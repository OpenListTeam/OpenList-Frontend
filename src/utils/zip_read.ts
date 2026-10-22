/**
 * 纯前端 ZIP 解包（浏览器原生 DecompressionStream）。
 *
 * 之所以不直接依赖 fflate/jszip：
 *  - 打包进 bundle 会增加体积，而这里只需要读取少量条目（EPUB / 插件包）；
 *  - 从 CDN 动态加载则存在供应链与离线部署风险。
 * 因此使用浏览器原生 API，仅支持 store(0) 与 deflate(8) 两种压缩方式，
 * 这在 EPUB / 插件 zip 中覆盖了绝大多数情况。
 */

/** 部分浏览器（Safari 16.4 之前）没有 DecompressionStream */
export const supportsNativeZip = () =>
  typeof DecompressionStream !== "undefined"

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw")
  const writer = ds.writable.getWriter()
  // 复制一份拿到确定以 ArrayBuffer 为底层的视图：TS 5.9 的 BufferSource 不接受
  // Uint8Array<ArrayBufferLike>（可能挂在 SharedArrayBuffer 上）
  const chunk = new Uint8Array(data.length)
  chunk.set(data)
  void writer.write(chunk)
  void writer.close()
  const out = await new Response(ds.readable).arrayBuffer()
  return new Uint8Array(out)
}

/**
 * 解析 ZIP 中央目录，返回「条目路径 -> 未压缩字节」。
 * 只支持 store / deflate，其它压缩方式会被跳过而不是抛错。
 */
export async function extractZipNative(
  buffer: ArrayBuffer,
): Promise<Record<string, Uint8Array>> {
  if (!supportsNativeZip()) {
    throw new Error("DecompressionStream is not supported in this environment")
  }
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

  let currentCdOffset = cdOffset
  for (let i = 0; i < cdCount; i++) {
    if (view.getUint32(currentCdOffset, true) !== 0x02014b50) {
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

    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      continue
    }
    const localFileNameLen = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true)
    const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen
    const compressedData = new Uint8Array(buffer, dataOffset, compressedSize)

    if (compressionMethod === 0) {
      files[fileName] = new Uint8Array(compressedData)
    } else if (compressionMethod === 8) {
      files[fileName] = await inflateRaw(compressedData)
    }
  }

  return files
}
