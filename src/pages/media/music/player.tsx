import {
  createSignal,
  createMemo,
  createEffect,
  Show,
  For,
  onMount,
  onCleanup,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import {
  TbArrowRight,
  TbArrowsShuffle,
  TbChevronDown,
  TbMusic,
  TbPlayerPauseFilled,
  TbPlayerPlayFilled,
  TbPlayerSkipBackFilled,
  TbPlayerSkipForwardFilled,
  TbRepeat,
  TbRepeatOnce,
  TbStar,
  TbStarFilled,
  TbVolume,
  TbVolumeOff,
  TbX,
} from "solid-icons/tb"
import {
  getMediaProgress,
  getMediaUserData,
  getSignedProxyUrl,
  saveMediaProgress,
  setMediaFavorite,
} from "~/utils/media_api"
import { notify } from "~/utils"
import type { MediaItem } from "~/types"
import { formatDuration, getMediaName } from "~/types"
import { accentBar, accentGradient } from "~/utils/accent"
import { resolveMediaCover } from "~/utils/media_cover"
import { OpenWithPlayer } from "~/components/OpenWithPlayer"
import { useT } from "~/hooks"
import { mediaEnabled, mediaSidebarOpen } from "~/store/media"
import { mediaOverlayZ } from "../ui"

/**
 * 全局音乐播放器：播放状态、音频元素、全屏歌词页与底部播放条。
 *
 * 单独成模块的原因：App / MediaLayout 只需要 playerState 与 MusicPlayer。
 * 若它们反向 import MusicLibrary 页面，整个音乐库代码会被打进首屏 bundle，
 * 同时让 `lazy(() => import(...MusicLibrary))` 的路由级拆包失效。
 */
// ==================== 全局播放器状态 ====================
export const [playerState, setPlayerState] = createSignal<{
  playlist: MediaItem[]
  currentIndex: number
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  loopMode: "none" | "all" | "one" | "shuffle"
  showLyrics: boolean
  externalLyrics: string // 外部同名 .lrc 文件内容，优先于内嵌歌词
}>({
  playlist: [],
  currentIndex: 0,
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 0.2,
  loopMode: "all",
  showLyrics: false,
  externalLyrics: "",
})

let audioEl: HTMLAudioElement | null = null

export const initAudio = () => {
  if (!audioEl) {
    audioEl = new Audio()
    audioEl.volume = playerState().volume

    let lastSavedAt = 0
    const persist = (played = false) => {
      const s = playerState()
      const item = s.playlist[s.currentIndex]
      if (!item || !audioEl) return
      const position = audioEl.currentTime
      if (position < 2 && !played) return
      saveMediaProgress({
        item_id: item.id,
        position,
        duration: audioEl.duration || 0,
        played,
      }).catch(() => {
        /* ignore */
      })
    }
    audioEl.addEventListener("timeupdate", () => {
      setPlayerState((s) => ({ ...s, currentTime: audioEl!.currentTime }))
      const now = Date.now()
      if (now - lastSavedAt < 10_000) return
      lastSavedAt = now
      persist()
    })
    audioEl.addEventListener("pause", () => persist())
    audioEl.addEventListener("ended", () => persist(true))
    audioEl.addEventListener("loadedmetadata", () => {
      setPlayerState((s) => ({ ...s, duration: audioEl!.duration }))
    })
    audioEl.addEventListener("ended", () => {
      playNext()
    })
  }
  return audioEl
}

// 连续切歌时，只有最后一次请求允许写入 audio.src，避免慢响应覆盖新歌
let trackRequestId = 0

export const playTrack = async (item: MediaItem) => {
  const audio = initAudio()
  const reqId = ++trackRequestId
  // 每首歌都是独立文件记录，播放路径 = folder_path + "/" + file_name
  const folder = item.folder_path?.replace(/\/$/, "") ?? ""
  // 使用签名 + 已编码的代理地址（开启签名后裸 /p 路径会 401，文件名含 # ? 也会失效）
  const url = await getSignedProxyUrl(`${folder}/${item.file_name}`)
  if (reqId !== trackRequestId) return
  audio.src = url
  // 续播：读取上次进度，metadata 就绪后跳转
  getMediaProgress(item.id)
    .then((resp) => {
      if (resp.code !== 200 || !resp.data || resp.data.played) return
      const seconds = resp.data.position_ticks / 10_000_000
      if (seconds <= 5) return
      const seekOnce = () => {
        audio.currentTime = seconds
        audio.removeEventListener("loadedmetadata", seekOnce)
      }
      audio.addEventListener("loadedmetadata", seekOnce)
    })
    .catch(() => {
      /* ignore */
    })
  // play() 返回 Promise：自动播放被拦截时必须回滚 playing 状态，
  // 否则按钮显示「暂停」但实际没有声音。
  audio.play().catch(() => {
    setPlayerState((s) => ({ ...s, playing: false }))
  })
  setPlayerState((s) => ({ ...s, playing: true, externalLyrics: "" }))
  const baseName = item.file_name?.replace(/\.[^.]+$/, "") ?? ""
  const lrcPath = `${folder}/${baseName}.lrc`
  getSignedProxyUrl(lrcPath)
    .then((lrcUrl) => fetch(lrcUrl))
    .then((res) => {
      if (res.ok) return res.text()
      return ""
    })
    .then((text) => {
      if (reqId !== trackRequestId) return
      setPlayerState((s) => ({ ...s, externalLyrics: text ?? "" }))
    })
    .catch(() => {
      if (reqId !== trackRequestId) return
      setPlayerState((s) => ({ ...s, externalLyrics: "" }))
    })
}

export const playPlaylist = (items: MediaItem[], startIndex = 0) => {
  setPlayerState((s) => ({
    ...s,
    playlist: items,
    currentIndex: startIndex,
  }))
  playTrack(items[startIndex])
}

// 关闭底部播放器（清空播放列表并停止播放）
export const closePlayer = () => {
  const audio = initAudio()
  audio.pause()
  audio.removeAttribute("src")
  audio.load()
  setPlayerState((s) => ({
    ...s,
    playlist: [],
    currentIndex: 0,
    playing: false,
    currentTime: 0,
    duration: 0,
    showLyrics: false,
  }))
}

export const togglePlay = () => {
  const audio = initAudio()
  if (playerState().playing) {
    audio.pause()
    setPlayerState((s) => ({ ...s, playing: false }))
  } else {
    audio
      .play()
      .then(() => setPlayerState((s) => ({ ...s, playing: true })))
      .catch(() => setPlayerState((s) => ({ ...s, playing: false })))
  }
}

/**
 * 暂停音乐但保留播放列表（不关闭底部播放条）。
 * 视频开始播放时调用，避免视频声音和音乐叠在一起。
 */
export const pauseMusic = () => {
  const audio = initAudio()
  if (!audio.paused) audio.pause()
  if (playerState().playing) {
    setPlayerState((s) => ({ ...s, playing: false }))
  }
}

export const playNext = () => {
  const { playlist, currentIndex, loopMode } = playerState()
  if (playlist.length === 0) return
  let next = currentIndex
  if (loopMode === "shuffle") {
    next = Math.floor(Math.random() * playlist.length)
  } else if (loopMode === "one") {
    next = currentIndex
  } else {
    next = (currentIndex + 1) % playlist.length
  }
  setPlayerState((s) => ({ ...s, currentIndex: next }))
  playTrack(playlist[next])
}

export const playPrev = () => {
  const { playlist, currentIndex } = playerState()
  if (playlist.length === 0) return
  const prev = (currentIndex - 1 + playlist.length) % playlist.length
  setPlayerState((s) => ({ ...s, currentIndex: prev }))
  playTrack(playlist[prev])
}

// ==================== LRC歌词解析 ====================
interface LyricLine {
  time: number
  text: string
}

const parseLRC = (lrc: string): LyricLine[] => {
  if (!lrc) return []
  const lines: LyricLine[] = []
  const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/g
  let match
  while ((match = regex.exec(lrc)) !== null) {
    const min = parseInt(match[1])
    const sec = parseInt(match[2])
    const ms = parseInt(match[3].padEnd(3, "0"))
    lines.push({
      time: min * 60 + sec + ms / 1000,
      text: match[4].trim(),
    })
  }
  return lines.sort((a, b) => a.time - b.time)
}

// ==================== 全屏歌词页 ====================
/**
 * 当前播放曲目的收藏状态（底栏与歌词页共用）。
 *
 * 依赖用 memo 收窄到「曲目 id」：playerState 每次 timeupdate 都会换新对象，
 * 直接在 effect 里读 playerState() 会导致每秒几十次请求。
 */
const useTrackFavorite = () => {
  const t = useT()
  const id = createMemo(() => {
    const s = playerState()
    return s.playlist[s.currentIndex]?.id
  })
  const [favorite, setFavorite] = createSignal(false)
  let reqId = 0
  createEffect(() => {
    const cur = id()
    const mine = ++reqId
    if (!cur) {
      setFavorite(false)
      return
    }
    getMediaUserData([cur])
      .then((resp) => {
        if (mine !== reqId) return
        if (resp.code !== 200 || !resp.data) return
        const row = resp.data.find((d) => d.item_id === cur)
        setFavorite(!!row?.is_favorite)
      })
      .catch(() => {
        /* 访客 / 未登录：忽略 */
      })
  })
  const toggle = async () => {
    const cur = id()
    if (!cur) return
    const next = !favorite()
    setFavorite(next)
    const resp = await setMediaFavorite(cur, next)
    if (resp.code !== 200) {
      setFavorite(!next)
      notify.error(t("media.browser.favorite_failed") + ": " + resp.message)
    }
  }
  return { favorite, toggle }
}

/**
 * 可拖动的进度条。
 *
 * 之前只有 onClick、可视高度 3~4px：手机上一是点不准，二是根本拖不动。
 * 这里改用 Pointer Events（鼠标/触摸一套逻辑）+ 指针捕获，
 * 并把可交互区域用 padding 撑到 ~24px；拖动期间用本地比例覆盖播放进度，
 * 避免和音频 timeupdate 抢位置导致滑块回弹。
 */
const SeekBar = (props: {
  height?: number
  padding?: string
  trackColor?: string
  onSeek: (seconds: number) => void
}) => {
  let trackRef: HTMLDivElement | undefined
  const [dragging, setDragging] = createSignal(false)
  const [dragRatio, setDragRatio] = createSignal<number | null>(null)

  const ratio = () => {
    const dragging = dragRatio()
    if (dragging !== null) return dragging
    const { currentTime, duration } = playerState()
    return duration > 0 ? Math.min(1, currentTime / duration) : 0
  }

  const seekByClientX = (clientX: number) => {
    const el = trackRef
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    setDragRatio(r)
    const duration = playerState().duration
    if (duration > 0) props.onSeek(r * duration)
  }

  return (
    <div
      style={{
        padding: props.padding ?? "10px 0",
        cursor: "pointer",
        "touch-action": "none",
        "user-select": "none",
      }}
      onPointerDown={(e) => {
        e.preventDefault()
        setDragging(true)
        e.currentTarget.setPointerCapture?.(e.pointerId)
        seekByClientX(e.clientX)
      }}
      onPointerMove={(e) => {
        if (!dragging()) return
        seekByClientX(e.clientX)
      }}
      onPointerUp={(e) => {
        setDragging(false)
        setDragRatio(null)
        e.currentTarget.releasePointerCapture?.(e.pointerId)
      }}
      onPointerCancel={() => {
        setDragging(false)
        setDragRatio(null)
      }}
    >
      <div
        ref={trackRef}
        style={{
          height: `${props.height ?? 4}px`,
          background: props.trackColor ?? "rgba(255,255,255,0.15)",
          "border-radius": "2px",
          position: "relative",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${ratio() * 100}%`,
            background: accentBar(),
            "border-radius": "2px",
            transition: dragging() ? "none" : "width 0.4s linear",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: `${ratio() * 100}%`,
            width: "12px",
            height: "12px",
            "border-radius": "50%",
            background: "#fff",
            transform: "translate(-50%, -50%)",
            "box-shadow": "0 1px 4px rgba(0,0,0,0.45)",
            opacity: dragging() ? 1 : 0.9,
          }}
        />
      </div>
    </div>
  )
}

const LyricsPage = () => {
  const t = useT()
  const { favorite, toggle: toggleFavorite } = useTrackFavorite()
  // 窄屏（手机竖屏）必须换成纵向布局：左右两栏里左栏固定 340px 且不可压缩，
  // 加上外层 40px 内边距，390px 的屏幕根本放不下，歌词那一栏会被挤到可视区外，
  // 表现就是「有封面、没歌词」。
  const [isNarrow, setIsNarrow] = createSignal(false)
  onMount(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    const update = () => setIsNarrow(mq.matches)
    update()
    mq.addEventListener("change", update)
    onCleanup(() => mq.removeEventListener("change", update))
  })
  // 使用函数形式访问 signal，保持响应式
  const currentItem = () => {
    const s = playerState()
    return s.playlist[s.currentIndex]
  }
  // 优先使用外部同名 .lrc 文件，其次使用内嵌歌词
  const lyrics = () => {
    const ext = playerState().externalLyrics
    if (ext) return parseLRC(ext)
    return parseLRC(currentItem()?.lyrics ?? "")
  }

  const currentLyricIndex = () => {
    const lines = lyrics()
    const t = playerState().currentTime
    let idx = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= t) idx = i
    }
    return idx
  }

  let lyricsContainerRef: HTMLDivElement | undefined
  // 歌词自由滚动：手动滚动后暂停自动跟随，8 秒后或点击按钮恢复
  const [autoScroll, setAutoScroll] = createSignal(true)
  const lineRefs: HTMLDivElement[] = []
  let resumeTimer: ReturnType<typeof setTimeout> | undefined

  const resumeAutoScroll = () => {
    setAutoScroll(true)
    if (resumeTimer) {
      clearTimeout(resumeTimer)
      resumeTimer = undefined
    }
  }

  const pauseAutoScroll = () => {
    setAutoScroll(false)
    if (resumeTimer) clearTimeout(resumeTimer)
    resumeTimer = setTimeout(() => setAutoScroll(true), 8000)
  }

  // 仅在「当前行」真正变化时才滚动，避免 timeupdate 触发重复滚动
  const activeLyricIndex = createMemo(() => currentLyricIndex())

  createEffect(() => {
    const idx = activeLyricIndex()
    const container = lyricsContainerRef
    if (!autoScroll() || !container) return
    const el = lineRefs[idx]
    if (!el) return
    const containerRect = container.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const top =
      elRect.top -
      containerRect.top +
      container.scrollTop -
      container.clientHeight / 2 +
      elRect.height / 2
    container.scrollTo({ top, behavior: "smooth" })
  })

  onCleanup(() => {
    if (resumeTimer) clearTimeout(resumeTimer)
  })

  const loopIcon = () => {
    switch (playerState().loopMode) {
      case "all":
        return TbRepeat
      case "one":
        return TbRepeatOnce
      case "shuffle":
        return TbArrowsShuffle
      default:
        return TbArrowRight
    }
  }

  // 点击歌词跳转到对应时间
  const seekTo = (time: number) => {
    const audio = initAudio()
    audio.currentTime = time
    setPlayerState((s) => ({ ...s, currentTime: time }))
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: "0",
        // 必须盖住站点 Header（吸附时 z-index 1000），否则顶部「收起」按钮点不到
        "z-index": mediaOverlayZ,
        display: "flex",
        "flex-direction": "column",
        overflow: "hidden",
      }}
    >
      {/* 专辑封面模糊背景 */}
      <div
        style={{
          position: "absolute",
          inset: "0",
          background: currentItem()?.cover
            ? `url(${resolveMediaCover(currentItem()?.cover)}) center/cover no-repeat`
            : "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
          filter: "blur(80px) brightness(0.25) saturate(2)",
          transform: "scale(1.3)",
          transition: "background 0.8s ease",
        }}
      />
      {/* 深色遮罩 */}
      <div
        style={{
          position: "absolute",
          inset: "0",
          background: "rgba(0,0,0,0.55)",
        }}
      />

      {/* 顶部栏 */}
      <div
        style={{
          position: "relative",
          "z-index": "1",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: isNarrow() ? "12px 16px" : "20px 28px",
        }}
      >
        <button
          onClick={() => setPlayerState((s) => ({ ...s, showLyrics: false }))}
          title={t("media.player.collapse_lyrics")}
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.15)",
            "border-radius": "10px",
            color: "rgba(255,255,255,0.8)",
            padding: "8px 16px",
            "font-size": "13px",
            cursor: "pointer",
            display: "flex",
            "align-items": "center",
            gap: "6px",
            "backdrop-filter": "blur(10px)",
          }}
        >
          <TbChevronDown size={16} />
          {t("media.player.collapse")}
        </button>
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            color: "rgba(255,255,255,0.5)",
            "font-size": "13px",
          }}
        >
          {t("media.player.now_playing")}
        </div>
        <div style={{ width: "80px" }} />
      </div>

      {/* 主内容区 */}
      <div
        style={{
          position: "relative",
          "z-index": "1",
          flex: "1",
          display: "flex",
          // 窄屏：上封面、下歌词；宽屏：左封面、右歌词
          "flex-direction": isNarrow() ? "column" : "row",
          gap: isNarrow() ? "6px" : "40px",
          "align-items": isNarrow() ? "stretch" : "stretch",
          overflow: "hidden",
          padding: isNarrow() ? "0 16px" : "0 40px",
          width: "100%",
          "max-width": "1150px",
          margin: "0 auto",
          "min-height": "0",
        }}
      >
        {/* 左侧：封面 + 信息 + 控制（窄屏为顶部一块，让出下方空间给歌词） */}
        <div
          style={{
            width: isNarrow() ? "100%" : "340px",
            "flex-shrink": "0",
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            "justify-content": "center",
            gap: isNarrow() ? "10px" : "20px",
            padding: isNarrow() ? "0 0 6px" : "0 20px 80px",
          }}
        >
          {/* 旋转唱片 */}
          <div
            style={{
              position: "relative",
              width: isNarrow() ? "132px" : "220px",
              height: isNarrow() ? "132px" : "220px",
            }}
          >
            {/* 唱片外圈 */}
            <div
              style={{
                position: "absolute",
                inset: "-12px",
                "border-radius": "50%",
                background:
                  "radial-gradient(circle, #2a2a2a 30%, #1a1a1a 60%, #111 100%)",
                "box-shadow":
                  "0 0 60px rgba(24,144,255,0.35), 0 20px 60px rgba(0,0,0,0.6)",
                animation: playerState().playing
                  ? "spin 20s linear infinite"
                  : "none",
              }}
            />
            {/* 封面图 */}
            <div
              style={{
                position: "absolute",
                inset: "0",
                "border-radius": "50%",
                overflow: "hidden",
                animation: playerState().playing
                  ? "spin 20s linear infinite"
                  : "none",
              }}
            >
              <Show
                when={currentItem()?.cover}
                fallback={
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      background: accentGradient(),
                      display: "flex",
                      "align-items": "center",
                      "justify-content": "center",
                    }}
                  >
                    <TbMusic size={72} style={{ opacity: 0.85 }} />
                  </div>
                }
              >
                <img
                  src={resolveMediaCover(currentItem()?.cover)}
                  style={{
                    width: "100%",
                    height: "100%",
                    "object-fit": "cover",
                  }}
                />
              </Show>
            </div>
            {/* 中心圆点 */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "20px",
                height: "20px",
                "border-radius": "50%",
                background: "#1a1a2e",
                border: "3px solid #333",
                "z-index": "2",
              }}
            />
          </div>

          {/* 歌曲信息 */}
          <div style={{ "text-align": "center" }}>
            <div
              style={{
                color: "white",
                "font-size": isNarrow() ? "17px" : "20px",
                "font-weight": "700",
                "letter-spacing": "-0.02em",
                "margin-bottom": isNarrow() ? "2px" : "6px",
                "max-width": isNarrow() ? "100%" : "280px",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
              }}
            >
              {getMediaName(currentItem()!)}
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.55)",
                "font-size": isNarrow() ? "12px" : "14px",
              }}
            >
              {currentItem()?.album_artist || t("media.music.unknown_artist")}
            </div>
          </div>

          {/* 进度条 */}
          <div
            style={{
              width: "100%",
              "max-width": isNarrow() ? "100%" : "280px",
            }}
          >
            <SeekBar
              onSeek={(seconds) => {
                initAudio().currentTime = seconds
              }}
            />
            <div
              style={{
                display: "flex",
                "justify-content": "space-between",
                color: "rgba(255,255,255,0.4)",
                "font-size": "11px",
              }}
            >
              <span>
                {formatDuration(Math.floor(playerState().currentTime))}
              </span>
              <span>{formatDuration(Math.floor(playerState().duration))}</span>
            </div>
          </div>

          {/* 播放控制 */}
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: isNarrow() ? "12px" : "16px",
            }}
          >
            <button
              onClick={() => {
                const modes: Array<"none" | "all" | "one" | "shuffle"> = [
                  "none",
                  "all",
                  "one",
                  "shuffle",
                ]
                const cur = modes.indexOf(playerState().loopMode)
                setPlayerState((s) => ({
                  ...s,
                  loopMode: modes[(cur + 1) % modes.length],
                }))
              }}
              style={lyricsCtrlBtn}
              title={t("media.player.loop_mode")}
            >
              <Dynamic component={loopIcon()} size={18} />
            </button>
            <button
              onClick={playPrev}
              style={lyricsCtrlBtn}
              title={t("media.player.prev")}
            >
              <TbPlayerSkipBackFilled size={18} />
            </button>
            <button
              onClick={togglePlay}
              style={{
                width: isNarrow() ? "46px" : "52px",
                height: isNarrow() ? "46px" : "52px",
                "border-radius": "50%",
                background: accentGradient(),
                border: "none",
                color: "white",
                "font-size": isNarrow() ? "18px" : "20px",
                cursor: "pointer",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "box-shadow": "0 4px 20px rgba(24,144,255,0.5)",
                transition: "transform 0.15s, box-shadow 0.15s",
              }}
            >
              <Dynamic
                component={
                  playerState().playing
                    ? TbPlayerPauseFilled
                    : TbPlayerPlayFilled
                }
                size={22}
              />
            </button>
            <button
              onClick={playNext}
              style={lyricsCtrlBtn}
              title={t("media.player.next")}
            >
              <TbPlayerSkipForwardFilled size={18} />
            </button>
            {/* 收藏当前歌曲：与底栏、详情页同一份状态 */}
            <button
              onClick={toggleFavorite}
              style={{
                ...lyricsCtrlBtn,
                color: favorite() ? "#fbbf24" : "#94a3b8",
              }}
              title={
                favorite()
                  ? t("media.video.favorited")
                  : t("media.video.favorite")
              }
              aria-label={t("media.video.favorite")}
            >
              <Dynamic
                component={favorite() ? TbStarFilled : TbStar}
                size={18}
              />
            </button>
          </div>
        </div>

        {/* 右侧：滚动歌词 */}
        <div
          style={{
            flex: "1",
            "min-width": "0",
            // flex 子项必须允许收缩，否则歌词容器会被内容撑高、把自身推出可视区
            "min-height": "0",
            "max-width": isNarrow() ? "100%" : "680px",
            display: "flex",
            "flex-direction": "column",
            overflow: "hidden",
            padding: isNarrow() ? "0 0 8px 0" : "20px 0 100px 0",
          }}
        >
          <Show
            when={lyrics().length > 0}
            fallback={
              <div
                style={{
                  flex: "1",
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  color: "rgba(255,255,255,0.3)",
                  "font-size": "16px",
                  "flex-direction": "column",
                  gap: "12px",
                }}
              >
                <TbMusic size={40} style={{ opacity: 0.6 }} />
                <span>{t("media.player.no_lyrics")}</span>
              </div>
            }
          >
            <div style={{ position: "relative", flex: "1", "min-height": "0" }}>
              <div
                ref={lyricsContainerRef}
                onWheel={pauseAutoScroll}
                onTouchMove={pauseAutoScroll}
                style={{
                  height: "100%",
                  "overflow-y": "auto",
                  "overflow-x": "hidden",
                  "scroll-behavior": "smooth",
                  "padding-top": isNarrow() ? "22vh" : "36vh",
                  "padding-bottom": isNarrow() ? "28vh" : "40vh",
                  "scrollbar-width": "none",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    "flex-direction": "column",
                    "align-items": "center",
                    width: "100%",
                  }}
                >
                  <For each={lyrics()}>
                    {(line, i) => (
                      <div
                        ref={(el: HTMLDivElement) => {
                          lineRefs[i()] = el
                        }}
                        onClick={() => {
                          seekTo(line.time)
                          resumeAutoScroll()
                        }}
                        title={t("media.player.jump_to_line")}
                        style={{
                          "min-height": isNarrow() ? "42px" : "52px",
                          display: "flex",
                          "align-items": "center",
                          "justify-content": "center",
                          gap: isNarrow() ? "8px" : "12px",
                          cursor: "pointer",
                          "max-width": "100%",
                          padding: "4px 8px",
                          "text-align": "center",
                          "font-size":
                            i() === currentLyricIndex()
                              ? isNarrow()
                                ? "19px"
                                : "22px"
                              : isNarrow()
                                ? "15px"
                                : "16px",
                          "font-weight":
                            i() === currentLyricIndex() ? "700" : "400",
                          color:
                            i() === currentLyricIndex()
                              ? "white"
                              : Math.abs(i() - currentLyricIndex()) === 1
                                ? "rgba(255,255,255,0.45)"
                                : Math.abs(i() - currentLyricIndex()) === 2
                                  ? "rgba(255,255,255,0.25)"
                                  : "rgba(255,255,255,0.12)",
                          transition:
                            "all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                          "letter-spacing":
                            i() === currentLyricIndex() ? "0.02em" : "0",
                          "text-shadow":
                            i() === currentLyricIndex()
                              ? "0 0 30px rgba(24,144,255,0.6)"
                              : "none",
                        }}
                      >
                        <span>{line.text}</span>
                        <Show when={i() === currentLyricIndex()}>
                          <span
                            style={{
                              display: "inline-flex",
                              "align-items": "center",
                              gap: "4px",
                              padding: "2px 10px",
                              "border-radius": "999px",
                              border: "1px solid rgba(255,255,255,0.45)",
                              color: "rgba(255,255,255,0.85)",
                              "font-size": "11px",
                              "font-weight": "500",
                              "flex-shrink": "0",
                              "font-variant-numeric": "tabular-nums",
                            }}
                          >
                            <TbPlayerPlayFilled size={9} />
                            {formatDuration(Math.floor(line.time))}
                          </span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              {/* 手动滚动时暂停自动跟随，可一键回到当前行 */}
              <Show when={!autoScroll()}>
                <button
                  onClick={resumeAutoScroll}
                  style={{
                    position: "absolute",
                    bottom: "12px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "rgba(255,255,255,0.14)",
                    border: "1px solid rgba(255,255,255,0.25)",
                    color: "white",
                    "border-radius": "999px",
                    padding: "6px 16px",
                    "font-size": "12px",
                    cursor: "pointer",
                    "backdrop-filter": "blur(10px)",
                    "z-index": "3",
                  }}
                >
                  {t("media.player.back_to_current")}
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

const lyricsCtrlBtn = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  "border-radius": "50%",
  color: "rgba(255,255,255,0.7)",
  "font-size": "16px",
  cursor: "pointer",
  width: "36px",
  height: "36px",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
}

// ==================== 底部播放器 ====================
export const MusicPlayer = () => {
  const t = useT()
  // 所有状态通过 playerState() 函数调用获取，保持响应式
  const currentItem = () => {
    const s = playerState()
    return s.playlist[s.currentIndex]
  }

  // 底部播放器只占右侧内容区：桌面端且侧栏展开时让出 216px
  const [isDesktop, setIsDesktop] = createSignal(true)
  onMount(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const update = () => setIsDesktop(mq.matches)
    update()
    mq.addEventListener("change", update)
    onCleanup(() => mq.removeEventListener("change", update))
  })
  const barLeft = () =>
    mediaEnabled() && mediaSidebarOpen() && isDesktop() ? "216px" : "0"

  // 底栏收藏：与详情页/列表共用同一份 userdata
  const { favorite, toggle: toggleFavorite } = useTrackFavorite()

  // ===== 底栏滚动歌词：复用 parseLRC，外部 .lrc 优先于内嵌歌词 =====
  // 仅在歌词文本变化时才重新解析（依赖 currentIndex / externalLyrics / 当前 item.lyrics）
  const miniLyricLines = createMemo(() => {
    const ext = playerState().externalLyrics
    if (ext) return parseLRC(ext)
    return parseLRC(currentItem()?.lyrics ?? "")
  })
  // 当前命中的歌词行索引（依赖 currentTime；找不到时返回 -1）
  const currentMiniLyricIdx = () => {
    const lines = miniLyricLines()
    if (lines.length === 0) return -1
    const t = playerState().currentTime
    let idx = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= t) idx = i
      else break
    }
    return idx
  }

  const handleVolume = (e: MouseEvent) => {
    const bar = e.currentTarget as HTMLDivElement
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const audio = initAudio()
    audio.volume = ratio
    setPlayerState((s) => ({ ...s, volume: ratio }))
  }

  const cycleLoop = () => {
    const modes: Array<"none" | "all" | "one" | "shuffle"> = [
      "none",
      "all",
      "one",
      "shuffle",
    ]
    const cur = modes.indexOf(playerState().loopMode)
    setPlayerState((s) => ({ ...s, loopMode: modes[(cur + 1) % modes.length] }))
  }

  const loopIcon = () => {
    switch (playerState().loopMode) {
      case "all":
        return TbRepeat
      case "one":
        return TbRepeatOnce
      case "shuffle":
        return TbArrowsShuffle
      default:
        return TbArrowRight
    }
  }

  return (
    <>
      <Show when={playerState().showLyrics}>
        <LyricsPage />
      </Show>

      <Show when={playerState().playlist.length > 0}>
        <div
          style={{
            position: "fixed",
            bottom: "0",
            left: barLeft(),
            right: "0",
            "z-index": "150",
            background: "rgba(10,14,26,0.96)",
            "backdrop-filter": "blur(24px)",
            "-webkit-backdrop-filter": "blur(24px)",
            "border-top": "1px solid rgba(255,255,255,0.07)",
          }}
        >
          {/* 进度条（可拖动；手机端也能拖） */}
          <SeekBar
            height={3}
            padding="7px 0"
            trackColor="rgba(255,255,255,0.08)"
            onSeek={(seconds) => {
              initAudio().currentTime = seconds
            }}
          />

          {/* 控制区 */}
          <div
            style={{
              display: "flex",
              "align-items": "center",
              height: isDesktop() ? "68px" : "60px",
              padding: isDesktop() ? "0 20px" : "0 12px",
              gap: isDesktop() ? "12px" : "8px",
            }}
          >
            {/* 左：封面 + 歌曲信息（点击展开歌词） */}
            {/* 桌面端用有限宽度，把剩余空间让给中间的歌词条；
                手机端没有歌词条，改为占满剩余宽度，否则右侧控件会被挤出屏幕 */}
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: isDesktop() ? "12px" : "8px",
                width: isDesktop() ? "260px" : "auto",
                flex: isDesktop() ? "0 0 260px" : "1 1 auto",
                "min-width": "0",
                "flex-shrink": isDesktop() ? "0" : "1",
                cursor: "pointer",
              }}
              onClick={() =>
                setPlayerState((s) => ({ ...s, showLyrics: true }))
              }
            >
              <div
                style={{
                  width: isDesktop() ? "46px" : "38px",
                  height: isDesktop() ? "46px" : "38px",
                  "border-radius": "8px",
                  overflow: "hidden",
                  "flex-shrink": "0",
                  background: accentGradient(),
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "font-size": "20px",
                  "box-shadow": "0 2px 12px rgba(24,144,255,0.3)",
                }}
              >
                <Show
                  when={currentItem()?.cover}
                  fallback={<TbMusic size={22} style={{ opacity: 0.8 }} />}
                >
                  <img
                    src={resolveMediaCover(currentItem()?.cover)}
                    style={{
                      width: "100%",
                      height: "100%",
                      "object-fit": "cover",
                    }}
                  />
                </Show>
              </div>
              <div style={{ "min-width": "0" }}>
                <div
                  style={{
                    color: "#f1f5f9",
                    "font-size": "14px",
                    "font-weight": "500",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                    "letter-spacing": "-0.01em",
                  }}
                >
                  {getMediaName(currentItem()!)}
                </div>
                <div
                  style={{
                    color: "#475569",
                    "font-size": "12px",
                    "margin-top": "2px",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                >
                  {currentItem()?.album_artist ||
                    t("media.music.unknown_artist")}
                </div>
              </div>
            </div>

            {/* 中-左：滚动歌词条（专辑信息 与 播放控制 之间）
                - flex:1 占据剩余空间；min-width:0 保证 ellipsis 生效
                - 点击同样可展开全屏歌词页
                - 双行：上方为当前行（高亮），下方为下一行预览
                - 没有歌词时显示淡占位以保持布局稳定
                - 手机端不渲染：屏幕太窄，留着会把播放控制挤出可视区 */}
            <Show when={isDesktop()}>
              <div
                onClick={() =>
                  setPlayerState((s) => ({ ...s, showLyrics: true }))
                }
                title={t("media.player.view_full_lyrics")}
                style={{
                  flex: "1",
                  "min-width": "0",
                  display: "flex",
                  "flex-direction": "column",
                  "justify-content": "center",
                  gap: "2px",
                  cursor: "pointer",
                  padding: "0 14px",
                  "text-align": "center",
                  "user-select": "none",
                }}
              >
                <Show
                  when={miniLyricLines().length > 0}
                  fallback={
                    <div
                      style={{
                        color: "rgba(148,163,184,0.4)",
                        "font-size": "13px",
                        "white-space": "nowrap",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                      }}
                    >
                      <TbMusic
                        size={13}
                        style={{
                          "vertical-align": "-2px",
                          "margin-right": "4px",
                        }}
                      />
                      {t("media.player.no_lyrics")}
                    </div>
                  }
                >
                  <div
                    style={{
                      color: "#f1f5f9",
                      "font-size": "14px",
                      "font-weight": "500",
                      "white-space": "nowrap",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "letter-spacing": "-0.01em",
                      transition: "color 0.3s",
                    }}
                  >
                    {currentMiniLyricIdx() >= 0
                      ? miniLyricLines()[currentMiniLyricIdx()].text || "♪"
                      : miniLyricLines()[0]?.text || "♪"}
                  </div>
                  <div
                    style={{
                      color: "rgba(148,163,184,0.55)",
                      "font-size": "12px",
                      "white-space": "nowrap",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                    }}
                  >
                    {(() => {
                      const lines = miniLyricLines()
                      const i = currentMiniLyricIdx()
                      const next = i >= 0 ? lines[i + 1] : lines[1]
                      return next?.text ?? ""
                    })()}
                  </div>
                </Show>
              </div>
            </Show>

            {/* 中：播放控制 */}
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "6px",
                "flex-shrink": "0",
              }}
            >
              <button
                onClick={playPrev}
                style={ctrlBtnStyle}
                title={t("media.player.prev")}
              >
                <TbPlayerSkipBackFilled size={16} />
              </button>
              <button
                onClick={togglePlay}
                style={{
                  width: "42px",
                  height: "42px",
                  "border-radius": "50%",
                  background: accentGradient(),
                  border: "none",
                  color: "white",
                  "font-size": "16px",
                  cursor: "pointer",
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "box-shadow": "0 2px 16px rgba(24,144,255,0.45)",
                  transition: "transform 0.15s, box-shadow 0.15s",
                  "flex-shrink": "0",
                }}
                title={
                  playerState().playing
                    ? t("media.player.pause")
                    : t("media.player.play")
                }
              >
                <Dynamic
                  component={
                    playerState().playing
                      ? TbPlayerPauseFilled
                      : TbPlayerPlayFilled
                  }
                  size={18}
                />
              </button>
              <button
                onClick={playNext}
                style={ctrlBtnStyle}
                title={t("media.player.next")}
              >
                <TbPlayerSkipForwardFilled size={16} />
              </button>
              {/* 「本地播放器」入口在手机上先隐藏：窄屏放不下 */}
              <Show when={isDesktop() ? currentItem() : undefined}>
                {(cur) => (
                  <div
                    style={{
                      transform: "scale(0.85)",
                      "transform-origin": "left center",
                      "margin-left": "4px",
                    }}
                  >
                    <OpenWithPlayer
                      itemId={cur().id}
                      name={cur().file_name}
                      dark
                    />
                  </div>
                )}
              </Show>
            </div>

            {/* 右：时间 + 循环 + 收藏 + 音量（手机端只隐藏时间和音量，循环/收藏保留） */}
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: isDesktop() ? "10px" : "4px",
                "flex-shrink": "0",
              }}
            >
              <Show when={isDesktop()}>
                {/* 时间 */}
                <div
                  style={{
                    color: "#475569",
                    "font-size": "12px",
                    "white-space": "nowrap",
                    "font-variant-numeric": "tabular-nums",
                  }}
                >
                  {formatDuration(Math.floor(playerState().currentTime))}
                  <span style={{ margin: "0 3px", opacity: "0.4" }}>/</span>
                  {formatDuration(Math.floor(playerState().duration))}
                </div>
              </Show>

              {/* 循环模式：手机端也必须能切（顺序 / 单曲 / 列表 / 随机） */}
              <button
                onClick={cycleLoop}
                style={ctrlBtnStyle}
                title={t("media.player.loop_mode")}
              >
                <Dynamic component={loopIcon()} size={16} />
              </button>

              {/* 收藏当前歌曲 */}
              <button
                onClick={toggleFavorite}
                style={{
                  ...ctrlBtnStyle,
                  color: favorite() ? "#fbbf24" : ctrlBtnStyle.color,
                }}
                title={
                  favorite()
                    ? t("media.video.favorited")
                    : t("media.video.favorite")
                }
                aria-label={t("media.video.favorite")}
              >
                <Dynamic
                  component={favorite() ? TbStarFilled : TbStar}
                  size={16}
                />
              </button>

              <Show when={isDesktop()}>
                {/* 音量 */}
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "6px",
                  }}
                >
                  <span
                    style={{
                      color: "#475569",
                      "font-size": "14px",
                      "flex-shrink": "0",
                    }}
                  >
                    <Dynamic
                      component={
                        playerState().volume <= 0 ? TbVolumeOff : TbVolume
                      }
                      size={16}
                    />
                  </span>
                  <div
                    style={{
                      width: "72px",
                      height: "4px",
                      background: "rgba(255,255,255,0.1)",
                      "border-radius": "2px",
                      cursor: "pointer",
                      position: "relative",
                      "flex-shrink": "0",
                    }}
                    onClick={handleVolume}
                  >
                    <div
                      style={{
                        height: "100%",
                        background: accentBar(),
                        "border-radius": "2px",
                        width: `${playerState().volume * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </Show>

              {/* 关闭底部播放器 */}
              <button
                onClick={closePlayer}
                style={ctrlBtnStyle}
                title={t("media.player.close")}
              >
                <TbX size={16} />
              </button>
            </div>
          </div>
        </div>
      </Show>
    </>
  )
}

const ctrlBtnStyle = {
  background: "transparent",
  border: "none",
  color: "#64748b",
  "font-size": "18px",
  cursor: "pointer",
  width: "36px",
  height: "36px",
  "border-radius": "8px",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  transition: "color 0.15s, background 0.15s",
}
