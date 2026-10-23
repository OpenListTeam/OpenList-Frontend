/**
 * Main MediaBunny Engine
 * Coordinates audio and video playback
 */
import AudioEngine from "./AudioEngine.js"
import VideoEngine from "./VideoEngine.js"
import { prefetchVideoChunks } from "./Prefetcher.js"
import {
  registerHardwareDecoder,
  setHardwareDecoderDebug,
} from "./HardwareDecoder.js"

export default class MediaBunnyEngine {
  constructor({ canvas, ctx, events, option = {} }) {
    this.events = events
    this.option = option

    // 启动硬件加速解码器（默认开启）—— 为 mediabunny 注册一个加载了 prefer-hardware 的自定义解码器
    if (option.hardwareAcceleration !== false) {
      registerHardwareDecoder()
    }

    // 调试日志开关：option.debug=true 或 localStorage 写过 "mediabunny_debug=1" 都会启用
    const debugFromStorage =
      typeof localStorage !== "undefined" &&
      localStorage.getItem("mediabunny_debug") === "1"
    if (option.debug || debugFromStorage) {
      setHardwareDecoderDebug(true)
      console.log(
        "[MediaBunny] 调试日志已启用。在控制台运行 window.__HARDWARE_DECODER_STATS__ 查看硬解命中统计。",
      )
    }

    // Create audio and video engines
    this.audio = new AudioEngine(events)
    this.video = new VideoEngine({
      canvas,
      ctx,
      events,
      timeupdateInterval: option.timeupdateInterval ?? 250,
      avSyncTolerance: option.avSyncTolerance ?? 0.12,
      // 默认开启跳帧（dropLateFrames），用户明确允许
      dropLateFrames: option.dropLateFrames ?? true,
      poster: option.poster ?? "",
      preflightRange: option.preflightRange ?? false,
      disableVideo: option.disableVideo === true,
      resyncThreshold: option.resyncThreshold ?? 1.5,
      // 帧预读队列大小。兼容老参数名 poolSize。
      lookaheadFrames: option.lookaheadFrames ?? option.poolSize ?? 3,
    })

    // Playback state
    this.paused = true
    this.ended = false
    this.readyState = 0
    this.networkState = 0
    this.error = null
    this.seeking = false
    this.loadSeq = 0

    // Listen to ended event
    events.addEventListener?.("ended", () => {
      this.ended = true
      this.paused = true
    })
  }

  async load(src) {
    const id = ++this.loadSeq

    this.pause()
    this.ended = false
    this.error = null
    this.networkState = 2 // NETWORK_LOADING
    this.readyState = 0 // HAVE_NOTHING

    setTimeout(() => this.events.emit("waiting"), 0)
    setTimeout(() => this.events.emit("loadstart"), 0)

    // 预下载几个区块：在真正初始化 mediabunny 之前先用 HTTP Range 请求拿到首部数据，
    // 这样 mediabunny 后续请求会命中浏览器 HTTP 缓存、避免开播阶段连续 RTT。
    // 只对字符串 URL 预取；Blob/ReadableStream 本地源跳过。
    if (
      typeof src === "string" &&
      this.option.prefetchEnabled !== false &&
      id === this.loadSeq
    ) {
      try {
        await prefetchVideoChunks(src, {
          byteRange: this.option.prefetchBytes ?? 8 * 1024 * 1024,
          timeoutMs: this.option.prefetchTimeoutMs ?? 3000,
        })
      } catch (_) {
        /* prefetch 失败不阻止主流程 */
      }
      // 预取期间可能已被新的 load() 覆盖，丢弃本轮
      if (id !== this.loadSeq) return
    }

    const loadTimeout = Number.isFinite(this.option.loadTimeout)
      ? this.option.loadTimeout
      : 0

    try {
      await Promise.race([
        this.performLoad(src, id),
        loadTimeout > 0
          ? this.createTimeout(loadTimeout)
          : new Promise(() => {}),
      ])
    } catch (err) {
      if (id !== this.loadSeq) return

      this.loadSeq++
      this.error = { code: 4, message: err.message }
      this.networkState = 3 // NETWORK_NO_SOURCE
      this.events.emit("error")
    }
  }

  async performLoad(src, id) {
    let videoMetadataLoaded = false
    let audioMetadataLoaded = false

    const checkMetadata = () => {
      if (videoMetadataLoaded && audioMetadataLoaded) {
        this.readyState = 1 // HAVE_METADATA
        this.events.emit("loadedmetadata")
        this.events.emit("durationchange")
        this.events.emit("progress")
      }
    }

    try {
      await Promise.all([
        this.video.load(src, () => {
          if (id !== this.loadSeq) return
          videoMetadataLoaded = true
          checkMetadata()
        }),
        this.audio.load(src, () => {
          if (id !== this.loadSeq) return
          audioMetadataLoaded = true
          checkMetadata()
        }),
      ])

      if (id !== this.loadSeq) return

      this.readyState = 4 // HAVE_ENOUGH_DATA
      this.networkState = 1 // NETWORK_IDLE
      this.events.emit("loadeddata")
      this.events.emit("canplay")
      this.events.emit("canplaythrough")
      this.events.emit("progress")
    } catch (err) {
      // 已被新的 load() 取代：按正常结束处理，不报错也不改状态
      if (id !== this.loadSeq) return
      // 必须继续向上抛：外层用 Promise.race 判定加载成败，
      // 在这里吞掉异常会被当成「加载成功」，随后错误地设置 HAVE_ENOUGH_DATA
      // 并发出 canplay / canplaythrough。错误状态由 load() 的 catch 统一处理。
      throw err
    }
  }

  createTimeout(ms) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Load timeout")), ms)
    })
  }

  async play() {
    if (!this.paused) return

    if (this.ended) {
      this.ended = false
      await this.seek(0)
    }

    this.paused = false

    await this.audio.play()
    this.video.start(this.audio)

    this.events.emit("play")
    this.events.emit("playing")
  }

  pause() {
    if (this.paused) return

    this.paused = true

    this.audio.pause()
    this.video.stop()

    this.events.emit("pause")
  }

  async seek(time) {
    const shouldResume = !this.paused

    this.ended = false
    this.seeking = true

    this.events.emit("seeking")
    this.events.emit("waiting")

    this.pause()

    await Promise.all([this.audio.seek(time), this.video.seek(time)])

    this.seeking = false
    this.events.emit("seeked")

    if (shouldResume && !this.ended) {
      await this.play()
    }
  }

  setVolume(volume, muted) {
    this.audio.setVolume(volume, muted)
  }

  setPlaybackRate(rate) {
    this.audio.setPlaybackRate(rate)
    this.video.setPlaybackRate(rate)
  }

  destroy() {
    this.pause()
    this.audio.destroy()
    this.video.destroy()
  }

  // Getters
  get currentTime() {
    return this.audio.currentTime
  }

  get duration() {
    return this.audio.duration || this.video.duration
  }

  get videoWidth() {
    return this.video.width
  }

  get videoHeight() {
    return this.video.height
  }
}
