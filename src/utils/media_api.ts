import { createResource } from "solid-js"
import { api, r } from "~/utils"
import { encodePath } from "~/utils/path"
import type {
  MediaItem,
  AlbumInfo,
  MediaConfig,
  MediaScanPath,
  MediaScanProgress,
  MediaListQuery,
  MediaType,
} from "~/types"
import type { Resp } from "~/types"

// ==================== 公开API ====================

/** 获取媒体列表 */
export const getMediaList = (query: MediaListQuery) =>
  r.get("/fs/media/list", { params: query }) as Promise<
    Resp<{ content: MediaItem[]; total: number }>
  >

/** 获取媒体详情 */
export const getMediaItem = (id: number) =>
  r.get(`/fs/media/item/${id}`) as Promise<Resp<MediaItem>>

/** 获取专辑列表 */
export const getAlbumList = (params: {
  page?: number
  page_size?: number
  keyword?: string
  scan_path_id?: number
}) =>
  r.get("/fs/media/albums", { params }) as Promise<
    Resp<{ content: AlbumInfo[]; total: number }>
  >

/** 获取专辑曲目 */
export const getAlbumTracks = (albumName: string, albumArtist: string) =>
  r.get("/fs/media/album", {
    params: { album_name: albumName, album_artist: albumArtist },
  }) as Promise<Resp<MediaItem[]>>

/** 获取文件夹列表（目录浏览模式） */
export const getMediaFolders = (mediaType: MediaType) =>
  r.get("/fs/media/folders", { params: { media_type: mediaType } }) as Promise<
    Resp<string[]>
  >

/** 获取扫描路径列表（公开，用于前端筛选） */
export const getMediaScanPaths = (mediaType?: MediaType) =>
  r.get("/fs/media/scan_paths", {
    params: mediaType ? { media_type: mediaType } : {},
  }) as Promise<Resp<MediaScanPath[]>>

/** 媒体库状态（是否启用、已启用类型、协议地址） */
export const getMediaStatus = () =>
  r.get("/public/media_status") as Promise<
    Resp<import("~/store/media").MediaStatus>
  >

// ==================== 管理API ====================

/** 获取所有媒体库配置 */
export const adminGetMediaConfigs = () =>
  r.get("/admin/media/config/list") as Promise<Resp<MediaConfig[]>>

/** 保存媒体库配置 */
export const adminSaveMediaConfig = (cfg: Partial<MediaConfig>) =>
  r.post("/admin/media/config/save", cfg) as Promise<Resp<null>>

/** 获取扫描路径列表（管理） */
export const adminListMediaScanPaths = (mediaType?: MediaType) =>
  r.get("/admin/media/scan_paths", {
    params: mediaType ? { media_type: mediaType } : {},
  }) as Promise<Resp<MediaScanPath[]>>

/** 创建扫描路径 */
export const adminCreateMediaScanPath = (sp: Partial<MediaScanPath>) =>
  r.post("/admin/media/scan_paths/create", sp) as Promise<Resp<MediaScanPath>>

/** 更新扫描路径 */
export const adminUpdateMediaScanPath = (
  sp: Partial<MediaScanPath> & { id: number },
) => r.post("/admin/media/scan_paths/update", sp) as Promise<Resp<null>>

/** 删除扫描路径 */
export const adminDeleteMediaScanPath = (id: number) =>
  r.post("/admin/media/scan_paths/delete", null, {
    params: { id },
  }) as Promise<Resp<null>>

/** 清空扫描路径数据 */
export const adminClearMediaScanPathDB = (id: number) =>
  r.post("/admin/media/scan_paths/clear", null, {
    params: { id },
  }) as Promise<Resp<null>>

/** 后台获取媒体条目列表 */
export const adminGetMediaItems = (params: {
  media_type?: MediaType
  scan_path_id?: number
  page?: number
  page_size?: number
  keyword?: string
  order_by?: string
  order_dir?: string
}) =>
  r.get("/admin/media/items", { params }) as Promise<
    Resp<{ content: MediaItem[]; total: number }>
  >

/** 更新媒体条目 */
export const adminUpdateMediaItem = (
  item: Partial<MediaItem> & { id: number },
) => r.post("/admin/media/items/update", item) as Promise<Resp<null>>

/** 删除媒体条目 */
export const adminDeleteMediaItem = (id: number) =>
  r.post("/admin/media/items/delete", null, {
    params: { id },
  }) as Promise<Resp<null>>

/** 开始扫描（可指定单个扫描路径） */
export const adminStartMediaScan = (
  mediaType: MediaType,
  scanPathId?: number,
) =>
  r.post("/admin/media/scan/start", {
    media_type: mediaType,
    scan_path_id: scanPathId ?? 0,
  }) as Promise<Resp<null>>

/** 获取扫描进度 */
export const adminGetMediaScanProgress = (mediaType: MediaType) =>
  r.get("/admin/media/scan/progress", {
    params: { media_type: mediaType },
  }) as Promise<Resp<MediaScanProgress>>

/** 开始刮削 */
export const adminStartMediaScrape = (mediaType: MediaType, itemId?: number) =>
  r.post("/admin/media/scrape/start", {
    media_type: mediaType,
    item_id: itemId ?? 0,
  }) as Promise<Resp<null>>

/** 清空媒体数据库（整个类型） */
export const adminClearMediaDB = (mediaType: MediaType) =>
  r.post("/admin/media/clear", null, {
    params: { media_type: mediaType },
  }) as Promise<Resp<null>>

/** 清空刮削数据（保留扫描记录，只清空刮削结果字段）
 *  mediaType 为空表示清空所有类型
 */
export const adminClearMediaScrape = (mediaType?: MediaType) =>
  r.post("/admin/media/clear_scrape", null, {
    params: mediaType ? { media_type: mediaType } : {},
  }) as Promise<Resp<{ affected: number }>>

/** 删除已失效的媒体条目（对应文件已不存在）
 *  mediaType 为空表示扫描所有类型
 */
export const adminDeleteInvalidMedia = (mediaType?: MediaType) =>
  r.post("/admin/media/delete_invalid", null, {
    params: mediaType ? { media_type: mediaType } : {},
  }) as Promise<Resp<{ checked: number; deleted: number; skipped?: number }>>

/** 导出媒体数据
 *  - mediaType 为空 + scanPathId 为空 => 全部导出
 *  - 仅 mediaType => 导出指定类型
 *  - 仅 scanPathId => 导出单个扫描路径
 *  返回 Blob，供前端触发浏览器下载
 */
export const adminExportMediaDB = (
  mediaType?: MediaType,
  scanPathId?: number,
) => {
  const params: Record<string, any> = {}
  if (mediaType) params.media_type = mediaType
  if (scanPathId) params.scan_path_id = scanPathId
  return r.get("/admin/media/export", {
    params,
    responseType: "blob",
  }) as unknown as Promise<Blob>
}

/** 导入媒体数据（multipart/form-data）
 *  scanPathId 可选：传入则把导入条目的 scan_path_id 全部覆盖为该值
 *  （用于"导入到指定扫描路径"场景）
 */
export const adminImportMediaDB = (file: File, scanPathId?: number) => {
  const form = new FormData()
  form.append("file", file)
  const params: Record<string, any> = {}
  if (scanPathId) params.scan_path_id = scanPathId
  return r.post("/admin/media/import", form, {
    params,
    headers: { "Content-Type": "multipart/form-data" },
  }) as Promise<
    Resp<{
      scan_paths_created: number
      scan_paths_updated: number
      items_created: number
      items_updated: number
    }>
  >
}

/** 获取条目（或某一集）的签名直链，供本地播放器使用 */
export const getMediaStreamUrl = (params: {
  id?: number
  episode?: number
  path?: string
}) =>
  r.get("/fs/media/stream_url", { params }) as Promise<
    Resp<{ url: string; path: string; name: string; proxied: string }>
  >

// ==================== 签名代理 URL ====================
// 直接拼接 `/p${path}?force` 有两个问题：
//  1. 开启全局/存储签名后请求会 401；
//  2. 文件名里的 `#`、`?`、`%` 会破坏 URL。
// 统一通过后端 stream_url 取得带签名的 /p 地址，并补上 force（强制代理，避免 302 跨域）。

const signedProxyCache = new Map<
  string,
  { urls: SignedMediaUrls; at: number }
>()
const SIGNED_PROXY_TTL = 5 * 60 * 1000
// 上限兜底：媒体库翻页会不断产生新路径，长会话下必须有容量上限
const SIGNED_PROXY_MAX = 300

const trimSignedProxyCache = () => {
  const now = Date.now()
  for (const [key, value] of signedProxyCache) {
    if (now - value.at >= SIGNED_PROXY_TTL) signedProxyCache.delete(key)
  }
  while (signedProxyCache.size > SIGNED_PROXY_MAX) {
    const oldest = signedProxyCache.keys().next().value
    if (oldest === undefined) break
    signedProxyCache.delete(oldest)
  }
}

/** 未签名但已正确编码的 /p 地址，仅作为取签名失败时的降级方案 */
export const unsignedProxyUrl = (path: string) =>
  `${api}/p${encodePath(path)}?force`

const withForce = (url: string) =>
  /[?&]force(=|&|$)/.test(url)
    ? url
    : `${url}${url.includes("?") ? "&" : "?"}force`

export interface SignedMediaUrls {
  /**
   * 签名后的 /d 直链：由服务端 302 到网盘直链。
   * 下载、外链播放等由客户端自己取流的场景应该用它，避免服务端转发整份流量。
   */
  direct: string
  /** 签名后的 /p 代理地址（强制代理）：浏览器内读取（播放器/阅读器）用它 */
  proxied: string
}

const fallbackSignedUrls = (path: string): SignedMediaUrls => ({
  direct: `${api}/d${encodePath(path)}`,
  proxied: unsignedProxyUrl(path),
})

const fetchSignedMediaUrls = async (path: string): Promise<SignedMediaUrls> => {
  const hit = signedProxyCache.get(path)
  if (hit && Date.now() - hit.at < SIGNED_PROXY_TTL) {
    // 命中后提升为最近使用，避免被容量上限优先淘汰
    signedProxyCache.delete(path)
    signedProxyCache.set(path, hit)
    return hit.urls
  }
  try {
    const resp = await getMediaStreamUrl({ path })
    if (resp.code === 200 && resp.data?.proxied) {
      // 直链与代理地址一次取回，避免下载按钮再发一次请求
      const urls: SignedMediaUrls = {
        direct: resp.data.url || fallbackSignedUrls(path).direct,
        proxied: withForce(resp.data.proxied),
      }
      signedProxyCache.set(path, { urls, at: Date.now() })
      trimSignedProxyCache()
      return urls
    }
  } catch {
    // 降级处理见下
  }
  return fallbackSignedUrls(path)
}

/** 获取指定路径的签名直链与代理地址（带短期缓存）；失败时降级为未签名地址 */
export const getSignedMediaUrls = fetchSignedMediaUrls

/** 获取指定路径的签名代理地址（带短期缓存）；失败时降级为编码后的未签名地址 */
export const getSignedProxyUrl = async (path: string): Promise<string> =>
  (await fetchSignedMediaUrls(path)).proxied

/** 条目 folder_path + file_name 拼出的 VFS 路径 */
export const mediaItemPath = (item: {
  folder_path?: string
  file_name: string
}) => `${item.folder_path?.replace(/\/$/, "") ?? ""}/${item.file_name}`

/**
 * 响应式签名地址：路径变化时重新获取；未就绪时返回 undefined，
 * 避免先发出一次必然 401 的未签名请求。
 */
export const createSignedProxyUrl = (path: () => string | undefined) => {
  const [url] = createResource(path, (p) => getSignedProxyUrl(p))
  return url
}

/** 同时拿到直链与代理地址的响应式版本（下载用直链、阅读/播放用代理） */
export const createSignedMediaUrls = (path: () => string | undefined) => {
  const [urls] = createResource(path, (p) => getSignedMediaUrls(p))
  return urls
}

/** 批量生成 STRM */
export const adminGenerateStrm = (mediaType?: MediaType, scanPathId?: number) =>
  r.post("/admin/media/strm/generate", {
    media_type: mediaType ?? "",
    scan_path_id: scanPathId ?? 0,
  }) as Promise<Resp<{ written: number; path: string }>>

/* ==================== 阅读器批注 ==================== */

/**
 * 一条批注：anchor 是查看器原生的批注对象（JSON 字符串），
 * 回灌时原样交给 PDF 引擎，因此这里不拆字段。
 */
export interface MediaAnnotationRow {
  remote_id: string
  anchor: string
}

/** 读取当前用户对某个条目的全部批注（未登录 / 访客返回空数组） */
export const getMediaAnnotations = (itemId: number) =>
  r.get("/fs/media/annotations", { params: { item_id: itemId } }) as Promise<
    Resp<MediaAnnotationRow[]>
  >

/** 增量保存批注：upserts 覆盖同一 remote_id，deletes 按 remote_id 删除 */
export const syncMediaAnnotations = (payload: {
  item_id: number
  upserts: MediaAnnotationRow[]
  deletes: string[]
}) =>
  r.post("/fs/media/annotations", payload) as Promise<
    Resp<{ saved: number; deleted: number }>
  >

/* ==================== 播放进度与收藏 ==================== */

export interface MediaUserData {
  item_id: number
  episode_index: number
  played: boolean
  play_count: number
  is_favorite: boolean
  position_ticks: number
}

export const getMediaUserData = (ids: number[]) =>
  r.get(`/fs/media/userdata?ids=${ids.join(",")}`) as Promise<
    Resp<MediaUserData[]>
  >

export const getMediaProgress = (itemId: number, episodeIndex = 0) =>
  r.get("/fs/media/progress", {
    params: { item_id: itemId, episode_index: episodeIndex },
  }) as Promise<Resp<MediaUserData | null>>

export const saveMediaProgress = (payload: {
  item_id: number
  episode_index?: number
  position: number
  duration: number
  played?: boolean
}) => r.post("/fs/media/progress", payload) as Promise<Resp<MediaUserData>>

/** 下载条目的 .strm 文件（走鉴权请求，避免 <a> 直链丢掉 Authorization 头） */
export const downloadMediaStrm = (itemId: number, episode = 0) =>
  r.get("/fs/media/strm", {
    params: { id: itemId, episode },
    responseType: "blob",
  }) as Promise<Blob>

export const setMediaFavorite = (
  itemId: number,
  favorite: boolean,
  episodeIndex = 0,
) =>
  r.post("/fs/media/favorite", {
    item_id: itemId,
    episode_index: episodeIndex,
    favorite,
  }) as Promise<Resp<{ favorite: boolean }>>

export const getMediaFavorites = (
  mediaType?: string,
  page = 1,
  pageSize = 40,
) =>
  r.get("/fs/media/favorites", {
    params: { media_type: mediaType, page, page_size: pageSize },
  }) as Promise<Resp<{ content: any[]; total: number }>>

export const getMediaResume = (mediaType?: string, limit = 20) =>
  r.get("/fs/media/resume", {
    params: { media_type: mediaType, limit },
  }) as Promise<Resp<any[]>>

/** 媒体应用密钥 */
export interface MediaAppKey {
  id: number
  name: string
  prefix: string
  last_used_at: string | null
  created_at: string
}

export const adminListAppKeys = () =>
  r.get("/admin/media/appkey/list") as Promise<Resp<MediaAppKey[]>>

export const adminCreateAppKey = (name: string) =>
  r.post("/admin/media/appkey/create", { name }) as Promise<
    Resp<{ id: number; name: string; prefix: string; key: string }>
  >

export const adminDeleteAppKey = (id: number) =>
  r.post("/admin/media/appkey/delete", null, { params: { id } }) as Promise<
    Resp<null>
  >

// ==================== 转码 API ====================

/** 转码播放响应 */
export interface TranscodePlayResult {
  transcode: boolean
  reason?: string
  job_id?: string
  master_url?: string
  profile?: string
}

/** 申请转码播放
 *  前端在播放视频前调用此接口，后端根据文件大小/编码/后缀等决策是否需要转码。
 *  - transcode=false → 走原有直链播放
 *  - transcode=true  → 使用返回的 master_url (HLS) 播放
 */
export const requestTranscodePlay = (path: string) =>
  r.post("/fs/transcode/play", { path }) as Promise<Resp<TranscodePlayResult>>
