import { api } from "./config"
import { mediaStatus } from "~/store/media"

/**
 * 媒体封面地址解析：
 * - data:/blob: 直接使用（刮削时写入的 base64 缩略图）
 * - http(s) 外链走服务端代理（TMDB / 豆瓣 / Discogs 在部分网络下不可直连）
 * - /d/imgs/... 是刮削器写入本地磁盘的缩略图，改用本地缩略图接口读取
 * - 其它 VFS 路径补上站点地址，避免相对路径落到前端路由上
 */
export const resolveMediaCover = (
  cover?: string,
  thumbBase?: string,
): string => {
  if (!cover) return ""
  thumbBase = thumbBase || mediaStatus().thumb_path || "/imgs"
  if (cover.startsWith("data:") || cover.startsWith("blob:")) return cover
  if (/^https?:\/\//i.test(cover)) {
    return `${api}/api/public/media/proxy?url=${encodeURIComponent(cover)}`
  }
  let p = cover
  if (p.startsWith("/d/")) p = p.slice(2)
  const base = thumbBase.replace(/\/+$/, "")
  if (base && (p === base || p.startsWith(base + "/"))) {
    return `${api}/api/public/media/thumb?path=${encodeURIComponent(p)}`
  }
  if (p.startsWith("/")) return `${api}/d${p}`
  return p
}
