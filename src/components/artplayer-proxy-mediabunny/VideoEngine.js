/**
 * Video Engine for MediaBunny
 * Handles video frame rendering and synchronization
 *
 * 关键设计（性能优化）：
 *  1. 使用 VideoSampleSink 而非 CanvasSink。区别：
 *     - CanvasSink 内部把 VideoFrame 复制到一块 OffscreenCanvas，再交给我们 → 我们再 drawImage 到 canvas
 *       = 1080p 一帧需要"复制 1 次到中间 canvas + 复制 1 次到目标 canvas"，CPU 开销 16-30ms
 *     - VideoSampleSink 直接给我们 VideoSample（内部包 VideoFrame），调用 sample.draw(ctx, ...) 时
 *       浏览器走 GPU 加速 drawImage(VideoFrame) 路径 = 仅 1 次 GPU 复制，1080p < 5ms
 *     这是"硬解已生效但仍然卡"的真正瓶颈：渲染侧吃满了 CPU。
 *  2. 维护 lookahead 队列（默认 3 帧）而非单一 nextFrame，避免每个 RAF 必须等异步迭代器。
 *  3. 严格 close() 每个未使用的 VideoSample，避免 VideoFrame 内存泄漏（VideoFrame 持有 GPU 资源，
 *     不及时 close 会触发 mediabunny 的"unclosed sample"警告并最终崩溃）。
 */
import {
  ALL_FORMATS,
  BlobSource,
  Input,
  ReadableStreamSource,
  UrlSource,
  VideoSampleSink,
} from "mediabunny"

export default class VideoEngine {
  constructor({
    canvas,
    ctx,
    events,
    timeupdateInterval = 250,
    avSyncTolerance = 0.12,
    // 默认允许跳帧（用户明确要求）—— 视频赶不上时丢过期帧不重拾
    dropLateFrames = true,
    poster = "",
    preflightRange = false,
    disableVideo = false,
    // 视频落后超过该阈值（秒）时，不再逐帧追赶，而是直接 reset 迭代器到音频位置
    resyncThreshold = 1.5,
    // lookahead 队列大小：缓冲 N 帧已解码 sample 等待呈现。3 是 1080p 30fps 较合理的值。
    lookaheadFrames = 3,
  }) {
    this.canvas = canvas
    this.ctx = ctx
    this.events = events
    this.timeupdateInterval = timeupdateInterval
    this.avSyncTolerance = avSyncTolerance
    this.dropLateFrames = dropLateFrames
    this.poster = poster
    this.preflightRange = preflightRange
    this.disableVideo = disableVideo
    this.resyncThreshold = Math.max(0.5, Number(resyncThreshold) || 1.5)
    this.lookaheadFrames = Math.max(
      1,
      Math.min(8, Number(lookaheadFrames) || 3),
    )

    // MediaBunny instances
    this.input = null
    this.videoSink = null
    this.videoIterator = null

    // Frame rendering：lookahead 队列存放 VideoSample 对象（带 timestamp）
    this.frameQueue = [] // 升序：最早的在前
    this.rafId = 0
    this.asyncId = 0

    // Video properties
    this.width = 0
    this.height = 0
    this.duration = Number.NaN

    // Playback state
    this.audioClock = null
    this.lastTimeUpdate = 0
    this.stalled = false
    this.playbackRate = 1
    this.posterDrawn = false
    this.isFetching = false
    this._fetchStartTs = 0 // 上次 isFetching 进入 true 的 wall-clock。超过阈值视为卡死。

    // 看门狗：检测音频时钟是否长时间不前进
    this._lastClockSampleTs = 0 // 上次采样的 wall-clock
    this._lastClockSampleVal = 0 // 上次采样的 audio.currentTime
    this._stallStartWallTs = 0 // 卡死起始 wall-clock。0 表示未卡
    this._needResync = false // 调度位：需要重置迭代器追赶到音频位置
    this._lastFrameTs = null
  }

  normalizeSource(src) {
    if (typeof src === "string") return new UrlSource(src)
    if (src instanceof Blob) return new BlobSource(src)
    if (
      typeof ReadableStream !== "undefined" &&
      src instanceof ReadableStream
    ) {
      return new ReadableStreamSource(src)
    }
    return src
  }

  async preflight(url) {
    if (!this.preflightRange || typeof url !== "string") return true

    try {
      const res = await fetch(url, { method: "HEAD" })
      const acceptRanges = res.headers.get("accept-ranges")
      if (!acceptRanges || acceptRanges === "none") {
        this.events.emit("error", new Event("RangeNotSupported"))
        return false
      }
      return true
    } catch (e) {
      console.warn("Preflight check failed:", e)
      return true
    }
  }

  drawPoster() {
    if (this.posterDrawn) return
    if (!this.poster) {
      const w = this.canvas.width || 16
      const h = this.canvas.height || 9
      if (!this.canvas.width) this.canvas.width = w
      if (!this.canvas.height) this.canvas.height = h
      this.ctx.fillStyle = "#000"
      this.ctx.fillRect(0, 0, w, h)
      this.posterDrawn = true
      return
    }

    const img = new Image()
    img.onload = () => {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      this.canvas.width = img.naturalWidth || this.canvas.width
      this.canvas.height = img.naturalHeight || this.canvas.height
      this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height)
      this.posterDrawn = true
    }
    img.src = this.poster
  }

  /** 安全关闭一帧，避免 VideoFrame 内存/GPU 资源泄漏 */
  closeFrameSafe(sample) {
    try {
      sample?.close?.()
    } catch (_) {
      /* ignore */
    }
  }

  /** 清空帧队列并 close 所有持有的 sample */
  clearFrameQueue() {
    while (this.frameQueue.length) {
      this.closeFrameSafe(this.frameQueue.shift())
    }
  }

  async stopIterator() {
    this.clearFrameQueue()
    await this.videoIterator?.return()
    this.videoIterator = null
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  /** 把一个 VideoSample 画到主 canvas（自动 close） */
  drawSample(sample) {
    try {
      // 重要：不要每帧都 clearRect，drawImage 会覆盖整张画面，clearRect 反而是一次额外 1080p GPU 操作
      sample.draw(this.ctx, 0, 0, this.canvas.width, this.canvas.height)
      this._lastFrameTs = sample.timestamp
    } catch (e) {
      console.warn("MediaBunny: drawSample 失败:", e)
    } finally {
      this.closeFrameSafe(sample)
    }
  }

  async load(src, onMetadata) {
    const id = ++this.asyncId

    await this.stopIterator()
    this.clear()
    this.posterDrawn = false

    if (this.disableVideo) {
      await this.loadAudioOnlyMode(src, id, onMetadata)
      return
    }

    if (!(await this.preflight(src))) return

    const source = this.normalizeSource(src)
    if (!source) {
      this.drawPoster()
      return
    }

    this.input = new Input({
      source,
      formats: ALL_FORMATS,
    })

    this.duration = await this.input.computeDuration()
    if (id !== this.asyncId) return

    const videoTrack = await this.input.getPrimaryVideoTrack()
    if (!videoTrack) {
      this.handleNoVideoTrack()
      onMetadata?.()
      return
    }

    if (videoTrack.codec === null || !(await videoTrack.canDecode())) {
      this.handleNoVideoTrack()
      onMetadata?.()
      return
    }

    try {
      // VideoSampleSink：直接吐 VideoSample（内部含 VideoFrame），后续 sample.draw() 走 GPU drawImage 快路径
      this.videoSink = new VideoSampleSink(videoTrack)
    } catch (err) {
      console.warn(
        "MediaBunny: 无法创建 VideoSampleSink，回退到无视频模式:",
        err,
      )
      this.handleNoVideoTrack()
      onMetadata?.()
      return
    }

    this.width = videoTrack.displayWidth
    this.height = videoTrack.displayHeight

    this.canvas.width = this.width
    this.canvas.height = this.height

    onMetadata?.()

    try {
      await this.resetIterator(0)
    } catch (err) {
      console.warn("MediaBunny: 视频帧初始化失败，回退到无视频模式:", err)
      this.handleNoVideoTrack()
    }
  }

  handleNoVideoTrack() {
    this.videoSink = null
    if (!this.canvas.width || !this.canvas.height) {
      this.canvas.width = this.width || 640
      this.canvas.height = this.height || 360
    }
    this.clear()
    this.drawPoster()
  }

  async loadAudioOnlyMode(src, id, onMetadata) {
    if (!(await this.preflight(src))) {
      this.handleNoVideoTrack()
      onMetadata?.()
      return
    }

    const source = this.normalizeSource(src)
    if (!source) {
      this.handleNoVideoTrack()
      onMetadata?.()
      return
    }

    try {
      this.input = new Input({ source, formats: ALL_FORMATS })
      this.duration = await this.input.computeDuration()
      if (id !== this.asyncId) return

      const videoTrack = await this.input.getPrimaryVideoTrack()
      if (
        !videoTrack ||
        videoTrack.codec === null ||
        !(await videoTrack.canDecode())
      ) {
        this.handleNoVideoTrack()
        onMetadata?.()
        return
      }

      this.width = videoTrack.displayWidth
      this.height = videoTrack.displayHeight
      this.canvas.width = this.width
      this.canvas.height = this.height

      onMetadata?.()

      // 抓首帧作为静态背景
      try {
        const sink = new VideoSampleSink(videoTrack)
        const it = sink.samples(0)
        const first = (await it.next()).value ?? null
        await it.return?.()
        if (id !== this.asyncId) {
          this.closeFrameSafe(first)
          return
        }
        if (first) {
          this.drawSample(first)
          this.posterDrawn = true
          this.events.emit("loadeddata")
        } else {
          this.drawPoster()
        }
      } catch (err) {
        console.warn(
          "MediaBunny[audio_only]: 首帧抓取失败，使用 poster 兜底:",
          err,
        )
        this.drawPoster()
      }

      this.videoSink = null
    } catch (err) {
      console.warn("MediaBunny[audio_only]: 容器解析失败，回退到无视频:", err)
      this.handleNoVideoTrack()
      onMetadata?.()
    }
  }

  /**
   * 重置迭代器到指定时间点。
   * 立即抓 1 帧渲染（首帧反馈），然后启动后台 fill 循环填充 lookahead 队列。
   */
  async resetIterator(time) {
    await this.stopIterator()

    if (!this.videoSink) return

    this.videoIterator = this.videoSink.samples(time)

    try {
      const first = (await this.videoIterator.next()).value ?? null
      if (first) {
        // 立即画首帧（reset 后即时反馈）
        this.drawSample(first)
        this.events.emit("loadeddata")
      } else {
        this.drawPoster()
      }
    } catch (err) {
      console.warn("MediaBunny: 视频帧解码失败:", err)
      await this.stopIterator()
      this.videoSink = null
      this.drawPoster()
    }
  }

  /**
   * 拉取新帧填充 lookahead 队列。fire-and-forget，不阻塞 RAF。
   * 关键：循环填到 lookaheadFrames 满或迭代器结束，单次调用最多消耗 N 帧时间，
   * 但因为是 await 所以不会阻塞主线程。
   */
  async updateNextFrame(localId) {
    // 超时保护
    if (this.isFetching) {
      if (this._fetchStartTs && Date.now() - this._fetchStartTs > 1500) {
        console.warn(
          "MediaBunny: updateNextFrame 超时（1.5s），释放锁并调度重同步",
        )
        this.isFetching = false
        this._fetchStartTs = 0
        this._needResync = true
      }
      return
    }
    if (!this.videoIterator) return

    // 队列已满则不抓
    if (this.frameQueue.length >= this.lookaheadFrames) return

    this.isFetching = true
    this._fetchStartTs = Date.now()

    try {
      const t = this.audioClock?.currentTime ?? 0
      const tolerance = Math.max(
        0.06,
        this.avSyncTolerance / Math.max(1, this.playbackRate),
      )

      // 单次最多新解 lookaheadFrames 帧 + 跳帧上限 8（避免主线程长占用）
      const maxFetchPerCall = this.lookaheadFrames
      const maxSkipPerCall = 8
      let fetched = 0
      let skipped = 0

      while (
        this.frameQueue.length < this.lookaheadFrames &&
        fetched < maxFetchPerCall &&
        skipped < maxSkipPerCall
      ) {
        let sample
        try {
          const r = await this.videoIterator.next()
          sample = r.value ?? null
          if (r.done) {
            this.videoIterator = null
            break
          }
        } catch (err) {
          console.warn("MediaBunny: 视频帧解码错误，停止视频渲染:", err)
          await this.stopIterator()
          this.videoSink = null
          this.drawPoster()
          return
        }
        if (!sample || localId !== this.asyncId) {
          this.closeFrameSafe(sample)
          return
        }

        // 过期帧丢弃
        if (this.dropLateFrames && sample.timestamp < t - tolerance) {
          this._lastFrameTs = sample.timestamp
          this.closeFrameSafe(sample)
          skipped++
          // 跳太多 → 标记重同步
          if (
            skipped >= maxSkipPerCall &&
            this._lastFrameTs != null &&
            t - this._lastFrameTs > this.resyncThreshold
          ) {
            this._needResync = true
          }
          continue
        }

        // 入队
        this.frameQueue.push(sample)
        fetched++
      }
    } finally {
      this.isFetching = false
      this._fetchStartTs = 0
    }
  }

  render() {
    if (!this.audioClock) return

    const t = this.audioClock.currentTime
    if (t == null || Number.isNaN(t)) {
      this.rafId = requestAnimationFrame(() => this.render())
      return
    }
    const now = Date.now()

    // 看门狗：音频时钟超过 1.5s 未前进 → 认为卡死，尝试 resume audioContext
    if (this._lastClockSampleTs === 0) {
      this._lastClockSampleTs = now
      this._lastClockSampleVal = t
    } else if (Math.abs(t - this._lastClockSampleVal) > 0.001) {
      this._lastClockSampleTs = now
      this._lastClockSampleVal = t
      this._stallStartWallTs = 0
    } else {
      const stalledMs = now - this._lastClockSampleTs
      if (stalledMs > 1500 && !this._stallStartWallTs) {
        this._stallStartWallTs = now
        const audioCtx = this.audioClock?.audioContext
        if (audioCtx && audioCtx.state === "suspended") {
          audioCtx.resume?.().catch(() => {})
        }
      }
      if (
        stalledMs > 3000 &&
        this.audioClock?.runIterator &&
        this.audioClock.audioSink &&
        !this.audioClock.paused
      ) {
        this._lastClockSampleTs = now
        try {
          this.audioClock.asyncId++
          this.audioClock.runIterator(this.audioClock.asyncId)
        } catch (_) {
          /* ignore */
        }
      }
    }

    // 调度重同步
    if (this._needResync && !this.isFetching) {
      this._needResync = false
      this.resetIterator(t).catch((err) => {
        console.warn("MediaBunny: resync resetIterator 失败:", err)
      })
    }

    if (now - this.lastTimeUpdate >= this.timeupdateInterval) {
      this.events.emit("timeupdate")
      this.lastTimeUpdate = now
    }

    if (Number.isFinite(this.duration) && t >= this.duration) {
      this.stop()
      this.stalled = false
      this.events.emit("ended")
      this.events.emit("pause")
      this.events.emit("canplay")
      return
    }

    // 关键渲染逻辑：从队列头部消费所有"已到呈现时间"的帧
    // 同时处理跳帧（队列里可能有过期帧——发生在 audio 突进时）
    const tolerance = Math.max(
      0.06,
      this.avSyncTolerance / Math.max(1, this.playbackRate),
    )

    let drewThisRaf = false
    while (this.frameQueue.length > 0) {
      const head = this.frameQueue[0]
      if (head.timestamp <= t + tolerance) {
        // 已到时间或临近 → 消费
        this.frameQueue.shift()
        // 过期太多则丢弃不画（节省 GPU）
        if (this.dropLateFrames && head.timestamp < t - tolerance) {
          this.closeFrameSafe(head)
          continue
        }
        this.drawSample(head)
        drewThisRaf = true
        // RAF 周期内只画一帧（屏幕一次刷新只能显示一帧）
        break
      } else {
        // 队首还在未来：本轮 RAF 不画
        break
      }
    }

    // 始终尝试补充 lookahead 队列（fire-and-forget）
    if (this.videoIterator && this.frameQueue.length < this.lookaheadFrames) {
      this.updateNextFrame(this.asyncId)
    }

    if (drewThisRaf && this.stalled) {
      this.events.emit("canplay")
      this.events.emit("playing")
      this.stalled = false
    } else if (
      !drewThisRaf &&
      this.frameQueue.length === 0 &&
      Number.isFinite(this.duration) &&
      t < this.duration &&
      !this.stalled &&
      this.videoIterator // 仅在视频迭代器还活着时报 stalled
    ) {
      this.stalled = true
      this.events.emit("waiting")
    }

    this.rafId = requestAnimationFrame(() => this.render())
  }

  start(audioEngine) {
    this.audioClock = audioEngine
    this.asyncId++
    this.stalled = false
    this._lastClockSampleTs = 0
    this._lastClockSampleVal = 0
    this._stallStartWallTs = 0
    this._needResync = false
    // 启动时立即填充 lookahead 队列（不等第一个 RAF）
    this.updateNextFrame(this.asyncId)
    this.rafId = requestAnimationFrame(() => this.render())
  }

  stop() {
    cancelAnimationFrame(this.rafId)
  }

  async seek(time) {
    this.asyncId++
    await this.resetIterator(time)
  }

  setPlaybackRate(rate) {
    this.playbackRate = Math.max(0.1, Number(rate) || 1)
  }

  destroy() {
    this.asyncId++
    this.stop()
    this.stopIterator()
    this.posterDrawn = false
    this.input = null
    this.videoSink = null
  }
}
