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

/**
 * 后端类型是否已被明确判定。
 *
 * 背景：`/public/settings` 是唯一的常规判定来源，但它可能失败——最典型的是
 * 存储未配置时后端对几乎所有接口返回 503。此时 `setBackendKind` 不会被调用，
 * `backend` 停留在默认值 `"go"`，`isTsWorker()` 返回 false，前端会**误判为
 * Go 后端**，进而跳过环境自检（`env_check`）等 TS Worker 专属逻辑——而这恰恰
 * 是最需要自检的场景。
 *
 * 该标志用于区分「已确认的后端类型」与「请求失败后的默认值兜底」，让调用方
 * 在类型未确认时能做出更保守的决策。
 */
let backendResolved = false

/** Called by setSettings() after fetching /public/settings. */
export const setBackendKind = (
  kind: BackendKind | string | undefined,
): void => {
  if (kind === "ts-worker") {
    backend = "ts-worker"
  } else {
    // Unknown or missing value defaults to "go" (Go backend never returns it).
    backend = "go"
  }
  backendResolved = true
}

/**
 * 明确标记为 TS Worker 后端。
 *
 * 用于「观测到 TS Worker 独占的响应特征」却拿不到 /public/settings 的场景。
 * 目前唯一的调用点是 App 收到 503 + STORAGE_CONFIG_ERROR：该错误码由 TS Worker
 * 的全局中间件产生，Go 后端不会返回，因此可安全反推后端类型。
 *
 * 与 setBackendKind 的区别：这是基于间接证据的推断，一旦被 /public/settings
 * 明确判定就会被覆盖（正常路径优先）。
 */
export const markTsWorker = (): void => {
  if (backendResolved) return
  backend = "ts-worker"
}

export const getBackendKind = (): BackendKind => backend

/** 后端类型是否已被明确判定（而非失败后停留在默认值） */
export const isBackendResolved = (): boolean => backendResolved

/** True when connected to the OpenListNext (TSWorker / Workers) Hono backend. */
export const isTsWorker = (): boolean => backend === "ts-worker"

/** True when connected to the Go OpenList backend. */
export const isGo = (): boolean => backend === "go"
