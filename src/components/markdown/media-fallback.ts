import { me, password } from "~/store"
import { fsGet, pathJoin } from "~/utils"

/**
 * Media of this deployment is linked through `/d`, which answers 401 when the
 * target needs a signature the folder listing didn't carry - a path outside
 * the current dir, a mounted share, or an encrypted meta. Only then the raw
 * url is resolved, per element that actually failed to load.
 */

// a raw url may be a temporary direct link, so it is not cached forever
const TTL = 10 * 60 * 1000
const resolved = new Map<string, { url: string; at: number }>()
const pending = new Map<string, Promise<string>>()

function fetchRawUrl(path: string) {
  const cached = resolved.get(path)
  if (cached && Date.now() - cached.at < TTL) return Promise.resolve(cached.url)
  const inflight = pending.get(path)
  if (inflight) return inflight

  const request = (async () => {
    try {
      const resp = await fsGet(pathJoin(me().base_path, path), password())
      return resp.code === 200 && resp.data?.raw_url ? resp.data.raw_url : ""
    } catch {
      return ""
    }
  })().then((url) => {
    pending.delete(path)
    if (url) resolved.set(path, { url, at: Date.now() })
    return url
  })
  pending.set(path, request)
  return request
}

function isBroken(el: HTMLElement) {
  if (el instanceof HTMLImageElement)
    return el.complete && el.naturalWidth === 0
  if (el instanceof HTMLMediaElement)
    return el.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
  return false
}

async function retryWithRawUrl(el: HTMLElement, path: string) {
  // one attempt per element per render, a raw url can't fail twice silently
  el.dataset.mdRetried = "1"
  const url = await fetchRawUrl(path)
  if (!url) {
    delete el.dataset.mdRetried
    return
  }
  el.setAttribute("src", url)
  // candidates of srcset win over src, so they must go away
  el.removeAttribute("srcset")
  el.removeAttribute("sizes")
  // <source>/<track> are only picked up again when the host reloads
  const host = el instanceof HTMLMediaElement ? el : el.closest("video, audio")
  if (host instanceof HTMLMediaElement) host.load()
}

export function watchMediaSrc(root?: ParentNode | null) {
  root
    ?.querySelectorAll<HTMLElement>("img,video,audio,source,track")
    .forEach((el) => {
      const path = el.dataset.mdPath
      if (!path || el.dataset.mdRetried) return
      // the request may already have failed before this runs
      if (isBroken(el)) {
        void retryWithRawUrl(el, path)
        return
      }
      el.addEventListener("error", () => void retryWithRawUrl(el, path), {
        once: true,
      })
    })
}
