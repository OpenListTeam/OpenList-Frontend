/**
 * MediaBunny Audio Patch
 * --------------------------------------------------------
 * 与 proxy 模式不同：本模块**不接管** <video>，而是作为独立的
 * “音频补丁器”运行在原生 video 元素旁边：
 *   - <video> 由浏览器原生解码视频画面（流畅、有 GPU 加速）
 *   - mediabunny 单独解码该 URL 的音轨，通过 Web Audio API 输出
 *   - <video> 被静音，音频权完全交给 mediabunny
 *   - 同步：监听 video 的 play/pause/seeking/seeked/ratechange/volumechange，
 *     驱动 AudioEngine；周期性校正漂移
 *
 * 适用场景：浏览器视频解码正常但音轨不支持（如 AC3）的场景。
 */
import EventTarget from "./EventTarget.js"
import AudioEngine from "./AudioEngine.js"
import { prefetchVideoChunks } from "./Prefetcher.js"

class FakeEvents {
  constructor() {
    this._t = new EventTarget()
  }
  addEventListener(type, fn) {
    this._t.addEventListener(type, fn)
  }
  removeEventListener(type, fn) {
    this._t.removeEventListener(type, fn)
  }
  emit(type, payload) {
    this._t.emit(type, payload)
  }
}

export default class MediaBunnyAudioPatch {
  /**
   * @param {Object} opts
   * @param {HTMLMediaElement} opts.video  - 原生 video 元素
   * @param {string} opts.src              - 媒体 URL（与 video.src 相同）
   * @param {number} [opts.driftThreshold=0.25] - 漂移超过该值则重新 seek 音频对齐
   * @param {(err:Error)=>void} [opts.onError]  - 加载或解码失败回调
   */
  constructor({ video, src, driftThreshold = 0.25, onError } = {}) {
    if (!video) throw new Error("AudioPatch: video element is required")
    this.video = video
    this.src = src
    this.driftThreshold = driftThreshold
    this.onError = onError

    this.events = new FakeEvents()
    this.audio = new AudioEngine(this.events)

    this._destroyed = false
    this._loaded = false
    this._driftTimer = 0
    this._wasMutedBeforePatch = !!video.muted
    this._prevVolume = video.volume
    // 用户意图的静音状态：与「本补丁把原生 video 静音」区分开。
    // ArtPlayer 的静音按钮 / 音量 UI 都读写 video.muted，
    // 所以下面会把该实例属性改造成「用户意图」，真实静音始终由原生元素承担。
    this._userMuted = this._wasMutedBeforePatch
    // 忽略「本补丁自己写入真实 muted」所触发的那次 volumechange
    this._suppressVolumeChange = false
    // 原生 muted 的真实读写通道（覆盖实例属性后仍然需要它）
    this._nativeMutedDesc =
      typeof HTMLMediaElement !== "undefined"
        ? Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "muted")
        : null

    // 先把原生 video 真正静音（音频改由 mediabunny 输出），再把 video.muted 暴露成用户意图
    this._applyNativeMute(true)
    this._patchMutedProperty()

    this._bind()
    this._load()
  }

  /** 读写原生元素真实的 muted（绕开被覆盖的实例属性） */
  _applyNativeMute(muted) {
    try {
      if (this._nativeMutedDesc) {
        if (this._nativeMutedDesc.get.call(this.video) === muted) return
        this._suppressVolumeChange = true
        this._nativeMutedDesc.set.call(this.video, muted)
      } else {
        if (this.video.muted === muted) return
        this._suppressVolumeChange = true
        this.video.muted = muted
      }
    } catch (_) {
      this._suppressVolumeChange = false
    }
  }

  /**
   * 把 video.muted 覆盖成「用户是否静音」。
   * 不覆盖的话它恒为 true（原生被强制静音），ArtPlayer 的音量 UI 会一直显示 0/静音，
   * 拖动音量条看起来毫无反应。属性是实例级、可配置的，destroy 时删掉即可还原。
   */
  _patchMutedProperty() {
    try {
      Object.defineProperty(this.video, "muted", {
        configurable: true,
        get: () => this._userMuted,
        set: (v) => this.setUserMuted(v),
      })
    } catch (_) {
      // 覆盖失败时退回「始终静音」，至少不影响播放
    }
  }

  /** 设置用户静音意图（ArtPlayer 的静音按钮会走到这里） */
  setUserMuted(muted) {
    this._userMuted = !!muted
    this._syncVolume()
  }

  /** 把当前音量与静音意图同步给 mediabunny 音频引擎 */
  _syncVolume() {
    this._prevVolume = this.video.volume
    // 音量为 0 同样视为静音（用户可能直接拖到 0）
    this.audio.setVolume(
      this._prevVolume,
      this._userMuted || this._prevVolume === 0,
    )
  }

  _bind() {
    const v = this.video
    this._handlers = {
      play: () => this._onPlay(),
      pause: () => this._onPause(),
      seeking: () => this._onSeeking(),
      seeked: () => this._onSeeked(),
      ratechange: () => this._onRateChange(),
      volumechange: () => this._onVolumeChange(),
      ended: () => this._onEnded(),
      emptied: () => this._onEmptied(),
    }
    for (const [k, fn] of Object.entries(this._handlers)) {
      v.addEventListener(k, fn)
    }
    // 初始音量同步（video 已被静音，所以从 video 端读取的 volume 仍可作为目标音量）
    this._syncVolume()
    this.audio.setPlaybackRate(v.playbackRate || 1)
  }

  async _load() {
    if (!this.src) return
    try {
      // 预下载几个区块：让 mediabunny 后续的 Range 请求命中浏览器 HTTP 缓存，
      // 减少“刚点播放 → 音频几秒后才出”的延迟。
      // 例如 audio_only 模式下 video 都在加载了，走原生缓存能避免重复请求。
      try {
        await prefetchVideoChunks(this.src, {
          byteRange: 4 * 1024 * 1024, // 4MB 对音轨已足够
          timeoutMs: 2500,
        })
      } catch (_) {
        /* 不阻止主流程 */
      }
      if (this._destroyed) return

      await this.audio.load(this.src)
      if (this._destroyed) return
      this._loaded = true
      // 起始位置对齐
      const t = this.video.currentTime || 0
      await this.audio.seek(t)
      // 如果加载完成时 video 已经在播放，立刻 play
      if (!this.video.paused) {
        await this.audio.play()
        this._startDriftCorrection()
      }
    } catch (err) {
      console.warn("[MediaBunny AudioPatch] 音频加载失败:", err)
      this.onError?.(err)
    }
  }

  async _onPlay() {
    if (!this._loaded) return
    // 同步到当前 video 位置后播放
    const drift = Math.abs(this.audio.currentTime - this.video.currentTime)
    if (drift > this.driftThreshold) {
      await this.audio.seek(this.video.currentTime)
    }
    await this.audio.play()
    this._startDriftCorrection()
  }

  _onPause() {
    this.audio.pause()
    this._stopDriftCorrection()
  }

  async _onSeeking() {
    // seeking 阶段 video 时间还没稳定，先暂停音频避免错位输出
    this.audio.pause()
  }

  async _onSeeked() {
    if (!this._loaded) return
    await this.audio.seek(this.video.currentTime)
    if (!this.video.paused) {
      await this.audio.play()
      this._startDriftCorrection()
    }
  }

  _onRateChange() {
    this.audio.setPlaybackRate(this.video.playbackRate || 1)
  }

  _onVolumeChange() {
    // 本补丁自己写真实 muted 触发的事件：用户意图没变，忽略
    if (this._suppressVolumeChange) {
      this._suppressVolumeChange = false
      return
    }
    // 拖动音量条（>0）视为取消静音，与主流播放器一致；
    // 静音按钮走 setUserMuted，不会再被这里覆盖回静音
    if (this.video.volume > 0) this._userMuted = false
    this._syncVolume()
  }

  _onEnded() {
    this.audio.pause()
    this._stopDriftCorrection()
  }

  _onEmptied() {
    // src 被清空（destroy 流程），停止音频
    this.audio.pause()
    this._stopDriftCorrection()
  }

  _startDriftCorrection() {
    this._stopDriftCorrection()
    // 每 1s 校正一次：如果音频与 video 的时间漂移超过阈值，则重新 seek 对齐
    this._driftTimer = window.setInterval(async () => {
      if (this._destroyed || this.video.paused) return
      const vt = this.video.currentTime
      const at = this.audio.currentTime
      if (Number.isFinite(vt) && Number.isFinite(at)) {
        const drift = Math.abs(at - vt)
        if (drift > this.driftThreshold) {
          try {
            await this.audio.seek(vt)
          } catch (_) {
            /* ignore */
          }
        }
      }
    }, 1000)
  }

  _stopDriftCorrection() {
    if (this._driftTimer) {
      window.clearInterval(this._driftTimer)
      this._driftTimer = 0
    }
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    this._stopDriftCorrection()
    if (this.video && this._handlers) {
      for (const [k, fn] of Object.entries(this._handlers)) {
        this.video.removeEventListener(k, fn)
      }
    }
    try {
      this.audio.destroy()
    } catch (_) {
      /* ignore */
    }
    // 先删掉覆盖的实例属性，再恢复补丁前的真实静音状态
    try {
      delete this.video.muted
    } catch (_) {
      /* ignore */
    }
    this._applyNativeMute(this._wasMutedBeforePatch)
  }
}

/**
 * 便捷工厂：在 Artplayer 完成 url 装载后给它打上音频补丁
 * @param {Artplayer} art
 * @param {string} src
 * @param {Object} [opts]
 * @returns {MediaBunnyAudioPatch}
 */
export function attachMediabunnyAudio(art, src, opts = {}) {
  if (!art || !art.video) {
    throw new Error("attachMediabunnyAudio: invalid artplayer instance")
  }
  const patch = new MediaBunnyAudioPatch({
    video: art.video,
    src,
    ...opts,
  })
  art.on("destroy", () => patch.destroy())
  // 兼容 artplayer 切换 url 的场景：销毁旧 patch
  art.on("url", () => patch.destroy())
  return patch
}
