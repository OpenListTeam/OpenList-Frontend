import { getLinkByDirAndObj } from "~/hooks/useLink"
import type { Obj } from "~/types"
import { api, base_path, ext, pathBase, pathDir, pathResolve } from "~/utils"

/**
 * Minimal hast shape. This runs after `rehype-raw`, so the tree only holds
 * element/text nodes and no `raw` node is left to expand.
 */
export interface HastNode {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

export interface MediaContext {
  /** storage path of the dir relative media urls are resolved against */
  baseDir: string
  /** storage path -> sign, taken from the folder listing when available */
  signs: Map<string, string>
}

// `![](x.mp4)` can never be played by an <img>, so it becomes a <video>
const VIDEO_EXTS = new Set(["mp4", "webm", "ogg", "ogv", "mov", "m4v", "mkv"])
const MEDIA_TAGS = new Set(["img", "video", "audio", "source", "track"])
// a link copied from this site may already carry a download/proxy prefix
const LINK_PREFIXES: [RegExp, string][] = [
  [/^\/sd\//, "/@s/"],
  [/^\/sp\//, "/@s/"],
  [/^\/[dp]\//, "/"],
]

const apiOrigin = (() => {
  try {
    return new URL(api).origin
  } catch {
    return ""
  }
})()

/**
 * The storage path a media url points to, or undefined when the url is not
 * ours to rewrite (other site, inline data, malformed).
 */
function resolveMediaPath(raw: unknown, ctx: MediaContext) {
  if (typeof raw !== "string") return
  let path = raw.trim()
  if (!path || /^(data|blob|about|javascript):/i.test(path)) return
  // protocol-relative: an external resource
  if (path.startsWith("//")) return

  let prefixed = true
  if (/^https?:/i.test(path)) {
    let url: URL
    try {
      url = new URL(path)
    } catch {
      return
    }
    if (url.origin !== apiOrigin) return
    path = url.pathname
    if (base_path && (path === base_path || path.startsWith(`${base_path}/`))) {
      path = path.slice(base_path.length) || "/"
    }
  } else if (path.startsWith("/")) {
    path = pathResolve("/", path)
  } else {
    path = pathResolve(ctx.baseDir, path)
    // a relative url never carries a link prefix
    prefixed = false
  }
  if (prefixed) {
    for (const [prefix, storage] of LINK_PREFIXES) {
      if (prefix.test(path)) {
        path = path.replace(prefix, storage)
        break
      }
    }
  }

  path = path.split(/[?#]/)[0]
  try {
    path = decodeURIComponent(path)
  } catch {
    // keep it when the author wrote malformed percent encoding
  }
  return path.startsWith("/") ? path : undefined
}

/**
 * The direct link of a storage path, built by the same helper the file list
 * uses, so the share prefix (`/sd`), `pwd`, `sign` and path encoding stay
 * consistent with the rest of the app.
 */
function toMediaLink(path: string, ctx: MediaContext) {
  const obj = { name: pathBase(path), sign: ctx.signs.get(path) } as Obj
  return getLinkByDirAndObj(
    pathDir(path),
    obj,
    "direct",
    path.startsWith("/@s"),
    true,
  )
}

/** href + storage path of a media url, or undefined to leave it untouched */
function resolveUrl(raw: unknown, ctx: MediaContext) {
  const path = resolveMediaPath(raw, ctx)
  return path ? { path, href: toMediaLink(path, ctx) } : undefined
}

/** `{ src, srcSet }` of a media element, with every url resolved */
function rewriteUrls(node: HastNode, ctx: MediaContext) {
  const properties = (node.properties ??= {})
  const src = resolveUrl(properties.src, ctx)
  if (src) {
    properties.src = src.href
    // lets the runtime fallback re-resolve through /fs/get when this link
    // turns out to need a signature that was not knowable at render time
    properties.dataMdPath = src.path
  }

  const poster = resolveUrl(properties.poster, ctx)
  if (poster) properties.poster = poster.href

  // "a.png 1x, b.png 2x": every candidate on its own, descriptors kept
  if (typeof properties.srcSet === "string") {
    properties.srcSet = properties.srcSet
      .split(",")
      .map((candidate) => {
        const [raw, ...descriptors] = candidate.trim().split(/\s+/)
        const url = resolveUrl(raw, ctx)
        return [url?.href ?? raw, ...descriptors].join(" ")
      })
      .join(", ")
  }

  return src
}

function toVideo(
  properties: Record<string, unknown>,
  src: { path: string; href: string },
): HastNode {
  // `alt`/`srcSet`/`sizes` mean nothing to a video element
  const { alt, srcSet, sizes, ...rest } = properties
  return {
    type: "element",
    tagName: "video",
    properties: {
      ...rest,
      src: src.href,
      dataMdPath: src.path,
      controls: true,
      preload: "metadata",
    },
    children: [],
  }
}

/**
 * rehype transformer: resolve media urls of the rendered markdown, and render
 * a video referenced with the image syntax as an actual player.
 */
export function rehypeMedia(root: HastNode, ctx: MediaContext) {
  const visit = (node: HastNode) => {
    const children = node.children
    if (!children) return
    children.forEach((child, index) => {
      if (child.type !== "element" || !child.tagName) return
      if (MEDIA_TAGS.has(child.tagName)) {
        const url = rewriteUrls(child, ctx)
        if (
          url &&
          child.tagName === "img" &&
          VIDEO_EXTS.has(ext(url.path).toLowerCase())
        ) {
          children[index] = toVideo(child.properties ?? {}, url)
        }
      }
      visit(child)
    })
  }
  visit(root)
}
