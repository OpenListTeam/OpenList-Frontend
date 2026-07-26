import { Upload, SetUpload } from "./types"
import { r, pathDir } from "~/utils"

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

  if (uploadInfo.upload_urls) {
    return await uploadS3Multipart(file, uploadInfo, setUpload)
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

async function uploadS3Multipart(
  file: File,
  uploadInfo: {
    chunk_size: number
    upload_urls: string[]
    complete_url: string
    abort_url: string
  },
  setUpload?: SetUpload,
): Promise<undefined> {
  const calcSpeed = createSpeedCalculator()
  const parts: { partNumber: number; etag: string }[] = []
  let uploadedBytes = 0

  try {
    for (let i = 0; i < uploadInfo.upload_urls.length; i++) {
      const start = i * uploadInfo.chunk_size
      const chunk = file.slice(start, start + uploadInfo.chunk_size)
      const etag = await uploadS3Part(
        chunk,
        uploadInfo.upload_urls[i],
        i + 1,
        uploadedBytes,
        file.size,
        calcSpeed,
        setUpload,
      )
      parts.push({ partNumber: i + 1, etag })
      uploadedBytes += chunk.size
    }

    const body = buildS3CompleteMultipartUploadXML(parts)
    const response = await fetch(uploadInfo.complete_url, {
      method: "POST",
      body,
    })
    await validateS3CompleteResponse(response)
  } catch (error) {
    // Avoid leaving incomplete multipart uploads billed by the object store.
    void fetch(uploadInfo.abort_url, { method: "DELETE" })
    throw error
  }

  return undefined
}

function buildS3CompleteMultipartUploadXML(
  parts: { partNumber: number; etag: string }[],
): string {
  const xml = document.implementation.createDocument(
    "",
    "CompleteMultipartUpload",
  )
  const root = xml.documentElement

  for (const { partNumber, etag } of parts) {
    const part = xml.createElement("Part")
    const partNumberNode = xml.createElement("PartNumber")
    partNumberNode.textContent = String(partNumber)
    const etagNode = xml.createElement("ETag")
    etagNode.textContent = etag
    part.append(partNumberNode, etagNode)
    root.append(part)
  }

  return new XMLSerializer().serializeToString(xml)
}

async function validateS3CompleteResponse(response: Response): Promise<void> {
  const body = await response.text()
  if (!response.ok) {
    throw new Error(
      `Complete multipart upload failed with status ${response.status}: ${body}`,
    )
  }

  const xml = new DOMParser().parseFromString(body, "application/xml")
  const parseError = xml.querySelector("parsererror")
  if (parseError) {
    throw new Error("Complete multipart upload returned invalid XML")
  }

  const error = xml.querySelector("Error")
  if (error) {
    const code = error.querySelector("Code")?.textContent?.trim()
    const message = error.querySelector("Message")?.textContent?.trim()
    throw new Error(
      `Complete multipart upload failed${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}`,
    )
  }

  if (!xml.querySelector("CompleteMultipartUploadResult")) {
    throw new Error("Complete multipart upload returned an unexpected response")
  }
}

function uploadS3Part(
  chunk: Blob,
  uploadURL: string,
  partNumber: number,
  uploadedBytes: number,
  totalSize: number,
  calcSpeed: ReturnType<typeof createSpeedCalculator>,
  setUpload?: SetUpload,
): Promise<string> {
  const xhr = new XMLHttpRequest()
  return new Promise((resolve, reject) => {
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && setUpload) {
        const totalLoaded = uploadedBytes + e.loaded
        setUpload("progress", (totalLoaded / totalSize) * 100)
        calcSpeed(totalLoaded, setUpload)
      }
    })
    xhr.addEventListener("load", () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new Error(
            `Upload part ${partNumber} failed with status ${xhr.status}`,
          ),
        )
        return
      }
      const etag = xhr.getResponseHeader("ETag")
      if (!etag) {
        reject(new Error(`Upload part ${partNumber} did not return an ETag`))
        return
      }
      resolve(etag)
    })
    xhr.addEventListener("error", () =>
      reject(new Error(`Upload part ${partNumber} failed`)),
    )
    xhr.open("PUT", uploadURL)
    xhr.send(chunk)
  })
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
