/**
 * Audio Engine for MediaBunny
 * Handles audio playback using Web Audio API
 *
 * 关键修复：
 *   原实现在 runIterator 的每个迭代周期都 new 一个 setInterval(checkStarvation, 100)，
 *   1) 多个 interval 会并发存在，可能多次调 audioContext.suspend() 锁死播放器。
 *   2) starvation 阈值在某些时刻（迭代器刚启动 / 主线程一次微卡顿）容易误触发。
 *   现在改为单一 wall-clock watchdog（在 RAF 侧已有），AudioEngine 内部仅做必要的调度，
 *   不再主动 suspend audioContext —— 避免 starvation 误判导致的"播几秒后卡死"。
 */
import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  Input,
  ReadableStreamSource,
  UrlSource,
} from "mediabunny"
import { TimeStretcher } from "./pitchPreservingTimeStretch.js"

export default class AudioEngine {
  constructor(events) {
    this.events = events

    // MediaBunny instances
    this.input = null
    this.audioSink = null
    this.audioIterator = null

    // Web Audio API
    this.audioContext = null
    this.gainNode = null

    // Playback state
    this.audioContextStartTime = 0
    this.playbackTimeAtStart = 0
    this.latestScheduledEndTime = 0
    this.duration = Number.NaN
    this.paused = true

    // Audio settings
    this.volume = 0.7
    this.muted = false
    this.playbackRate = 1

    // Async control
    this.asyncId = 0
    this.queuedNodes = new Set()

    // 变速不变调拉伸器（跨 buffer 有状态、避免接缝爆音）
    this.stretcher = null
    // 拉伸输出起始位置在媒体时间轴上的锁定点（stretcher 活动期间使用）
    // 设为 null 表示尚未锁定（下一个输入 buffer 的 timestamp 会被用作起始点）
    this._stretchOriginTs = null
    // 拉伸输入的原始总时长累计（秒）—— 用来推算每个输出块的起始 timestamp
    this._stretchInputDur = 0
  }

  get currentTime() {
    if (this.paused || !this.audioContext) return this.playbackTimeAtStart

    return (
      (this.audioContext.currentTime - this.audioContextStartTime) *
        this.playbackRate +
      this.playbackTimeAtStart
    )
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

  ensureAudioContext(sampleRate) {
    if (this.audioContext) return

    const AudioContext = window.AudioContext || window.webkitAudioContext

    try {
      this.audioContext = new AudioContext({ sampleRate })
    } catch {
      this.audioContext = new AudioContext()
    }

    this.gainNode = this.audioContext.createGain()
    this.gainNode.connect(this.audioContext.destination)
    this.updateGain()
  }

  updateGain() {
    if (!this.gainNode) return
    const v = this.muted ? 0 : this.volume
    this.gainNode.gain.value = v * v
  }

  stopQueuedNodes() {
    this.queuedNodes.forEach((node) => {
      try {
        node.stop()
      } catch (_) {
        /* ignore */
      }
    })
    this.queuedNodes.clear()
  }

  async stopIterator() {
    await this.audioIterator?.return()
    this.audioIterator = null
  }

  async load(src, onMetadata) {
    const id = ++this.asyncId

    await this.stopIterator()
    this.stopQueuedNodes()
    // 加载新源前先重置 stretcher 状态（旧实例下面会被新 TimeStretcher 替换，
    // 但 flush 一下能避免 _stretchOriginTs 等残留状态影响新流程）
    this.stretcher?.flush()
    this._stretchOriginTs = null
    this._stretchInputDur = 0

    this.paused = true
    this.playbackTimeAtStart = 0
    this.audioContextStartTime = 0

    const source = this.normalizeSource(src)
    if (!source) return

    this.input = new Input({
      source,
      formats: ALL_FORMATS,
    })

    this.duration = await this.input.computeDuration()
    if (id !== this.asyncId) return

    const audioTrack = await this.input.getPrimaryAudioTrack()
    if (!audioTrack) {
      this.audioSink = null
      this.ensureAudioContext()
      onMetadata?.()
      return
    }

    if (audioTrack.codec === null || !(await audioTrack.canDecode())) {
      this.audioSink = null
      this.ensureAudioContext()
      onMetadata?.()
      return
    }

    this.ensureAudioContext(audioTrack.sampleRate)
    this.audioSink = new AudioBufferSink(audioTrack)

    // 创建 stretcher（带 sampleRate / channels 信息）
    this.stretcher = new TimeStretcher(
      this.audioContext,
      audioTrack.sampleRate,
      audioTrack.numberOfChannels || 2,
    )
    this.stretcher.setRate(this.playbackRate)
    this._stretchOriginTs = null
    this._stretchInputDur = 0

    onMetadata?.()
  }

  /**
   * 持续从 audio sink 拉 buffer 并 schedule 到 AudioContext。
   *
   * 重要变更：去除了原来在每次迭代都 new 一个 setInterval 的实现。
   *  - 不再主动调用 audioContext.suspend()。
   *  - starvation 检测交给 VideoEngine 的 RAF 侧 watchdog（监听 currentTime 是否前进）。
   *  - 当 audioContext.state 意外变为 suspended 时仍会 resume，但绝不主动 suspend。
   */
  async runIterator(localId) {
    if (!this.audioSink) return

    await this.stopIterator()
    this.audioIterator = this.audioSink.buffers(this.currentTime)

    while (true) {
      if (localId !== this.asyncId || this.paused) return

      let result
      try {
        result = await this.audioIterator.next()
      } catch (e) {
        console.error("Audio iterator error:", e)
        break
      }

      if (localId !== this.asyncId || this.paused) return

      // 若 audioContext 意外被 suspend（设备唤醒、用户切回前台），主动 resume
      if (this.audioContext.state === "suspended") {
        try {
          await this.audioContext.resume()
        } catch (_) {
          /* ignore */
        }
        this.events.emit("canplay")
        this.events.emit("playing")
      }

      if (result.done) break

      const { buffer, timestamp } = result.value

      // 变速不变调路径：
      //   - rate === 1：原路径不变，用 mediabunny 的 timestamp 调度 buffer
      //   - rate ≠ 1：推入 stretcher、用起始 timestamp 锁定拉伸输出的原点，
      //                后续输出块的 timestamp = origin + 已输入原始时长 / rate。
      //     这样跨 buffer 连续拼接，没有接缝。
      let nodeBuffer = null
      let nodeTimestamp = timestamp

      if (this.playbackRate === 1) {
        nodeBuffer = buffer
        nodeTimestamp = timestamp
      } else {
        // 锁定输出原点 timestamp（首个 buffer 进来时）
        if (this._stretchOriginTs === null) {
          this._stretchOriginTs = timestamp
          this._stretchInputDur = 0
        }
        // 处理：可能返回 null（累积不够）
        const out = this.stretcher.process(buffer)
        // 记录本轮输出在媒体时间轴上的起点（输入本轮之前累计的原始时长决定）
        const outStartMediaTs = this._stretchOriginTs + this._stretchInputDur
        // 累计本轮输入的原始时长
        this._stretchInputDur += buffer.duration

        if (!out) {
          // 数据不够，暂不调度，等下一个 buffer 累积
          continue
        }
        nodeBuffer = out
        nodeTimestamp = outStartMediaTs
      }

      // 调度音频 buffer
      const node = this.audioContext.createBufferSource()
      node.buffer = nodeBuffer
      node.connect(this.gainNode)
      // 变速不变调后用原速播放；playbackRate 不再带来 “尖锐化” 副作用
      node.playbackRate.value = 1

      // 在 audioContext 时间轴上的起始位置：
      //   nodeTimestamp 是原始媒体时间轴上的位置，进入该位置之后的实际 wall-clock = (nodeTimestamp - playbackTimeAtStart) / rate
      const startAt =
        this.audioContextStartTime +
        (nodeTimestamp - this.playbackTimeAtStart) / this.playbackRate

      // 拉伸后 buffer 以原速播放，wall-clock 时长 = nodeBuffer.duration
      const duration = nodeBuffer.duration
      const endAt = startAt + duration

      if (endAt > this.latestScheduledEndTime) {
        this.latestScheduledEndTime = endAt
      }

      try {
        if (startAt >= this.audioContext.currentTime) {
          node.start(startAt)
        } else {
          // 起始点已过：偶尔过期补丁，过期太多则丢弃
          const lateBy = this.audioContext.currentTime - startAt
          if (lateBy < duration) {
            // 拉伸后 buffer 以原速播放，offset 单位为拉伸后的秒数（不需乘 rate）
            node.start(this.audioContext.currentTime, lateBy)
          } else {
            // 过期太多，直接丢
            continue
          }
        }
      } catch (e) {
        console.warn("Audio buffer source start failed:", e)
        continue
      }

      this.queuedNodes.add(node)
      node.onended = () => this.queuedNodes.delete(node)

      // 节流：当已 schedule 的时间领先 currentTime 超过 2 秒时，让出主线程一会儿，
      // 避免一次性把所有 buffer 都灌进 audioContext（占用过多内存）。
      const ahead = this.latestScheduledEndTime - this.audioContext.currentTime
      if (ahead > 2.0) {
        // 简单 await 一个 setTimeout，0ms 也行——让 await 把控制权还给事件循环
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(500, (ahead - 1.5) * 1000)),
        )
      }
    }
  }

  async play() {
    if (!this.paused) return

    if (!this.audioContext) {
      this.ensureAudioContext()
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume()
    }

    this.audioContextStartTime = this.audioContext.currentTime
    this.latestScheduledEndTime = this.audioContextStartTime
    this.paused = false

    const id = ++this.asyncId
    this.runIterator(id)
  }

  pause() {
    if (this.paused) return

    this.playbackTimeAtStart = this.currentTime
    this.paused = true

    this.stopIterator()
    this.stopQueuedNodes()
    // 重置 stretcher 状态，避免 “恢复播放时用了之前的拉伸状态” 造成接缝不连续
    this.stretcher?.flush()
    this._stretchOriginTs = null
    this._stretchInputDur = 0
  }

  async seek(time) {
    this.playbackTimeAtStart = Math.max(0, time)
    if (this.audioContext) {
      this.audioContextStartTime = this.audioContext.currentTime
      this.latestScheduledEndTime = this.audioContextStartTime
    } else {
      this.audioContextStartTime = 0
      this.latestScheduledEndTime = 0
    }

    // seek 后原始媒体位置完全变了，stretcher 的跨 buffer 状态不再适用
    this.stretcher?.flush()
    this._stretchOriginTs = null
    this._stretchInputDur = 0

    const id = ++this.asyncId
    if (!this.paused) {
      this.runIterator(id)
    }
  }

  setVolume(volume, muted) {
    this.volume = volume
    this.muted = muted
    this.updateGain()
  }

  setPlaybackRate(rate) {
    if (rate === this.playbackRate) return

    if (!this.paused) {
      this.playbackTimeAtStart = this.currentTime
      this.audioContextStartTime = this.audioContext.currentTime
      this.latestScheduledEndTime = this.audioContextStartTime
      // 切换速率时，旧的 queuedNodes 仍以旧速率/旧拉伸结果在播，会和新调度的 buffer 叠加。
      // 立即停掉旧节点（runIterator 在下一轮 await 后才会真正退出，间隔期间会出现双轨叠加）
      this.stopQueuedNodes()
    }

    this.playbackRate = rate
    // 拉伸状态的 prevTailRef / prevTailSamples 在新速率下不再适用，重置
    this.stretcher?.setRate(rate)
    this.stretcher?.flush()
    this._stretchOriginTs = null
    this._stretchInputDur = 0

    if (!this.paused) {
      const id = ++this.asyncId
      this.runIterator(id)
    }
  }

  destroy() {
    this.asyncId++
    this.pause()
    try {
      this.audioContext?.close()
    } catch (_) {
      /* ignore */
    }
    this.audioContext = null
    this.input = null
    this.audioSink = null
    this.stretcher = null
  }
}
