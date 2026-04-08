import {
  createSignal,
  createResource,
  createMemo,
  Show,
  For,
  onMount,
  onCleanup,
} from "solid-js"
import { useColorMode } from "@hope-ui/solid"
import { MediaLayout } from "../MediaLayout"
import { MediaBrowser } from "../MediaBrowser"
import { getMediaItem } from "~/utils/media_api"
import type { MediaItem, EpisodeInfo } from "~/types"
import { getMediaName, parseAuthors, parseEpisodes } from "~/types"
import { api, base_path, ext } from "~/utils"
import Artplayer from "artplayer"
import artplayerProxyMediabunny from "~/components/artplayer-proxy-mediabunny"
import Hls from "hls.js"
import mpegts from "mpegts.js"
import { registerAc3Decoder } from "@mediabunny/ac3"

// MediaBunny 播放器开关：从 localStorage 读取用户偏好
const MEDIABUNNY_KEY = "use_mediabunny_player"
function isMediaBunnyEnabled(): boolean {
  return localStorage.getItem(MEDIABUNNY_KEY) === "true"
}
function setMediaBunnyEnabled(enabled: boolean) {
  localStorage.setItem(MEDIABUNNY_KEY, enabled ? "true" : "false")
}
// 仅在启用 MediaBunny 时注册 AC3 解码器
if (isMediaBunnyEnabled()) {
  registerAc3Decoder()
}

// ==================== 视频卡片 ====================
const VideoCard = (props: { item: MediaItem }) => {
  const { colorMode } = useColorMode()
  const isDark = createMemo(() => colorMode() === "dark")
  const cardBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
  )
  const cardBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)",
  )
  const coverBg = createMemo(() => (isDark() ? "#1e293b" : "#e2e8f0"))
  const titleColor = createMemo(() => (isDark() ? "#e2e8f0" : "#1e293b"))
  const subColor = createMemo(() => (isDark() ? "#64748b" : "#94a3b8"))
  const name = () => getMediaName(props.item)
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
      {/* 封面 */}
      <div
        style={{
          position: "relative",
          "padding-top": "150%",
          background: coverBg(),
        }}
      >
        <Show
          when={props.item.cover}
          fallback={
            <div
              style={{
                position: "absolute",
                inset: "0",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "48px",
                color: subColor(),
              }}
            >
              🎬
            </div>
          }
        >
          <img
            src={props.item.cover}
            alt={name()}
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
        {/* 评分角标 */}
        <Show when={props.item.rating > 0}>
          <div
            style={{
              position: "absolute",
              top: "8px",
              right: "8px",
              background: "rgba(0,0,0,0.7)",
              "border-radius": "6px",
              padding: "2px 6px",
              "font-size": "11px",
              color: "#fbbf24",
              "font-weight": "600",
            }}
          >
            ⭐ {props.item.rating.toFixed(1)}
          </div>
        </Show>
      </div>
      {/* 信息 */}
      <div style={{ padding: "10px 12px" }}>
        <div
          style={{
            color: titleColor(),
            "font-size": "13px",
            "font-weight": "500",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            "margin-bottom": "4px",
          }}
          title={name()}
        >
          {name()}
        </div>
        <Show when={props.item.release_date}>
          <div style={{ color: subColor(), "font-size": "11px" }}>
            {props.item.release_date?.slice(0, 4)}
          </div>
        </Show>
      </div>
    </div>
  )
}

// ==================== 内嵌视频播放器 ====================
const VideoPlayer = (props: {
  item: MediaItem
  // 可选：指定播放的文件路径和标题（用于选集播放）
  filePath?: string
  title?: string
  onClose: () => void
}) => {
  let playerContainer: HTMLDivElement | undefined
  let player: Artplayer | undefined
  let hlsPlayer: Hls | undefined
  let flvPlayer: mpegts.Player | undefined

  // 优先使用传入的 filePath，否则拼接 folder_path + "/" + file_name
  const videoUrl = () => {
    if (props.filePath) return `${api}/p${props.filePath}?force`
    const folder = props.item.folder_path?.replace(/\/$/, "") ?? ""
    return `${api}/p${folder}/${props.item.file_name}?force`
  }
  const videoTitle = () => props.title ?? getMediaName(props.item)

  onMount(() => {
    if (!playerContainer) return
    const fileExt = ext(props.item.file_name)
    player = new Artplayer({
      container: playerContainer,
      url: videoUrl(),
      title: videoTitle(),
      volume: 1.0,
      autoplay: false,
      autoSize: false,
      loop: false,
      flip: true,
      playbackRate: true,
      aspectRatio: true,
      screenshot: true,
      setting: true,
      hotkey: true,
      pip: true,
      fullscreen: true,
      fullscreenWeb: true,
      mutex: true,
      playsInline: true,
      type: fileExt,
      setting: true,
      ...(isMediaBunnyEnabled() ? { proxy: artplayerProxyMediabunny() } : {}),
      customType: {
        m3u8: (video: HTMLMediaElement, src: string) => {
          hlsPlayer = new Hls()
          hlsPlayer.loadSource(src)
          hlsPlayer.attachMedia(video)
          if (!video.src) video.src = src
        },
        flv: (video: HTMLMediaElement, src: string) => {
          flvPlayer = mpegts.createPlayer({ type: "flv", url: src })
          flvPlayer.attachMediaElement(video)
          flvPlayer.load()
        },
      },
      moreVideoAttr: {
        // @ts-ignore
        "webkit-playsinline": true,
        playsInline: true,
      },
      settings: [
        {
          id: "setting_mediabunny",
          html: "MediaBunny 播放器",
          tooltip: isMediaBunnyEnabled() ? "已启用" : "已禁用",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
          switch: isMediaBunnyEnabled(),
          onSwitch: function (item: any) {
            const newVal = !item.switch
            setMediaBunnyEnabled(newVal)
            item.tooltip = newVal ? "已启用" : "已禁用"
            setTimeout(() => {
              if (confirm("切换播放器需要刷新页面才能生效，是否立即刷新？")) {
                location.reload()
              }
            }, 100)
            return newVal
          },
        },
      ],
    })
  })

  onCleanup(() => {
    if (player?.video) player.video.src = ""
    player?.destroy()
    hlsPlayer?.destroy()
    flvPlayer?.destroy()
  })

  return (
    <div
      style={{
        position: "fixed",
        inset: "0",
        "z-index": "200",
        background: "#000",
        display: "flex",
        "flex-direction": "column",
      }}
    >
      {/* 顶部栏 */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "12px",
          padding: "10px 16px",
          background: "rgba(0,0,0,0.8)",
          "flex-shrink": "0",
        }}
      >
        <button
          onClick={props.onClose}
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.12)",
            "border-radius": "8px",
            color: "#94a3b8",
            padding: "6px 14px",
            cursor: "pointer",
            "font-size": "13px",
          }}
        >
          ← 返回
        </button>
        <span
          style={{
            color: "#e2e8f0",
            "font-size": "14px",
            "font-weight": "500",
          }}
        >
          {videoTitle()}
        </span>
      </div>

      {/* 播放区域 */}
      <div style={{ flex: "1", position: "relative", background: "#000" }}>
        <div ref={playerContainer} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  )
}

// ==================== 视频详情页 ====================
const VideoDetail = (props: { id: string; onBack: () => void }) => {
  const { colorMode } = useColorMode()
  const isDark = createMemo(() => colorMode() === "dark")
  const [item] = createResource(
    () => parseInt(props.id),
    async (id) => {
      const resp = await getMediaItem(id)
      if (resp.code === 200) return resp.data
      return null
    },
  )

  const [showPlayer, setShowPlayer] = createSignal(false)
  // 当前播放的选集（null 表示播放主文件）
  const [currentEpisode, setCurrentEpisode] = createSignal<EpisodeInfo | null>(
    null,
  )

  const backBtnBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
  )
  const backBtnBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)",
  )
  const backBtnColor = createMemo(() => (isDark() ? "#94a3b8" : "#64748b"))
  const titleColor = createMemo(() => (isDark() ? "#f1f5f9" : "#0f172a"))
  const metaColor = createMemo(() => (isDark() ? "#64748b" : "#94a3b8"))
  const genreBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
  )
  const genreColor = createMemo(() => (isDark() ? "#94a3b8" : "#64748b"))
  const authorColor = createMemo(() => (isDark() ? "#94a3b8" : "#475569"))
  const authorLabelColor = createMemo(() => (isDark() ? "#64748b" : "#94a3b8"))
  const plotTitleColor = createMemo(() => (isDark() ? "#94a3b8" : "#64748b"))
  const plotColor = createMemo(() => (isDark() ? "#cbd5e1" : "#334155"))
  const coverFallbackBg = createMemo(() => (isDark() ? "#1e293b" : "#e2e8f0"))
  const coverFallbackColor = createMemo(() =>
    isDark() ? "#334155" : "#94a3b8",
  )

  return (
    <Show
      when={item()}
      fallback={
        <div
          style={{
            "text-align": "center",
            padding: "60px",
            color: metaColor(),
          }}
        >
          {item.loading ? "加载中..." : "资源不存在"}
        </div>
      }
    >
      {(data) => {
        const authors = () => parseAuthors(data().authors)
        const genres = () => data().genre?.split(",").filter(Boolean) ?? []

        return (
          <div>
            {/* 返回按鈕 */}
            <button
              onClick={props.onBack}
              style={{
                background: backBtnBg(),
                border: `1px solid ${backBtnBorder()}`,
                "border-radius": "8px",
                color: backBtnColor(),
                padding: "8px 16px",
                cursor: "pointer",
                "font-size": "13px",
                "margin-bottom": "24px",
                display: "flex",
                "align-items": "center",
                gap: "6px",
              }}
            >
              ← 返回
            </button>

            {/* 背景模糊层 */}
            <Show when={data().cover}>
              <div
                style={{
                  position: "fixed",
                  inset: "0",
                  "background-image": `url(${data().cover})`,
                  "background-size": "cover",
                  "background-position": "center",
                  filter: "blur(40px) brightness(0.2)",
                  "z-index": "-1",
                  transform: "scale(1.1)",
                }}
              />
            </Show>

            {/* 详情内容 */}
            <div
              style={{
                display: "flex",
                gap: "32px",
                "flex-wrap": "wrap",
              }}
            >
              {/* 封面 */}
              <div style={{ "flex-shrink": "0" }}>
                <Show
                  when={data().cover}
                  fallback={
                    <div
                      style={{
                        width: "220px",
                        height: "330px",
                        background: coverFallbackBg(),
                        "border-radius": "12px",
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "center",
                        "font-size": "64px",
                        color: coverFallbackColor(),
                      }}
                    >
                      🎬
                    </div>
                  }
                >
                  <img
                    src={data().cover}
                    alt={getMediaName(data())}
                    style={{
                      width: "220px",
                      height: "330px",
                      "object-fit": "cover",
                      "border-radius": "12px",
                      "box-shadow": "0 20px 60px rgba(0,0,0,0.5)",
                    }}
                  />
                </Show>
              </div>

              {/* 信息 */}
              <div style={{ flex: "1", "min-width": "280px" }}>
                <h1
                  style={{
                    margin: "0 0 8px",
                    "font-size": "28px",
                    "font-weight": "700",
                    color: titleColor(),
                    "line-height": "1.2",
                  }}
                >
                  {getMediaName(data())}
                </h1>

                {/* 元信息行 */}
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "12px",
                    "flex-wrap": "wrap",
                    "margin-bottom": "16px",
                  }}
                >
                  <Show when={data().rating > 0}>
                    <span
                      style={{
                        background: "rgba(251,191,36,0.15)",
                        border: "1px solid rgba(251,191,36,0.3)",
                        "border-radius": "6px",
                        padding: "3px 8px",
                        color: "#fbbf24",
                        "font-size": "14px",
                        "font-weight": "600",
                      }}
                    >
                      ⭐ {data().rating.toFixed(1)}
                    </span>
                  </Show>
                  <Show when={data().release_date}>
                    <span style={{ color: metaColor(), "font-size": "14px" }}>
                      {data().release_date?.slice(0, 4)}
                    </span>
                  </Show>
                  <Show when={data().video_type}>
                    <span
                      style={{
                        background: "rgba(99,102,241,0.15)",
                        border: "1px solid rgba(99,102,241,0.3)",
                        "border-radius": "6px",
                        padding: "3px 8px",
                        color: "#a5b4fc",
                        "font-size": "12px",
                      }}
                    >
                      {data().video_type === "movie" ? "电影" : "电视剧"}
                    </span>
                  </Show>
                </div>

                {/* 类型标签 */}
                <Show when={genres().length > 0}>
                  <div
                    style={{
                      display: "flex",
                      "flex-wrap": "wrap",
                      gap: "6px",
                      "margin-bottom": "16px",
                    }}
                  >
                    <For each={genres()}>
                      {(g) => (
                        <span
                          style={{
                            background: genreBg(),
                            "border-radius": "6px",
                            padding: "3px 10px",
                            color: genreColor(),
                            "font-size": "12px",
                          }}
                        >
                          {g}
                        </span>
                      )}
                    </For>
                  </div>
                </Show>

                {/* 演员 */}
                <Show when={authors().length > 0}>
                  <div style={{ "margin-bottom": "16px" }}>
                    <span
                      style={{ color: authorLabelColor(), "font-size": "13px" }}
                    >
                      主演：
                    </span>
                    <span style={{ color: authorColor(), "font-size": "13px" }}>
                      {authors().slice(0, 5).join(" / ")}
                    </span>
                  </div>
                </Show>

                {/* 播放器（全屏覆盖层） */}
                <Show when={showPlayer()}>
                  <VideoPlayer
                    item={data()}
                    filePath={
                      currentEpisode()
                        ? `${data().folder_path?.replace(/\/$/, "")}/${data().file_name}/${currentEpisode()!.file_name}`
                        : undefined
                    }
                    title={
                      currentEpisode()
                        ? currentEpisode()!.index > 0
                          ? `第${currentEpisode()!.index}集 ${currentEpisode()!.title}`
                          : currentEpisode()!.title
                        : undefined
                    }
                    onClose={() => setShowPlayer(false)}
                  />
                </Show>

                {/* 无选集：直接显示播放按钮 */}
                <Show when={parseEpisodes(data().episodes).length === 0}>
                  <button
                    onClick={() => {
                      setCurrentEpisode(null)
                      setShowPlayer(true)
                    }}
                    style={{
                      background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                      border: "none",
                      "border-radius": "10px",
                      color: "white",
                      padding: "12px 28px",
                      "font-size": "15px",
                      "font-weight": "600",
                      cursor: "pointer",
                      display: "flex",
                      "align-items": "center",
                      gap: "8px",
                      "box-shadow": "0 4px 16px rgba(99,102,241,0.4)",
                      "margin-bottom": "24px",
                    }}
                  >
                    ▶ 立即播放
                  </button>
                </Show>

                {/* 选集列表（路径合并模式下有选集时显示） */}
                <Show when={parseEpisodes(data().episodes).length > 0}>
                  {(_) => {
                    const episodes = parseEpisodes(data().episodes)
                    return (
                      <div style={{ "margin-bottom": "24px" }}>
                        <h3
                          style={{
                            color: plotTitleColor(),
                            "font-size": "13px",
                            "font-weight": "600",
                            "text-transform": "uppercase",
                            "letter-spacing": "0.08em",
                            "margin-bottom": "12px",
                          }}
                        >
                          选集（共 {episodes.length} 集）
                        </h3>
                        <div
                          style={{
                            display: "grid",
                            "grid-template-columns":
                              "repeat(auto-fill, minmax(120px, 1fr))",
                            gap: "8px",
                            "max-height": "260px",
                            "overflow-y": "auto",
                            "padding-right": "4px",
                          }}
                        >
                          <For each={episodes}>
                            {(ep) => {
                              const isActive = () =>
                                currentEpisode()?.file_name === ep.file_name
                              const label =
                                ep.index > 0
                                  ? `第${ep.index}集${ep.title ? " " + ep.title : ""}`
                                  : ep.title || ep.file_name
                              return (
                                <button
                                  onClick={() => {
                                    setCurrentEpisode(ep)
                                    setShowPlayer(true)
                                  }}
                                  title={ep.file_name}
                                  style={{
                                    background: isActive()
                                      ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                                      : isDark()
                                        ? "rgba(255,255,255,0.06)"
                                        : "rgba(0,0,0,0.05)",
                                    border: isActive()
                                      ? "none"
                                      : `1px solid ${isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
                                    "border-radius": "8px",
                                    color: isActive()
                                      ? "white"
                                      : isDark()
                                        ? "#94a3b8"
                                        : "#475569",
                                    padding: "8px 10px",
                                    "font-size": "12px",
                                    cursor: "pointer",
                                    "text-align": "left",
                                    overflow: "hidden",
                                    "text-overflow": "ellipsis",
                                    "white-space": "nowrap",
                                    transition: "all 0.15s",
                                    "box-shadow": isActive()
                                      ? "0 2px 8px rgba(99,102,241,0.4)"
                                      : "none",
                                  }}
                                >
                                  ▶ {label}
                                </button>
                              )
                            }}
                          </For>
                        </div>
                      </div>
                    )
                  }}
                </Show>

                {/* 剧情简介 */}
                <Show when={data().plot || data().description}>
                  <div>
                    <h3
                      style={{
                        color: plotTitleColor(),
                        "font-size": "13px",
                        "font-weight": "600",
                        "text-transform": "uppercase",
                        "letter-spacing": "0.08em",
                        "margin-bottom": "8px",
                      }}
                    >
                      剧情简介
                    </h3>
                    <p
                      style={{
                        color: plotColor(),
                        "font-size": "14px",
                        "line-height": "1.7",
                        margin: "0",
                      }}
                    >
                      {data().plot || data().description}
                    </p>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        )
      }}
    </Show>
  )
}

// ==================== 视频库主页 ====================
const VideoLibrary = () => {
  const [selectedId, setSelectedId] = createSignal<string | null>(null)

  return (
    <MediaLayout title="🎬 影视资源库">
      <Show
        when={selectedId()}
        fallback={
          <MediaBrowser
            mediaType="video"
            onItemClick={(item) => setSelectedId(String(item.id))}
            renderCard={(item) => <VideoCard item={item} />}
            renderListRow={(item) => {
              const { colorMode: cm } = useColorMode()
              const dark = createMemo(() => cm() === "dark")
              return (
                <>
                  <Show
                    when={item.cover}
                    fallback={<span style={{ "font-size": "20px" }}>🎬</span>}
                  >
                    <img
                      src={item.cover}
                      style={{
                        width: "32px",
                        height: "48px",
                        "object-fit": "cover",
                        "border-radius": "4px",
                      }}
                    />
                  </Show>
                  <div style={{ flex: "1" }}>
                    <div
                      style={{
                        color: dark() ? "#e2e8f0" : "#1e293b",
                        "font-size": "14px",
                      }}
                    >
                      {getMediaName(item)}
                    </div>
                    <div
                      style={{
                        color: dark() ? "#475569" : "#94a3b8",
                        "font-size": "12px",
                      }}
                    >
                      {item.release_date?.slice(0, 4)}{" "}
                      {item.genre?.split(",")[0]}
                    </div>
                  </div>
                  <Show when={item.rating > 0}>
                    <span style={{ color: "#fbbf24", "font-size": "13px" }}>
                      ⭐ {item.rating.toFixed(1)}
                    </span>
                  </Show>
                </>
              )
            }}
          />
        }
      >
        <VideoDetail id={selectedId()!} onBack={() => setSelectedId(null)} />
      </Show>
    </MediaLayout>
  )
}

export default VideoLibrary
