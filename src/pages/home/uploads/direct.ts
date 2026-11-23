import { Upload, SetUpload } from "./types"
import { Upload, SetUpload } from "./types"
import { r, pathDir } from "~/utils"

// A part that fails for a transient reason is retried before giving up on the
// whole upload.
const PART_MAX_ATTEMPTS = 3

type PartError = Error & { retryable?: boolean }

// Create a speed calculator using closure
function createSpeedCalculator(throttleMs = 500) {
  let lastLoaded = 0
  let lastTime = Date.now()

  return (loaded: number, setUpload?: SetUpload) => {
    const now = Date.now()
    const timeDiff = (now - lastTime) / 1000

    if (timeDiff >= throttleMs / 1000) {
      const speed = (loaded - lastLoaded) / timeDiff
      setUpload?.("speed", speed)
      lastLoaded = loaded
      lastTime = now
    }
  }
}

export const HttpDirectUpload: Upload = async (
  uploadPath: string,
  file: File,
  setUpload: SetUpload,
  _asTask: boolean,
  overwrite: boolean,
  _rapid: boolean,
  seedOptions,
) => {
  const path = pathDir(uploadPath)

  // Get direct upload info from backend
  const resp = await r.post(
    "/fs/get_direct_upload_info",
    {
      path,
      file_name: file.name,
      file_size: file.size,
      content_type: file.type || "application/octet-stream",
      tool: "HttpDirect",
      seed_options: seedOptions?.formats.length ? seedOptions : undefined,
    },
    {
      headers: {
        Overwrite: overwrite,
      },
    },
  )

  const uploadInfo = resp.data

  // If upload_info is null, direct upload is not supported - fallback to Stream
  if (!uploadInfo) {
    throw new Error("Http Direct Upload not supported")
  }

  // Upload file directly to storage
  const chunkSize = uploadInfo.chunk_size || 0
  const uploadURL = uploadInfo.upload_url
  const method = uploadInfo.method || "PUT"

  // Storages that sign every part separately (e.g. Cloudreve S3/KS3 upload
  // sessions) hand out one URL per part plus an endpoint that finalizes the
  // multipart upload with the collected ETags.
  if (Array.isArray(uploadInfo.upload_urls) && uploadInfo.upload_urls.length) {
    const etags = await uploadParts(
      file,
      uploadInfo.upload_urls,
      chunkSize,
      method,
      uploadInfo.headers,
      setUpload,
    )
    if (uploadInfo.complete_url) {
      await completeDirectUpload(
        uploadInfo.complete_url,
        uploadInfo.complete_method || "POST",
        etags,
      )
    }
    return
  }

  if (!uploadURL) {
    throw new Error("Http Direct Upload returned no upload url")
  }

  if (chunkSize > 0) {
    // Always use chunked upload when chunkSize is provided
    // This ensures Content-Range header is set for all files
    return await uploadChunked(
      file,
      uploadURL,
      chunkSize,
      method,
      uploadInfo.headers,
      setUpload,
    )
  } else {
    // Single upload for drivers that don't support chunking
    return await uploadSingle(
      file,
      uploadURL,
      method,
      uploadInfo.headers,
      setUpload,
    )
  }
}

async function uploadSingle(
  file: File,
  uploadURL: string,
  method: string,
  headers?: Record<string, string>,
  setUpload?: SetUpload,
): Promise<undefined> {
  const xhr = new XMLHttpRequest()
  const calcSpeed = createSpeedCalculator()

  return new Promise((resolve, reject) => {
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && setUpload) {
        const progress = (e.loaded / e.total) * 100
        setUpload("progress", progress)
        calcSpeed(e.loaded, setUpload)
      }
    })

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(undefined)
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`))
      }
    })

    xhr.addEventListener("error", () => {
      reject(new Error("Upload failed"))
    })

    xhr.open(method, uploadURL)

    // Set custom headers if provided
    if (headers) {
      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value)
      })
    }

    xhr.send(file)
  })
}

async function uploadChunked(
  file: File,
  uploadURL: string,
  chunkSize: number,
  method: string,
  headers?: Record<string, string>,
  setUpload?: SetUpload,
): Promise<undefined> {
  const totalChunks = Math.ceil(file.size / chunkSize)
  const calcSpeed = createSpeedCalculator()
  let uploadedBytes = 0

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, file.size)
    const chunk = file.slice(start, end)

    const xhr = new XMLHttpRequest()

    await new Promise<void>((resolve, reject) => {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && setUpload) {
          const totalLoaded = uploadedBytes + e.loaded
          const progress = (totalLoaded / file.size) * 100
          setUpload("progress", progress)
          calcSpeed(totalLoaded, setUpload)
        }
      })

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          uploadedBytes += chunk.size
          resolve()
        } else {
          reject(
            new Error(`Upload chunk ${i + 1} failed with status ${xhr.status}`),
          )
        }
      })

      xhr.addEventListener("error", () => {
        reject(new Error(`Upload chunk ${i + 1} failed`))
      })

      xhr.open(method, uploadURL)

      // Set Content-Range header for chunked upload
      xhr.setRequestHeader(
        "Content-Range",
        `bytes ${start}-${end - 1}/${file.size}`,
      )

      // Set custom headers if provided
      if (headers) {
        Object.entries(headers).forEach(([key, value]) => {
          xhr.setRequestHeader(key, value)
        })
      }

      xhr.send(chunk)
    })
  }

  return undefined
}

// uploadParts PUTs one part per presigned URL and returns the part ETags, which
// the backend needs in order to finalize the multipart upload.
async function uploadParts(
  file: File,
  urls: string[],
  chunkSize: number,
  method: string,
  headers?: Record<string, string>,
  setUpload?: SetUpload,
): Promise<string[]> {
  const partSize =
    chunkSize > 0 ? chunkSize : Math.ceil(file.size / urls.length)
  const calcSpeed = createSpeedCalculator()
  const etags: string[] = []
  let uploadedBytes = 0

  for (let i = 0; i < urls.length; i++) {
    const start = i * partSize
    const end = Math.min(start + partSize, file.size)
    if (end <= start) {
      break
    }
    const raw = file.slice(start, end)
    // A presigned URL may be signed with or without a Content-Type, so only
    // send one when the backend explicitly asked for it.
    const chunk = hasHeader(headers, "content-type")
      ? raw
      : new Blob([raw], { type: "" })

    let failure: Error | undefined
    for (let attempt = 1; attempt <= PART_MAX_ATTEMPTS; attempt++) {
      try {
        const etag = await uploadPart(
          urls[i],
          chunk,
          method,
          headers,
          (loaded) => {
            if (!setUpload) return
            const totalLoaded = uploadedBytes + loaded
            setUpload("progress", (totalLoaded / file.size) * 100)
            calcSpeed(totalLoaded, setUpload)
          },
        )
        etags.push(etag)
        uploadedBytes += chunk.size
        failure = undefined
        break
      } catch (err) {
        failure = err as Error
        const retryable = (err as PartError).retryable !== false
        if (!retryable || attempt === PART_MAX_ATTEMPTS) {
          break
        }
        // back off a little before retrying the same part
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
      }
    }
    if (failure) {
      throw new Error(`Upload part ${i + 1}: ${failure.message}`)
    }
  }

  return etags
}

// uploadPart sends a single part and resolves with its ETag. The returned error
// carries whether another attempt may succeed.
function uploadPart(
  url: string,
  chunk: Blob,
  method: string,
  headers: Record<string, string> | undefined,
  onProgress: (loaded: number) => void,
): Promise<string> {
  const xhr = new XMLHttpRequest()
  return new Promise<string>((resolve, reject) => {
    const fail = (message: string, retryable: boolean) => {
      const err = new Error(message) as PartError
      err.retryable = retryable
      reject(err)
    }

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded)
      }
    })

    xhr.addEventListener("load", () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        // 4xx other than timeout/throttling will not succeed on a retry
        fail(
          `failed with status ${xhr.status}`,
          xhr.status >= 500 || xhr.status === 408 || xhr.status === 429,
        )
        return
      }
      const etag = xhr.getResponseHeader("ETag")
      if (!etag) {
        fail("returned no ETag, expose it in the bucket CORS rules", false)
        return
      }
      resolve(etag)
    })

    xhr.addEventListener("error", () => {
      fail("failed", true)
    })

    xhr.open(method, url)

    // Set custom headers if provided
    if (headers) {
      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value)
      })
    }

    xhr.send(chunk)
  })
}

function hasHeader(
  headers: Record<string, string> | undefined,
  name: string,
): boolean {
  if (!headers) {
    return false
  }
  return Object.keys(headers).some((key) => key.toLowerCase() === name)
}

// completeDirectUpload asks the backend to finalize the multipart upload with
// the ETags collected by uploadParts.
async function completeDirectUpload(
  url: string,
  method: string,
  etags: string[],
): Promise<void> {
  const res: any = await r.request({
    url,
    method: method as any,
    data: { etags },
  })
  if (res?.code !== 200) {
    throw new Error(res?.message || "failed to complete the upload")
  }
}
