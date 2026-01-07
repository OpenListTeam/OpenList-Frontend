import { UploadFileProps } from "./types"
import { createMD5, createSHA1, createSHA256, createXXHash64 } from "hash-wasm"

export const traverseFileTree = async (entry: FileSystemEntry) => {
  let res: File[] = []
  const internalProcess = async (entry: FileSystemEntry, path: string) => {
    const promise = new Promise<{}>((resolve, reject) => {
      const errorCallback: ErrorCallback = (e) => {
        console.error(e)
        reject(e)
      }
      if (entry.isFile) {
        ; (entry as FileSystemFileEntry).file((file) => {
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
            if (entries.length > 0) {
              readEntries()
            } else {
              resolve({})
            }

            /*  resolve({})
            /**
            why? https://stackoverflow.com/questions/3590058/does-html5-allow-drag-drop-upload-of-folders-or-a-folder-tree/53058574#53058574
            Unfortunately none of the existing answers are completely correct because 
            readEntries will not necessarily return ALL the (file or directory) entries for a given directory. 
            This is part of the API specification (see Documentation section below).
            
            To actually get all the files, we'll need to call readEntries repeatedly (for each directory we encounter) 
            until it returns an empty array. If we don't, we will miss some files/sub-directories in a directory 
            e.g. in Chrome, readEntries will only return at most 100 entries at a time.
            
            if (entries.length > 0) {
              readEntries()
            }
            */
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

export const calculateXXHash64 = async (file: File) => {
  const hasher = await createXXHash64()
  const reader = file.stream().getReader()

  const read = async () => {
    const { done, value } = await reader.read()
    if (done) {
      return
    }
    hasher.update(value)
    // Yield to main thread to prevent UI freeze
    await new Promise((resolve) => setTimeout(resolve, 0))
    await read()
  }

  await read()
  return hasher.digest("hex")
}

// Keep old signature for compatibility if needed, but we essentially replace it
export const calculateHash = async (file: File) => {
  return calculateXXHash64(file).then((xxhash) => ({
    xxhash,
    md5: "",
    sha1: "",
    sha256: "",
  }))
}
 
