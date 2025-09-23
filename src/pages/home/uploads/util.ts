import { HashInfo, UploadFileProps } from "./types"
import { FsUpinfoResp, FsPreupResp, FsSliceupCompleteResp } from "~/types"
import { createMD5, createSHA1, createSHA256 } from "hash-wasm"
import { r } from "~/utils"

export const traverseFileTree = async (entry: FileSystemEntry) => {
  let res: File[] = []
  const internalProcess = async (entry: FileSystemEntry, path: string) => {
    const promise = new Promise<{}>((resolve, reject) => {
      const errorCallback: ErrorCallback = (e) => {
        console.error(e)
        reject(e)
      }
      if (entry.isFile) {
        ;(entry as FileSystemFileEntry).file((file) => {
          const newFile = new File([file], path + file.name, {
            type: file.type,
          })
          res.push(newFile)
          console.log(newFile)
          resolve({})
        }, errorCallback)
      } else if (entry.isDirectory) {
        const dirReader = (entry as FileSystemDirectoryEntry).createReader()
        const readEntries = () => {
          dirReader.readEntries(async (entries) => {
            for (let i = 0; i < entries.length; i++) {
              await internalProcess(entries[i], path + entry.name + "/")
            }
            resolve({})
            /**
            why? https://stackoverflow.com/questions/3590058/does-html5-allow-drag-drop-upload-of-folders-or-a-folder-tree/53058574#53058574
            Unfortunately none of the existing answers are completely correct because 
            readEntries will not necessarily return ALL the (file or directory) entries for a given directory. 
            This is part of the API specification (see Documentation section below).
            
            To actually get all the files, we'll need to call readEntries repeatedly (for each directory we encounter) 
            until it returns an empty array. If we don't, we will miss some files/sub-directories in a directory 
            e.g. in Chrome, readEntries will only return at most 100 entries at a time.
            */
            if (entries.length > 0) {
              readEntries()
            }
          }, errorCallback)
        }
        readEntries()
      }
    })
    await promise
  }
  await internalProcess(entry, "")
  return res
}

export const fsUploadInfo = (path: string = "/"): Promise<FsUpinfoResp> => {
  return r.get("/fs/upload/info", {
    headers: {
      "File-Path": encodeURIComponent(path),
    },
  })
}

export const fsPreup = async (
  path: string,
  name: string,
  size: number,
  hash: HashInfo,
  overwrite: boolean,
  as_task: boolean,
): Promise<FsPreupResp> => {
  return r.post(
    "/fs/preup",
    {
      path,
      name,
      size,
      hash,
      overwrite,
      as_task,
    },
    {
      headers: {
        "File-Path": encodeURIComponent(path),
      },
    },
  )
}

export const FsSliceupComplete = async (
  path: string,
  task_id: string,
): Promise<FsSliceupCompleteResp> => {
  return r.post(
    "/fs/slice_upload_complete",
    {
      task_id,
    },
    {
      headers: {
        "File-Path": encodeURIComponent(path),
      },
    },
  )
}

export const File2Upload = (file: File): UploadFileProps => {
  return {
    name: file.name,
    path: file.webkitRelativePath ? file.webkitRelativePath : file.name,
    size: file.size,
    progress: 0,
    speed: 0,
    status: "pending",
  }
}

export enum HashType {
  Md5 = "md5",
  Md5256kb = "md5_256kb",
  Sha1 = "sha1",
  Sha256 = "sha256",
}

export const calculateHash = async (
  file: File,
  hashType: string[] = [HashType.Md5],
) => {
  let md5Digest: any, md5256kbDigest: any, sha1Digest: any, sha256Digest: any
  let hash: HashInfo = {
    md5: "",
    md5_256kb: "",
    sha1: "",
    sha256: "",
  }
  // 初始化需要的 hash 实例
  for (const ht of hashType) {
    if (ht === HashType.Md5) {
      md5Digest = await createMD5()
    } else if (ht === HashType.Md5256kb) {
      md5256kbDigest = await createMD5()
    } else if (ht === HashType.Sha1) {
      sha1Digest = await createSHA1()
    } else if (ht === HashType.Sha256) {
      sha256Digest = await createSHA256()
    }
  }

  const reader = file.stream().getReader()
  let readBytes = 0
  const KB256 = 256 * 1024
  let md5256kbDone = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    if (md5Digest) md5Digest.update(value)
    if (sha1Digest) sha1Digest.update(value)
    if (sha256Digest) sha256Digest.update(value)

    // 计算前256KB的md5
    if (md5256kbDigest && !md5256kbDone) {
      let chunk = value
      if (readBytes + chunk.length > KB256) {
        // 只取剩余需要的部分
        chunk = chunk.slice(0, KB256 - readBytes)
        md5256kbDone = true
      }
      md5256kbDigest.update(chunk)
      readBytes += chunk.length
      if (readBytes >= KB256) {
        md5256kbDone = true
      }
    }
  }

  if (md5Digest) hash.md5 = await md5Digest.digest("hex")
  if (md5256kbDigest) hash.md5_256kb = await md5256kbDigest.digest("hex")
  if (sha1Digest) hash.sha1 = await sha1Digest.digest("hex")
  if (sha256Digest) hash.sha256 = await sha256Digest.digest("hex")

  return hash
}

export const calculateSliceHash = async (
  file: File,
  sliceSize: number,
  hashType: string,
) => {
  const sliceCount = Math.ceil(file.size / sliceSize)
  const results: string[] = []

  for (let i = 0; i < sliceCount; i++) {
    const start = i * sliceSize
    const end = Math.min(file.size, start + sliceSize)
    const blob = file.slice(start, end)
    const arrayBuffer = await blob.arrayBuffer()
    let hash: string = ""

    if (hashType === HashType.Md5) {
      const md5 = await createMD5()
      md5.update(new Uint8Array(arrayBuffer))
      hash = await md5.digest("hex")
    } else if (hashType === HashType.Sha1) {
      const sha1 = await createSHA1()
      sha1.update(new Uint8Array(arrayBuffer))
      hash = await sha1.digest("hex")
    } else if (hashType === HashType.Sha256) {
      const sha256 = await createSHA256()
      sha256.update(new Uint8Array(arrayBuffer))
      hash = await sha256.digest("hex")
    } else {
      throw new Error("Unsupported hash type: " + hashType)
    }

    results.push(hash)
  }

  return results // 每个分片的hash组成的数组
}
