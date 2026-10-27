/**
 * 纯前端 ZIP 解包（浏览器原生 DecompressionStream）。
 *
 * 之所以不直接依赖 fflate/jszip：
 *  - 打包进 bundle 会增加体积，而这里只需要读取少量条目（EPUB / 插件包）；
 *  - 从 CDN 动态加载则存在供应链与离线部署风险。
 * 因此使用浏览器原生 API，仅支持 store(0) 与 deflate(8) 两种压缩方式，
 * 这在 EPUB / 插件 zip 中覆盖了绝大多数情况。
 *
 * 解压过程带硬性上限：中央目录里声明的 uncompressedSize 可以伪造，
 * 所以按「实际输出字节」计数，超限立即中止，避免压缩炸弹把标签页打挂。
 */

/** 部分浏览器（Safari 16.4 之前）没有 DecompressionStream */
export const supportsNativeZip = () =>
  typeof DecompressionStream !== "undefined"

const MB = 1024 * 1024

/**
 * 解压超出安全上限时抛出的专用错误。
 *
 * 调用方必须把它和「环境不支持」区分开：这类错误不能回退到无上限的解压实现，
 * 否则压缩炸弹防护会被直接绕过。
 */
export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ZipLimitError"
  }
}

export interface ZipLimits {
  /** 单条目解压上限，默认 64MB */
  maxEntryBytes?: number
  /** 全部条目解压总量上限，默认 256MB */
  maxTotalBytes?: number
  /** 中央目录条目数上限，默认 20000 */
  maxEntries?: number
  /**
   * 单条目超过 maxEntryBytes 时跳过而不是整包失败。
   * EPUB 场景用：一张超大插图不该让整本书打不开；总量超限仍然终止。
   */
  skipOversizedEntries?: boolean
}

/** 默认上限：原生解压与 fflate 兜底路径共用同一套数值 */
export const DEFAULT_ZIP_LIMITS: Required<ZipLimits> = {
  maxEntryBytes: 64 * MB,
  maxTotalBytes: 256 * MB,
  maxEntries: 20000,
  skipOversizedEntries: false,
}

export interface ZipExtractOptions {
  limits?: ZipLimits
  /** 跳过一个超限条目时回调（EPUB 用来提示「已跳过 N 个超大资源」） */
  onSkip?: (name: string) => void
}

/**
 * 流式解压并统计实际输出字节数，超过 limit 立刻 cancel 并抛错。
 * 不用 Response.arrayBuffer() 是因为它无法在解压途中设检查点。
 */
async function inflateRaw(
  data: Uint8Array,
  limit: number,
): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw")
  const writer = ds.writable.getWriter()
  // 复制一份拿到确定以 ArrayBuffer 为底层的视图：TS 5.9 的 BufferSource 不接受
  // Uint8Array<ArrayBufferLike>（可能挂在 SharedArrayBuffer 上）
  const chunk = new Uint8Array(data.length)
  chunk.set(data)
  // 超限中止时整条流会被 abort，写入侧的 Promise 必然以 AbortError 拒绝；
  // 必须在这里吞掉，否则会变成 unhandledRejection。
  const writeDone = writer
    .write(chunk)
    .then(() => writer.close())
    .catch(() => undefined)

  const reader = ds.readable.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > limit) {
        // cancel 自身也可能以 AbortError 拒绝，同样不能漏出去
        await reader.cancel().catch(() => undefined)
        await writeDone
        throw new ZipLimitError(
          `ZIP entry exceeds the ${Math.round(limit / MB)}MB limit`,
        )
      }
      parts.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* already released */
    }
  }
  await writeDone

  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

/**
 * 解析 ZIP 中央目录，返回「条目路径 -> 未压缩字节」。
 * 只支持 store / deflate，其它压缩方式会被跳过而不是抛错。
 */
export async function extractZipNative(
  buffer: ArrayBuffer,
  opts: ZipExtractOptions = {},
): Promise<Record<string, Uint8Array>> {
  if (!supportsNativeZip()) {
    throw new Error("DecompressionStream is not supported in this environment")
  }
  const limits = { ...DEFAULT_ZIP_LIMITS, ...(opts.limits ?? {}) }
  const view = new DataView(buffer)
  const length = buffer.byteLength
  const files: Record<string, Uint8Array> = {}

  // 1. 定位 End of Central Directory（EOCD）记录
  let eocdOffset = -1
  for (let i = length - 22; i >= Math.max(0, length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) {
    throw new Error(
      "Invalid ZIP file: End of Central Directory signature not found",
    )
  }

  const cdCount = view.getUint16(eocdOffset + 10, true)
  const cdOffset = view.getUint32(eocdOffset + 16, true)
  if (cdCount > limits.maxEntries) {
    throw new ZipLimitError(`ZIP has too many entries (${cdCount})`)
  }
  if (cdOffset < 0 || cdOffset > length) {
    throw new Error("Invalid ZIP file: bad central directory offset")
  }

  let totalUncompressed = 0
  let currentCdOffset = cdOffset
  for (let i = 0; i < cdCount; i++) {
    if (
      currentCdOffset + 46 > length ||
      view.getUint32(currentCdOffset, true) !== 0x02014b50
    ) {
      break
    }
    const compressionMethod = view.getUint16(currentCdOffset + 10, true)
    const compressedSize = view.getUint32(currentCdOffset + 20, true)
    const fileNameLength = view.getUint16(currentCdOffset + 28, true)
    const extraFieldLength = view.getUint16(currentCdOffset + 30, true)
    const fileCommentLength = view.getUint16(currentCdOffset + 32, true)
    const localHeaderOffset = view.getUint32(currentCdOffset + 42, true)

    const fileNameBytes = new Uint8Array(
      buffer,
      currentCdOffset + 46,
      fileNameLength,
    )
    const fileName = new TextDecoder("utf-8").decode(fileNameBytes)

    currentCdOffset +=
      46 + fileNameLength + extraFieldLength + fileCommentLength

    // 跳过目录条目
    if (fileName.endsWith("/")) continue

    if (
      localHeaderOffset + 30 > length ||
      view.getUint32(localHeaderOffset, true) !== 0x04034b50
    ) {
      continue
    }
    const localFileNameLen = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true)
    const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen
    if (dataOffset + compressedSize > length) continue

    // 剩余总量额度：单条目上限与它取小
    const remaining = limits.maxTotalBytes - totalUncompressed
    if (remaining <= 0) {
      throw new ZipLimitError("ZIP uncompressed size exceeds the total limit")
    }
    // 这里区分两种超限，后续处理完全不同：
    //   exceedsEntryCap —— 单条目自己太大：允许调用方选择「跳过该条目」
    //   exceedsTotalCap —— 总量额度不够：必须终止整包，否则总量上限形同虚设
    const exceedsEntryCap = limits.maxEntryBytes < remaining
    const entryLimit = exceedsEntryCap ? limits.maxEntryBytes : remaining
    const exceedsTotalCap = !exceedsEntryCap
    const canSkipThisEntry = () =>
      limits.skipOversizedEntries && exceedsEntryCap

    if (compressionMethod === 0) {
      if (compressedSize > entryLimit) {
        if (canSkipThisEntry()) {
          opts.onSkip?.(fileName)
          continue
        }
        throw new ZipLimitError(
          exceedsTotalCap
            ? "ZIP uncompressed size exceeds the total limit"
            : `ZIP entry exceeds the ${Math.round(entryLimit / MB)}MB limit`,
        )
      }
      files[fileName] = new Uint8Array(
        new Uint8Array(buffer, dataOffset, compressedSize),
      )
      totalUncompressed += compressedSize
    } else if (compressionMethod === 8) {
      let out: Uint8Array
      try {
        out = await inflateRaw(
          new Uint8Array(buffer, dataOffset, compressedSize),
          entryLimit,
        )
      } catch (err) {
        if (err instanceof ZipLimitError) {
          if (canSkipThisEntry()) {
            opts.onSkip?.(fileName)
            continue
          }
          if (exceedsTotalCap) {
            throw new ZipLimitError(
              "ZIP uncompressed size exceeds the total limit",
            )
          }
        }
        throw err
      }
      files[fileName] = out
      totalUncompressed += out.byteLength
    }
  }

  return files
}
