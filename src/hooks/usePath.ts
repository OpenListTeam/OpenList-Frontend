import axios, { Canceler } from "axios"
import {
  appendObjs,
  password,
  ObjStore,
  State,
  getPagination,
  objStore,
  getHistoryKey,
  hasHistory,
  recoverHistory,
  clearHistory,
  me,
  shouldKeepState,
} from "~/store"
import {
  fsGet,
  fsList,
  handleRespWithoutNotify,
  log,
  notify,
  pathJoin,
} from "~/utils"
import { useFetch } from "./useFetch"
import { useRouter } from "./useRouter"

let first_fetch = true

let cancelObj: Canceler
let cancelList: Canceler

const IsDirRecord: Record<string, boolean> = {}
let globalPage = 1
export const getGlobalPage = () => {
  return globalPage
}
export const setGlobalPage = (page: number) => {
  globalPage = page
  // console.log("setGlobalPage", globalPage)
}
export const resetGlobalPage = () => {
  setGlobalPage(1)
}
export const usePath = () => {
  const { pathname, to, searchParams } = useRouter()
  const [, getObj] = useFetch((path: string) =>
    fsGet(
      path,
      password(),
      new axios.CancelToken((c) => {
        cancelObj = c
      }),
    ),
  )
  const pagination = getPagination()
  if (pagination.type === "pagination") {
    setGlobalPage(parseInt(searchParams["page"]) || 1)
  }
  const [, getObjs] = useFetch(
    (arg?: {
      path: string
      index?: number
      size?: number
      force?: boolean
    }) => {
      const page = {
        index: arg?.index,
        size: arg?.size,
      }
      // setSearchParams(page);
      return fsList(
        arg?.path,
        password(),
        page.index,
        page.size,
        arg?.force,
        new axios.CancelToken((c) => {
          cancelList = c
        }),
      )
    },
  )
  // set a path must be a dir
  const setPathAs = (path: string, dir = true, push = false) => {
    if (push) {
      path = pathJoin(pathname(), path)
    }
    if (dir) {
      IsDirRecord[path] = true
    } else {
      delete IsDirRecord[path]
    }
  }

  // record is second time password is wrong
  let retry_pass = false
  // 上一次复位/写入 is_share 时对应的目录，用于区分「换目录」与「同目录翻页/刷新」
  let lastIsSharePath = ""
  // handle pathname change
  // if confirm current path is dir, fetch List directly
  // if not, fetch get then determine if it is dir or file
  const handlePathChange = (
    path: string,
    index?: number,
    rp?: boolean,
    force?: boolean,
  ) => {
    cancelObj?.()
    cancelList?.()
    retry_pass = rp ?? false
    ObjStore.setErr("")
    // 分享目录标记只由 fs/list 给出：目录变化时先复位，避免 fs/get 报错
    // （如分享链接失效）时沿用上一个目录的 is_share。
    // 同一目录（翻页 / 刷新）下保持原值，避免按钮闪一下。
    if (lastIsSharePath !== path) {
      ObjStore.setIsShare(false)
    }
    lastIsSharePath = path
    if (hasHistory(path, index)) {
      log(`handle [${getHistoryKey(path, index)}] from history`)
      return recoverHistory(path, index)
    } else if (IsDirRecord[path]) {
      log(`handle [${getHistoryKey(path, index)}] as folder`)
      return handleFolder(path, index, undefined, undefined, force)
    } else {
      log(`handle [${getHistoryKey(path, index)}] as obj`)
      return handleObj(path, index)
    }
  }

  // handle enter obj that don't know if it is dir or file
  const handleObj = async (path: string, index?: number) => {
    shouldKeepState() || ObjStore.setState(State.FetchingObj)
    const resp = await getObj(path)
    handleRespWithoutNotify(
      resp,
      (data) => {
        ObjStore.setObj(data)
        ObjStore.setProvider(data.provider)
        if (data.is_dir) {
          setPathAs(path)
          handleFolder(path, index)
        } else {
          ObjStore.setReadme(data.readme)
          ObjStore.setHeader(data.header)
          ObjStore.setRelated(data.related ?? [])
          ObjStore.setRawUrl(data.raw_url)
          shouldKeepState() || ObjStore.setState(State.File)
        }
      },
      handleErr,
    )
  }

  // change enter a folder or turn page or load more
  const handleFolder = async (
    path: string,
    index?: number,
    size?: number,
    append = false,
    force?: boolean,
    onlyList = false,
  ) => {
    if (!size) {
      size = pagination.size
    }
    if (size !== undefined && pagination.type === "all") {
      size = undefined
    }
    if (!onlyList && !shouldKeepState())
      ObjStore.setState(append ? State.FetchingMore : State.FetchingObjs)
    const resp = await getObjs({ path, index, size, force })
    // 列表失败时后端仍会带上 data.is_share（见 fs.List 出错分支），
    // 这样分享链接失效导致列表报错时，仍能保留「更新分享链接」入口。
    // 仅当这次请求依然是当前路径的请求时才写入，避免旧请求覆盖新路径的状态。
    const isShareFromResp = (resp.data as { is_share?: boolean } | undefined)
      ?.is_share
    const applyIsShare = (value: boolean | undefined) => {
      if (value !== undefined && pathname() === path) {
        ObjStore.setIsShare(value)
      }
    }
    handleRespWithoutNotify(
      resp,
      (data) => {
        setGlobalPage(index ?? 1)
        if (append) {
          appendObjs(data.content)
        } else {
          ObjStore.setObjs(data.content ?? [])
          ObjStore.setTotal(data.total)
        }
        if (onlyList) {
          applyIsShare(data.is_share)
          return
        }
        ObjStore.setReadme(data.readme)
        ObjStore.setHeader(data.header)
        ObjStore.setWrite(data.write)
        ObjStore.setWriteContentBypass(data.write_content_bypass)
        ObjStore.setProvider(data.provider)
        applyIsShare(data.is_share)
        ObjStore.setDirectUploadTools(data.direct_upload_tools)
        shouldKeepState() || ObjStore.setState(State.Folder)
      },
      (msg: string, code?: number) => {
        applyIsShare(isShareFromResp)
        if (!onlyList || code !== 403) {
          handleErr(msg, code)
        }
      },
    )
  }

  const handleErr = (msg: string, code?: number) => {
    if (code === 403) {
      ObjStore.setState(State.NeedPassword)
      if (retry_pass) {
        notify.error(msg)
      }
    } else {
      const basePath = me().base_path
      if (
        first_fetch &&
        basePath != "/" &&
        pathname().includes(basePath) &&
        msg.endsWith("object not found")
      ) {
        first_fetch = false
        to(pathname().replace(basePath, ""))
        return
      }
      if (code === undefined || code >= 0) {
        ObjStore.setErr(msg)
      }
    }
  }
  const loadMore = () => {
    return handleFolder(pathname(), globalPage + 1, undefined, true)
  }
  return {
    handlePathChange,
    handleFolder,
    setPathAs,
    refresh: async (retry_pass?: boolean, force?: boolean) => {
      const path = pathname()
      const scroll = window.scrollY
      clearHistory(path, globalPage)
      if (
        pagination.type === "load_more" ||
        pagination.type === "auto_load_more"
      ) {
        const page = globalPage
        resetGlobalPage()
        await handlePathChange(path, globalPage, retry_pass, force)
        while (globalPage < page) {
          await loadMore()
        }
      } else {
        await handlePathChange(path, globalPage, retry_pass, force)
      }
      window.scroll({ top: scroll, behavior: "smooth" })
    },
    loadMore,
    allLoaded: () => globalPage >= Math.ceil(objStore.total / pagination.size),
  }
}
