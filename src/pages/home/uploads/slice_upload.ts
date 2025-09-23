import { password } from "~/store"
import { EmptyResp } from "~/types"
import { r, pathDir } from "~/utils"
import { SetUpload, Upload } from "./types"
import {
  calculateHash,
  calculateSliceHash,
  fsUploadInfo,
  fsPreup,
  FsSliceupComplete,
  HashType,
} from "./util"
import createMutex from "~/utils/mutex"

const RETRY_CONFIG = {
  maxRetries: 15,
  retryDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  nativeSliceRetries: 8,
}

enum UploadErrorType {
  NETWORK_ERROR = "network_error",
  SERVER_ERROR = "server_error",
  FILE_ERROR = "file_error",
  CANCEL_ERROR = "cancel_error",
  TIMEOUT_ERROR = "timeout_error",
  HASH_ERROR = "hash_error",
  MEMORY_ERROR = "memory_error",
}

class UploadError extends Error {
  public type: UploadErrorType
  public statusCode?: number
  public retryable: boolean
  public userMessage: string

  constructor(
    type: UploadErrorType,
    message: string,
    userMessage: string,
    statusCode?: number,
    retryable: boolean = true,
  ) {
    super(message)
    this.type = type
    this.statusCode = statusCode
    this.retryable = retryable
    this.userMessage = userMessage
    this.name = "UploadError"
  }

  static fromAxiosError(error: any, chunkIndex?: number): UploadError {
    const chunkMsg =
      chunkIndex !== undefined ? `分片 ${chunkIndex + 1}` : "文件"

    if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
      return new UploadError(
        UploadErrorType.TIMEOUT_ERROR,
        `Upload timeout: ${error.message}`,
        `${chunkMsg}上传超时，请检查网络连接`,
        error.response?.status,
        true,
      )
    }

    if (!error.response) {
      return new UploadError(
        UploadErrorType.NETWORK_ERROR,
        `Network error: ${error.message}`,
        `网络连接失败，请检查网络状态`,
        undefined,
        true,
      )
    }

    const status = error.response.status
    const data = error.response.data

    if (status >= 500) {
      return new UploadError(
        UploadErrorType.SERVER_ERROR,
        `Server error ${status}: ${data?.message || error.message}`,
        `服务器暂时不可用 (${status})，正在重试...`,
        status,
        true,
      )
    } else if (status === 413) {
      return new UploadError(
        UploadErrorType.FILE_ERROR,
        `File too large: ${data?.message || error.message}`,
        `${chunkMsg}过大，请选择较小的文件`,
        status,
        false,
      )
    } else if (status === 401 || status === 403) {
      return new UploadError(
        UploadErrorType.SERVER_ERROR,
        `Authorization failed: ${data?.message || error.message}`,
        `认证失败，请重新登录`,
        status,
        false,
      )
    } else {
      return new UploadError(
        UploadErrorType.SERVER_ERROR,
        `HTTP ${status}: ${data?.message || error.message}`,
        `上传失败 (${status})，${data?.message || "未知错误"}`,
        status,
        status >= 400 && status < 500 ? false : true,
      )
    }
  }

  static fromGenericError(error: any, context: string = ""): UploadError {
    if (error instanceof UploadError) {
      return error
    }

    const message = error.message || String(error)
    if (message.includes("memory") || message.includes("Memory")) {
      return new UploadError(
        UploadErrorType.MEMORY_ERROR,
        `Memory error in ${context}: ${message}`,
        `内存不足，请关闭其他程序或选择较小的文件`,
        undefined,
        false,
      )
    }

    return new UploadError(
      UploadErrorType.FILE_ERROR,
      `${context} error: ${message}`,
      `文件处理出错: ${message}`,
      undefined,
      false,
    )
  }
}

interface UploadProgress {
  uploadedBytes: number
  totalBytes: number
  percentage: number
  speed: number // bytes per second
  remainingTime: number // seconds
  activeChunks: number
  completedChunks: number
  totalChunks: number
  lastError?: UploadError
  stage:
    | "preparing"
    | "hashing"
    | "uploading"
    | "completing"
    | "completed"
    | "error"
}

const progressMutex = createMutex()

const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = RETRY_CONFIG.maxRetries,
  delay: number = RETRY_CONFIG.retryDelay,
  context: string = "operation",
): Promise<T> => {
  let lastError: Error

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      if (i === maxRetries) {
        throw lastError
      }

      // Calculate delay time with exponential backoff
      const waitTime = Math.min(
        delay * Math.pow(RETRY_CONFIG.backoffMultiplier, i),
        RETRY_CONFIG.maxDelay,
      )

      console.log(
        `${context} failed, retrying in ${waitTime / 1000} seconds (${i + 1}/${maxRetries}):`,
        (error as any) instanceof UploadError
          ? (error as UploadError).userMessage
          : (error as Error).message,
      )

      await new Promise((resolve) => setTimeout(resolve, waitTime))
    }
  }
  throw lastError!
}

// Upload state management
interface UploadState {
  isPaused: boolean
  isCancelled: boolean
  totalBytes: number
  uploadedBytes: number
  completedChunks: number
  totalChunks: number
  activeChunks: number
  speed: number
  lastError?: UploadError
  onProgress?: (progress: UploadProgress) => void
}

export const SliceUpload: Upload = async (
  uploadPath: string,
  file: File,
  setUpload: SetUpload,
  asTask = false,
  overwrite = false,
): Promise<Error | undefined> => {
  let hashtype: string = HashType.Md5
  let slicehash: string[] = []
  let sliceupstatus: Uint8Array
  let ht: string[] = []

  let taskInfo: {
    taskId: string
    hash: any
    sliceSize: number
    sliceCnt: number
  } | null = null

  // 初始化上传状态
  const state: UploadState = {
    isPaused: false,
    isCancelled: false,
    totalBytes: file.size,
    uploadedBytes: 0,
    completedChunks: 0,
    totalChunks: 0,
    activeChunks: 0,
    speed: 0,
  }

  uploadQueue.addUpload(uploadPath, state)

  let speedInterval: any
  const cleanup = () => {
    if (speedInterval) {
      clearInterval(speedInterval)
    }
    uploadQueue.removeUpload(uploadPath)
  }

  const dir = pathDir(uploadPath)

  const resp = await fsUploadInfo(dir)
  if (resp.code != 200) {
    cleanup()
    return new Error(`Upload info failed: ${resp.code} - ${resp.message}`)
  }

  // hash计算
  if (resp.data.hash_md5_need) {
    ht.push(HashType.Md5)
    hashtype = HashType.Md5
  }
  if (resp.data.hash_sha1_need) {
    ht.push(HashType.Sha1)
    hashtype = HashType.Sha1
  }
  if (resp.data.hash_md5_256kb_need) {
    ht.push(HashType.Md5256kb)
  }
  const hash = await calculateHash(file, ht)
  const resp1 = await fsPreup(
    dir,
    file.name,
    file.size,
    hash,
    overwrite,
    asTask,
  )
  if (resp1.code != 200) {
    cleanup()
    return new Error(`Preup failed: ${resp1.code} - ${resp1.message}`)
  }

  state.totalChunks = resp1.data.slice_cnt

  taskInfo = {
    taskId: resp1.data.task_id,
    hash,
    sliceSize: resp1.data.slice_size,
    sliceCnt: resp1.data.slice_cnt,
  }

  if (resp1.data.reuse) {
    setUpload("progress", "100")
    setUpload("status", "success")
    setUpload("speed", "0")
    cleanup()
    return
  }
  if (resp.data.slice_hash_need) {
    slicehash = await calculateSliceHash(file, resp1.data.slice_size, hashtype)
  }
  sliceupstatus = base64ToUint8Array(resp1.data.slice_upload_status)

  let lastTimestamp = Date.now()
  let lastUploadedBytes = 0
  let completeFlag = false

  for (let i = 0; i < resp1.data.slice_cnt; i++) {
    if (isSliceUploaded(sliceupstatus, i)) {
      state.uploadedBytes += Math.min(
        resp1.data.slice_size,
        state.totalBytes - i * resp1.data.slice_size,
      )
    }
  }

  const uploadChunk = async (
    chunk: Blob,
    idx: number,
    slice_hash: string,
    task_id: string,
  ) => {
    if (state.isCancelled) {
      throw new UploadError(
        UploadErrorType.CANCEL_ERROR,
        "Upload cancelled by user",
        "上传已取消",
        undefined,
        false,
      )
    }

    while (state.isPaused && !state.isCancelled) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    let oldLoaded = 0

    return retryWithBackoff(
      async () => {
        try {
          const slice = chunk.slice(0, chunk.size)
          const resp: EmptyResp = await r.put("/fs/slice_upload", slice, {
            headers: {
              "File-Path": encodeURIComponent(dir),
              "X-Task-ID": task_id,
              "X-Slice-Num": idx.toString(),
              "X-Slice-Hash": slice_hash,
              Password: password(),
            },
            onUploadProgress: async (progressEvent: any) => {
              if (!progressEvent.lengthComputable || state.isCancelled) {
                return
              }
              const release = await progressMutex.acquire()
              try {
                const sliceuploaded = progressEvent.loaded - oldLoaded
                state.uploadedBytes += sliceuploaded
                oldLoaded = progressEvent.loaded

                state.completedChunks = Math.floor(
                  state.uploadedBytes / (state.totalBytes / state.totalChunks),
                )

                const progress = Math.min(
                  100,
                  ((state.uploadedBytes / state.totalBytes) * 100) | 0,
                )
                setUpload("progress", progress)
              } finally {
                progressMutex.release()
              }
            },
          })

          if (resp.code != 200) {
            throw new UploadError(
              UploadErrorType.SERVER_ERROR,
              `Slice upload failed: ${resp.code} - ${resp.message}`,
              `分片 ${idx + 1} 上传失败: ${resp.message || "服务器错误"}`,
              resp.code,
              resp.code >= 500,
            )
          }
          return resp
        } catch (err: any) {
          // Convert to structured error
          const uploadError =
            err instanceof UploadError
              ? err
              : UploadError.fromAxiosError(err, idx)

          // Record last error
          state.lastError = uploadError

          console.error(
            `Slice ${idx + 1} upload failed:`,
            uploadError.userMessage,
          )
          throw uploadError
        }
      },
      RETRY_CONFIG.maxRetries,
      RETRY_CONFIG.retryDelay,
      `slice_${idx + 1}_upload`,
    )
  }

  speedInterval = setInterval(() => {
    if (completeFlag || state.isCancelled) {
      clearInterval(speedInterval)
      return
    }

    const intervalLoaded = state.uploadedBytes - lastUploadedBytes
    if (intervalLoaded < 1000) {
      return
    }
    const speed = intervalLoaded / ((Date.now() - lastTimestamp) / 1000)
    const complete = Math.min(
      100,
      ((state.uploadedBytes / state.totalBytes) * 100) | 0,
    )
    setUpload("speed", speed)
    setUpload("progress", complete)
    lastTimestamp = Date.now()
    lastUploadedBytes = state.uploadedBytes
  }, 1000)

  lastTimestamp = Date.now()

  if (!isSliceUploaded(sliceupstatus, 0)) {
    const chunk = file.slice(0, resp1.data.slice_size)
    try {
      await uploadChunk(
        chunk,
        0,
        slicehash.length == 0 ? "" : slicehash.join(","),
        resp1.data.task_id,
      )
    } catch (err) {
      completeFlag = true
      setUpload("status", "error")
      setUpload("speed", 0)
      return err as Error
    }
  } else {
    state.uploadedBytes += Math.min(resp1.data.slice_size, state.totalBytes)
  }

  const concurrentLimit = 3 // 固定3个并发
  console.log(
    `File size: ${(file.size / 1024 / 1024).toFixed(2)}MB, using ${concurrentLimit} concurrent uploads`,
  )

  const pendingSlices: number[] = []
  for (let i = 1; i < resp1.data.slice_cnt; i++) {
    if (!isSliceUploaded(sliceupstatus, i)) {
      pendingSlices.push(i)
    }
  }

  const errors: Error[] = []
  let currentIndex = 0

  const processNextSlice = async (): Promise<void> => {
    while (currentIndex < pendingSlices.length) {
      const sliceIndex = pendingSlices[currentIndex++]
      
      try {
        const chunk = file.slice(
          sliceIndex * resp1.data.slice_size,
          (sliceIndex + 1) * resp1.data.slice_size,
        )
        await uploadChunk(
          chunk,
          sliceIndex,
          slicehash.length == 0 ? "" : slicehash[sliceIndex],
          resp1.data.task_id,
        )
      } catch (err) {
        errors.push(err as Error)
      }
    }
  }

  const tasks: Promise<void>[] = []
  for (let i = 0; i < Math.min(concurrentLimit, pendingSlices.length); i++) {
    tasks.push(processNextSlice())
  }

  await Promise.all(tasks)

  if (errors.length > 0) {
    setUpload(
      "progress",
      Math.min(100, ((state.uploadedBytes / state.totalBytes) * 100) | 0),
    )
    setUpload("status", "error")
    cleanup()

    const serverErrors = errors.filter(
      (e) =>
        e instanceof UploadError && e.type === UploadErrorType.SERVER_ERROR,
    )
    const networkErrors = errors.filter(
      (e) =>
        e instanceof UploadError && e.type === UploadErrorType.NETWORK_ERROR,
    )

    if (serverErrors.length > 0) {
      return serverErrors[0]
    } else if (networkErrors.length > 0) {
      return networkErrors[0]
    } else {
      return errors[0]
    }
  } else {
    if (!asTask) {
      setUpload("status", "backending")
    }

    try {
      const resp = await retryWithBackoff(
        () => FsSliceupComplete(dir, resp1.data.task_id),
        RETRY_CONFIG.maxRetries,
        RETRY_CONFIG.retryDelay,
        "upload_complete",
      )

      completeFlag = true
      cleanup()

      if (resp.code != 200) {
        return new UploadError(
          UploadErrorType.SERVER_ERROR,
          `Upload complete failed: ${resp.code} - ${resp.message}`,
          `上传完成确认失败: ${resp.message}`,
          resp.code,
          resp.code >= 500,
        )
      } else if (resp.data.complete == 0) {
        return new UploadError(
          UploadErrorType.SERVER_ERROR,
          "slice missing, please reupload",
          "文件分片缺失，请重新上传",
          undefined,
          true,
        )
      }

      return
    } catch (error) {
      cleanup()
      return error instanceof UploadError
        ? error
        : UploadError.fromGenericError(error, "upload_complete")
    }
  }
}

const base64ToUint8Array = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const isSliceUploaded = (status: Uint8Array, idx: number): boolean => {
  //   const bytes = base64ToUint8Array(statusBase64)
  const byteIdx = Math.floor(idx / 8)
  const bitIdx = idx % 8
  if (byteIdx >= status.length) return false
  return (status[byteIdx] & (1 << bitIdx)) !== 0
}

// 上传队列管理
class UploadQueue {
  private static instance: UploadQueue
  private uploads: Map<string, UploadState> = new Map()

  static getInstance(): UploadQueue {
    if (!UploadQueue.instance) {
      UploadQueue.instance = new UploadQueue()
    }
    return UploadQueue.instance
  }

  addUpload(uploadPath: string, state: UploadState): void {
    this.uploads.set(uploadPath, state)
  }

  pauseUpload(uploadPath: string): void {
    const state = this.uploads.get(uploadPath)
    if (state) {
      state.isPaused = true
    }
  }

  resumeUpload(uploadPath: string): void {
    const state = this.uploads.get(uploadPath)
    if (state) {
      state.isPaused = false
    }
  }

  cancelUpload(uploadPath: string): void {
    const state = this.uploads.get(uploadPath)
    if (state) {
      state.isCancelled = true
    }
  }

  removeUpload(uploadPath: string): void {
    this.uploads.delete(uploadPath)
  }

  getUploadState(uploadPath: string): UploadState | undefined {
    return this.uploads.get(uploadPath)
  }

  getAllUploads(): Array<{ path: string; state: UploadState }> {
    return Array.from(this.uploads.entries()).map(([path, state]) => ({
      path,
      state,
    }))
  }
}

export const uploadQueue = UploadQueue.getInstance()

export const pauseUpload = (uploadPath: string) =>
  uploadQueue.pauseUpload(uploadPath)
export const resumeUpload = (uploadPath: string) =>
  uploadQueue.resumeUpload(uploadPath)
export const cancelUpload = (uploadPath: string) =>
  uploadQueue.cancelUpload(uploadPath)

export { UploadError, UploadErrorType }
export type { UploadProgress }

export const getUploadDetails = (
  uploadPath: string,
): {
  state?: UploadState
  progress?: UploadProgress
  errorMessage?: string
} => {
  const state = uploadQueue.getUploadState(uploadPath)
  if (!state) return {}

  const progress: UploadProgress = {
    uploadedBytes: state.uploadedBytes,
    totalBytes: state.totalBytes,
    percentage: Math.min(
      100,
      ((state.uploadedBytes / state.totalBytes) * 100) | 0,
    ),
    speed: state.speed,
    remainingTime:
      state.speed > 0
        ? (state.totalBytes - state.uploadedBytes) / state.speed
        : 0,
    activeChunks: state.activeChunks,
    completedChunks: state.completedChunks,
    totalChunks: state.totalChunks,
    lastError: state.lastError,
    stage: state.isCancelled
      ? "error"
      : state.uploadedBytes >= state.totalBytes
        ? "completed"
        : "uploading",
  }

  return {
    state,
    progress,
    errorMessage: state.lastError?.userMessage,
  }
}
