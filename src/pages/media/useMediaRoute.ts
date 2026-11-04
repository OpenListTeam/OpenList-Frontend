import { useSearchParams } from "@solidjs/router"
import type { Params } from "@solidjs/router"

/**
 * 媒体库的「浏览位置」全部放在 URL 查询参数里，而不是组件内存信号：
 *
 *   ?page=3&q=关键词        列表页（第 3 页，带搜索词）
 *   ?page=3&q=关键词&id=12  详情页（返回后回到上面的列表页）
 *   ?...&id=12&play=1       详情页的播放状态（刷新 / 切换 mediabunny 后继续播放）
 *
 * 这样浏览器返回、页面刷新、location.reload() 都能恢复到原位置，
 * 并且详情页的返回按钮只需要清掉 id/play 两个参数，不会丢页码和搜索词。
 */
export interface MediaRouteParams {
  page?: string
  q?: string
  id?: string
  ep?: string
  play?: string
}

/**
 * useSearchParams 的泛型约束是 Params = Record<string, string>。
 * 这里保留具名键便于阅读，同时用 & Params 让类型满足约束：
 * 若直接写索引签名 `[key: string]: string | undefined`，
 * 会因为值可能是 undefined 而不满足 Params（TS2344）。
 */
type MediaSearchParams = MediaRouteParams & Params

export const useMediaRoute = () => {
  const [params, setParams] = useSearchParams<MediaSearchParams>()

  /** 当前打开的详情条目 ID（没有则在列表页） */
  const selectedId = () => params.id || null

  /** 打开详情页：新增一条历史记录，浏览器「返回」回到列表 */
  const openDetail = (id: string | number) => {
    setParams(
      { id: String(id), play: undefined, ep: undefined },
      { scroll: false },
    )
  }

  /**
   * 从详情页返回列表。
   * 用 replace 清掉 id/play/ep，保留 page 和 q，列表页会按它们恢复原来的页码与搜索。
   */
  const closeDetail = () => {
    setParams(
      { id: undefined, play: undefined, ep: undefined },
      { replace: true, scroll: false },
    )
  }

  /** 当前是否在播放（刷新后据此恢复） */
  const playing = () => params.play === "1"
  /** 当前播放的选集序号（0 / 未设置 表示播放主文件） */
  const episode = () => {
    const n = parseInt(params.ep ?? "0", 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  /** 进入播放：replace，避免「返回」需要多按几次才能退出播放 */
  const startPlay = (ep?: number) => {
    setParams(
      { play: "1", ep: ep && ep > 0 ? String(ep) : undefined },
      { replace: true, scroll: false },
    )
  }
  const stopPlay = () => {
    setParams(
      { play: undefined, ep: undefined },
      { replace: true, scroll: false },
    )
  }

  return {
    params,
    setParams,
    selectedId,
    openDetail,
    closeDetail,
    playing,
    episode,
    startPlay,
    stopPlay,
  }
}
