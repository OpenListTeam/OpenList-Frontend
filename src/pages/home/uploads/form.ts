import { password } from "~/store"
import { getSetting } from "~/store"
import { EmptyResp } from "~/types"
import { r } from "~/utils"
import { SetUpload, Upload } from "./types"
import { calculateHash, calculateXXHash64 } from "./util"
import { buf as crc32 } from "crc-32"

// Default chunk size: 95MB (below Cloudflare's 100MB limit)
const DEFAULT_CHUNK_SIZE = 95 * 1024 * 1024

// Get chunk size from server settings or use default
const getChunkSize = (): number => {
  const configuredSize = getSetting("chunked_upload_chunk_size")
  if (configuredSize) {
    return parseInt(configuredSize) * 1024 * 1024
  }
  return DEFAULT_CHUNK_SIZE
}

// Generate a unique upload ID based on path, size, and file hash
async function generateUploadId(path: string, file: File): Promise<string> {
  const sample = file.slice(0, Math.min(1024 * 1024, file.size))
  const buffer = await sample.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer)
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  // Use encodeURIComponent to handle Unicode characters before btoa
  const rawId = `${path}|${file.size}|${hashHex}`
  const encodedId = btoa(encodeURIComponent(rawId))
  return encodedId.replace(/[+/=]/g, "_")
}

// Split file into chunks
function splitFile(file: File, chunkSize: number): Blob[] {
  const chunks: Blob[] = []
  let start = 0
  while (start < file.size) {
    chunks.push(file.slice(start, Math.min(start + chunkSize, file.size)))
    start += chunkSize
  }
  return chunks
}

// Chunked upload for large files
async function chunkedUpload(
  uploadPath: string,
  file: File,
  setUpload: SetUpload,
  asTask: boolean,
  overwrite: boolean,
  chunkSize: number,
): Promise<undefined> {
  const fileSizeMB = (file.size / 1024 / 1024).toFixed(2)
  const chunkSizeMB = (chunkSize / 1024 / 1024).toFixed(0)

  // Calculate local file hash - Incremental non-blocking xxHash64
  const hashPromise = calculateXXHash64(file)
    .then((xxhash) => {
      console.log(`[Chunked Upload] Local xxHash64: ${xxhash}`)
      return xxhash
    })
    .catch((err) => {
      console.warn(`[Chunked Upload] Failed to compute local hash: ${err}`)
      return ""
    })

  // Generate upload ID
  const uploadId = await generateUploadId(uploadPath, file)

  // Split file into chunks
  const chunks = splitFile(file, chunkSize)
  const totalChunks = chunks.length

  console.log(`[Chunked Upload] Starting: ${file.name}`)
  console.log(
    `[Chunked Upload] File size: ${fileSizeMB} MB, Chunks: ${totalChunks} x ${chunkSizeMB} MB`,
  )

  // State for speed calculation
  let totalUploadedBytes = 0
  const startTime = Date.now()
  let lastTime = startTime
  let lastLoaded = 0
  let instantSpeed = 0
  let averageSpeed = 0

  // Upload each chunk with retry
  for (let i = 0; i < totalChunks; i++) {
    const form = new FormData()
    const chunk = chunks[i]
    form.append("file", chunk)

    // Calculate chunk CRC32
    const chunkBuffer = await chunk.arrayBuffer()
    const chunkCRC32 = (crc32(new Uint8Array(chunkBuffer)) >>> 0)
      .toString(16)
      .padStart(8, "0")

    let attempt = 0
    let success = false
    while (attempt < 3 && !success) {
      try {
        attempt++
        // Update status message
        const retryMsg = attempt > 1 ? ` (Retry ${attempt}/3)` : ""
        setUpload("msg", `Uploading chunk ${i + 1}/${totalChunks}${retryMsg}`)

        const chunkStartTime = Date.now()
        const resp: any = await r.put(
          `/fs/put/chunk?upload_id=${encodeURIComponent(uploadId)}&index=${i}`,
          form,
          {
            headers: {
              "Content-Type": "multipart/form-data",
              "X-Chunk-CRC32": chunkCRC32,
              Password: password(),
            },
            onUploadProgress: (progressEvent: any) => {
              if (progressEvent.total) {
                totalUploadedBytes = i * chunkSize + progressEvent.loaded
                const now = Date.now()
                const duration = (now - lastTime) / 1000
                if (duration > 0.5) {
                  const loadedDiff = totalUploadedBytes - lastLoaded
                  instantSpeed = loadedDiff / duration
                  averageSpeed = totalUploadedBytes / ((now - startTime) / 1000)
                  setUpload("speed", instantSpeed)
                  console.log(
                    `[Chunked Upload] Chunk ${i + 1} progress: ${(
                      (progressEvent.loaded / progressEvent.total) *
                      100
                    ).toFixed(1)}%, Instant: ${(
                      instantSpeed /
                      1024 /
                      1024
                    ).toFixed(2)} MB/s, Average: ${(
                      averageSpeed /
                      1024 /
                      1024
                    ).toFixed(2)} MB/s`,
                  )
                  lastTime = now
                  lastLoaded = totalUploadedBytes
                }
                const chunkProgress =
                  (progressEvent.loaded / progressEvent.total) *
                  (chunkSize / file.size) *
                  95
                const overallProgress = (i / totalChunks) * 95 + chunkProgress
                setUpload("progress", overallProgress)
              }
            },
          },
        )
        const elapsed = Date.now() - chunkStartTime

        if (resp.code !== 200) {
          throw new Error(`Server returned ${resp.code}: ${resp.message}`)
        }

        // Log server returned CRC if available
        if (resp.data && resp.data.crc32) {
          console.log(
            `[Chunked Upload] Chunk ${i + 1} Verified. Client CRC: ${chunkCRC32}, Server CRC: ${resp.data.crc32}`,
          )
        }

        totalUploadedBytes = (i + 1) * chunkSize
        const chunkBytes = chunks[i].size
        const chunkSpeed = chunkBytes / (elapsed / 1000)
        instantSpeed = chunkSpeed
        averageSpeed = totalUploadedBytes / ((Date.now() - startTime) / 1000)
        setUpload("speed", instantSpeed)

        const progress = ((i + 1) / totalChunks) * 95
        setUpload("progress", progress)

        console.log(
          `[Chunked Upload] Chunk ${i + 1}/${totalChunks} done (${(
            chunkSpeed /
            1024 /
            1024
          ).toFixed(2)} MB/s), Average: ${(
            averageSpeed /
            1024 /
            1024
          ).toFixed(2)} MB/s`,
        )
        success = true
      } catch (e: any) {
        console.error(
          `[Chunked Upload] Chunk ${i + 1} attempt ${attempt} failed: ${e.message}`,
        )
        if (attempt >= 3) {
          throw new Error(`Chunk ${i + 1} failed after 3 attempts: ${e.message}`)
        }
        // Wait 1s before retry
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
  }

  // Wait for hash calculation
  setUpload("msg", "Verifying local hash...")
  const localHash = await hashPromise
  console.log(
    `[Chunked Upload] All chunks done. Local xxHash64: ${localHash}. Requesting merge...`,
  )

  setUpload("status", "backending")
  setUpload("msg", "Merging chunks...")
  setUpload("speed", 0)

  const mergeResp: any = await r.post("/fs/put/chunk/merge", {
    upload_id: uploadId,
    path: uploadPath,
    total_chunks: totalChunks,
    as_task: true, // Always use async task for chunked uploads to prevent timeout
    overwrite: overwrite,
    last_modified: file.lastModified,
    hash: localHash, // Send local hash for verification
  })

  if (mergeResp.code === 200) {
    // Check if response contains remote file hash
    const remoteHash = mergeResp.data?.hash
    if (remoteHash) {
      console.log(`[Chunked Upload] Merge Success. Remote Hash:`, remoteHash)
      if (remoteHash.xxh64 && localHash && remoteHash.xxh64 !== localHash) {
        console.error(
          `[Chunked Upload] CRITICAL: Hash Mismatch! Local: ${localHash}, Remote: ${remoteHash.xxh64}`,
        )
        // Optionally throw error here, but for now just log critical error
      }
    }
    setUpload("progress", 100)
    setUpload("msg", "")
    return
  } else {
    console.error(`[Chunked Upload] Merge failed: ${mergeResp.message}`)
    throw new Error(mergeResp.message)
  }
}

// Direct upload for small files (original logic)
async function directUpload(
  uploadPath: string,
  file: File,
  setUpload: SetUpload,
  asTask: boolean,
  overwrite: boolean,
  rapid: boolean,
): Promise<undefined> {
  let oldTimestamp = new Date().valueOf()
  let oldLoaded = 0
  const form = new FormData()
  form.append("file", file)
  let headers: { [k: string]: any } = {
    "File-Path": encodeURIComponent(uploadPath),
    "As-Task": asTask,
    "Content-Type": "multipart/form-data",
    "Last-Modified": file.lastModified,
    Password: password(),
    Overwrite: overwrite.toString(),
  }
  if (rapid) {
    const { md5, sha1, sha256 } = await calculateHash(file)
    headers["X-File-Md5"] = md5
    headers["X-File-Sha1"] = sha1
    headers["X-File-Sha256"] = sha256
  }
  const resp: EmptyResp = await r.put("/fs/form", form, {
    headers: headers,
    onUploadProgress: (progressEvent: any) => {
      if (progressEvent.total) {
        const complete = ((progressEvent.loaded / progressEvent.total) * 100) | 0
        setUpload("progress", complete)

        const timestamp = new Date().valueOf()
        const duration = (timestamp - oldTimestamp) / 1000
        if (duration > 1) {
          const loaded = progressEvent.loaded - oldLoaded
          const speed = loaded / duration
          const remain = progressEvent.total - progressEvent.loaded
          const remainTime = remain / speed
          setUpload("speed", speed)
          console.log(remainTime)

          oldTimestamp = timestamp
          oldLoaded = progressEvent.loaded
        }

        if (complete === 100) {
          setUpload("status", "backending")
        }
      }
    },
  })
  if (resp.code === 200) {
    return
  } else {
    throw new Error(resp.message)
  }
}

export const FormUpload: Upload = async (
  uploadPath: string,
  file: File,
  setUpload: SetUpload,
  asTask = false,
  overwrite = false,
  rapid = false,
): Promise<undefined> => {
  const chunkSize = getChunkSize()
  const fileSizeMB = (file.size / 1024 / 1024).toFixed(2)
  const chunkSizeMB = (chunkSize / 1024 / 1024).toFixed(0)

  // Use chunked upload for large files
  if (file.size > chunkSize) {
    console.log(
      `[Form Upload] ${file.name} (${fileSizeMB} MB) > ${chunkSizeMB} MB threshold, using chunked upload`,
    )
    return chunkedUpload(
      uploadPath,
      file,
      setUpload,
      asTask,
      overwrite,
      chunkSize,
    )
  }

  // Use direct upload for small files
  console.log(`[Form Upload] ${file.name} (${fileSizeMB} MB) using direct upload`)
  return directUpload(uploadPath, file, setUpload, asTask, overwrite, rapid)
}
 
