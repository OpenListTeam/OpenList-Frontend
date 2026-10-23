import { resolveMediaCover } from "~/utils/media_cover"
import { accentGradient } from "~/utils/accent"
import {
  createSignal,
  createResource,
  createMemo,
  Show,
  For,
  createEffect,
} from "solid-js"
import { useColorMode } from "@hope-ui/solid"
import { TbMusic, TbPlayerPlayFilled } from "solid-icons/tb"
import { MediaLayout } from "../MediaLayout"
import { MediaItemDetail } from "../MediaItemDetail"
import { mediaBackBtn, mediaPrimaryBtn } from "../ui"
import {
  getAlbumList,
  getAlbumTracks,
  getMediaFolders,
  getMediaList,
  getMediaUserData,
  setMediaFavorite,
} from "~/utils/media_api"
import type { MediaItem, AlbumInfo } from "~/types"
import { getMediaName, formatDuration } from "~/types"
import { notify } from "~/utils"
import { useT } from "~/hooks"
import { playPlaylist, playTrack } from "./player"

type BrowseMode = "all" | "folder"
type OrderBy = "name" | "date" | "size"
type OrderDir = "asc" | "desc"

export {
  MusicPlayer,
  closePlayer,
  initAudio,
  playNext,
  playPlaylist,
  playPrev,
  playTrack,
  playerState,
  setPlayerState,
  togglePlay,
} from "./player"

// ==================== 专辑卡片 ====================
const AlbumCard = (props: { album: AlbumInfo }) => {
  const t = useT()
  const { colorMode } = useColorMode()
  const isDark = createMemo(() => colorMode() === "dark")
  const cardBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
  )
  const cardBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)",
  )
  const coverFallbackBg = createMemo(() =>
    isDark()
      ? "linear-gradient(135deg, #1e293b, #0f172a)"
      : "linear-gradient(135deg, #e2e8f0, #cbd5e1)",
  )
  const coverBg = createMemo(() => (isDark() ? "#1e293b" : "#e2e8f0"))
  const titleColor = createMemo(() => (isDark() ? "#e2e8f0" : "#1e293b"))
  const subColor = createMemo(() => (isDark() ? "#64748b" : "#94a3b8"))

  return (
    <div
      style={{
        background: cardBg(),
        "border-radius": "12px",
        overflow: "hidden",
        border: `1px solid ${cardBorder()}`,
        transition: "transform 0.2s, box-shadow 0.2s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-4px)"
        e.currentTarget.style.boxShadow = isDark()
          ? "0 12px 32px rgba(0,0,0,0.4)"
          : "0 12px 32px rgba(0,0,0,0.15)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)"
        e.currentTarget.style.boxShadow = "none"
      }}
    >
      <div
        style={{
          position: "relative",
          "padding-top": "100%",
          background: coverBg(),
        }}
      >
        <Show
          when={props.album.cover}
          fallback={
            <div
              style={{
                position: "absolute",
                inset: "0",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                background: coverFallbackBg(),
              }}
            >
              <TbMusic size={48} style={{ opacity: 0.55 }} />
            </div>
          }
        >
          <img
            src={resolveMediaCover(props.album.cover)}
            alt={props.album.album_name}
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              "object-fit": "cover",
            }}
            loading="lazy"
          />
        </Show>
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div
          style={{
            color: titleColor(),
            "font-size": "13px",
            "font-weight": "500",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {props.album.album_name || t("media.music.unknown_album")}
        </div>
        <div
          style={{
            color: subColor(),
            "font-size": "11px",
            "margin-top": "2px",
          }}
        >
          {[
            props.album.album_artist || t("media.music.unknown_artist"),
            props.album.release_date?.slice(0, 4),
            t("media.music.track_count", { count: props.album.track_count }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </div>
  )
}

// ==================== 专辑详情 ====================
const AlbumDetail = (props: { album: AlbumInfo; onBack: () => void }) => {
  const t = useT()
  const { colorMode } = useColorMode()
  const isDark = createMemo(() => colorMode() === "dark")
  const labelColor = createMemo(() => (isDark() ? "#64748b" : "#94a3b8"))
  const titleColor = createMemo(() => (isDark() ? "#f1f5f9" : "#0f172a"))
  const artistColor = createMemo(() => (isDark() ? "#94a3b8" : "#475569"))
  const metaColor = createMemo(() => (isDark() ? "#475569" : "#94a3b8"))
  const trackBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)",
  )
  const trackHoverBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
  )
  const trackNumColor = createMemo(() => (isDark() ? "#475569" : "#94a3b8"))
  const trackNameColor = createMemo(() => (isDark() ? "#e2e8f0" : "#1e293b"))
  const trackDurColor = createMemo(() => (isDark() ? "#475569" : "#94a3b8"))

  // 用 createMemo 稳定化 source，避免每次渲染都产生新对象引用导致无限重复请求
  const trackSource = createMemo(
    () => `${props.album.album_name}|||${props.album.album_artist}`,
  )

  const [tracks] = createResource(trackSource, async (key) => {
    const [name, artist] = key.split("|||")
    // 专辑名和艺术家名都为空时才跳过（后端要求至少一个不为空）
    if (!name && !artist) return [] as MediaItem[]
    const resp = await getAlbumTracks(name, artist)
    if (resp.code === 200) return resp.data as MediaItem[]
    return [] as MediaItem[]
  })

  return (
    <div>
      <button onClick={props.onBack} style={mediaBackBtn(isDark())}>
        ← {t("media.music.back")}
      </button>

      {/* 专辑头部 */}
      <div
        style={{
          display: "flex",
          gap: "28px",
          "margin-bottom": "32px",
          "flex-wrap": "wrap",
        }}
      >
        <Show
          when={props.album.cover}
          fallback={
            <div
              style={{
                width: "180px",
                height: "180px",
                "border-radius": "12px",
                background: accentGradient(),
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "flex-shrink": "0",
              }}
            >
              <TbMusic size={64} style={{ opacity: 0.85 }} />
            </div>
          }
        >
          <img
            src={resolveMediaCover(props.album.cover)}
            style={{
              width: "180px",
              height: "180px",
              "border-radius": "12px",
              "object-fit": "cover",
              "box-shadow": "0 16px 40px rgba(0,0,0,0.4)",
              "flex-shrink": "0",
            }}
          />
        </Show>
        <div style={{ flex: "1" }}>
          <div
            style={{
              color: labelColor(),
              "font-size": "12px",
              "margin-bottom": "6px",
            }}
          >
            {t("media.music.album")}
          </div>
          <h2
            style={{
              margin: "0 0 8px",
              "font-size": "24px",
              color: titleColor(),
            }}
          >
            {props.album.album_name || t("media.music.unknown_album")}
          </h2>
          <div
            style={{
              color: artistColor(),
              "font-size": "14px",
              "margin-bottom": "4px",
            }}
          >
            {props.album.album_artist}
          </div>
          <div
            style={{
              color: metaColor(),
              "font-size": "13px",
              "margin-bottom": "16px",
            }}
          >
            {props.album.release_date?.slice(0, 4)} ·{" "}
            {t("media.music.song_count", { count: props.album.track_count })}
          </div>
          <button
            onClick={() => {
              const list = tracks()
              if (list && list.length > 0) playPlaylist(list, 0)
            }}
            style={mediaPrimaryBtn()}
          >
            <TbPlayerPlayFilled size={14} />
            {t("media.music.play_all")}
          </button>
        </div>
      </div>

      {/* 曲目列表 */}
      <div>
        <h3
          style={{
            color: labelColor(),
            "font-size": "12px",
            "font-weight": "600",
            "text-transform": "uppercase",
            "letter-spacing": "0.08em",
            "margin-bottom": "12px",
          }}
        >
          {t("media.music.track_list")}
        </h3>
        <Show
          when={!tracks.loading}
          fallback={
            <div style={{ color: metaColor() }}>{t("media.music.loading")}</div>
          }
        >
          <Show
            when={(tracks()?.length ?? 0) > 0}
            fallback={
              <div
                style={{
                  color: metaColor(),
                  padding: "20px 0",
                  "text-align": "center",
                }}
              >
                {t("media.music.no_tracks")}
              </div>
            }
          >
            <For each={tracks() ?? []}>
              {(track, i) => (
                <div
                  onClick={() => {
                    const t = tracks()
                    if (t && t.length > 0) playPlaylist(t, i())
                  }}
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "12px",
                    padding: "10px 12px",
                    "border-radius": "8px",
                    cursor: "pointer",
                    transition: "background 0.15s",
                    "border-bottom": `1px solid ${trackBorder()}`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = trackHoverBg()
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent"
                  }}
                >
                  <span
                    style={{
                      color: trackNumColor(),
                      "font-size": "13px",
                      width: "24px",
                      "text-align": "right",
                    }}
                  >
                    {track.track_number || i() + 1}
                  </span>
                  <div style={{ flex: "1" }}>
                    <div
                      style={{ color: trackNameColor(), "font-size": "14px" }}
                    >
                      {getMediaName(track)}
                    </div>
                  </div>
                  <span style={{ color: trackDurColor(), "font-size": "12px" }}>
                    {formatDuration(track.duration)}
                  </span>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  )
}

// ==================== 音乐库主页 ====================
const MusicLibrary = () => {
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
  const sortLabelColor = createMemo(() => (isDark() ? "#475569" : "#64748b"))
  const sortActiveBg = "rgba(24,144,255,0.3)"
  const sortActiveBorder = "rgba(24,144,255,0.5)"
  const sortActiveColor = "#a5b4fc"
  const sortInactiveBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
  )
  const sortInactiveBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)",
  )
  const sortInactiveColor = createMemo(() => (isDark() ? "#94a3b8" : "#475569"))
  const btnActiveBg = "rgba(24,144,255,0.3)"
  const btnActiveBorder = "rgba(24,144,255,0.5)"
  const btnActiveColor = "#a5b4fc"
  const btnInactiveBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)",
  )
  const btnInactiveColor = createMemo(() => (isDark() ? "#64748b" : "#64748b"))
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
  const folderBtnColor = createMemo(() => (isDark() ? "#94a3b8" : "#64748b"))
  const emptyColor = createMemo(() => (isDark() ? "#475569" : "#94a3b8"))
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

  const [selectedAlbum, setSelectedAlbum] = createSignal<AlbumInfo | null>(null)
  // 卡片（专辑）/ 列表（歌曲）视图，持久化到浏览器
  const MUSIC_VIEW_KEY = "media-view-mode-music"
  const storedMusicView = (() => {
    try {
      const v = localStorage.getItem(MUSIC_VIEW_KEY)
      return v === "list" || v === "card" ? v : "card"
    } catch {
      return "card"
    }
  })()
  const [viewMode, setViewMode] = createSignal<"card" | "list">(storedMusicView)
  const changeViewMode = (mode: "card" | "list") => {
    setViewMode(mode)
    try {
      localStorage.setItem(MUSIC_VIEW_KEY, mode)
    } catch {
      /* ignore */
    }
  }
  const [selectedTrack, setSelectedTrack] = createSignal<MediaItem | null>(null)
  const [favorites, setFavorites] = createSignal<Record<number, boolean>>({})
  const [page, setPage] = createSignal(1)
  const [keyword, setKeyword] = createSignal("")
  const [browseMode, setBrowseMode] = createSignal<BrowseMode>("all")
  const [orderBy, setOrderBy] = createSignal<OrderBy>("name")
  const [orderDir, setOrderDir] = createSignal<OrderDir>("asc")
  const [selectedFolder, setSelectedFolder] = createSignal("")
  const pageSize = 40

  const [albumData] = createResource(
    () => ({
      page: page(),
      page_size: pageSize,
      keyword: keyword() || undefined,
      order_by: orderBy(),
      order_dir: orderDir(),
      folder_path: browseMode() === "folder" ? selectedFolder() : undefined,
    }),
    async (params) => {
      const resp = await getAlbumList(params)
      if (resp.code === 200) return resp.data
      return { content: [], total: 0 }
    },
  )

  // 加载文件夹列表
  const [foldersData] = createResource(
    () => (browseMode() === "folder" ? "music" : null),
    async (mt) => {
      if (!mt) return []
      const resp = await getMediaFolders("music")
      if (resp.code === 200) return resp.data
      return []
    },
  )

  // 列表视图：直接拉取歌曲条目，展示专辑 / 作者 / 类型 / 年代
  const [trackData] = createResource(
    () =>
      viewMode() === "list"
        ? {
            page: page(),
            page_size: pageSize,
            keyword: keyword() || undefined,
            order_by: orderBy(),
            order_dir: orderDir(),
            folder_path:
              browseMode() === "folder" ? selectedFolder() : undefined,
          }
        : null,
    async (params) => {
      if (!params) return { content: [], total: 0 }
      const resp = await getMediaList({ media_type: "music", ...params })
      if (resp.code === 200) return resp.data
      return { content: [], total: 0 }
    },
  )

  const albums = () => (albumData()?.content as AlbumInfo[]) ?? []
  const tracks = () => (trackData()?.content as MediaItem[]) ?? []
  const total = () =>
    (viewMode() === "list" ? trackData()?.total : albumData()?.total) ?? 0
  const totalPages = () => Math.ceil(total() / pageSize)

  // 批量拉取收藏状态
  createEffect(() => {
    const list = tracks()
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
        /* 忽略访客场景 */
      })
  })

  // 列表视图保持有选中项
  createEffect(() => {
    const list = tracks()
    const current = selectedTrack()
    if (viewMode() !== "list" || list.length === 0) {
      if (current && !list.some((item) => item.id === current.id)) {
        setSelectedTrack(null)
      }
      return
    }
    if (!current || !list.some((item) => item.id === current.id)) {
      setSelectedTrack(list[0])
    }
  })

  const toggleFavorite = async (item: MediaItem, favorite: boolean) => {
    setFavorites((prev) => ({ ...prev, [item.id]: favorite }))
    const resp = await setMediaFavorite(item.id, favorite)
    if (resp.code !== 200) {
      setFavorites((prev) => ({ ...prev, [item.id]: !favorite }))
      notify.error(t("media.browser.favorite_failed") + ": " + resp.message)
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
        background: orderBy() === p.col ? sortActiveBg : sortInactiveBg(),
        border:
          orderBy() === p.col
            ? `1px solid ${sortActiveBorder}`
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
    <MediaLayout title={t("media.music.title")}>
      <Show
        when={selectedAlbum()}
        fallback={
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
                        browseMode() === mode ? btnActiveBg : "transparent",
                      border:
                        browseMode() === mode
                          ? `1px solid ${btnActiveBorder}`
                          : `1px solid ${btnInactiveBorder()}`,
                      "border-radius": "6px",
                      color:
                        browseMode() === mode
                          ? btnActiveColor
                          : btnInactiveColor(),
                      padding: "5px 12px",
                      "font-size": "12px",
                      cursor: "pointer",
                    }}
                  >
                    {mode === "all"
                      ? t("media.browser.all")
                      : t("media.browser.folders")}
                  </button>
                ))}
              </div>

              <div
                style={{
                  width: "1px",
                  height: "20px",
                  background: dividerColor(),
                }}
              />

              {/* 排序 */}
              <div
                style={{ display: "flex", gap: "6px", "align-items": "center" }}
              >
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
                placeholder={t("media.music.search_placeholder")}
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
                  width: "180px",
                }}
              />

              {/* 视图切换：卡片（专辑）/ 列表（歌曲） */}
              <div style={{ display: "flex", gap: "4px" }}>
                {(["card", "list"] as const).map((mode) => (
                  <button
                    onClick={() => {
                      changeViewMode(mode)
                      setPage(1)
                    }}
                    title={
                      mode === "card"
                        ? t("media.music.view_card")
                        : t("media.music.view_list")
                    }
                    style={{
                      background:
                        viewMode() === mode ? btnActiveBg : "transparent",
                      border:
                        viewMode() === mode
                          ? `1px solid ${btnActiveBorder}`
                          : `1px solid ${btnInactiveBorder()}`,
                      "border-radius": "6px",
                      color:
                        viewMode() === mode
                          ? btnActiveColor
                          : btnInactiveColor(),
                      padding: "5px 8px",
                      "font-size": "14px",
                      cursor: "pointer",
                    }}
                  >
                    {mode === "card" ? "⊞" : "☰"}
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
                    background:
                      selectedFolder() === "" ? btnActiveBg : folderBtnBg(),
                    border: `1px solid ${btnInactiveBorder()}`,
                    "border-radius": "8px",
                    color:
                      selectedFolder() === ""
                        ? btnActiveColor
                        : folderBtnColor(),
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
                          selectedFolder() === folder
                            ? btnActiveBg
                            : folderBtnBg(),
                        border:
                          selectedFolder() === folder
                            ? `1px solid ${btnActiveBorder}`
                            : `1px solid ${btnInactiveBorder()}`,
                        "border-radius": "8px",
                        color:
                          selectedFolder() === folder
                            ? btnActiveColor
                            : folderBtnColor(),
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

            {/* 卡片视图：专辑 */}
            <Show when={viewMode() === "card"}>
              <Show
                when={!albumData.loading}
                fallback={
                  <div
                    style={{
                      "text-align": "center",
                      padding: "60px",
                      color: emptyColor(),
                    }}
                  >
                    <div
                      style={{ "font-size": "32px", "margin-bottom": "12px" }}
                    >
                      ⏳
                    </div>
                    <div>{t("media.music.loading")}</div>
                  </div>
                }
              >
                <Show
                  when={albums().length > 0}
                  fallback={
                    <div
                      style={{
                        "text-align": "center",
                        padding: "60px",
                        color: emptyColor(),
                      }}
                    >
                      <div style={{ "margin-bottom": "12px" }}>
                        <TbMusic size={48} style={{ opacity: 0.5 }} />
                      </div>
                      <div>{t("media.music.no_albums")}</div>
                    </div>
                  }
                >
                  <div style={{ columns: "5 160px", "column-gap": "16px" }}>
                    <For each={albums()}>
                      {(album) => (
                        <div
                          style={{
                            "break-inside": "avoid",
                            "margin-bottom": "16px",
                            cursor: "pointer",
                          }}
                          onClick={() => setSelectedAlbum(album)}
                        >
                          <AlbumCard album={album} />
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </Show>

            {/* 列表视图：歌曲 + 右侧详情 */}
            <Show when={viewMode() === "list"}>
              <style>{`
                .music-list-layout {
                  display: grid;
                  grid-template-columns: minmax(0, 1fr) 320px;
                  gap: 16px;
                  align-items: start;
                }
                @media (max-width: 1100px) {
                  .music-list-layout { grid-template-columns: minmax(0, 1fr); }
                  .music-list-detail { display: none; }
                }
              `}</style>
              <Show
                when={!trackData.loading}
                fallback={
                  <div
                    style={{
                      "text-align": "center",
                      padding: "60px",
                      color: emptyColor(),
                    }}
                  >
                    <div
                      style={{ "font-size": "32px", "margin-bottom": "12px" }}
                    >
                      ⏳
                    </div>
                    <div>{t("media.music.loading")}</div>
                  </div>
                }
              >
                <Show
                  when={tracks().length > 0}
                  fallback={
                    <div
                      style={{
                        "text-align": "center",
                        padding: "60px",
                        color: emptyColor(),
                      }}
                    >
                      <div style={{ "margin-bottom": "12px" }}>
                        <TbMusic size={48} style={{ opacity: 0.5 }} />
                      </div>
                      <div>{t("media.music.no_albums")}</div>
                    </div>
                  }
                >
                  <div class="music-list-layout">
                    <div
                      style={{
                        display: "flex",
                        "flex-direction": "column",
                        gap: "4px",
                      }}
                    >
                      <For each={tracks()}>
                        {(track) => (
                          <div
                            onClick={() => setSelectedTrack(track)}
                            onDblClick={() => playTrack(track)}
                            title={t("media.music.track_item_tip")}
                            style={{
                              display: "flex",
                              "align-items": "center",
                              gap: "12px",
                              padding: "8px 12px",
                              "border-radius": "8px",
                              cursor: "pointer",
                              background:
                                selectedTrack()?.id === track.id
                                  ? isDark()
                                    ? "rgba(24,144,255,0.16)"
                                    : "rgba(24,144,255,0.08)"
                                  : isDark()
                                    ? "rgba(255,255,255,0.03)"
                                    : "rgba(0,0,0,0.02)",
                              border:
                                selectedTrack()?.id === track.id
                                  ? `1px solid ${btnActiveBorder}`
                                  : `1px solid ${
                                      isDark()
                                        ? "rgba(255,255,255,0.05)"
                                        : "rgba(0,0,0,0.06)"
                                    }`,
                            }}
                          >
                            <Show
                              when={track.cover}
                              fallback={
                                <div
                                  style={{
                                    width: "40px",
                                    height: "40px",
                                    "border-radius": "6px",
                                    background: accentGradient(),
                                    display: "flex",
                                    "align-items": "center",
                                    "justify-content": "center",
                                    "flex-shrink": "0",
                                    color: "white",
                                  }}
                                >
                                  <TbMusic size={18} />
                                </div>
                              }
                            >
                              <img
                                src={resolveMediaCover(track.cover)}
                                alt={getMediaName(track)}
                                loading="lazy"
                                style={{
                                  width: "40px",
                                  height: "40px",
                                  "border-radius": "6px",
                                  "object-fit": "cover",
                                  "flex-shrink": "0",
                                }}
                              />
                            </Show>
                            <div style={{ flex: "1", "min-width": "0" }}>
                              <div
                                style={{
                                  color: isDark() ? "#e2e8f0" : "#1e293b",
                                  "font-size": "14px",
                                  overflow: "hidden",
                                  "text-overflow": "ellipsis",
                                  "white-space": "nowrap",
                                }}
                              >
                                {getMediaName(track)}
                              </div>
                              <div
                                style={{
                                  color: isDark() ? "#64748b" : "#94a3b8",
                                  "font-size": "12px",
                                  overflow: "hidden",
                                  "text-overflow": "ellipsis",
                                  "white-space": "nowrap",
                                }}
                              >
                                {[track.album_name, track.album_artist]
                                  .filter(Boolean)
                                  .join(" · ") ||
                                  t("media.music.unknown_album")}
                              </div>
                            </div>
                            <div
                              style={{
                                color: isDark() ? "#64748b" : "#94a3b8",
                                "font-size": "12px",
                                "text-align": "right",
                                "flex-shrink": "0",
                              }}
                            >
                              <div>
                                {[track.genre, track.release_date?.slice(0, 4)]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                              <div>{formatDuration(track.duration)}</div>
                            </div>
                            <Show when={favorites()[track.id]}>
                              <span
                                style={{
                                  color: "#fbbf24",
                                  "font-size": "13px",
                                  "flex-shrink": "0",
                                }}
                              >
                                ★
                              </span>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                    <Show when={selectedTrack()}>
                      {(track) => (
                        <div class="music-list-detail">
                          <MediaItemDetail
                            item={track()}
                            favorite={!!favorites()[track().id]}
                            onToggleFavorite={toggleFavorite}
                            onOpen={(item) => playTrack(item)}
                            openLabel={t("media.music.play")}
                          />
                        </div>
                      )}
                    </Show>
                  </div>
                </Show>
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
                      page() <= 1
                        ? paginationDisabledColor()
                        : paginationColor(),
                    padding: "6px 14px",
                    cursor: page() <= 1 ? "not-allowed" : "pointer",
                    "font-size": "13px",
                  }}
                >
                  ← {t("media.browser.prev_page")}
                </button>
                <span
                  style={{ color: paginationInfoColor(), "font-size": "13px" }}
                >
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
              </div>
            </Show>
          </div>
        }
      >
        <AlbumDetail
          album={selectedAlbum()!}
          onBack={() => setSelectedAlbum(null)}
        />
      </Show>
    </MediaLayout>
  )
}

export default MusicLibrary
