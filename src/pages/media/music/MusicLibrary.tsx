import {
  createSignal,
  createResource,
  createMemo,
  Show,
  For,
  onCleanup,
  createEffect,
} from "solid-js"
import { useColorMode } from "@hope-ui/solid"
import { MediaLayout } from "../MediaLayout"
import {
  getAlbumList,
  getAlbumTracks,
  getMediaItem,
  getMediaFolders,
} from "~/utils/media_api"
import type { MediaItem, AlbumInfo } from "~/types"
import { getMediaName, parseAuthors, formatDuration } from "~/types"
import { api } from "~/utils"

type BrowseMode = "all" | "folder"
type OrderBy = "name" | "date" | "size"
type OrderDir = "asc" | "desc"

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
  volume: 0.8,
  loopMode: "all",
  showLyrics: false,
  externalLyrics: "",
})

let audioEl: HTMLAudioElement | null = null

export const initAudio = () => {
  if (!audioEl) {
    audioEl = new Audio()
    audioEl.volume = playerState().volume

    audioEl.addEventListener("timeupdate", () => {
      setPlayerState((s) => ({ ...s, currentTime: audioEl!.currentTime }))
    })
    audioEl.addEventListener("loadedmetadata", () => {
      setPlayerState((s) => ({ ...s, duration: audioEl!.duration }))
    })
    audioEl.addEventListener("ended", () => {
      playNext()
    })
  }
  return audioEl
}

export const playTrack = (item: MediaItem) => {
  const audio = initAudio()
  // 每首歌都是独立文件记录，播放路径 = folder_path + "/" + file_name
  const folder = item.folder_path?.replace(/\/$/, "") ?? ""
  const url = `${api}/p${folder}/${item.file_name}?force`
  audio.src = url
  audio.play()
  // 先清空外部歌词，再异步尝试加载同名 .lrc 文件
  setPlayerState((s) => ({ ...s, playing: true, externalLyrics: "" }))
  const baseName = item.file_name?.replace(/\.[^.]+$/, "") ?? ""
  const lrcUrl = `${api}/p${folder}/${baseName}.lrc?force`
  fetch(lrcUrl)
    .then((res) => {
      if (res.ok) return res.text()
      return ""
    })
    .then((text) => {
      setPlayerState((s) => ({ ...s, externalLyrics: text ?? "" }))
    })
    .catch(() => {
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

export const togglePlay = () => {
  const audio = initAudio()
  if (playerState().playing) {
    audio.pause()
    setPlayerState((s) => ({ ...s, playing: false }))
  } else {
    audio.play()
    setPlayerState((s) => ({ ...s, playing: true }))
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
const LyricsPage = () => {
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

  return (
    <div
      style={{
        position: "fixed",
        inset: "0",
        "z-index": "200",
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
            ? `url(${currentItem()?.cover}) center/cover no-repeat`
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
          padding: "20px 28px",
        }}
      >
        <button
          onClick={() => setPlayerState((s) => ({ ...s, showLyrics: false }))}
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
          ↓ 收起
        </button>
        <div style={{ color: "rgba(255,255,255,0.5)", "font-size": "13px" }}>
          正在播放
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
          gap: "0",
          "align-items": "stretch",
          overflow: "hidden",
          padding: "0 5vw",
        }}
      >
        {/* 左侧：封面 + 信息 + 控制 */}
        <div
          style={{
            width: "340px",
            "flex-shrink": "0",
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            "justify-content": "center",
            gap: "20px",
            padding: "0 20px 80px",
          }}
        >
          {/* 旋转唱片 */}
          <div
            style={{
              position: "relative",
              width: "220px",
              height: "220px",
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
                  "0 0 60px rgba(99,102,241,0.35), 0 20px 60px rgba(0,0,0,0.6)",
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
                      background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                      display: "flex",
                      "align-items": "center",
                      "justify-content": "center",
                      "font-size": "72px",
                    }}
                  >
                    🎵
                  </div>
                }
              >
                <img
                  src={currentItem()?.cover}
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
                "font-size": "20px",
                "font-weight": "700",
                "letter-spacing": "-0.02em",
                "margin-bottom": "6px",
                "max-width": "280px",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
              }}
            >
              {getMediaName(currentItem()!)}
            </div>
            <div
              style={{ color: "rgba(255,255,255,0.55)", "font-size": "14px" }}
            >
              {currentItem()?.album_artist || "未知艺术家"}
            </div>
          </div>

          {/* 进度条 */}
          <div style={{ width: "100%", "max-width": "280px" }}>
            <div
              style={{
                height: "4px",
                background: "rgba(255,255,255,0.15)",
                "border-radius": "2px",
                cursor: "pointer",
                position: "relative",
                "margin-bottom": "8px",
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const ratio = (e.clientX - rect.left) / rect.width
                const audio = initAudio()
                audio.currentTime = ratio * playerState().duration
              }}
            >
              <div
                style={{
                  height: "100%",
                  background: "linear-gradient(90deg, #6366f1, #a78bfa)",
                  "border-radius": "2px",
                  width: `${
                    playerState().duration > 0
                      ? (playerState().currentTime / playerState().duration) *
                        100
                      : 0
                  }%`,
                  transition: "width 0.5s linear",
                }}
              />
            </div>
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
            style={{ display: "flex", "align-items": "center", gap: "16px" }}
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
              title="切换循环模式"
            >
              {
                (
                  { none: "➡️", all: "🔁", one: "🔂", shuffle: "🔀" } as Record<
                    string,
                    string
                  >
                )[playerState().loopMode]
              }
            </button>
            <button onClick={playPrev} style={lyricsCtrlBtn}>
              ⏮
            </button>
            <button
              onClick={togglePlay}
              style={{
                width: "52px",
                height: "52px",
                "border-radius": "50%",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                border: "none",
                color: "white",
                "font-size": "20px",
                cursor: "pointer",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "box-shadow": "0 4px 20px rgba(99,102,241,0.5)",
                transition: "transform 0.15s, box-shadow 0.15s",
              }}
            >
              {playerState().playing ? "⏸" : "▶"}
            </button>
            <button onClick={playNext} style={lyricsCtrlBtn}>
              ⏭
            </button>
            <div style={{ width: "32px" }} />
          </div>
        </div>

        {/* 右侧：滚动歌词 */}
        <div
          style={{
            flex: "1",
            display: "flex",
            "flex-direction": "column",
            overflow: "hidden",
            padding: "20px 0 100px 40px",
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
                <span style={{ "font-size": "40px" }}>🎵</span>
                <span>暂无歌词</span>
              </div>
            }
          >
            <div
              ref={lyricsContainerRef}
              style={{
                flex: "1",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {/* 顶部渐变遮罩 */}
              <div
                style={{
                  position: "absolute",
                  top: "0",
                  left: "0",
                  right: "0",
                  height: "80px",
                  background:
                    "linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)",
                  "z-index": "2",
                  "pointer-events": "none",
                }}
              />
              {/* 底部渐变遮罩 */}
              <div
                style={{
                  position: "absolute",
                  bottom: "0",
                  left: "0",
                  right: "0",
                  height: "120px",
                  background:
                    "linear-gradient(to top, rgba(0,0,0,0.6), transparent)",
                  "z-index": "2",
                  "pointer-events": "none",
                }}
              />
              <div
                style={{
                  transition:
                    "transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                  transform: `translateY(calc(40vh - ${currentLyricIndex() * 52 + 26}px))`,
                  "padding-top": "20px",
                }}
              >
                <For each={lyrics()}>
                  {(line, i) => (
                    <div
                      style={{
                        height: "52px",
                        display: "flex",
                        "align-items": "center",
                        "padding-left": "8px",
                        "font-size":
                          i() === currentLyricIndex() ? "22px" : "16px",
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
                            ? "0 0 30px rgba(167,139,250,0.6)"
                            : "none",
                      }}
                    >
                      {line.text}
                    </div>
                  )}
                </For>
              </div>
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
  // 所有状态通过 playerState() 函数调用获取，保持响应式
  const currentItem = () => {
    const s = playerState()
    return s.playlist[s.currentIndex]
  }

  const handleSeek = (e: MouseEvent) => {
    const bar = e.currentTarget as HTMLDivElement
    const rect = bar.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const audio = initAudio()
    audio.currentTime = ratio * playerState().duration
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

  const loopLabel = () =>
    (
      ({ none: "➡️", all: "🔁", one: "🔂", shuffle: "🔀" }) as Record<
        string,
        string
      >
    )[playerState().loopMode]

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
            left: "0",
            right: "0",
            "z-index": "150",
            background: "rgba(10,14,26,0.96)",
            "backdrop-filter": "blur(24px)",
            "-webkit-backdrop-filter": "blur(24px)",
            "border-top": "1px solid rgba(255,255,255,0.07)",
          }}
        >
          {/* 进度条（可点击） */}
          <div
            style={{
              height: "3px",
              background: "rgba(255,255,255,0.08)",
              cursor: "pointer",
              position: "relative",
            }}
            onClick={handleSeek}
          >
            <div
              style={{
                height: "100%",
                background: "linear-gradient(90deg, #6366f1, #a78bfa)",
                width: `${
                  playerState().duration > 0
                    ? (playerState().currentTime / playerState().duration) * 100
                    : 0
                }%`,
                transition: "width 0.5s linear",
                "border-radius": "0 2px 2px 0",
              }}
            />
          </div>

          {/* 控制区 */}
          <div
            style={{
              display: "flex",
              "align-items": "center",
              height: "68px",
              padding: "0 20px",
              gap: "12px",
            }}
          >
            {/* 左：封面 + 歌曲信息（点击展开歌词） */}
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "12px",
                flex: "1",
                "min-width": "0",
                cursor: "pointer",
              }}
              onClick={() =>
                setPlayerState((s) => ({ ...s, showLyrics: true }))
              }
            >
              <div
                style={{
                  width: "46px",
                  height: "46px",
                  "border-radius": "8px",
                  overflow: "hidden",
                  "flex-shrink": "0",
                  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "font-size": "20px",
                  "box-shadow": "0 2px 12px rgba(99,102,241,0.3)",
                }}
              >
                <Show when={currentItem()?.cover} fallback={<span>🎵</span>}>
                  <img
                    src={currentItem()?.cover}
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
                  {currentItem()?.album_artist || "未知艺术家"}
                </div>
              </div>
            </div>

            {/* 中：播放控制 */}
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "6px",
                "flex-shrink": "0",
              }}
            >
              <button onClick={playPrev} style={ctrlBtnStyle} title="上一首">
                ⏮
              </button>
              <button
                onClick={togglePlay}
                style={{
                  width: "42px",
                  height: "42px",
                  "border-radius": "50%",
                  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  border: "none",
                  color: "white",
                  "font-size": "16px",
                  cursor: "pointer",
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "box-shadow": "0 2px 16px rgba(99,102,241,0.45)",
                  transition: "transform 0.15s, box-shadow 0.15s",
                  "flex-shrink": "0",
                }}
                title={playerState().playing ? "暂停" : "播放"}
              >
                {playerState().playing ? "⏸" : "▶"}
              </button>
              <button onClick={playNext} style={ctrlBtnStyle} title="下一首">
                ⏭
              </button>
            </div>

            {/* 右：时间 + 循环 + 音量 */}
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "10px",
                "flex-shrink": "0",
              }}
            >
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

              {/* 循环模式 */}
              <button
                onClick={cycleLoop}
                style={ctrlBtnStyle}
                title="切换循环模式"
              >
                {loopLabel()}
              </button>

              {/* 音量 */}
              <div
                style={{ display: "flex", "align-items": "center", gap: "6px" }}
              >
                <span
                  style={{
                    color: "#475569",
                    "font-size": "14px",
                    "flex-shrink": "0",
                  }}
                >
                  🔊
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
                      background: "linear-gradient(90deg, #6366f1, #a78bfa)",
                      "border-radius": "2px",
                      width: `${playerState().volume * 100}%`,
                    }}
                  />
                </div>
              </div>
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

// ==================== 专辑卡片 ====================
const AlbumCard = (props: { album: AlbumInfo }) => {
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
                "font-size": "48px",
                background: coverFallbackBg(),
              }}
            >
              🎵
            </div>
          }
        >
          <img
            src={props.album.cover}
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
          {props.album.album_name || "未知专辑"}
        </div>
        <div
          style={{
            color: subColor(),
            "font-size": "11px",
            "margin-top": "2px",
          }}
        >
          {props.album.album_artist || "未知艺术家"} · {props.album.track_count}{" "}
          首
        </div>
      </div>
    </div>
  )
}

// ==================== 专辑详情 ====================
const AlbumDetail = (props: { album: AlbumInfo; onBack: () => void }) => {
  const { colorMode } = useColorMode()
  const isDark = createMemo(() => colorMode() === "dark")
  const backBtnBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
  )
  const backBtnBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)",
  )
  const backBtnColor = createMemo(() => (isDark() ? "#94a3b8" : "#64748b"))
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
        }}
      >
        ← 返回
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
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "64px",
                "flex-shrink": "0",
              }}
            >
              🎵
            </div>
          }
        >
          <img
            src={props.album.cover}
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
            专辑
          </div>
          <h2
            style={{
              margin: "0 0 8px",
              "font-size": "24px",
              color: titleColor(),
            }}
          >
            {props.album.album_name || "未知专辑"}
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
            {props.album.release_date?.slice(0, 4)} · {props.album.track_count}{" "}
            首歌曲
          </div>
          <button
            onClick={() => {
              const t = tracks()
              if (t && t.length > 0) playPlaylist(t, 0)
            }}
            style={{
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              border: "none",
              "border-radius": "10px",
              color: "white",
              padding: "10px 24px",
              "font-size": "14px",
              "font-weight": "600",
              cursor: "pointer",
              display: "flex",
              "align-items": "center",
              gap: "8px",
            }}
          >
            ▶ 播放全部
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
          曲目列表
        </h3>
        <Show
          when={!tracks.loading}
          fallback={<div style={{ color: metaColor() }}>加载中...</div>}
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
                暂无曲目
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
  const sortActiveBg = "rgba(99,102,241,0.3)"
  const sortActiveBorder = "rgba(99,102,241,0.5)"
  const sortActiveColor = "#a5b4fc"
  const sortInactiveBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
  )
  const sortInactiveBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)",
  )
  const sortInactiveColor = createMemo(() => (isDark() ? "#94a3b8" : "#475569"))
  const btnActiveBg = "rgba(99,102,241,0.3)"
  const btnActiveBorder = "rgba(99,102,241,0.5)"
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

  const albums = () => (albumData()?.content as AlbumInfo[]) ?? []
  const total = () => albumData()?.total ?? 0
  const totalPages = () => Math.ceil(total() / pageSize)

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
    <MediaLayout title="🎵 音乐资源库">
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
                    {mode === "all" ? "全部" : "目录"}
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
                placeholder="搜索专辑或艺术家..."
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

            {/* 专辑瀑布流 */}
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
                  <div style={{ "font-size": "32px", "margin-bottom": "12px" }}>
                    ⏳
                  </div>
                  <div>加载中...</div>
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
                    <div
                      style={{ "font-size": "48px", "margin-bottom": "12px" }}
                    >
                      🎵
                    </div>
                    <div>暂无音乐</div>
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
                  ← 上一页
                </button>
                <span
                  style={{ color: paginationInfoColor(), "font-size": "13px" }}
                >
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
