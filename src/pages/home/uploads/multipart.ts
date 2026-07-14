import { getSettingNumber, password } from "~/store"
import { Resp } from "~/types"
import { r } from "~/utils"
import { SetUpload, Upload } from "./types"
import { calculateHash } from "./util"
import { StreamUpload } from "./stream"

type MultipartState =
  | "receiving"
  | "completed"
  | "failed_retriable"
  | "failed_permanent"
  | "aborted"

interface MultipartSnapshot {
  upload_id: string
  state: MultipartState
  attempt: number
  path: string
  size: number
  chunk_size: number
  total_chunks: number
  received: [number, number][]
  received_bytes: number
  frontier: number
  storage_progress: number
  error?: string
}

type SnapResp = Resp<MultipartSnapshot>
type InitResp = Resp<MultipartSnapshot & { resumed: boolean }>

// concurrent chunk requests; the server-side window holds 8 chunks, so 3
// in-flight ascending uploads virtually never hit flow control
const INFLIGHT = 3
// flow control (429 / server window full) is not failure: the server already
// parks each chunk request for up to ~10s waiting for a slot, so retries here
// only happen when the storage uplink is genuinely slower than the client —
// be patient rather than declaring a large upload dead
const MAX_FLOW_RETRIES = 400

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// request.ts's error interceptor RESOLVES transport failures into a bare
// {code, message}: no numeric code for a network error, the HTTP status for a
// CDN-level failure, -1 for a cancellation. A genuine server envelope is
// always HTTP 200 and always carries a `data` key, so anything else is a
// transport-layer failure — returned as undefined for the caller to retry or
// probe, never to be mistaken for a server verdict.
const mpRequest = async <T extends Resp<unknown>>(
  req: Promise<unknown>,
): Promise<T | undefined> => {
  let resp: any
  try {
    resp = await req
  } catch (_) {
    return undefined
  }
  if (resp && typeof resp.code === "number" && "data" in resp) {
    return resp as T
  }
  if (resp?.code === -1) {
    throw new Error(resp.message || "canceled")
  }
  return undefined
}

export const MultipartUpload: Upload = async (
  uploadPath: string,
  file: File,
  setUpload: SetUpload,
  _asTask = false, // sessions are synchronous pipelines; As-Task does not apply
  overwrite = false,
  rapid = false,
): Promise<Error | undefined> => {
  // a single-chunk multipart upload costs 3 requests where Stream costs 1,
  // and small files pass CDN body limits anyway — silently fall back
  const fallbackThreshold =
    Math.max(1, getSettingNumber("multipart_chunk_size", 10)) * 1024 * 1024
  if (file.size <= fallbackThreshold) {
    return StreamUpload(uploadPath, file, setUpload, false, overwrite, rapid)
  }

  const initHeaders: Record<string, string | number> = {
    "File-Path": encodeURIComponent(uploadPath),
    "X-File-Size": file.size,
    // suggest slicing by the same size the fallback decision was made with;
    // the server clamps to [1MB, admin ceiling] and echoes chunk_size back
    "X-Chunk-Size": fallbackThreshold,
    "Content-Type": file.type || "application/octet-stream",
    "Last-Modified": file.lastModified,
    Password: password(),
    Overwrite: overwrite.toString(),
  }
  if (rapid) {
    setUpload("status", "hashing")
    const { md5, sha1, sha256 } = await calculateHash(file, (p) => {
      setUpload("progress", p | 0)
    })
    initHeaders["X-File-Md5"] = md5
    initHeaders["X-File-Sha1"] = sha1
    initHeaders["X-File-Sha256"] = sha256
  }

  setUpload("status", "uploading")
  setUpload("progress", 0)
  // init resumes an interrupted session of the same path+size transparently:
  // `received` tells us which chunks to skip; a failed_retriable session
  // reports nothing received and re-sending from chunk 0 re-fills it.
  // init is idempotent thanks to the resume semantics, so a transient network
  // failure is safe to retry instead of failing the whole upload.
  let initResp: InitResp | undefined
  for (let i = 0; ; i++) {
    initResp = await mpRequest<InitResp>(
      r.post("/fs/multipart/init", undefined, { headers: initHeaders }),
    )
    if (initResp) break
    if (i >= 2) throw new Error("multipart init failed: network error")
    await sleep(1000 * (i + 1))
  }
  if (initResp!.code !== 200) {
    throw new Error(initResp!.message)
  }
  const session = initResp!.data
  const uploadId = session.upload_id
  const chunkSize = session.chunk_size
  const total = session.total_chunks
  const chunkLen = (idx: number) =>
    idx === total - 1 ? file.size - idx * chunkSize : chunkSize

  if (session.state === "completed") {
    // rapid upload finished before we sent a single chunk
    setUpload("progress", 100)
    return
  }
  const have = new Set<number>()
  for (const [lo, hi] of session.received ?? []) {
    for (let i = lo; i <= hi; i++) have.add(i)
  }
  const missing: number[] = []
  for (let i = 0; i < total; i++) {
    if (!have.has(i)) missing.push(i)
  }

  let ackedBytes = session.received_bytes ?? 0
  const inflightLoaded: Record<number, number> = {}
  // a rejected chunk (flow control, network hiccup) drops its in-flight bytes
  // from the sum until it is resent; report the high-water mark so progress
  // plateaus instead of jumping backwards and speed can never go negative
  let peakDone = ackedBytes
  let lastTime = Date.now()
  let lastBytes = ackedBytes
  const report = () => {
    let inflight = 0
    for (const v of Object.values(inflightLoaded)) inflight += v
    peakDone = Math.max(peakDone, Math.min(ackedBytes + inflight, file.size))
    setUpload("progress", ((peakDone / file.size) * 100) | 0)
    const now = Date.now()
    if (now - lastTime >= 1000) {
      setUpload("speed", ((peakDone - lastBytes) / (now - lastTime)) * 1000)
      lastTime = now
      lastBytes = peakDone
    }
  }

  let completedEarly = false // rapid upload finished the session server-side
  let fatal: Error | undefined

  const sendChunk = async (idx: number) => {
    const blob = file.slice(idx * chunkSize, idx * chunkSize + chunkLen(idx))
    let flowRetries = 0
    for (;;) {
      if (completedEarly || fatal) return
      // a transport failure (network hiccup, CDN-level rejection) yields
      // undefined — the probe below decides between resending and giving up
      const resp = await mpRequest<SnapResp>(
        r.put("/fs/multipart/chunk", blob, {
          headers: {
            "X-Upload-Id": uploadId,
            "X-Chunk-Index": idx,
            "Content-Type": "application/octet-stream",
          },
          onUploadProgress: (e: any) => {
            inflightLoaded[idx] = e.loaded ?? 0
            report()
          },
        }),
      )
      delete inflightLoaded[idx]
      if (resp && resp.code === 200) {
        ackedBytes += chunkLen(idx)
        if (resp.data?.state === "completed") {
          completedEarly = true
        }
        report()
        return
      }
      if (resp && resp.code !== 429 && resp.code !== 409) {
        throw new Error(resp.message)
      }
      if (!resp) {
        // a rapid upload may have completed the session while this chunk was
        // mid-flight; the early server response surfaces as a network error —
        // ask the session before assuming the network actually failed
        const st = await mpRequest<SnapResp>(
          r.get(`/fs/multipart/status?upload_id=${uploadId}`),
        )
        if (
          (st?.code === 200 && st.data.state === "completed") ||
          st?.code === 404 // completed sessions are reaped after success
        ) {
          completedEarly = true
          return
        }
        if (st?.code === 200 && st.data.state.startsWith("failed")) {
          throw new Error(st.data.error || `upload failed (${st.data.state})`)
        }
      }
      flowRetries++
      if (flowRetries > MAX_FLOW_RETRIES) {
        throw new Error(`chunk ${idx} stalled: the storage cannot keep up`)
      }
      await sleep(resp ? 800 : Math.min(1200 * flowRetries, 4800))
    }
  }

  // refill protocol: a failed_retriable session restarts only when chunk 0
  // arrives, so send it alone first — concurrent siblings would race the
  // respawn and be rejected
  let startFrom = 0
  if (session.state === "failed_retriable" && missing.length > 0) {
    await sendChunk(missing[0])
    startFrom = 1
  }

  // ascending order keeps the server window flowing without back-pressure
  let nextIdx = startFrom
  const worker = async () => {
    for (;;) {
      if (completedEarly || fatal) return
      const i = nextIdx++
      if (i >= missing.length) return
      try {
        await sendChunk(missing[i])
      } catch (e: any) {
        fatal = e instanceof Error ? e : new Error(String(e))
        return
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(INFLIGHT, missing.length) || 1 }, worker),
  )
  if (fatal) {
    throw fatal
  }

  // every chunk is on the server; the driver is still writing to the storage
  setUpload("status", "backending")
  setUpload("speed", 0)
  let settled = false
  // a CDN-cut connection resolves to undefined and the polling below takes
  // over; the catch is defensive — mpRequest throws only on cancellation
  const completePromise: Promise<SnapResp | undefined> = mpRequest<SnapResp>(
    r.post("/fs/multipart/complete", undefined, {
      headers: { "X-Upload-Id": uploadId },
    }),
  )
    .catch(() => undefined)
    .finally(() => {
      settled = true
    })

  while (!settled) {
    await sleep(2000)
    if (settled) break
    const st = await mpRequest<SnapResp>(
      r.get(`/fs/multipart/status?upload_id=${uploadId}`),
    )
    if (st?.code === 200 && st.data.state === "receiving") {
      setUpload("progress", st.data.storage_progress | 0)
    }
  }
  const fin = await completePromise
  if (fin) {
    if (fin.code !== 200) {
      throw new Error(fin.message)
    }
    setUpload("progress", 100)
    return
  }
  // the complete request never came back — poll the session to its end
  for (;;) {
    await sleep(2000)
    const st = await mpRequest<SnapResp>(
      r.get(`/fs/multipart/status?upload_id=${uploadId}`),
    )
    if (!st) {
      continue // transient blip while the driver finishes — keep polling
    }
    if (st.code === 404) {
      // completed sessions are removed right after they are reaped; with all
      // chunks acknowledged this means the upload finished
      setUpload("progress", 100)
      return
    }
    if (st.code !== 200) {
      throw new Error(st.message)
    }
    switch (st.data.state) {
      case "completed":
        setUpload("progress", 100)
        return
      case "receiving":
        setUpload("progress", st.data.storage_progress | 0)
        continue
      default:
        throw new Error(st.data.error || `upload failed (${st.data.state})`)
    }
  }
}
