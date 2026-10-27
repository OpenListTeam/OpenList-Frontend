import type Artplayer from "artplayer"

interface Option {
  /**
   * Timeout for loading media in milliseconds
   * @default 0
   */
  loadTimeout?: number

  /**
   * Interval for timeupdate events in milliseconds
   * @default 250
   */
  timeupdateInterval?: number

  /**
   * Audio-video synchronization tolerance in seconds
   * @default 0.12
   */
  avSyncTolerance?: number

  /**
   * Whether to drop late video frames
   * @default false
   */
  dropLateFrames?: boolean

  /**
   * Poster image URL
   */
  poster?: string

  /**
   * Media source (URL, Blob, or ReadableStream)
   */
  source?: string | Blob | ReadableStream<Uint8Array>

  /**
   * Check if server supports range requests before loading
   * @default false
   */
  preflightRange?: boolean

  /**
   * Disable video decoding entirely (audio-only mode).
   * When true, VideoEngine 不会尝试初始化/解码视频轨道，canvas 仅显示 poster。
   * 适用于规避部分有问题的视频轨道导致的解码崩溃。
   * @default false
   */
  disableVideo?: boolean

  /**
   * 视频与音频时间漂移超过该秒数时，主动重置解码器迭代器到当前音频位置（快进追赶）。
   * 用于解决持续解码卡顿场景下的画面长时间落后问题。
   * @default 1.5
   */
  resyncThreshold?: number

  /**
   * 视频帧 lookahead 队列长度：缓冲多少已解码 VideoSample 等待呈现。
   * 值越大可以越好地吸收瞬时主线程卡顿，但占用更多 GPU/CPU 资源。
   * 建议范围 1~8。
   * @default 3
   */
  lookaheadFrames?: number

  /**
   * @deprecated 旧参数名，已被 lookaheadFrames 取代（仍兼容）。
   */
  poolSize?: number

  /**
   * 是否启用硬件加速解码（注册自定义解码器，配置 hardwareAcceleration: 'prefer-hardware'）。
   * 启用后视频解码会优先走 GPU 路径，显著降低 CPU 占用。某些不支持硬件加速的 codec 配置会自动回退。
   * @default true
   */
  hardwareAcceleration?: boolean

  /**
   * 是否启用启动预取：在 mediabunny 真正初始化解码器之前先用 HTTP Range
   * 请求把视频文件的前几个区块拉到浏览器 HTTP 缓存。
   * @default true
   */
  prefetchEnabled?: boolean

  /**
   * 启动预取的字节数。默认 8MB（通常足够 1080p H.264 4Mbps 码率播放约 16 秒）。
   * @default 8388608
   */
  prefetchBytes?: number

  /**
   * 启动预取的超时上限，避免慢网阻塞播放器初始化。
   * @default 3000
   */
  prefetchTimeoutMs?: number

  /**
   * 启用调试日志：硬件解码器降级、解码错误等会输出到控制台。
   * 也可以在控制台执行 `localStorage.setItem('mediabunny_debug', '1')` 持久启用。
   * @default false
   */
  debug?: boolean

  /**
   * Initial volume (0-1)
   * @default 0.7
   */
  volume?: number

  /**
   * Initial muted state
   * @default false
   */
  muted?: boolean

  /**
   * Autoplay
   * @default false
   */
  autoplay?: boolean

  /**
   * Loop playback
   * @default false
   */
  loop?: boolean

  /**
   * Cross-origin setting
   */
  crossOrigin?: string
}

type Result = HTMLCanvasElement

declare const artplayerProxyMediabunny: (
  option?: Option,
) => (art: Artplayer) => Result

export default artplayerProxyMediabunny
