// 媒体库类型定义

export type MediaType = "video" | "music" | "image" | "book"

// 选集信息（路径合并模式下文件夹内的每个媒体文件）
export interface EpisodeInfo {
  file_name: string // 原始文件名（含扩展名）
  index: number // 序号，默认0，文件名开头有数字则取该数字
  title: string // 选集标题（去掉序号后的文件名，不含扩展名）
}

export interface MediaItem {
  id: number
  created_at: string
  updated_at: string
  media_type: MediaType
  scan_path_id: number
  file_name: string
  file_size: number
  mime_type: string
  hidden: boolean
  // 刮削信息
  scraped_name: string
  description: string
  cover: string
  release_date: string
  rating: number
  genre: string
  authors: string // JSON数组字符串
  plot: string
  reviews: string
  external_id: string
  // 音乐
  album_name: string
  album_artist: string
  track_number: number
  duration: number
  lyrics: string
  // 视频
  video_type: string
  season: number
  episode: number
  // 书籍
  publisher: string
  isbn: string
  // 目录
  is_folder: boolean
  folder_path: string // 扫描根路径（恒定为扫描路径，与 file_name + album_name 组合唯一）
  episodes: string // 选集信息 JSON 字符串，格式：[{file_name,index,title},...]
  scraped_at: string | null
}

// 解析 episodes JSON 字符串
export function parseEpisodes(episodes: string): EpisodeInfo[] {
  if (!episodes) return []
  try {
    return JSON.parse(episodes)
  } catch {
    return []
  }
}

export interface AlbumInfo {
  album_name: string
  album_artist: string
  cover: string
  release_date: string
  track_count: number
  scan_path_id: number
}

export interface MediaConfig {
  id?: number
  media_type: MediaType
  enabled: boolean
  last_scan_at: string | null
  last_scrape_at: string | null
}

// 扫描路径配置
export interface MediaScanPath {
  id?: number
  media_type: MediaType
  name: string
  path: string
  path_merge: boolean
  type_tag: string // 类型标签：电影、电视剧等
  content_tags: string // 内容标签：喜剧、惊悚等（逗号分隔）
  enable_scrape: boolean
  last_scan_at: string | null
}

export interface MediaScanProgress {
  media_type: MediaType
  scan_path_id?: number
  running: boolean
  total: number
  done: number
  message: string
  error?: string
}

export interface MediaListQuery {
  media_type?: MediaType
  scan_path_id?: number
  page?: number
  page_size?: number
  order_by?: "name" | "date" | "size"
  order_dir?: "asc" | "desc"
  folder_path?: string
  keyword?: string
  type_tag?: string
  content_tag?: string
}

// 解析 authors JSON字符串
export function parseAuthors(authors: string): string[] {
  if (!authors) return []
  try {
    return JSON.parse(authors)
  } catch {
    return authors ? [authors] : []
  }
}

// 格式化时长（秒 -> mm:ss）
export function formatDuration(seconds: number): string {
  if (!seconds) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

// 获取媒体显示名称
export function getMediaName(item: MediaItem): string {
  return item.scraped_name || item.file_name || ""
}

// 获取媒体文件的VFS路径（folder_path + "/" + file_name）
// 可选传入 episodeFileName 用于播放文件夹条目中的某个选集
export function getMediaFilePath(
  item: MediaItem,
  episodeFileName?: string,
): string {
  const folder = item.folder_path?.replace(/\/$/, "") ?? ""
  const fileName = episodeFileName ?? item.file_name ?? ""
  if (!fileName) return folder
  return `${folder}/${fileName}`
}

// 媒体类型标签
export const mediaTypeLabels: Record<MediaType, string> = {
  video: "影视",
  music: "音乐",
  image: "图片",
  book: "书籍",
}
