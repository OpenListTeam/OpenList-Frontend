import { createSignal } from "solid-js"
import type { MediaType } from "~/types"

export interface MediaStatus {
  enabled: boolean
  types: MediaType[]
  emby_enabled: boolean
  subsonic_enabled: boolean
  emby_base_url: string
  subsonic_base_url: string
  strm_path: string
  strm_on_scan: boolean
  strm_same_dir: boolean
  thumb_path: string
  version: string
  proxy_cover: boolean
}

const emptyStatus: MediaStatus = {
  enabled: false,
  types: [],
  emby_enabled: false,
  subsonic_enabled: false,
  emby_base_url: "",
  subsonic_base_url: "",
  strm_path: "",
  strm_on_scan: false,
  strm_same_dir: true,
  thumb_path: "/imgs",
  version: "",
  proxy_cover: false,
}

const [mediaStatus, setMediaStatusRaw] = createSignal<MediaStatus>(emptyStatus)

/** 后端可能返回 types: null（旧版本/未启用），统一归一化，避免 .includes 崩溃 */
export const setMediaStatus = (status?: Partial<MediaStatus> | null) => {
  if (!status) {
    setMediaStatusRaw(emptyStatus)
    return
  }
  setMediaStatusRaw({
    ...emptyStatus,
    ...status,
    types: Array.isArray(status.types) ? status.types : [],
  })
}

/** 媒体库总开关（关闭时前端不渲染任何媒体库入口） */
export const mediaEnabled = () => mediaStatus().enabled

/** 某个媒体类型是否启用 */
export const mediaTypeEnabled = (type: MediaType) =>
  mediaStatus().types.includes(type)

/** 侧边栏展开状态，持久化到 localStorage */
const stored =
  typeof localStorage !== "undefined"
    ? localStorage.getItem("media-sidebar-open")
    : null
// 默认展开：媒体库启用后侧边栏直接可见，用户手动收起后记住选择
const [mediaSidebarOpen, setMediaSidebarOpenRaw] = createSignal(
  stored === null ? true : stored === "true",
)

export const setMediaSidebarOpen = (open: boolean) => {
  setMediaSidebarOpenRaw(open)
  try {
    localStorage.setItem("media-sidebar-open", String(open))
  } catch {
    /* ignore */
  }
}

export { mediaSidebarOpen, mediaStatus }
