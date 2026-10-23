import { PluginItem, PluginType } from "~/types"
import { loadScriptIIFE } from "./load_external"
import { DEFAULT_ZIP_LIMITS, ZipLimitError, extractZipNative } from "./zip_read"

export interface ExtractedPluginPackage {
  manifest: Partial<PluginItem>
  files: {
    manifestFile?: string
    scriptFile?: string
    styleFile?: string
    iconFile?: string
    readmeFile?: string
  }
}

/**
 * Parse a ZIP file and extract plugin files (manifest, scripts, styles, icon)
 */
export async function parsePluginZip(
  file: File | ArrayBuffer,
): Promise<ExtractedPluginPackage> {
  const buffer = file instanceof File ? await file.arrayBuffer() : file
  const extractedFiles = await extractZipEntries(buffer)

  // 1. Locate manifest file (plugin.json, manifest.json, or openlist-plugin.json)
  const manifestFileName = Object.keys(extractedFiles).find((name) => {
    const lower = name.toLowerCase()
    return (
      lower === "plugin.json" ||
      lower.endsWith("/plugin.json") ||
      lower === "manifest.json" ||
      lower.endsWith("/manifest.json") ||
      lower === "openlist-plugin.json"
    )
  })

  let manifest: Partial<PluginItem> = {}
  if (manifestFileName && extractedFiles[manifestFileName]) {
    try {
      const text = new TextDecoder("utf-8").decode(
        extractedFiles[manifestFileName],
      )
      manifest = JSON.parse(text)
    } catch (e: any) {
      throw new Error(
        `Failed to parse plugin manifest (${manifestFileName}): ${e.message}`,
      )
    }
  }

  // Find prefix folder if files are nested inside a root folder (e.g. repo-main/)
  let prefix = ""
  if (manifestFileName && manifestFileName.includes("/")) {
    prefix = manifestFileName.slice(0, manifestFileName.lastIndexOf("/") + 1)
  }

  // 2. Find JavaScript entry file if script_content is not embedded in manifest
  let scriptFile = ""
  if (!manifest.script_content) {
    const candidateJs = Object.keys(extractedFiles).find((name) => {
      const rel = prefix ? name.replace(prefix, "") : name
      const lower = rel.toLowerCase()
      return (
        lower === "index.js" ||
        lower === "main.js" ||
        lower === "plugin.js" ||
        lower === "script.js" ||
        (manifest.entry_url && lower === manifest.entry_url.toLowerCase())
      )
    })
    if (candidateJs) {
      scriptFile = candidateJs
      manifest.script_content = new TextDecoder("utf-8").decode(
        extractedFiles[candidateJs],
      )
    }
  }

  // 3. Find CSS stylesheet if style_content is not embedded in manifest
  let styleFile = ""
  if (!manifest.style_content) {
    const candidateCss = Object.keys(extractedFiles).find((name) => {
      const rel = prefix ? name.replace(prefix, "") : name
      const lower = rel.toLowerCase()
      return (
        lower === "style.css" || lower === "index.css" || lower === "main.css"
      )
    })
    if (candidateCss) {
      styleFile = candidateCss
      manifest.style_content = new TextDecoder("utf-8").decode(
        extractedFiles[candidateCss],
      )
    }
  }

  // 4. Find icon if not specified
  let iconFile = ""
  if (!manifest.icon) {
    const candidateIcon = Object.keys(extractedFiles).find((name) => {
      const rel = prefix ? name.replace(prefix, "") : name
      const lower = rel.toLowerCase()
      return (
        lower === "icon.svg" ||
        lower === "icon.png" ||
        lower === "icon.jpg" ||
        lower === "logo.svg" ||
        lower === "logo.png"
      )
    })
    if (candidateIcon) {
      iconFile = candidateIcon
      const bytes = extractedFiles[candidateIcon]
      const ext = candidateIcon.toLowerCase().endsWith(".svg")
        ? "image/svg+xml"
        : "image/png"
      const base64 = uint8ArrayToBase64(bytes)
      manifest.icon = `data:${ext};base64,${base64}`
    }
  }

  // Fallback default ID and name if missing
  if (!manifest.id) {
    if (file instanceof File) {
      manifest.id = file.name
        .replace(/\.zip$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
    } else {
      manifest.id = "oplist-plugin-" + Math.random().toString(36).slice(2, 8)
    }
  }
  if (!manifest.name) {
    manifest.name = manifest.id
  }
  if (!manifest.version) {
    manifest.version = "1.0.0"
  }
  if (!manifest.type) {
    manifest.type = "ui" as PluginType
  }
  if (manifest.enabled === undefined) {
    manifest.enabled = true
  }

  return {
    manifest,
    files: {
      manifestFile: manifestFileName,
      scriptFile,
      styleFile,
      iconFile,
    },
  }
}

/**
 * Native ZIP parser utilizing DecompressionStream / fallback
 */
async function extractZipEntries(
  buffer: ArrayBuffer,
): Promise<Record<string, Uint8Array>> {
  try {
    return await extractZipNative(buffer)
  } catch (err) {
    // 超限错误必须直接抛出：下面的 fflate 兜底没有任何大小上限，
    // 回退过去等于把压缩炸弹防护整个绕过（还会额外拉一次 CDN 脚本）。
    if (err instanceof ZipLimitError) throw err
    // 只对「原生解压不支持该 zip」这类环境问题回退
    return await extractZipFallback(buffer)
  }
}

async function extractZipFallback(
  buffer: ArrayBuffer,
): Promise<Record<string, Uint8Array>> {
  if (typeof window !== "undefined" && !(window as any).fflate) {
    await loadScriptIIFE(
      "https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js",
      "fflate-lib",
    )
  }
  const fflate = (window as any).fflate
  if (!fflate) {
    throw new Error("Failed to load ZIP extraction module")
  }

  // 兜底路径必须和原生解压走同一套上限，否则压缩炸弹正好可以从这里绕过：
  // fflate 会按中央目录声明的 originalSize 分配缓冲区，所以按声明值过滤即可挡住。
  const limits = DEFAULT_ZIP_LIMITS
  let seen = 0
  let total = 0
  let skipped = 0

  return new Promise((resolve, reject) => {
    fflate.unzip(
      new Uint8Array(buffer),
      {
        filter: (file: { originalSize: number }) => {
          seen += 1
          if (seen > limits.maxEntries) {
            skipped += 1
            return false
          }
          if (file.originalSize > limits.maxEntryBytes) {
            skipped += 1
            return false
          }
          if (total + file.originalSize > limits.maxTotalBytes) {
            skipped += 1
            return false
          }
          total += file.originalSize
          return true
        },
      },
      (err: any, unzipped: Record<string, Uint8Array>) => {
        if (err) {
          reject(err)
          return
        }
        if (skipped > 0) {
          // 插件包不该静默丢文件：超限直接报错，让用户知道需要精简插件
          reject(
            new ZipLimitError(
              `插件包中有 ${skipped} 个条目超过解压上限（单条 ${Math.round(
                limits.maxEntryBytes / 1024 / 1024,
              )}MB / 总量 ${Math.round(
                limits.maxTotalBytes / 1024 / 1024,
              )}MB）`,
            ),
          )
          return
        }
        resolve(unzipped)
      },
    )
  })
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ""
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
