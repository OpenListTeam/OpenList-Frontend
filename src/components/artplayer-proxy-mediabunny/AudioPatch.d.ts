import type Artplayer from "artplayer"

export interface MediaBunnyAudioPatchOptions {
  video: HTMLMediaElement
  src: string
  /** 漂移超过该值则重新 seek 音频对齐，默认 0.25 秒 */
  driftThreshold?: number
  /** 加载或解码失败回调 */
  onError?: (err: Error) => void
}

export default class MediaBunnyAudioPatch {
  constructor(opts: MediaBunnyAudioPatchOptions)
  destroy(): void
}

/**
 * 便捷工厂：在 Artplayer 完成 url 装载后给它打上音频补丁
 */
export function attachMediabunnyAudio(
  art: Artplayer,
  src: string,
  opts?: Partial<Omit<MediaBunnyAudioPatchOptions, "video" | "src">>,
): MediaBunnyAudioPatch
