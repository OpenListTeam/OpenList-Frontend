import { resolveMediaCover } from "~/utils/media_cover"
import { accentGradient } from "~/utils/accent"
import {
  createSignal,
  createResource,
  createMemo,
  createEffect,
  Show,
  For,
  onMount,
  onCleanup,
} from "solid-js"
import { useColorMode } from "@hope-ui/solid"
import { MediaLayout } from "../MediaLayout"
import { MediaBrowser } from "../MediaBrowser"
import {
  formatMediaSize,
  mediaBackBtn,
  mediaChip,
  mediaSecondaryBtn,
} from "../ui"
import {
  downloadMediaStrm,
  getMediaItem,
  getMediaProgress,
  getMediaUserData,
  getSignedProxyUrl,
  mediaItemPath,
  requestTranscodePlay,
  saveMediaProgress,
  setMediaFavorite,
} from "~/utils/media_api"
import type { MediaItem, EpisodeInfo } from "~/types"
import { getMediaName, parseAuthors, parseEpisodes } from "~/types"
import { base_path, ext, notify } from "~/utils"
import { useT } from "~/hooks"
import { OpenWithPlayer } from "~/components/OpenWithPlayer"
import { MediaPlayButton } from "~/components/MediaPlayButton"
import Artplayer from "artplayer"
import artplayerProxyMediabunny from "~/components/artplayer-proxy-mediabunny"
import { attachMediabunnyAudio } from "~/components/artplayer-proxy-mediabunny/AudioPatch"
import Hls from "hls.js"
import mpegts from "mpegts.js"
import { registerAc3Decoder } from "@mediabunny/ac3"

// MediaBunny 播放器模式：三档选择
//   "disabled"   - 禁用（使用原生 <video>，默认）
//   "audio_only" - 仅解码音频（原生 <video> 解码画面 + mediabunny 单独提供音轨）
//   "full"       - 全部解码（mediabunny 接管，音频 + 视频均由 mediabunny）
const MEDIABUNNY_KEY = "use_mediabunny_player"
type MediaBunnyMode = "disabled" | "audio_only" | "full"
function getMediaBunnyMode(): MediaBunnyMode {
  const v = localStorage.getItem(MEDIABUNNY_KEY)
  if (v === "audio_only") return "audio_only"
  // 向下兼容旧版 "true/false" 布尔值
  if (v === "true" || v === "full") return "full"
  return "disabled"
}
function setMediaBunnyMode(mode: MediaBunnyMode) {
  localStorage.setItem(MEDIABUNNY_KEY, mode)
}
function isMediaBunnyEnabled(): boolean {
  return getMediaBunnyMode() !== "disabled"
}
const mediabunnyModeKey = (m: MediaBunnyMode) =>
  m === "disabled"
    ? "media.video.decode_disabled"
    : m === "audio_only"
      ? "media.video.decode_audio_only"
      : "media.video.decode_all"
// AC3 解码器改为按需注册：模块 import 期不产生任何副作用。
// force=true 用于 AC3 自动回退路径：即使播放器模式是 disabled，
// 回退也会用 mediabunny 解音轨，此时必须注册解码器。
let ac3Registered = false
function ensureAc3Decoder(force = false) {
  if (ac3Registered) return
  if (!force && !isMediaBunnyEnabled()) return
  ac3Registered = true
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
  const [hover, setHover] = createSignal(false)
  const authors = () => parseAuthors(props.item.authors)
  // 目录聚合条目没有有意义的单文件大小，改为显示集数
  const episodeCount = () => parseEpisodes(props.item.episodes).length
  const sizeText = () =>
    episodeCount() > 0
      ? `${episodeCount()} 集`
      : formatMediaSize(props.item.file_size)
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
        setHover(true)
        e.currentTarget.style.transform = "translateY(-4px)"
        e.currentTarget.style.boxShadow = isDark()
          ? "0 12px 32px rgba(0,0,0,0.4)"
          : "0 12px 32px rgba(0,0,0,0.15)"
      }}
      onMouseLeave={(e) => {
        setHover(false)
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
            src={resolveMediaCover(props.item.cover)}
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
              left: "8px",
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
        {/* 悬浮详情 */}
        <Show when={hover()}>
          <div
            style={{
              position: "absolute",
              inset: "0",
              display: "flex",
              "flex-direction": "column",
              "justify-content": "flex-end",
              gap: "5px",
              padding: "12px",
              background:
                "linear-gradient(to top, rgba(0,0,0,0.94), rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.1))",
              color: "#e2e8f0",
              "font-size": "11px",
              "line-height": "1.5",
              "pointer-events": "none",
            }}
          >
            <Show when={authors().length > 0}>
              <div
                style={{
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                }}
              >
                演员：{authors().slice(0, 4).join(" / ")}
              </div>
            </Show>
            <Show when={props.item.plot || props.item.description}>
              <div
                style={{
                  display: "-webkit-box",
                  "-webkit-line-clamp": "4",
                  "-webkit-box-orient": "vertical",
                  overflow: "hidden",
                  color: "rgba(226,232,240,0.8)",
                }}
              >
                {props.item.plot || props.item.description}
              </div>
            </Show>
            <div
              style={{
                color: "rgba(148,163,184,0.9)",
                "font-size": "10px",
              }}
            >
              {[
                props.item.release_date?.slice(0, 4),
                props.item.genre,
                sizeText(),
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
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
        <div
          style={{
            color: subColor(),
            "font-size": "11px",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
          title={[
            props.item.release_date?.slice(0, 4),
            props.item.genre,
            sizeText(),
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          {[
            props.item.release_date?.slice(0, 4),
            props.item.genre?.split(",")[0],
            sizeText(),
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
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
  episodeIndex?: number
  onClose: () => void
}) => {
  const t = useT()
  let playerContainer: HTMLDivElement | undefined
  let player: Artplayer | undefined
  let hlsPlayer: Hls | null | undefined
  let flvPlayer: mpegts.Player | undefined
  // 卸载标记：onMount 中有多处 await，期间用户可能已离开，
  // 此时 onCleanup 已执行，之后创建的实例不会再被销毁。
  let disposed = false

  // 播放文件的 VFS 路径：优先使用传入的 filePath，否则 folder_path + "/" + file_name
  const videoPath = () => props.filePath ?? mediaItemPath(props.item)
  // 签名 + 编码后的代理地址，在 onMount 里异步取得
  let directUrl = ""
  const videoUrl = () => directUrl
  const videoTitle = () => props.title ?? getMediaName(props.item)

  onMount(async () => {
    if (!playerContainer) return
    let fileExt = ext(props.item.file_name)
    directUrl = await getSignedProxyUrl(videoPath())
    if (disposed || !playerContainer) return

    // 读取上次播放进度，用于续播
    let resumeSeconds = 0
    try {
      const prog = await getMediaProgress(
        props.item.id,
        props.episodeIndex ?? 0,
      )
      if (prog.code === 200 && prog.data && !prog.data.played) {
        resumeSeconds = prog.data.position_ticks / 10_000_000
      }
    } catch {
      // 忽略进度读取失败
    }
    if (disposed) return

    // ---- 云端转码判断 ----
    // 播放前先调用后端转码决策接口，如果需要转码则使用 HLS master_url 播放
    let useTranscode = false
    let actualUrl = videoUrl()
    try {
      const filePath = videoPath()
      const tcResp = await requestTranscodePlay(filePath)
      if (
        tcResp.code === 200 &&
        tcResp.data?.transcode &&
        tcResp.data.master_url
      ) {
        useTranscode = true
        actualUrl = tcResp.data.master_url
        fileExt = "m3u8"
        console.log(
          `[transcode] 媒体库使用云端转码播放: job=${tcResp.data.job_id}, profile=${tcResp.data.profile}`,
        )
      }
    } catch (e) {
      // 转码接口失败（可能未开启），静默降级到直链播放
      console.debug("[transcode] 转码接口不可用，使用直链播放", e)
    }
    // 等待转码响应期间若已卸载，放弃初始化，避免产生无人销毁的播放器实例
    if (disposed) return

    // 【预加载策略】
    // 1. 不在创建播放器时主动预取，避免点击视频立即触发数据加载；
    // 2. <video> 设为 preload="none"，浏览器不会自动 metadata/auto；
    // 3. HLS 模式下使用 autoStartLoad=false，attachMedia 不会立刻拉切片；
    //    在用户点击播放时才开始加载，且初始仅缓冲约 1 个分块；
    //    待第一个分块开始播放后再放宽缓冲到约 10 个分块顺序缓存。

    ensureAc3Decoder()
    player = new Artplayer({
      container: playerContainer,
      url: actualUrl,
      title: videoTitle(),
      volume: 1.0,
      autoplay: true,
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
      // 【重要】转码模式下一律使用 HLS.js，不使用 mediabunny proxy，
      // 避免 proxy 与 HLS.js 同时接管 video 元素导致双重加载、重复请求。
      // 只有直链播放且 mediabunny=full 时才启用 proxy。
      ...(!useTranscode && getMediaBunnyMode() === "full"
        ? { proxy: artplayerProxyMediabunny() }
        : {}),
      customType: {
        m3u8: (video: HTMLMediaElement, src: string, art: Artplayer) => {
          // 【重复创建保护】customType 可能被 Artplayer 多次触发（如 url 刷新、
          // proxy + customType 冲突），创建多个 Hls 实例会导致同一个 video
          // 元素上多个 HLS.js 并发拉取 playlist 和切片，产生请求风暴。
          if (hlsPlayer) {
            console.warn(
              "[hls] customType triggered again, destroying previous instance",
            )
            hlsPlayer.destroy()
            hlsPlayer = undefined
          }
          // 【按需加载策略】
          //   - autoStartLoad=false：attachMedia 后不会立即拉取切片，
          //     等用户点击播放时再 startLoad()，避免点开视频就开始下载。
          //   - 初始 maxBufferLength=1 秒：仅触发第一个分块加载即可起播；
          //     播放开始后会被动态扩大到 INITIAL → FULL（见下方 play 事件）。
          //   - 顺序缓存最多约 10 个分块：常见转码切片为 6 秒/块，
          //     因此 FULL_BUFFER_SECONDS = 6 * 10 = 60 秒。
          const INITIAL_BUFFER_SECONDS = 1
          const FULL_BUFFER_SECONDS = 60
          hlsPlayer = new Hls({
            // 关键：禁止 attachMedia 后自动加载 manifest/切片
            autoStartLoad: false,
            // 起步缓冲极小，仅够拉一个分块即可起播
            maxBufferLength: INITIAL_BUFFER_SECONDS,
            maxMaxBufferLength: INITIAL_BUFFER_SECONDS,
            maxBufferSize: 16 * 1024 * 1024,
            maxBufferHole: 0.5,
            levelLoadingMaxRetry: 4,
            levelLoadingRetryDelay: 1000,
            progressive: false,
            enableWorker: false,
            fragLoadingMaxRetry: 4,
            fragLoadingRetryDelay: 1000,
            backBufferLength: 60,
            liveSyncDuration: 6,
            liveMaxLatencyDuration: 30,
          })

          // ---- 防止 play() 与 HLS.js load 竞态 ----
          // HLS.js attachMedia 会异步接管 video 媒体源，在 manifest 解析完成前
          // 任何 play() 调用都会被浏览器中断并抛出 AbortError。
          // 解决方案：拦截 video.play()，在第一次播放时启动 HLS 加载，
          // 在 manifest 就绪前将 play 请求排队，就绪后自动执行。
          let hlsReady = false
          let pendingPlay = false
          let loadStarted = false // 是否已调用 startLoad（懒加载触发标志）
          let bufferExpanded = false // 是否已把缓冲扩大到 FULL
          const origPlay = video.play.bind(video)
          const ensureLoadStarted = () => {
            if (loadStarted || !hlsPlayer) return
            loadStarted = true
            console.debug("[hls] startLoad() triggered by play()")
            try {
              hlsPlayer.startLoad(0)
            } catch (e) {
              console.warn("[hls] startLoad failed:", e)
            }
          }
          video.play = function () {
            // 用户点击播放时才真正开始加载切片
            ensureLoadStarted()
            if (hlsReady) {
              return origPlay()
            }
            // manifest 尚未就绪，记录待播放状态，稍后自动触发
            pendingPlay = true
            console.debug("[hls] play() deferred, waiting for manifest")
            return Promise.resolve()
          } as typeof video.play

          // attachMedia 之前 loadSource 即可，autoStartLoad=false
          // 保证 attachMedia 不会自动开始下载
          hlsPlayer.loadSource(src)
          hlsPlayer.attachMedia(video)

          // 第一个切片开始播放后，把缓冲放宽到 ~10 个分块（约 60 秒）顺序缓存
          const expandBufferOnPlaying = () => {
            if (bufferExpanded || !hlsPlayer) return
            bufferExpanded = true
            try {
              const cfg: any = hlsPlayer.config
              cfg.maxBufferLength = FULL_BUFFER_SECONDS
              cfg.maxMaxBufferLength = FULL_BUFFER_SECONDS
              cfg.maxBufferSize = 60 * 1024 * 1024
              console.debug(
                `[hls] buffer expanded to ${FULL_BUFFER_SECONDS}s (~10 fragments)`,
              )
            } catch (e) {
              console.warn("[hls] expand buffer failed:", e)
            }
          }
          video.addEventListener("playing", expandBufferOnPlaying, {
            once: true,
          })

          // ---- 【最终兜底】单切片请求次数限流 ----
          // 无论什么原因（codec 不匹配、recoverMediaError 死循环、buffer append 失败等），
          // 如果同一个切片 URL 被请求超过 5 次，说明已经陷入无法恢复的死循环，
          // 直接销毁 hls 实例，避免后端被请求洪水冲垮。
          const fragRequestCount = new Map<string, number>()
          const MAX_PER_FRAG = 5
          hlsPlayer.on(Hls.Events.FRAG_LOADING, (_: any, data: any) => {
            const url = data?.frag?.url || data?.frag?.relurl || ""
            if (!url) return
            const cnt = (fragRequestCount.get(url) || 0) + 1
            fragRequestCount.set(url, cnt)
            if (cnt > MAX_PER_FRAG) {
              console.error(
                `[hls] fragment requested ${cnt} times, aborting to prevent flood: ${url}`,
              )
              if (hlsPlayer) {
                hlsPlayer.destroy()
                hlsPlayer = undefined
              }
              hlsReady = true
              video.play = origPlay
              // 提示用户
              try {
                art.notice.show = t("media.video.hls_broken")
              } catch {
                // ignore
              }
            }
          })

          hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
            console.debug("[hls] manifest parsed, ready to play")
            hlsReady = true
            // 恢复原始 play 方法
            video.play = origPlay
            // 如果在等待期间有 play 请求，现在执行
            if (pendingPlay) {
              pendingPlay = false
              origPlay().catch((e: any) => {
                // 忽略用户手势限制等非致命错误
                if (e.name !== "AbortError") {
                  console.warn("[hls] deferred play failed:", e)
                }
              })
            }
          })

          // ---- HLS.js 错误恢复（带限流，防止坏切片导致死循环）----
          let recoverCount = 0
          let lastRecoverAt = 0
          let swapAudioCodecTried = false
          hlsPlayer.on(Hls.Events.ERROR, (_: any, data: any) => {
            if (!data.fatal) return
            console.error("[hls] fatal error:", data.type, data.details)
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && hlsPlayer) {
              const now = Date.now()
              // 距离上次恢复 <3s 视为同一坏切片，累计计数；否则重置
              if (now - lastRecoverAt < 3000) {
                recoverCount++
              } else {
                recoverCount = 1
              }
              lastRecoverAt = now
              if (recoverCount === 1) {
                console.warn("[hls] recoverMediaError() #1")
                hlsPlayer.recoverMediaError()
              } else if (recoverCount === 2 && !swapAudioCodecTried) {
                console.warn("[hls] recoverMediaError() #2 + swapAudioCodec()")
                swapAudioCodecTried = true
                hlsPlayer.swapAudioCodec()
                hlsPlayer.recoverMediaError()
              } else {
                // 超过 2 次连续 media error → 放弃，避免后端切片被无限请求
                console.error(
                  "[hls] media error unrecoverable, giving up to prevent request flood",
                )
                hlsPlayer.destroy()
                hlsPlayer = null
                hlsReady = true
                video.play = origPlay
              }
            } else {
              hlsReady = true
              video.play = origPlay // 恢复，避免永久拦截
            }
          })
          // 注意：不要手动设置 video.src，HLS.js attachMedia 已接管媒体源
          // 手动赋值会导致 video 重新加载，与 Artplayer 的 play() 产生竞态
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
        // 【预加载控制】
        // - 转码模式：HLS.js 接管媒体源，preload 对其无实质影响；
        // - 直链模式：preload="none" 使浏览器在点击播放前不加载任何数据，
        //   避免进入页面立即产生多个范围请求。点击播放后浏览器
        //   会自动按需拉取，不会一次性下载过多。
        preload: "none",
      },
      settings: [
        {
          id: "setting_mediabunny",
          html: t("media.video.mediabunny_player"),
          tooltip: t(mediabunnyModeKey(getMediaBunnyMode())),
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
          selector: (
            ["disabled", "audio_only", "full"] as MediaBunnyMode[]
          ).map((m) => ({
            html: t(mediabunnyModeKey(m)),
            name: m,
            default: getMediaBunnyMode() === m,
          })),
          onSelect: function (item: any) {
            const newMode = item.name as MediaBunnyMode
            setMediaBunnyMode(newMode)
            setTimeout(() => {
              if (confirm(t("media.video.mode_reload_confirm"))) {
                location.reload()
              }
            }, 100)
            return t(mediabunnyModeKey(newMode))
          },
        },
      ],
    })

    // Artplayer 默认在媒体就绪前一直显示加载转圈；HLS 采用懒加载（点击播放才开始拉流），
    // 初始阶段必须隐藏加载层，只在真正开始缓冲/播放时显示，避免页面一打开就一直转圈。
    player.loading.show = false
    // 不再用 Artplayer 的加载层：它会在未起播时一直转圈并挡住中间的播放按钮
    player.on("video:playing", () => {
      if (player) player.loading.show = false
    })
    // 部分浏览器会拦截自动播放：失败时保持暂停，用户点击中间的播放键即可
    player.on("ready", () => {
      player?.play().catch(() => {
        /* autoplay blocked */
      })
    })
    player.on("video:canplay", () => {
      if (player) player.loading.show = false
    })
    player.on("video:error", () => {
      if (player) player.loading.show = false
    })

    // ---- 播放进度：续播 + 定时上报（与 Emby 共用 user_data）----
    let lastSavedAt = 0
    let resumed = false
    const persistProgress = (played = false) => {
      if (!player) return
      const duration = player.duration || 0
      const position = player.currentTime || 0
      if (position < 2 && !played) return
      saveMediaProgress({
        item_id: props.item.id,
        episode_index: props.episodeIndex ?? 0,
        position,
        duration,
        played,
      }).catch(() => {
        /* ignore */
      })
    }
    player.on("video:playing", () => {
      if (!resumed && resumeSeconds > 5) {
        player!.seek = resumeSeconds
        resumed = true
      }
    })
    player.on("video:timeupdate", () => {
      const now = Date.now()
      if (now - lastSavedAt < 10_000) return
      lastSavedAt = now
      persistProgress()
    })
    player.on("video:pause", () => persistProgress())
    player.on("video:ended", () => persistProgress(true))
    onCleanup(() => persistProgress())

    // "仅音频"模式：原生 <video> 负责视频解码，mediabunny 只提供音轨。
    // 仅在直链模式下生效，转码模式已经是 HLS 流，不需要 mediabunny 音频补丁。
    if (!useTranscode && getMediaBunnyMode() === "audio_only") {
      attachMediabunnyAudio(player, videoUrl())
    }

    // 默认禁用 MediaBunny 时，仍自动检测浏览器不支持的音频（AC3/EAC3/DTS 等）：
    // 播放几秒后音频解码字节数仍为 0，或浏览器明确报告无音频轨，则自动挂载 MediaBunny 音轨。
    if (!useTranscode && getMediaBunnyMode() === "disabled") {
      let audioPatched = false
      const patchAudio = () => {
        if (audioPatched || !player) return
        audioPatched = true
        // 模式为 disabled 时 ensureAc3Decoder() 默认不会注册；回退路径要强制注册，
        // 否则 AC3/EAC3 这类音轨即使挂上 MediaBunny 也解不出来
        ensureAc3Decoder(true)
        attachMediabunnyAudio(player, videoUrl())
        player.notice.show = t("media.video.audio_fallback")
      }
      const detectUnsupportedAudio = () => {
        if (audioPatched || !player) return
        const video = player.video as HTMLVideoElement & {
          mozHasAudio?: boolean
          webkitAudioDecodedByteCount?: number
        }
        if (!video) return
        // Firefox 会明确告知是否存在音频轨
        if (video.mozHasAudio === false) {
          patchAudio()
          return
        }
        // Chromium：播放数秒后音频解码字节数仍为 0，说明浏览器丢弃了音轨
        const decoded = video.webkitAudioDecodedByteCount
        if (
          typeof decoded === "number" &&
          video.currentTime > 3 &&
          decoded === 0
        ) {
          patchAudio()
        }
      }
      player.on("video:timeupdate", detectUnsupportedAudio)
    }
  })

  onCleanup(() => {
    disposed = true
    // 先销毁 HLS/FLV 播放器，再销毁 Artplayer
    // 避免 Artplayer destroy 时触发 video.src 变更导致多余的 load 事件
    if (hlsPlayer) {
      hlsPlayer.destroy()
      hlsPlayer = undefined
    }
    if (flvPlayer) {
      flvPlayer.destroy()
      flvPlayer = undefined
    }
    if (player) {
      player.destroy()
      player = undefined
    }
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
      {/* Artplayer 自带加载层在自动播放被拦截时会一直转圈，直接隐藏 */}
      <style>{`.art-loading { display: none !important; }`}</style>
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
        <div style={{ "margin-left": "auto" }}>
          <OpenWithPlayer
            itemId={props.item.id}
            path={props.filePath}
            name={props.title ?? props.item.file_name}
          />
        </div>
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
  const t = useT()
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
  const [favorite, setFavorite] = createSignal(false)

  // 详情页收藏状态
  createEffect(() => {
    const it = item()
    if (!it) return
    getMediaUserData([it.id])
      .then((resp) => {
        if (resp.code !== 200 || !resp.data) return
        const row = resp.data.find((d) => d.item_id === it.id)
        setFavorite(!!row?.is_favorite)
      })
      .catch(() => {
        /* 访客场景忽略 */
      })
  })

  const toggleFavorite = async () => {
    const it = item()
    if (!it) return
    const next = !favorite()
    setFavorite(next)
    const resp = await setMediaFavorite(it.id, next)
    if (resp.code !== 200) {
      setFavorite(!next)
      notify.error(t("media.browser.favorite_failed") + ": " + resp.message)
    }
  }

  // 下载 .strm：必须带鉴权头，因此走 axios 再触发本地保存
  const downloadStrm = async (item: MediaItem) => {
    const episode = currentEpisode()?.index ?? 0
    const blob = await downloadMediaStrm(item.id, episode)
    if (!(blob instanceof Blob)) {
      notify.error(t("media.video.strm_failed"))
      return
    }
    const suffix = episode
      ? ` S${String(item.season || 1).padStart(2, "0")}E${String(episode).padStart(2, "0")}`
      : ""
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${getMediaName(item)}${suffix}.strm`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const titleColor = createMemo(() => (isDark() ? "#f1f5f9" : "#0f172a"))
  const metaColor = createMemo(() => (isDark() ? "#64748b" : "#94a3b8"))
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
          {item.loading
            ? t("media.common.loading")
            : t("media.common.not_found")}
        </div>
      }
    >
      {(data) => {
        const authors = () => parseAuthors(data().authors)
        const genres = () => data().genre?.split(",").filter(Boolean) ?? []

        return (
          <div>
            {/* 返回按鈕 */}
            <button onClick={props.onBack} style={mediaBackBtn(isDark())}>
              ← 返回
            </button>

            {/* 背景模糊层 */}
            <Show when={data().cover}>
              <div
                style={{
                  position: "fixed",
                  inset: "0",
                  "background-image": `url(${resolveMediaCover(data().cover)})`,
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
                    src={resolveMediaCover(data().cover)}
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
                <div
                  style={{
                    display: "flex",
                    "align-items": "flex-start",
                    gap: "12px",
                    "flex-wrap": "wrap",
                    "margin-bottom": "8px",
                  }}
                >
                  <h1
                    style={{
                      margin: "0",
                      "font-size": "28px",
                      "font-weight": "700",
                      color: titleColor(),
                      "line-height": "1.2",
                    }}
                  >
                    {getMediaName(data())}
                  </h1>
                  <button
                    onClick={toggleFavorite}
                    title={
                      favorite()
                        ? t("media.detail.unfavorite")
                        : t("media.detail.favorite")
                    }
                    aria-label={
                      favorite()
                        ? t("media.detail.unfavorite")
                        : t("media.detail.favorite")
                    }
                    style={{
                      display: "inline-flex",
                      "align-items": "center",
                      gap: "6px",
                      padding: "6px 14px",
                      "border-radius": "999px",
                      cursor: "pointer",
                      "font-size": "13px",
                      "font-weight": "500",
                      background: favorite()
                        ? "rgba(251,191,36,0.16)"
                        : isDark()
                          ? "rgba(255,255,255,0.06)"
                          : "rgba(0,0,0,0.05)",
                      border: favorite()
                        ? "1px solid rgba(251,191,36,0.4)"
                        : `1px solid ${
                            isDark()
                              ? "rgba(255,255,255,0.12)"
                              : "rgba(0,0,0,0.1)"
                          }`,
                      color: favorite()
                        ? "#fbbf24"
                        : isDark()
                          ? "#cbd5e1"
                          : "#334155",
                    }}
                  >
                    {favorite()
                      ? t("media.video.favorited")
                      : t("media.video.favorite")}
                  </button>
                </div>

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
                        background: "rgba(24,144,255,0.15)",
                        border: "1px solid rgba(24,144,255,0.3)",
                        "border-radius": "6px",
                        padding: "3px 8px",
                        color: "#a5b4fc",
                        "font-size": "12px",
                      }}
                    >
                      {data().video_type === "movie"
                        ? t("media.video.movie")
                        : t("media.video.tv")}
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
                      {(g) => <span style={mediaChip(isDark())}>{g}</span>}
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
                    episodeIndex={currentEpisode()?.index ?? 0}
                    onClose={() => setShowPlayer(false)}
                  />
                </Show>

                {/* 无选集：直接显示播放按钮 */}
                <Show when={parseEpisodes(data().episodes).length === 0}>
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "12px",
                      "flex-wrap": "wrap",
                      "margin-bottom": "24px",
                    }}
                  >
                    <MediaPlayButton
                      itemId={data().id}
                      name={data().file_name}
                      onBrowserPlay={() => {
                        setCurrentEpisode(null)
                        setShowPlayer(true)
                      }}
                    />
                    <button
                      onClick={() => downloadStrm(data())}
                      style={mediaSecondaryBtn(isDark())}
                    >
                      下载 STRM
                    </button>
                  </div>
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
                                      ? accentGradient()
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
                                      ? "0 2px 8px rgba(24,144,255,0.4)"
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
  const t = useT()
  const [selectedId, setSelectedId] = createSignal<string | null>(null)

  return (
    <MediaLayout title={t("media.video.title")}>
      <Show
        when={selectedId()}
        fallback={
          <MediaBrowser
            mediaType="video"
            enableFavorites
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
                      src={resolveMediaCover(item.cover)}
                      style={{
                        width: "40px",
                        height: "58px",
                        "object-fit": "cover",
                        "border-radius": "4px",
                        "flex-shrink": "0",
                      }}
                    />
                  </Show>
                  <div style={{ flex: "1", "min-width": "0" }}>
                    <div
                      style={{
                        color: dark() ? "#e2e8f0" : "#1e293b",
                        "font-size": "14px",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                      }}
                    >
                      {getMediaName(item)}
                    </div>
                    <div
                      style={{
                        color: dark() ? "#475569" : "#94a3b8",
                        "font-size": "12px",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                      }}
                    >
                      {[
                        item.release_date?.slice(0, 4),
                        item.genre?.split(",").slice(0, 2).join("/"),
                        item.duration
                          ? `${Math.floor(item.duration / 60)} 分钟`
                          : "",
                        parseEpisodes(item.episodes).length > 0
                          ? `${parseEpisodes(item.episodes).length} 集`
                          : formatMediaSize(item.file_size),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    <Show when={parseAuthors(item.authors).length > 0}>
                      <div
                        style={{
                          color: dark() ? "#334155" : "#94a3b8",
                          "font-size": "11px",
                          overflow: "hidden",
                          "text-overflow": "ellipsis",
                          "white-space": "nowrap",
                        }}
                      >
                        演员：
                        {parseAuthors(item.authors).slice(0, 4).join(" / ")}
                      </div>
                    </Show>
                  </div>
                  <Show when={item.rating > 0}>
                    <span
                      style={{
                        color: "#fbbf24",
                        "font-size": "13px",
                        "flex-shrink": "0",
                      }}
                    >
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
