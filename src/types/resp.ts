import { Obj } from "."

export interface Resp<T> {
  code: number
  message: string
  data: T
}

export type PageResp<T> = Resp<{
  content: T[]
  total: number
}>

export type FsListResp = Resp<{
  content: Obj[]
  total: number
  readme: string
  header: string
  write: boolean
  provider: string
}>

export type SearchNode = {
  parent: string
  name: string
  is_dir: boolean
  size: number
  path: string
  type: number
}

export type FsSearchResp = PageResp<SearchNode>

export type FsGetResp = Resp<
  Obj & {
    raw_url: string
    readme: string
    header: string
    provider: string
    related: Obj[]
  }
>

export type FsPreupResp = Resp<{
  task_id: string
  slice_size: number
  slice_cnt: number
  slice_upload_status: string
  reuse: boolean
}>
export type FsUpinfoResp = Resp<{
  slice_hash_need: boolean //是否需要分片哈希
  hash_md5_need: boolean //是否需要md5
  hash_md5_256kb_need: boolean //是否需要前256KB的md5
  hash_sha1_need: boolean //是否需要sha1
}>

export type FsSliceupCompleteResp = Resp<{
  task_id: string
  slice_upload_status: string
  complete: number
}>

export type EmptyResp = Resp<{}>

export type PResp<T> = Promise<Resp<T>>
export type PPageResp<T> = Promise<PageResp<T>>
export type PEmptyResp = Promise<EmptyResp>
