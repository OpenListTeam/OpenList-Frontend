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

export interface ZipLimits {
  /** 单条目解压上限，默认 64MB */
  maxEntryBytes?: number
  /** 全部条目解压总量上限，默认 256MB */
  maxTotalBytes?: number
  /** 中央目录条目数上限，默认 20000 */
  maxEntries?: number
}

const DEFAULT_LIMITS: Required<ZipLimits> = {
  maxEntryBytes: 64 * MB,
  maxTotalBytes: 256 * MB,
  maxEntries: 20000,
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
  void writer.write(chunk)
  void writer.close()

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
        await reader.cancel().catch(() => undefined)
        throw new Error(
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
  opts: { limits?: ZipLimits } = {},
): Promise<Record<string, Uint8Array>> {
  if (!supportsNativeZip()) {
    throw new Error("DecompressionStream is not supported in this environment")
  }
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) }
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
    throw new Error(`ZIP has too many entries (${cdCount})`)
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

    // 剩余可用额度：单条目上限与总量剩余额度取小
    const entryLimit = Math.min(
      limits.maxEntryBytes,
      limits.maxTotalBytes - totalUncompressed,
    )
    if (entryLimit <= 0) {
      throw new Error("ZIP uncompressed size exceeds the total limit")
    }

    if (compressionMethod === 0) {
      if (compressedSize > entryLimit) {
        throw new Error(
          `ZIP entry exceeds the ${Math.round(entryLimit / MB)}MB limit`,
        )
      }
      files[fileName] = new Uint8Array(
        new Uint8Array(buffer, dataOffset, compressedSize),
      )
      totalUncompressed += compressedSize
    } else if (compressionMethod === 8) {
      const out = await inflateRaw(
        new Uint8Array(buffer, dataOffset, compressedSize),
        entryLimit,
      )
      files[fileName] = out
      totalUncompressed += out.byteLength
    }
  }

  return files
}
