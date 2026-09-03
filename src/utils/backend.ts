/**
 * Backend-mode detection: a single frontend codebase that works with both the
 * Go OpenList backend and the OpenListNext (TSWorker / Cloudflare Workers) backend.
 *
 * Detection source (priority high -> low):
 *  1. `backend` field returned by `/api/public/settings`:
 *     - The TS backend returns `"ts-worker"`.
 *     - The Go backend does not return this field, so it defaults to `"go"`.
 *
 * Usage:
 *   import { isTsWorker, isGo } from "~/utils/backend"
 *   if (isTsWorker()) { /* TS-only capability *\/ }
 */

export type BackendKind = "go" | "ts-worker"

let backend: BackendKind = "go"

/** Called by setSettings() after fetching /public/settings. */
export const setBackendKind = (kind: BackendKind | string | undefined): void => {
  if (kind === "ts-worker") {
    backend = "ts-worker"
  } else {
    // Unknown or missing value defaults to "go" (Go backend never returns it).
    backend = "go"
  }
}

export const getBackendKind = (): BackendKind => backend

/** True when connected to the OpenListNext (TSWorker / Workers) Hono backend. */
export const isTsWorker = (): boolean => backend === "ts-worker"

/** True when connected to the Go OpenList backend. */
export const isGo = (): boolean => backend === "go"
