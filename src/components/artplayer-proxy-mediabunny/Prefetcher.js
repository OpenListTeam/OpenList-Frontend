/**
 * Video Prefetcher
 * --------------------------------------------------------
 * 在播放器启动前先用 HTTP Range 请求把视频文件的前 N 个区块拉下来，
 * 让浏览器把这些字节放进 HTTP 缓存。这样 mediabunny 的 UrlSource
 * 后续以同样的 URL 发出 Range 请求时会命中缓存，立即拿到数据，
 * 大幅缩短"开播即解码"的等待。
 *
 * 设计要点：
 * 1. 使用与 mediabunny UrlSource 相同的 URL（不带新查询参数），保证
 *    HTTP 层缓存可以复用。
 * 2. 默认预取首部 8MB 数据（约可够 H.264 1080p 4Mbps 码率播放 16 秒）。
 *    支持自定义大小。
 * 3. 同一个 URL 的预取最多发一次，全局结果用 Map 缓存。
 * 4. 启动时间限制 3 秒，避免慢网时阻塞播放器初始化。
 * 5. AbortController 支持销毁时取消。
 */

const _inflight = new Map() // url -> Promise<{ ok: boolean }>

/**
 * 预下载指定 URL 的前 byteRange 字节
 * @param {string} url
 * @param {Object} [opts]
 * @param {number} [opts.byteRange=8388608] - 预取的字节数（默认 8MB）
 * @param {number} [opts.timeoutMs=3000]    - 超时上限（默认 3s）
 * @returns {Promise<{ok: boolean, status?: number, bytes?: number, fromCache?: boolean}>}
 */
export function prefetchVideoChunks(url, opts = {}) {
  if (!url || typeof url !== "string") {
    return Promise.resolve({ ok: false })
  }
  if (_inflight.has(url)) return _inflight.get(url)

  const byteRange = Math.max(64 * 1024, opts.byteRange ?? 8 * 1024 * 1024)
  const timeoutMs = Math.max(500, opts.timeoutMs ?? 3000)

  const controller = new AbortController()
  const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs)

  const p = (async () => {
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          // 显式 Range 请求，对支持的服务端会得到 206 Partial Content
          // 不支持的服务端会回 200 + 全文，那也不算坏 —— 浏览器仍会缓存
          Range: `bytes=0-${byteRange - 1}`,
        },
        // 与 mediabunny 默认 fetch 相同的 cache 模式，保证 HTTP 缓存键一致
        cache: "default",
        credentials: "same-origin",
        signal: controller.signal,
      })

      if (resp.status === 200) {
        // 服务端忽略了 Range，返回的是整个文件。继续读下去会把几 GB 的
        // 数据全部灌进缓存/带宽，而且会拖慢真正的开播，直接放弃这次预取。
        try {
          await resp.body?.cancel()
        } catch (_) {
          /* ignore */
        }
        return { ok: false, status: 200, reason: "range-ignored" }
      }
      if (!resp.ok) {
        // 鉴权失败 / 404 等
        return { ok: false, status: resp.status }
      }

      // 必须把 body 完整读出来才会真正落到浏览器 HTTP 缓存
      // （仅响应头不会触发缓存写入）。
      // 加一道字节上限兜底：服务端声称 206 但实际回更多数据时也不会无限读。
      const reader = resp.body?.getReader()
      let total = 0
      const cap = byteRange * 2
      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          total += value?.byteLength ?? 0
          if (total > cap) {
            try {
              await reader.cancel()
            } catch (_) {
              /* ignore */
            }
            break
          }
        }
      }

      return {
        ok: true,
        status: resp.status,
        bytes: total,
        fromCache: resp.headers.get("x-cache") === "HIT",
      }
    } catch (err) {
      // AbortError（超时）和网络错误都按 ok=false 处理，但不阻塞主流程
      return { ok: false, error: err?.name || String(err) }
    } finally {
      clearTimeout(timeoutTimer)
    }
  })()

  _inflight.set(url, p)
  // 60 秒后清掉缓存项（避免长时间累积）
  p.finally(() => {
    const timer = setTimeout(() => _inflight.delete(url), 60_000)
    // Node（单元测试）下 unref，避免这个纯粹的清理定时器把进程挂住 60 秒；
    // 浏览器里 setTimeout 返回 number，没有 unref 方法，跳过即可。
    if (typeof timer?.unref === "function") timer.unref()
  })

  return p
}

/** 清除某个 URL 的预取记录（不再阻止重新预取） */
export function forgetPrefetch(url) {
  _inflight.delete(url)
}

/** 批量预取多个 URL */
export function prefetchAll(urls, opts) {
  return Promise.all(urls.map((u) => prefetchVideoChunks(u, opts)))
}
