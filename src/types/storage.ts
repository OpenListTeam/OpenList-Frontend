import { MountDetails } from "./obj"

export enum OrderBy {
  Name = "name",
  Size = "size",
  Modified = "modified",
  None = "",
}

export enum OrderDirection {
  Asc = "ASC",
  Desc = "DESC",
  None = "",
}

export enum ExtractFolder {
  Front = "front",
  Back = "back",
  None = "",
}

export enum WebdavPolicy {
  Redirect = "302_redirect",
  UseProxyUrl = "use_proxy_url",
  NativeProxy = "native_proxy",
}

export interface Storage {
  id: number
  mount_path: string
  order: number
  driver: string
  status: string
  addition: string
  remark: string
  modified: string
  order_by: OrderBy
  order_direction: OrderDirection
  extract_folder: ExtractFolder
  web_proxy: boolean
  webdav_policy: WebdavPolicy
  disabled: boolean
  seed_policy: "inherit" | "on" | "off"
  mount_details?: MountDetails
}

export type Addition = Record<string, string | boolean | number>

/**
 * 更新网盘分享链接的请求体。
 *
 * 只提交当前目录路径、分享 ID 和提取码（无提取码时为空串），
 * 存储配置的更新由后端 `/admin/storage/update_sharelink` 实现。
 */
export interface UpdateShareLinkReq {
  path: string
  sid: string
  pwd: string
}

/**
 * 更新网盘分享链接的响应。
 *
 * 后端返回该路径所在存储的挂载路径（挂载路径可能有多级，如 /mnt/share），
 * 前端更新成功后跳回该路径重新加载，而不是自己从路径形状猜测挂载根。
 */
export interface UpdateShareLinkResp {
  mount_path: string
}
