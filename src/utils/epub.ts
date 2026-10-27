import { extractZipNative } from "./zip_read"

/**
 * 轻量 EPUB 阅读器解析层。
 *
 * 之前用 cdnjs 上的 epub.js：运行时从第三方 CDN 拉脚本，离线部署不可用，
 * 且引入供应链风险。这里改为就地解析：EPUB 本质是 ZIP + XHTML，
 * 用浏览器原生 DecompressionStream 解包即可，无需外部依赖。
 *
 * 章节内容会在 sandbox iframe 中以 srcdoc 渲染（禁止脚本、非同源），
 * 图片/CSS 通过 blob URL 内联，不会向外部发起任何请求。
 */

export interface EpubChapter {
  /** 目录中的标题（无目录时取正文首个标题） */
  title: string
  /** 该章在书内的路径（已解析为绝对路径，不含 fragment） */
  href: string
  /** 已消毒、可直接放进 sandbox iframe 的 HTML */
  html: string
}

export interface EpubBook {
  title: string
  chapters: EpubChapter[]
  /** 因超过解压上限被跳过的资源数（超大插图等），用于给用户提示 */
  skippedEntries: number
  /** 释放过程中创建的 blob URL */
  revoke: () => void
}

const decoder = new TextDecoder("utf-8")

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  css: "text/css",
  js: "text/javascript",
}

const mimeOf = (path: string) => {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase()
  return MIME_BY_EXT[ext] ?? "application/octet-stream"
}

const dirOf = (path: string) => {
  const i = path.lastIndexOf("/")
  return i < 0 ? "" : path.slice(0, i)
}

/** 以 baseDir 为基准解析相对路径，消解 "." 与 ".." */
export const resolvePath = (baseDir: string, rel: string): string => {
  const clean = rel.split("#")[0].split("?")[0].trim()
  const joined = clean.startsWith("/")
    ? clean.slice(1)
    : baseDir
      ? `${baseDir}/${clean}`
      : clean
  const out: string[] = []
  for (const part of joined.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join("/")
}

const tryDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** 解析 XML/HTML，失败时退回宽松的 HTML 解析器 */
const parseDoc = (text: string, xml = true): Document => {
  const doc = new DOMParser().parseFromString(
    text,
    xml ? "application/xml" : "text/html",
  )
  if (xml && doc.getElementsByTagName("parsererror").length > 0) {
    return new DOMParser().parseFromString(text, "text/html")
  }
  return doc
}

const isExternal = (ref: string) =>
  /^(data:|https?:|blob:|javascript:|mailto:|tel:|#)/i.test(ref.trim())

/** 去掉脚本与事件属性，阻断 EPUB 内的 XSS 尝试 */
const sanitize = (root: Element) => {
  root
    .querySelectorAll(
      "script, iframe, object, embed, form, input, textarea, button, link, meta, base",
    )
    .forEach((n) => n.remove())
  root.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name)
        continue
      }
      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        /^\s*javascript:/i.test(attr.value)
      ) {
        el.removeAttribute(attr.name)
      }
    }
  })
}

/** 取出 epub3 nav / epub2 ncx 中的目录项（href 已解析为书内绝对路径） */
const parseToc = (
  readText: (path: string) => string | undefined,
  navPath: string | undefined,
  ncxPath: string | undefined,
): Array<{ label: string; href: string }> => {
  const toc: Array<{ label: string; href: string }> = []

  const navText = navPath ? readText(navPath) : undefined
  if (navPath && navText) {
    const doc = parseDoc(navText, false)
    const navs = Array.from(doc.getElementsByTagName("nav"))
    const tocNav =
      navs.find((n) =>
        (n.getAttribute("epub:type") ?? n.getAttribute("type") ?? "").includes(
          "toc",
        ),
      ) ?? navs[0]
    if (tocNav) {
      const baseDir = dirOf(navPath)
      tocNav.querySelectorAll("a[href]").forEach((a) => {
        const href = a.getAttribute("href")
        const label = (a.textContent ?? "").trim()
        if (!href || !label) return
        toc.push({ label, href: resolvePath(baseDir, href) })
      })
    }
  }

  const ncxText = ncxPath ? readText(ncxPath) : undefined
  if (toc.length === 0 && ncxPath && ncxText) {
    const doc = parseDoc(ncxText)
    const baseDir = dirOf(ncxPath)
    Array.from(doc.getElementsByTagName("navPoint")).forEach((point) => {
      const label = (
        point
          .getElementsByTagName("navLabel")[0]
          ?.getElementsByTagName("text")[0]?.textContent ?? ""
      ).trim()
      const src = point.getElementsByTagName("content")[0]?.getAttribute("src")
      if (!label || !src) return
      toc.push({ label, href: resolvePath(baseDir, src) })
    })
  }

  return toc
}

interface ManifestItem {
  href: string
  mediaType: string
  properties: string
}

export async function loadEpub(url: string): Promise<EpubBook> {
  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }
  // 单条目超限（常见于超大插图）时跳过并继续，避免整本书打不开；
  // 总量超限仍然会中止解压。跳过的数量会传给阅读器，避免用户只看到裂图却没提示。
  let skippedEntries = 0
  const files = await extractZipNative(await resp.arrayBuffer(), {
    limits: { skipOversizedEntries: true },
    onSkip: () => {
      skippedEntries++
    },
  })

  // 预建索引：EPUB 内路径可能带 %20 编码或大小写不一致。
  // 之前每次未命中都全量扫描 Object.keys，图片多时会退化成 O(n²)。
  const lowerIndex = new Map<string, Uint8Array>()
  for (const [name, data] of Object.entries(files)) {
    const key = tryDecode(name).toLowerCase()
    if (!lowerIndex.has(key)) lowerIndex.set(key, data)
  }
  const findEntry = (path: string): Uint8Array | undefined => {
    const decoded = tryDecode(path)
    return files[decoded] ?? lowerIndex.get(decoded.toLowerCase())
  }

  const readText = (path: string) => {
    const data = findEntry(path)
    return data ? decoder.decode(data) : undefined
  }

  const blobUrls: string[] = []
  const resourceCache = new Map<string, string>()

  const makeBlobUrl = (path: string): string => {
    const cached = resourceCache.get(path)
    if (cached) return cached
    const data = findEntry(path)
    if (!data) return ""
    const buffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer
    const blobUrl = URL.createObjectURL(
      new Blob([buffer], { type: mimeOf(path) }),
    )
    resourceCache.set(path, blobUrl)
    blobUrls.push(blobUrl)
    return blobUrl
  }

  /** 把 CSS 中的相对 url() 换成 blob URL；外链与 data URI 保持原样 */
  const rewriteCss = (css: string, cssDir: string) =>
    css.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (match, _quote, ref) => {
      if (isExternal(ref)) return match
      const blobUrl = makeBlobUrl(resolvePath(cssDir, ref))
      return blobUrl ? `url("${blobUrl}")` : match
    })

  // ---- 1. container.xml -> OPF ----
  const containerXml = readText("META-INF/container.xml")
  if (!containerXml) {
    throw new Error("不是有效的 EPUB：缺少 META-INF/container.xml")
  }
  const containerDoc = parseDoc(containerXml)
  const rootfile = containerDoc.getElementsByTagName("rootfile")[0]
  const opfPath = rootfile?.getAttribute("full-path")
  const opfText = opfPath ? readText(opfPath) : undefined
  if (!opfPath || !opfText) {
    throw new Error("不是有效的 EPUB：找不到 OPF 包文件")
  }
  const opfDir = dirOf(opfPath)
  const opfDoc = parseDoc(opfText)

  const title =
    (
      opfDoc.getElementsByTagName("dc:title")[0]?.textContent ??
      opfDoc.getElementsByTagName("title")[0]?.textContent ??
      ""
    ).trim() || "EPUB"

  // ---- 2. manifest / spine ----
  const manifest = new Map<string, ManifestItem>()
  Array.from(opfDoc.getElementsByTagName("item")).forEach((item) => {
    const id = item.getAttribute("id")
    const href = item.getAttribute("href")
    if (!id || !href) return
    manifest.set(id, {
      href: resolvePath(opfDir, href),
      mediaType: item.getAttribute("media-type") ?? "",
      properties: item.getAttribute("properties") ?? "",
    })
  })

  let navPath: string | undefined
  let ncxPath: string | undefined
  manifest.forEach((item) => {
    if (item.properties.split(/\s+/).includes("nav")) navPath = item.href
    if (item.mediaType === "application/x-dtbncx+xml") ncxPath = item.href
  })

  const spineEl = opfDoc.getElementsByTagName("spine")[0]
  const spineIds = Array.from(opfDoc.getElementsByTagName("itemref"))
    .map((ref) => ref.getAttribute("idref"))
    .filter((id): id is string => !!id)
  if (!ncxPath && spineEl) {
    const tocId = spineEl.getAttribute("toc")
    const tocItem = tocId ? manifest.get(tocId) : undefined
    if (tocItem) ncxPath = tocItem.href
  }

  const toc = parseToc(readText, navPath, ncxPath)

  // ---- 3. 逐章渲染 ----
  const chapters: EpubChapter[] = []
  for (const id of spineIds) {
    const item = manifest.get(id)
    if (!item) continue
    if (item.mediaType && !/xhtml|html|xml/i.test(item.mediaType)) {
      // 图片等非文本 spine 项跳过（极少见）
      if (!/\.x?html?$/i.test(item.href)) continue
    }
    const raw = readText(item.href)
    if (!raw) continue
    const doc = parseDoc(raw, false)
    const chapterDir = dirOf(item.href)

    // 图片 -> blob URL
    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src")
      if (!src) return
      if (isExternal(src)) {
        if (/^javascript:/i.test(src)) img.removeAttribute("src")
        return
      }
      const blobUrl = makeBlobUrl(resolvePath(chapterDir, src))
      if (blobUrl) img.setAttribute("src", blobUrl)
      else img.remove()
    })
    doc.querySelectorAll("image").forEach((image) => {
      const href =
        image.getAttribute("xlink:href") ?? image.getAttribute("href")
      if (!href || isExternal(href)) return
      const blobUrl = makeBlobUrl(resolvePath(chapterDir, href))
      if (blobUrl) {
        image.setAttribute("xlink:href", blobUrl)
        image.setAttribute("href", blobUrl)
      }
    })

    // 外链样式表 -> 内联 <style>
    doc.querySelectorAll("link[rel~='stylesheet']").forEach((link) => {
      const href = link.getAttribute("href")
      if (!href || isExternal(href)) return
      const cssPath = resolvePath(chapterDir, href)
      const css = readText(cssPath)
      if (!css) return
      const style = doc.createElement("style")
      style.textContent = rewriteCss(css, dirOf(cssPath))
      link.replaceWith(style)
    })

    // 内联样式中的相对资源
    doc.querySelectorAll("style").forEach((style) => {
      style.textContent = rewriteCss(style.textContent ?? "", chapterDir)
    })

    const body = doc.body
    if (!body) continue
    sanitize(body)
    // 链接处理：书内跳转已无意义（章节是独立渲染的），外链也不能留在 href 上——
    // CSP 只约束子资源、不约束导航，点击会把沙箱 iframe 自己导航到第三方页面
    // （父页面看不到地址栏，典型钓鱼场景）。外链改存 data-href，由阅读器用 window.open 打开。
    body.querySelectorAll("a[href]").forEach((a) => {
      const href = (a.getAttribute("href") ?? "").trim()
      // 书内锚点（脚注等）保留
      if (href.startsWith("#")) return
      a.setAttribute("href", "#")
      if (/^(?:https?:)?\/\//i.test(href) || /^mailto:/i.test(href)) {
        a.setAttribute("data-href", href)
      } else {
        a.removeAttribute("data-href")
      }
    })

    const firstHeading = body.querySelector("h1, h2, h3, title")
    const firstLine = body.textContent?.trim().split("\n")[0]?.trim() ?? ""
    const index = chapters.length + 1
    const tocEntry = toc.find((t) => t.href === item.href)
    chapters.push({
      href: item.href,
      title:
        tocEntry?.label ||
        firstHeading?.textContent?.trim() ||
        firstLine.slice(0, 40) ||
        `第 ${index} 章`,
      html: body.innerHTML,
    })
  }

  if (chapters.length === 0) {
    throw new Error("EPUB 中没有可显示的章节")
  }

  return {
    title,
    chapters,
    skippedEntries,
    revoke: () => {
      blobUrls.forEach((u) => URL.revokeObjectURL(u))
      blobUrls.length = 0
      resourceCache.clear()
    },
  }
}

/** 生成用于 iframe srcdoc 的完整文档（深色阅读主题 + 基本排版） */
export const buildChapterDoc = (chapter: EpubChapter) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<!--
  强制拦截一切外部请求：srcdoc 里的 <img src="https://...">、CSS @import、
  相对路径 url(/api/...) 都会在这里被浏览器拒绝，恶意 EPUB 无法回传阅读行为。
  只允许 blob:/data:（章节图片、字体都由父页面注入的 blob URL 提供）。
-->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; font-src blob: data:; media-src blob: data:">
<style>
  html, body { margin: 0; padding: 0; }
  body {
    background: #1e1e2e;
    color: #e2e8f0;
    font-family: Georgia, "Songti SC", "Noto Serif CJK SC", serif;
    line-height: 1.85;
    padding: 24px 40px 48px;
    font-size: 17px;
    word-wrap: break-word;
  }
  img, svg, video { max-width: 100%; height: auto; }
  a { color: #a5b4fc; text-decoration: none; }
  h1, h2, h3, h4 { line-height: 1.4; }
  blockquote { border-left: 3px solid #4c4f69; margin-left: 0; padding-left: 16px; color: #cbd5e1; }
  pre { white-space: pre-wrap; }
</style>
</head>
<body>${chapter.html}</body>
</html>`
