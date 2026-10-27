import { api } from "./config"
import { mediaStatus } from "~/store/media"

/**
 * 媒体封面地址解析：
 * - data:/blob: 直接使用（base64 模式）
 * - thumb:/imgs/x.jpg 运行目录模式，走本地缩略图接口
 * - /d/... 挂载目录（VFS）模式，补全站点地址后由 /d 直链返回
 * - http(s) 外链，按设置决定是否走服务端代理
 */
export const resolveMediaCover = (cover?: string): string => {
  if (!cover) return ""
  if (cover.startsWith("data:") || cover.startsWith("blob:")) return cover
  if (cover.startsWith("thumb:")) {
    return `${api}/api/public/media/thumb?path=${encodeURIComponent(cover.slice(6))}`
  }
  if (/^https?:\/\//i.test(cover)) {
    // 是否走服务端代理由设置决定，默认直接使用原始地址
    return mediaStatus().proxy_cover
      ? `${api}/api/public/media/proxy?url=${encodeURIComponent(cover)}`
      : cover
  }
  if (cover.startsWith("/")) return `${api}${cover}`
  return cover
}
