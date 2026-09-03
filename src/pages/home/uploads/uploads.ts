import { getSettingBool, objStore } from "~/store"
import { isGo, isTsWorker } from "~/utils/backend"
import { FormUpload } from "./form"
import { StreamUpload } from "./stream"
import { HttpDirectUpload } from "./direct"
import { MultipartUpload } from "./multipart"
import { ChunkedUpload } from "./chunked"
import { Upload } from "./types"

type Uploader = {
  upload: Upload
  name: string
  available: () => boolean
}

// All upload methods
const AllUploads: Uploader[] = [
  {
    name: "Multipart",
    upload: MultipartUpload,
    available: () => isGo() && getSettingBool("multipart_enabled"),
  },
  {
    name: "Chunked",
    upload: ChunkedUpload,
    available: () => isTsWorker(),
  },
  {
    name: "HTTP Direct",
    upload: HttpDirectUpload,
    available: () => {
      return objStore.direct_upload_tools?.includes("HttpDirect") || false
    },
  },
  {
    name: "Stream",
    upload: StreamUpload,
    available: () => true,
  },
  {
    name: "Form",
    upload: FormUpload,
    available: () => true,
  },
]

export const getUploads = (): Pick<Uploader, "name" | "upload">[] => {
  return AllUploads.filter((u) => u.available())
}
