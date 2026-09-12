/**
 * Backend-mode detection: a single frontend codebase that works with both the
 * Go OpenList backend and the OpenListNext (TSWorker / Cloudflare Workers) backend.
 *
 * Detection source (priority high -> low):
 *  1. `backend` field returned by `/api/public/settings`:
 *     - The TS backend returns `"ts-worker"`.
 *     - The Go backend does not return this field, so it defaults to `"go"`.
 *  2. Explicit override via `markTsWorker()` when a TS-only response is observed
 *     before settings could be fetched (see below).
 *
 * Usage:
 *   import { isTsWorker, isGo } from "~/utils/backend"
 *   if (isTsWorker()) { /* TS-only capability *\/ }
 */

export type BackendKind = "go" | "ts-worker"

let backend: BackendKind = "go"

/** Called by setSettings() after fetching /public/settings. */
export const setBackendKind = (
  kind: BackendKind | string | undefined,
): void => {
  // Only "ts-worker" is ever sent; anything else (including the Go backend,
  // which omits the field) means Go.
  backend = kind === "ts-worker" ? "ts-worker" : "go"
}

/**
 * 在拿不到 /public/settings 时标记为 TS Worker 后端。
 *
 * 背景：存储未绑定时后端对所有接口返回 503，/public/settings 也拿不到，
 * backend 会停留在默认的 "go"，导致前端误判为 Go 后端并跳过环境自检——
 * 而这恰恰是最需要自检的场景。该错误码由 TS Worker 中间件产生，Go 后端
 * 不会返回，故可安全反推。
 */
export const markTsWorker = (): void => {
  backend = "ts-worker"
}

export const getBackendKind = (): BackendKind => backend

/** True when connected to the OpenListNext (TSWorker / Workers) Hono backend. */
export const isTsWorker = (): boolean => backend === "ts-worker"

/** True when connected to the Go OpenList backend. */
export const isGo = (): boolean => backend === "go"
