import { Upload, SetUpload } from "./types"
import { Resp } from "~/types"
import { r, pathBase, pathDir } from "~/utils"

type DirectUploadCompletionInfo = {
  url?: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
}

type PdsDirectUploadInfo = {
  upload_url: string
  headers?: Record<string, string>
  method?: string
  complete?: DirectUploadCompletionInfo
}

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
) => {
  const path = pathDir(uploadPath)

  // Get direct upload info from backend
  const resp = await r.post(
    "/fs/get_direct_upload_info",
    {
      path,
      file_name: file.name,
      file_size: file.size,
      tool: "HttpDirect",
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

export const PdsDirectUpload: Upload = async (
  uploadPath: string,
  file: File,
  setUpload: SetUpload,
  _asTask: boolean,
  overwrite: boolean,
  _rapid: boolean,
) => {
  const path = pathDir(uploadPath)

  const resp = (await r.post(
    "/fs/get_direct_upload_info",
    {
      path,
      file_name: file.name,
      file_size: file.size,
      tool: "PdsDirect",
    },
    {
      headers: {
        "File-Path": encodeURIComponent(uploadPath),
        Overwrite: overwrite,
      },
    },
  )) as Resp<PdsDirectUploadInfo | null>

  if (resp.code !== 200) {
    throw new Error(resp.message)
  }

  const uploadInfo = resp.data

  if (!uploadInfo?.upload_url) {
    throw new Error("PDS Direct Upload not supported")
  }

  await uploadSingle(
    file,
    uploadInfo.upload_url,
    uploadInfo.method || "PUT",
    uploadInfo.headers,
    setUpload,
  )

  await completeDirectUpload(uploadInfo.complete, uploadPath, setUpload)
  return undefined
}

function getHeaderEntries(headers?: Record<string, string>) {
  return Object.entries(headers ?? {}).filter(([, value]) => value !== "")
}

function shouldSuppressContentType(headers?: Record<string, string>) {
  return Object.entries(headers ?? {}).some(
    ([key, value]) => key.toLowerCase() === "content-type" && value === "",
  )
}

function getRequestBody(blob: Blob, suppressContentType: boolean): Blob {
  if (!suppressContentType || blob.type === "") {
    return blob
  }
  return blob.slice(0, blob.size, "")
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
  const suppressContentType = shouldSuppressContentType(headers)

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

    getHeaderEntries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value)
    })

    xhr.send(getRequestBody(file, suppressContentType))
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

      getHeaderEntries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value)
      })

      xhr.send(chunk)
    })
  }

  return undefined
}

async function completeDirectUpload(
  complete?: DirectUploadCompletionInfo,
  uploadPath?: string,
  setUpload?: SetUpload,
): Promise<void> {
  if (!complete) {
    return
  }
  if (!complete.url) {
    throw new Error("Direct upload completion URL is missing")
  }

  setUpload?.("status", "backending")

  const headers = new Headers()
  getHeaderEntries(complete.headers).forEach(([key, value]) => {
    headers.set(key, value)
  })
  if (uploadPath && !headers.has("File-Path")) {
    headers.set("File-Path", encodeURIComponent(uploadPath))
  }
  if (!headers.has("Authorization")) {
    const token = localStorage.getItem("token")
    if (token) {
      headers.set("Authorization", token)
    }
  }

  let body: BodyInit | undefined
  const completeBody = normalizeCompleteBody(complete.body, uploadPath)
  if (completeBody !== undefined && completeBody !== null) {
    if (typeof completeBody === "string") {
      body = completeBody
    } else {
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json")
      }
      body = JSON.stringify(completeBody)
    }
  }

  const resp = await fetch(complete.url, {
    method: complete.method || "POST",
    headers,
    body,
  })
  const text = await resp.text()
  let data: Resp<unknown> | undefined
  try {
    data = text ? (JSON.parse(text) as Resp<unknown>) : undefined
  } catch {
    data = undefined
  }
  if (!resp.ok) {
    throw new Error(data?.message || `Complete upload failed: ${resp.status}`)
  }
  if (data && data.code !== 200) {
    throw new Error(data.message || "Complete upload failed")
  }
}

function normalizeCompleteBody(body: unknown, uploadPath?: string): unknown {
  if (!uploadPath || typeof body !== "object" || body === null) {
    return body
  }
  if (Array.isArray(body)) {
    return body
  }
  return {
    ...(body as Record<string, unknown>),
    path: pathDir(uploadPath),
    file_name: pathBase(uploadPath),
  }
}
