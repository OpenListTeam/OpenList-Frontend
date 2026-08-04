import { objStore } from "~/store"
import { FormUpload } from "./form"
import { StreamUpload } from "./stream"
import { HttpDirectUpload, PdsDirectUpload } from "./direct"
import { Upload } from "./types"

type Uploader = {
  upload: Upload
  name: string
  available: () => boolean
}

// All upload methods
const AllUploads: Uploader[] = [
  {
    name: "HTTP Direct",
    upload: HttpDirectUpload,
    available: () => {
      return objStore.direct_upload_tools?.includes("HttpDirect") || false
    },
  },
  {
    name: "PDS Direct",
    upload: PdsDirectUpload,
    available: () => {
      return objStore.direct_upload_tools?.includes("PdsDirect") || false
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
