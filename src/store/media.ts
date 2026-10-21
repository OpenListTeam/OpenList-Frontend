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
}

const [mediaStatus, setMediaStatus] = createSignal<MediaStatus>(emptyStatus)

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
const [mediaSidebarOpen, setMediaSidebarOpenRaw] = createSignal(
  stored === "true",
)

export const setMediaSidebarOpen = (open: boolean) => {
  setMediaSidebarOpenRaw(open)
  try {
    localStorage.setItem("media-sidebar-open", String(open))
  } catch {
    /* ignore */
  }
}

export { mediaSidebarOpen, mediaStatus, setMediaStatus }
