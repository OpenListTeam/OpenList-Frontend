/**
 * 预下载视频文件的前 N 个区块，让浏览器把这些字节放到 HTTP 缓存。
 * 后续 mediabunny / 原生 video 请求同一 URL 时会命中缓存，加速起播。
 */
export interface PrefetchOptions {
  /** 预取的字节数，默认 8MB（最少 64KB） */
  byteRange?: number
  /** 超时上限（毫秒），默认 3000 */
  timeoutMs?: number
}

export interface PrefetchResult {
  ok: boolean
  status?: number
  bytes?: number
  fromCache?: boolean
  error?: string
}

export declare function prefetchVideoChunks(
  url: string,
  opts?: PrefetchOptions,
): Promise<PrefetchResult>

export declare function forgetPrefetch(url: string): void

export declare function prefetchAll(
  urls: string[],
  opts?: PrefetchOptions,
): Promise<PrefetchResult[]>
