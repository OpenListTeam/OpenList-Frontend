import { objStore } from "~/store"
import { FormUpload } from "./form"
import { StreamUpload } from "./stream"
import { Upload } from "./types"
import { SliceUpload } from "./slice_upload"

type Uploader = {
  upload: Upload
  name: string
  provider: RegExp
}

const AllUploads: Uploader[] = [
  {
    name: "Stream",
    upload: StreamUpload,
    provider: /.*/,
  },
  {
    name: "Form",
    upload: FormUpload,
    provider: /.*/,
  },
  {
    name: "Slice",
    upload: SliceUpload,
    provider: /.*/,
  },
]

export const getUploads = (): Pick<Uploader, "name" | "upload">[] => {
  return AllUploads.filter((u) => u.provider.test(objStore.provider))
}
