import {
  createSignal,
  createResource,
  createEffect,
  createMemo,
  For,
  Show,
  Switch,
  Match,
} from "solid-js"
import { useColorMode } from "@hope-ui/solid"
import { useSearchParams } from "@solidjs/router"
import {
  getMediaFavorites,
  getMediaList,
  getMediaFolders,
  getMediaScanPaths,
  getMediaUserData,
  setMediaFavorite,
} from "~/utils/media_api"
import { notify } from "~/utils"
import { useT } from "~/hooks"
import type { MediaItem, MediaType, MediaScanPath } from "~/types"
import { getMediaName } from "~/types"
import { MediaItemDetail } from "./MediaItemDetail"

interface MediaBrowserProps {
  mediaType: MediaType
  onItemClick: (item: MediaItem) => void
  onItemsChange?: (items: MediaItem[]) => void
  renderCard: (item: MediaItem) => any
  renderListRow?: (item: MediaItem) => any
  /** 是否显示收藏入口（星标 / 收藏 Tab） */
  enableFavorites?: boolean
}

type ViewMode = "waterfall" | "list"
type BrowseMode = "all" | "folder" | "favorites"
type OrderBy = "name" | "date" | "size"
type OrderDir = "asc" | "desc"

export const MediaBrowser = (props: MediaBrowserProps) => {
  const t = useT()
  const { colorMode } = useColorMode()
  const isDark = createMemo(() => colorMode() === "dark")

  // 主题色 tokens
  const toolbarBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
  )
  const toolbarBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)",
  )
  const dividerColor = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
  )
  const btnActiveBg = "rgba(99,102,241,0.3)"
  const btnActiveBorder = "rgba(99,102,241,0.5)"
  const btnActiveColor = "#a5b4fc"
  const btnInactiveBg = createMemo(() =>
    isDark() ? "transparent" : "transparent",
  )
  const btnInactiveBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.15)",
  )
  const btnInactiveColor = createMemo(() => (isDark() ? "#64748b" : "#64748b"))
  const sortLabelColor = createMemo(() => (isDark() ? "#475569" : "#64748b"))
  const sortActiveBg = createMemo(() => "rgba(99,102,241,0.3)")
  const sortActiveBorder = createMemo(() => "rgba(99,102,241,0.5)")
  const sortActiveColor = "#a5b4fc"
  const sortInactiveBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
  )
  const sortInactiveBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)",
  )
  const sortInactiveColor = createMemo(() => (isDark() ? "#94a3b8" : "#475569"))
  const searchBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
  )
  const searchBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.15)",
  )
  const searchColor = createMemo(() => (isDark() ? "#e2e8f0" : "#1e293b"))
  const folderBtnBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
  )
  const emptyColor = createMemo(() => (isDark() ? "#475569" : "#94a3b8"))
  const listItemBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
  )
  const listItemBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)",
  )
  const listItemTextColor = createMemo(() => (isDark() ? "#e2e8f0" : "#1e293b"))
  const paginationBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
  )
  const paginationBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)",
  )
  const paginationColor = createMemo(() => (isDark() ? "#94a3b8" : "#475569"))
  const paginationDisabledColor = createMemo(() =>
    isDark() ? "#334155" : "#cbd5e1",
  )
  const paginationInfoColor = createMemo(() =>
    isDark() ? "#64748b" : "#94a3b8",
  )

  // URL 查询参数（持久化页码、便于浏览器前进/后退恢复浏览状态）
  const [searchParams, setSearchParams] = useSearchParams<{ page?: string }>()

  // 视图模式按媒体类型持久化，切回页面时保持上次选择
  const viewStorageKey = `media-view-mode-${props.mediaType}`
  const storedView = (() => {
    try {
      const v = localStorage.getItem(viewStorageKey)
      return v === "list" || v === "waterfall" ? v : "waterfall"
    } catch {
      return "waterfall"
    }
  })()
  const [viewMode, setViewMode] = createSignal<ViewMode>(storedView)
  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode)
    try {
      localStorage.setItem(viewStorageKey, mode)
    } catch {
      /* ignore */
    }
  }
  // 列表视图右侧详情面板
  const [selected, setSelected] = createSignal<MediaItem | null>(null)
  const [favorites, setFavorites] = createSignal<Record<number, boolean>>({})
  const [browseMode, setBrowseMode] = createSignal<BrowseMode>("all")
  const [orderBy, setOrderBy] = createSignal<OrderBy>("name")
  const [orderDir, setOrderDir] = createSignal<OrderDir>("asc")
  // 初始化时从 URL 中读取 page，便于从详情页返回时恢复
  const initialPage = (() => {
    const p = parseInt(searchParams.page ?? "1", 10)
    return Number.isFinite(p) && p > 0 ? p : 1
  })()
  const [page, setPageRaw] = createSignal(initialPage)
  const [keyword, setKeyword] = createSignal("")
  const [selectedFolder, setSelectedFolder] = createSignal("")
  const [selectedScanPathId, setSelectedScanPathId] = createSignal<number>(0)
  const [selectedTypeTag, setSelectedTypeTag] = createSignal("")
  const [selectedContentTag, setSelectedContentTag] = createSignal("")
  // 页码跳转输入框中的值
  const [pageInput, setPageInput] = createSignal(String(initialPage))

  // 包装 setPage：同步到 URL
  const setPage = (p: number) => {
    setPageRaw(p)
    setPageInput(String(p))
    // 写入 URL（page=1 时移除参数让 URL 更干净）
    setSearchParams(
      { page: p === 1 ? undefined : String(p) },
      { replace: false, scroll: false },
    )
  }

  // 监听 URL 变化（浏览器前进/后退时同步内部 state）
  createEffect(() => {
    const p = parseInt(searchParams.page ?? "1", 10)
    const valid = Number.isFinite(p) && p > 0 ? p : 1
    if (valid !== page()) {
      setPageRaw(valid)
      setPageInput(String(valid))
    }
  })

  const pageSize = 40

  // 加载扫描路径列表（用于筛选）
  const [scanPathsData] = createResource(
    () => props.mediaType,
    async (mt) => {
      const resp = await getMediaScanPaths(mt)
      if (resp.code === 200) return resp.data as MediaScanPath[]
      return [] as MediaScanPath[]
    },
  )

  // 计算所有可用的类型标签和内容标签
  const allTypeTags = createMemo(() => {
    const paths = scanPathsData() ?? []
    const tags = new Set<string>()
    paths.forEach((p) => {
      if (p.type_tag) tags.add(p.type_tag)
    })
    return Array.from(tags)
  })

  const allContentTags = createMemo(() => {
    const paths = scanPathsData() ?? []
    const tags = new Set<string>()
    paths.forEach((p) => {
      if (p.content_tags)
        p.content_tags.split(",").forEach((t) => {
          if (t.trim()) tags.add(t.trim())
        })
    })
    return Array.from(tags)
  })

  // 加载媒体列表（收藏 Tab 走收藏接口）
  const [mediaData, { refetch: refetchMedia }] = createResource(
    () => ({
      favorites: browseMode() === "favorites",
      media_type: props.mediaType,
      page: page(),
      page_size: pageSize,
      order_by: orderBy(),
      order_dir: orderDir(),
      folder_path: browseMode() === "folder" ? selectedFolder() : undefined,
      keyword: keyword() || undefined,
      scan_path_id: selectedScanPathId() || undefined,
      type_tag: selectedTypeTag() || undefined,
      content_tag: selectedContentTag() || undefined,
    }),
    async (params) => {
      if (params.favorites) {
        const resp = await getMediaFavorites(
          props.mediaType,
          params.page,
          params.page_size,
        )
        if (resp.code === 200) return resp.data
        return { content: [], total: 0 }
      }
      const { favorites: _favorites, ...query } = params
      const resp = await getMediaList(query)
      if (resp.code === 200) return resp.data
      return { content: [], total: 0 }
    },
  )

  // 加载文件夹列表
  const [foldersData] = createResource(
    () => (browseMode() === "folder" ? props.mediaType : null),
    async (mt) => {
      if (!mt) return []
      const resp = await getMediaFolders(mt)
      if (resp.code === 200) return resp.data
      return []
    },
  )

  const items = () => (mediaData()?.content as MediaItem[]) ?? []
  const total = () => mediaData()?.total ?? 0
  const totalPages = () => Math.ceil(total() / pageSize)

  // 数据变化时通知父组件（空列表也要通知，否则父组件会保留上一页的陈旧数据）
  createEffect(() => {
    if (mediaData.loading) return
    props.onItemsChange?.(items())
  })

  // 批量拉取当前页条目的收藏状态
  createEffect(() => {
    const list = items()
    const ids = list.map((item) => item.id)
    if (ids.length === 0) {
      setFavorites({})
      return
    }
    getMediaUserData(ids)
      .then((resp) => {
        if (resp.code !== 200 || !resp.data) return
        const map: Record<number, boolean> = {}
        resp.data.forEach((row) => {
          map[row.item_id] = row.is_favorite
        })
        setFavorites(map)
      })
      .catch(() => {
        /* 访客或未登录时忽略 */
      })
  })

  // 列表视图下保持有选中项，并跟随分页 / 筛选更新
  createEffect(() => {
    const list = items()
    const current = selected()
    if (viewMode() !== "list" || list.length === 0) {
      if (current && !list.some((item) => item.id === current.id)) {
        setSelected(null)
      }
      return
    }
    if (!current || !list.some((item) => item.id === current.id)) {
      setSelected(list[0])
    }
  })

  const toggleFavorite = async (item: MediaItem, favorite: boolean) => {
    // 乐观更新，失败时回滚
    setFavorites((prev) => ({ ...prev, [item.id]: favorite }))
    const resp = await setMediaFavorite(item.id, favorite)
    if (resp.code !== 200) {
      setFavorites((prev) => ({ ...prev, [item.id]: !favorite }))
      notify.error(t("media.browser.favorite_failed") + ": " + resp.message)
      return
    }
    // 在收藏 Tab 取消收藏后，立即从当前列表移除
    if (!favorite && browseMode() === "favorites") {
      refetchMedia()
    }
  }

  const toggleOrder = (col: OrderBy) => {
    if (orderBy() === col) {
      setOrderDir(orderDir() === "asc" ? "desc" : "asc")
    } else {
      setOrderBy(col)
      setOrderDir("asc")
    }
    setPage(1)
  }

  const OrderBtn = (p: { col: OrderBy; label: string }) => (
    <button
      onClick={() => toggleOrder(p.col)}
      style={{
        background: orderBy() === p.col ? sortActiveBg() : sortInactiveBg(),
        border:
          orderBy() === p.col
            ? `1px solid ${sortActiveBorder()}`
            : `1px solid ${sortInactiveBorder()}`,
        "border-radius": "6px",
        color: orderBy() === p.col ? sortActiveColor : sortInactiveColor(),
        padding: "5px 10px",
        "font-size": "12px",
        cursor: "pointer",
        display: "flex",
        "align-items": "center",
        gap: "4px",
      }}
    >
      {p.label}
      <Show when={orderBy() === p.col}>
        <span>{orderDir() === "asc" ? "↑" : "↓"}</span>
      </Show>
    </button>
  )

  return (
    <div>
      {/* 工具栏 */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "flex-wrap": "wrap",
          gap: "12px",
          "margin-bottom": "20px",
          padding: "12px 16px",
          background: toolbarBg(),
          "border-radius": "12px",
          border: `1px solid ${toolbarBorder()}`,
        }}
      >
        {/* 浏览模式：全部 / 目录 / 收藏 */}
        <div style={{ display: "flex", gap: "6px" }}>
          {(
            [
              { mode: "all", label: t("media.browser.all") },
              { mode: "folder", label: t("media.browser.folders") },
              ...(props.enableFavorites
                ? [{ mode: "favorites", label: t("media.browser.favorites") }]
                : []),
            ] as { mode: BrowseMode; label: string }[]
          ).map(({ mode, label }) => (
            <button
              onClick={() => {
                setBrowseMode(mode)
                setPage(1)
                setSelected(null)
              }}
              style={{
                background:
                  browseMode() === mode ? btnActiveBg : btnInactiveBg(),
                border:
                  browseMode() === mode
                    ? `1px solid ${btnActiveBorder}`
                    : `1px solid ${btnInactiveBorder()}`,
                "border-radius": "6px",
                color:
                  browseMode() === mode ? btnActiveColor : btnInactiveColor(),
                padding: "5px 12px",
                "font-size": "12px",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          style={{ width: "1px", height: "20px", background: dividerColor() }}
        />

        {/* 扫描路径筛选 */}
        <Show when={(scanPathsData() ?? []).length > 0}>
          <select
            value={selectedScanPathId()}
            onChange={(e) => {
              setSelectedScanPathId(Number(e.currentTarget.value))
              setPage(1)
            }}
            style={{
              background: searchBg(),
              border: `1px solid ${searchBorder()}`,
              "border-radius": "6px",
              color: searchColor(),
              padding: "5px 8px",
              "font-size": "12px",
              outline: "none",
            }}
          >
            <option value="0">{t("media.browser.all_paths")}</option>
            <For each={scanPathsData() ?? []}>
              {(sp) => <option value={sp.id}>{sp.name || sp.path}</option>}
            </For>
          </select>
        </Show>

        {/* 类型标签筛选 */}
        <Show when={allTypeTags().length > 0}>
          <select
            value={selectedTypeTag()}
            onChange={(e) => {
              setSelectedTypeTag(e.currentTarget.value)
              setPage(1)
            }}
            style={{
              background: searchBg(),
              border: `1px solid ${searchBorder()}`,
              "border-radius": "6px",
              color: searchColor(),
              padding: "5px 8px",
              "font-size": "12px",
              outline: "none",
            }}
          >
            <option value="">{t("media.browser.all_types")}</option>
            <For each={allTypeTags()}>
              {(tag) => <option value={tag}>{tag}</option>}
            </For>
          </select>
        </Show>

        {/* 内容标签筛选 */}
        <Show when={allContentTags().length > 0}>
          <select
            value={selectedContentTag()}
            onChange={(e) => {
              setSelectedContentTag(e.currentTarget.value)
              setPage(1)
            }}
            style={{
              background: searchBg(),
              border: `1px solid ${searchBorder()}`,
              "border-radius": "6px",
              color: searchColor(),
              padding: "5px 8px",
              "font-size": "12px",
              outline: "none",
            }}
          >
            <option value="">{t("media.browser.all_tags")}</option>
            <For each={allContentTags()}>
              {(tag) => <option value={tag}>{tag}</option>}
            </For>
          </select>
        </Show>

        <div
          style={{ width: "1px", height: "20px", background: dividerColor() }}
        />

        {/* 排序 */}
        <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
          <span style={{ color: sortLabelColor(), "font-size": "12px" }}>
            {t("media.browser.sort")}:
          </span>
          <OrderBtn col="name" label={t("media.browser.name")} />
          <OrderBtn col="date" label={t("media.browser.date")} />
          <OrderBtn col="size" label={t("media.browser.size")} />
        </div>

        <div style={{ flex: "1" }} />

        {/* 搜索 */}
        <input
          type="text"
          placeholder={t("media.browser.search_placeholder")}
          value={keyword()}
          onInput={(e) => {
            setKeyword(e.currentTarget.value)
            setPage(1)
          }}
          style={{
            background: searchBg(),
            border: `1px solid ${searchBorder()}`,
            "border-radius": "8px",
            color: searchColor(),
            padding: "6px 12px",
            "font-size": "13px",
            outline: "none",
            width: "160px",
          }}
        />

        {/* 视图切换 */}
        <div style={{ display: "flex", gap: "4px" }}>
          {(["waterfall", "list"] as ViewMode[]).map((mode) => (
            <button
              onClick={() => changeViewMode(mode)}
              title={
                mode === "waterfall"
                  ? t("media.browser.waterfall")
                  : t("media.browser.list")
              }
              style={{
                background: viewMode() === mode ? btnActiveBg : btnInactiveBg(),
                border:
                  viewMode() === mode
                    ? `1px solid ${btnActiveBorder}`
                    : `1px solid ${btnInactiveBorder()}`,
                "border-radius": "6px",
                color:
                  viewMode() === mode ? btnActiveColor : btnInactiveColor(),
                padding: "5px 8px",
                "font-size": "14px",
                cursor: "pointer",
              }}
            >
              {mode === "waterfall" ? "⊞" : "☰"}
            </button>
          ))}
        </div>
      </div>

      {/* 目录浏览模式 - 文件夹列表 */}
      <Show when={browseMode() === "folder"}>
        <div
          style={{
            display: "flex",
            "flex-wrap": "wrap",
            gap: "8px",
            "margin-bottom": "16px",
          }}
        >
          <button
            onClick={() => setSelectedFolder("")}
            style={{
              background: selectedFolder() === "" ? btnActiveBg : folderBtnBg(),
              border: `1px solid ${btnInactiveBorder()}`,
              "border-radius": "8px",
              color:
                selectedFolder() === "" ? btnActiveColor : paginationColor(),
              padding: "6px 14px",
              "font-size": "12px",
              cursor: "pointer",
            }}
          >
            📂 {t("media.browser.all_folders")}
          </button>
          <For each={foldersData() ?? []}>
            {(folder) => (
              <button
                onClick={() => {
                  setSelectedFolder(folder)
                  setPage(1)
                }}
                style={{
                  background:
                    selectedFolder() === folder ? btnActiveBg : folderBtnBg(),
                  border:
                    selectedFolder() === folder
                      ? `1px solid ${btnActiveBorder}`
                      : `1px solid ${btnInactiveBorder()}`,
                  "border-radius": "8px",
                  color:
                    selectedFolder() === folder
                      ? btnActiveColor
                      : paginationColor(),
                  padding: "6px 14px",
                  "font-size": "12px",
                  cursor: "pointer",
                  "max-width": "200px",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                }}
                title={folder}
              >
                📁 {folder.split("/").pop() || folder}
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* 内容区域 */}
      <Show
        when={!mediaData.loading}
        fallback={
          <div
            style={{
              "text-align": "center",
              padding: "60px",
              color: emptyColor(),
            }}
          >
            <div style={{ "font-size": "32px", "margin-bottom": "12px" }}>
              ⏳
            </div>
            <div>{t("media.browser.loading")}</div>
          </div>
        }
      >
        <Show
          when={items().length > 0}
          fallback={
            <div
              style={{
                "text-align": "center",
                padding: "60px",
                color: emptyColor(),
              }}
            >
              <div style={{ "font-size": "48px", "margin-bottom": "12px" }}>
                📭
              </div>
              <div>{t("media.browser.empty")}</div>
            </div>
          }
        >
          <Switch>
            {/* 瀑布流视图 */}
            <Match when={viewMode() === "waterfall"}>
              <div
                style={{
                  columns: "5 180px",
                  "column-gap": "16px",
                }}
              >
                <For each={items()}>
                  {(item) => (
                    <div
                      style={{
                        position: "relative",
                        "break-inside": "avoid",
                        "margin-bottom": "16px",
                        cursor: "pointer",
                      }}
                      onClick={() => props.onItemClick(item)}
                    >
                      {props.renderCard(item)}
                      <Show when={props.enableFavorites}>
                        <button
                          title={
                            favorites()[item.id]
                              ? t("media.detail.unfavorite")
                              : t("media.detail.favorite")
                          }
                          aria-label={
                            favorites()[item.id]
                              ? t("media.detail.unfavorite")
                              : t("media.detail.favorite")
                          }
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleFavorite(item, !favorites()[item.id])
                          }}
                          style={{
                            position: "absolute",
                            top: "8px",
                            right: "8px",
                            width: "30px",
                            height: "30px",
                            "border-radius": "50%",
                            border: "1px solid rgba(255,255,255,0.25)",
                            background: "rgba(0,0,0,0.45)",
                            color: favorites()[item.id] ? "#fbbf24" : "#e2e8f0",
                            cursor: "pointer",
                            display: "flex",
                            "align-items": "center",
                            "justify-content": "center",
                            "font-size": "16px",
                            "z-index": "2",
                          }}
                        >
                          {favorites()[item.id] ? "★" : "☆"}
                        </button>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Match>

            {/* 列表视图：左侧列表 + 右侧详情 */}
            <Match when={viewMode() === "list"}>
              <style>{`
                .media-list-layout {
                  display: grid;
                  grid-template-columns: minmax(0, 1fr) 320px;
                  gap: 16px;
                  align-items: start;
                }
                @media (max-width: 1100px) {
                  .media-list-layout { grid-template-columns: minmax(0, 1fr); }
                  .media-list-detail { display: none; }
                }
              `}</style>
              <div class="media-list-layout">
                <div
                  style={{
                    display: "flex",
                    "flex-direction": "column",
                    gap: "4px",
                  }}
                >
                  <For each={items()}>
                    {(item) => (
                      <div
                        onClick={() => setSelected(item)}
                        onDblClick={() => props.onItemClick(item)}
                        title={t("media.browser.list_item_tip")}
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "12px",
                          padding: "10px 16px",
                          background:
                            selected()?.id === item.id
                              ? isDark()
                                ? "rgba(99,102,241,0.16)"
                                : "rgba(99,102,241,0.08)"
                              : listItemBg(),
                          "border-radius": "8px",
                          border:
                            selected()?.id === item.id
                              ? `1px solid ${btnActiveBorder}`
                              : `1px solid ${listItemBorder()}`,
                          cursor: "pointer",
                          transition: "background 0.15s",
                        }}
                      >
                        {props.renderListRow ? (
                          props.renderListRow(item)
                        ) : (
                          <>
                            <span style={{ "font-size": "20px" }}>🎬</span>
                            <span
                              style={{
                                color: listItemTextColor(),
                                "font-size": "14px",
                              }}
                            >
                              {getMediaName(item)}
                            </span>
                          </>
                        )}
                        <Show when={props.enableFavorites}>
                          <button
                            title={
                              favorites()[item.id]
                                ? t("media.detail.unfavorite")
                                : t("media.detail.favorite")
                            }
                            aria-label={
                              favorites()[item.id]
                                ? t("media.detail.unfavorite")
                                : t("media.detail.favorite")
                            }
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleFavorite(item, !favorites()[item.id])
                            }}
                            style={{
                              width: "30px",
                              height: "30px",
                              "border-radius": "50%",
                              border: "none",
                              background: "transparent",
                              color: favorites()[item.id]
                                ? "#fbbf24"
                                : btnInactiveColor(),
                              cursor: "pointer",
                              "font-size": "16px",
                              "flex-shrink": "0",
                            }}
                          >
                            {favorites()[item.id] ? "★" : "☆"}
                          </button>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
                <Show when={selected()}>
                  {(item) => (
                    <div class="media-list-detail">
                      <MediaItemDetail
                        item={item()}
                        favorite={!!favorites()[item().id]}
                        onToggleFavorite={toggleFavorite}
                        onOpen={props.onItemClick}
                      />
                    </div>
                  )}
                </Show>
              </div>
            </Match>
          </Switch>
        </Show>
      </Show>

      {/* 分页 */}
      <Show when={totalPages() > 1}>
        <div
          style={{
            display: "flex",
            "justify-content": "center",
            "align-items": "center",
            "flex-wrap": "wrap",
            gap: "8px",
            "margin-top": "32px",
          }}
        >
          <button
            disabled={page() <= 1}
            onClick={() => setPage(1)}
            style={{
              background: paginationBg(),
              border: `1px solid ${paginationBorder()}`,
              "border-radius": "8px",
              color:
                page() <= 1 ? paginationDisabledColor() : paginationColor(),
              padding: "6px 10px",
              cursor: page() <= 1 ? "not-allowed" : "pointer",
              "font-size": "13px",
            }}
          >
            « {t("media.browser.first_page")}
          </button>
          <button
            disabled={page() <= 1}
            onClick={() => setPage(page() - 1)}
            style={{
              background: paginationBg(),
              border: `1px solid ${paginationBorder()}`,
              "border-radius": "8px",
              color:
                page() <= 1 ? paginationDisabledColor() : paginationColor(),
              padding: "6px 14px",
              cursor: page() <= 1 ? "not-allowed" : "pointer",
              "font-size": "13px",
            }}
          >
            ← {t("media.browser.prev_page")}
          </button>
          <span style={{ color: paginationInfoColor(), "font-size": "13px" }}>
            {t("media.browser.page_info", {
              page: page(),
              totalPages: totalPages(),
              total: total(),
            })}
          </span>
          <button
            disabled={page() >= totalPages()}
            onClick={() => setPage(page() + 1)}
            style={{
              background: paginationBg(),
              border: `1px solid ${paginationBorder()}`,
              "border-radius": "8px",
              color:
                page() >= totalPages()
                  ? paginationDisabledColor()
                  : paginationColor(),
              padding: "6px 14px",
              cursor: page() >= totalPages() ? "not-allowed" : "pointer",
              "font-size": "13px",
            }}
          >
            {t("media.browser.next_page")} →
          </button>
          <button
            disabled={page() >= totalPages()}
            onClick={() => setPage(totalPages())}
            style={{
              background: paginationBg(),
              border: `1px solid ${paginationBorder()}`,
              "border-radius": "8px",
              color:
                page() >= totalPages()
                  ? paginationDisabledColor()
                  : paginationColor(),
              padding: "6px 10px",
              cursor: page() >= totalPages() ? "not-allowed" : "pointer",
              "font-size": "13px",
            }}
          >
            {t("media.browser.last_page")} »
          </button>
          {/* 跳转输入框 */}
          <span style={{ color: paginationInfoColor(), "font-size": "13px" }}>
            {t("media.browser.jump_to")}
          </span>
          <input
            type="number"
            min="1"
            max={totalPages()}
            value={pageInput()}
            onInput={(e) => setPageInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = parseInt(pageInput(), 10)
                if (Number.isFinite(n) && n >= 1 && n <= totalPages()) {
                  setPage(n)
                } else {
                  setPageInput(String(page()))
                }
              }
            }}
            onBlur={() => {
              const n = parseInt(pageInput(), 10)
              if (!Number.isFinite(n) || n < 1 || n > totalPages()) {
                setPageInput(String(page()))
              }
            }}
            style={{
              background: paginationBg(),
              border: `1px solid ${paginationBorder()}`,
              "border-radius": "6px",
              color: paginationColor(),
              padding: "4px 8px",
              "font-size": "13px",
              width: "60px",
              "text-align": "center",
              outline: "none",
            }}
          />
          <button
            onClick={() => {
              const n = parseInt(pageInput(), 10)
              if (Number.isFinite(n) && n >= 1 && n <= totalPages()) {
                setPage(n)
              } else {
                setPageInput(String(page()))
              }
            }}
            style={{
              background: paginationBg(),
              border: `1px solid ${paginationBorder()}`,
              "border-radius": "6px",
              color: paginationColor(),
              padding: "5px 10px",
              cursor: "pointer",
              "font-size": "13px",
            }}
          >
            {t("media.browser.jump")}
          </button>
        </div>
      </Show>
    </div>
  )
}
