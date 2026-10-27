import test, { afterEach } from "node:test"
import assert from "node:assert/strict"
import {
  prefetchVideoChunks,
  prefetchAll,
  forgetPrefetch,
} from "./Prefetcher.js"

const originalFetch = globalThis.fetch

const fakeResponse = (status, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  body: null,
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("非字符串 url 直接返回 ok:false 且不发起请求", async () => {
  let called = 0
  globalThis.fetch = async () => {
    called++
    return fakeResponse(206)
  }
  assert.deepEqual(await prefetchVideoChunks(undefined), { ok: false })
  assert.equal(called, 0)
})

test("发出带 Range 的 GET 请求", async () => {
  const urls = []
  const ranges = []
  globalThis.fetch = async (url, init) => {
    urls.push(url)
    ranges.push(init.headers.Range)
    return fakeResponse(206)
  }
  const url = "https://example.test/a.mp4?range-probe"
  forgetPrefetch(url)
  const res = await prefetchVideoChunks(url, { byteRange: 1024 * 1024 })
  assert.equal(urls[0], url)
  assert.equal(ranges[0], `bytes=0-${1024 * 1024 - 1}`)
  assert.equal(res.ok, true)
  assert.equal(res.status, 206)
})

test("同一 url 的并发预取只发一次请求", async () => {
  let called = 0
  globalThis.fetch = async () => {
    called++
    return fakeResponse(206)
  }
  const url = "https://example.test/b.mp4"
  forgetPrefetch(url)
  const [a, b] = await Promise.all([
    prefetchVideoChunks(url),
    prefetchVideoChunks(url),
  ])
  assert.equal(called, 1)
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
})

test("服务端返回 404 时 ok:false 并带上状态码", async () => {
  globalThis.fetch = async () => fakeResponse(404)
  const url = "https://example.test/c.mp4"
  forgetPrefetch(url)
  const res = await prefetchVideoChunks(url)
  assert.equal(res.ok, false)
  assert.equal(res.status, 404)
})

test("网络异常被吞掉，返回 ok:false 与错误名", async () => {
  globalThis.fetch = async () => {
    const err = new Error("aborted")
    err.name = "AbortError"
    throw err
  }
  const url = "https://example.test/d.mp4"
  forgetPrefetch(url)
  const res = await prefetchVideoChunks(url)
  assert.equal(res.ok, false)
  assert.equal(res.error, "AbortError")
})

test("forgetPrefetch 之后可以重新预取", async () => {
  let called = 0
  globalThis.fetch = async () => {
    called++
    return fakeResponse(206)
  }
  const url = "https://example.test/e.mp4"
  forgetPrefetch(url)
  await prefetchVideoChunks(url)
  await prefetchVideoChunks(url)
  assert.equal(called, 1)
  forgetPrefetch(url)
  await prefetchVideoChunks(url)
  assert.equal(called, 2)
})

test("prefetchAll 批量返回每条结果", async () => {
  globalThis.fetch = async (url) =>
    fakeResponse(String(url).includes("ok") ? 206 : 500)
  const urls = ["https://example.test/ok-1.mp4", "https://example.test/bad.mp4"]
  urls.forEach(forgetPrefetch)
  const results = await prefetchAll(urls)
  assert.equal(results.length, 2)
  assert.equal(results[0].ok, true)
  assert.equal(results[1].ok, false)
})
