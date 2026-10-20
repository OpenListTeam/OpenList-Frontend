import { password } from "~/store"
import { r, pathDir } from "~/utils"
import { Resp } from "~/types"
import { SetUpload, Upload } from "./types"
import { calculateHash } from "./util"
import { StreamUpload } from "./stream"

/**
 * Session-based chunked upload (large-file friendly):
 * 1. POST /fs/upload/create to create an upload session (may carry MD5 for rapid upload)
 * 2. PUT /fs/upload/part chunk by chunk (each part is an independent request,
 *    real progress is visible, server memory is constant, and it does not hit the
 *    Workers request-body/memory limit)
 * 3. POST /fs/upload/complete to finalize
 * Falls back to stream upload when the storage does not support it.
 *
 * NOTE: This is the OpenListNext (TSWorker/Workers) upload path. The Go backend
 * uses MultipartUpload instead (see ./multipart.ts). Both are kept; the Go
 * interface and logic are the reference going forward.
 */
export const ChunkedUpload: Upload = async (
  uploadPath: string,
  file: File,
  setUpload: SetUpload,
  asTask = false,
  overwrite = false,
  rapid = false,
): Promise<Error | undefined> => {
  // Normalize root path: pathDir returns "" for root, so use "/" to avoid
  // "path and file_name are required" errors.
  const dirPath = pathDir(uploadPath) || "/"

  let md5 = ""
  if (rapid) {
    setUpload("status", "hashing")
    try {
      const hashes = await calculateHash(file, (p) => setUpload("progress", p))
      md5 = hashes.md5
    } catch {
      // Hash failure degrades to normal chunked upload without rapid upload
      md5 = ""
    }
  }

  setUpload("status", "uploading")
  const createSession = (): Promise<Resp<any>> =>
    r.post(
      "/fs/upload/create",
      {
        path: dirPath,
        file_name: file.name,
        size: file.size,
        md5,
      },
      {
        headers: {
          Password: password(),
          Overwrite: overwrite.toString(),
        },
      },
    ) as unknown as Promise<Resp<any>>

  let createResp = await createSession()
  if (createResp.code !== 200) {
    throw new Error(createResp.message)
  }
  let info = createResp.data
  // 189Cloud requires the complete MD5 during init. Hash in the browser and
  // retry session creation; the Worker still only receives one chunk at a time.
  if (info?.requiresMd5 && !md5) {
    setUpload("status", "hashing")
    const hashes = await calculateHash(file, (p) => {
      setUpload("progress", p | 0)
    })
    md5 = hashes.md5
    setUpload("status", "uploading")
    createResp = await createSession()
    if (createResp.code !== 200) {
      throw new Error(createResp.message)
    }
    info = createResp.data
  }
  // Storage does not support session chunked upload -> fall back to stream upload
  if (!info) {
    return await StreamUpload(
      uploadPath,
      file,
      setUpload,
      asTask,
      overwrite,
      false,
    )
  }
  // Rapid upload hit: file already exists, done
  if (info.reuse) {
    return
  }

  const { session, partCount, chunkSize } = info
  const totalParts: number = partCount

  let oldTimestamp = new Date().valueOf()
  let oldLoaded = 0
  const partMd5s: string[] = []

  // Upload parts sequentially (preserves part order and session consistency)
  for (let i = 1; i <= totalParts; i++) {
    const start = (i - 1) * chunkSize
    const end = Math.min(start + chunkSize, file.size)
    const chunk = file.slice(start, end)
    const partResp = (await r.put("/fs/upload/part", chunk, {
      headers: {
        "X-Upload-Session": session,
        "X-Part-Number": String(i),
        "Upload-Path": encodeURIComponent(dirPath),
        "Content-Type": "application/octet-stream",
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const loaded = start + progressEvent.loaded
          const complete = (loaded / file.size) * 100
          setUpload("progress", complete | 0)
          const timestamp = new Date().valueOf()
          const duration = (timestamp - oldTimestamp) / 1000
          if (duration > 1) {
            const speed = (loaded - oldLoaded) / duration
            setUpload("speed", speed)
            oldTimestamp = timestamp
            oldLoaded = loaded
          }
        }
      },
    })) as unknown as Resp<any>
    if (partResp.code !== 200) {
      throw new Error(
        `[Part ${i}/${totalParts}] ${partResp.message || "upload failed"}`,
      )
    }
    if (partResp.data?.partMd5) partMd5s[i - 1] = partResp.data.partMd5
  }

  setUpload("status", "backending")
  const completeResp = (await r.post("/fs/upload/complete", {
    path: dirPath,
    session,
    partMd5s,
  })) as unknown as Resp<any>
  if (completeResp.code !== 200) {
    throw new Error(completeResp.message)
  }
  return
}
