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
import {
  getMediaList,
  getMediaFolders,
  getMediaScanPaths,
} from "~/utils/media_api"
import type { MediaItem, MediaType, MediaScanPath } from "~/types"
import { getMediaName } from "~/types"

interface MediaBrowserProps {
  mediaType: MediaType
  onItemClick: (item: MediaItem) => void
  onItemsChange?: (items: MediaItem[]) => void
  renderCard: (item: MediaItem) => any
  renderListRow?: (item: MediaItem) => any
}

type ViewMode = "waterfall" | "list"
type BrowseMode = "all" | "folder"
type OrderBy = "name" | "date" | "size"
type OrderDir = "asc" | "desc"

export const MediaBrowser = (props: MediaBrowserProps) => {
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

  const [viewMode, setViewMode] = createSignal<ViewMode>("waterfall")
  const [browseMode, setBrowseMode] = createSignal<BrowseMode>("all")
  const [orderBy, setOrderBy] = createSignal<OrderBy>("name")
  const [orderDir, setOrderDir] = createSignal<OrderDir>("asc")
  const [page, setPage] = createSignal(1)
  const [keyword, setKeyword] = createSignal("")
  const [selectedFolder, setSelectedFolder] = createSignal("")
  const [selectedScanPathId, setSelectedScanPathId] = createSignal<number>(0)
  const [selectedTypeTag, setSelectedTypeTag] = createSignal("")
  const [selectedContentTag, setSelectedContentTag] = createSignal("")

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

  // 加载媒体列表
  const [mediaData] = createResource(
    () => ({
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
      const resp = await getMediaList(params)
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

  // 数据变化时通知父组件
  createEffect(() => {
    const list = items()
    if (list.length > 0) props.onItemsChange?.(list)
  })

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
        {/* 浏览模式 */}
        <div style={{ display: "flex", gap: "6px" }}>
          {(["all", "folder"] as BrowseMode[]).map((mode) => (
            <button
              onClick={() => {
                setBrowseMode(mode)
                setPage(1)
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
              {mode === "all" ? "全部" : "目录"}
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
            <option value="0">全部路径</option>
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
            <option value="">全部类型</option>
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
            <option value="">全部标签</option>
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
            排序:
          </span>
          <OrderBtn col="name" label="名称" />
          <OrderBtn col="date" label="日期" />
          <OrderBtn col="size" label="大小" />
        </div>

        <div style={{ flex: "1" }} />

        {/* 搜索 */}
        <input
          type="text"
          placeholder="搜索..."
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
              onClick={() => setViewMode(mode)}
              title={mode === "waterfall" ? "瀑布流" : "列表"}
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
            📂 全部目录
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
            <div>加载中...</div>
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
              <div>暂无内容</div>
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
                        "break-inside": "avoid",
                        "margin-bottom": "16px",
                        cursor: "pointer",
                      }}
                      onClick={() => props.onItemClick(item)}
                    >
                      {props.renderCard(item)}
                    </div>
                  )}
                </For>
              </div>
            </Match>

            {/* 列表视图 */}
            <Match when={viewMode() === "list"}>
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
                      onClick={() => props.onItemClick(item)}
                      style={{
                        display: "flex",
                        "align-items": "center",
                        gap: "12px",
                        padding: "10px 16px",
                        background: listItemBg(),
                        "border-radius": "8px",
                        border: `1px solid ${listItemBorder()}`,
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
                    </div>
                  )}
                </For>
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
            gap: "8px",
            "margin-top": "32px",
          }}
        >
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
            ← 上一页
          </button>
          <span style={{ color: paginationInfoColor(), "font-size": "13px" }}>
            {page()} / {totalPages()} 页（共 {total()} 项）
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
            下一页 →
          </button>
        </div>
      </Show>
    </div>
  )
}
