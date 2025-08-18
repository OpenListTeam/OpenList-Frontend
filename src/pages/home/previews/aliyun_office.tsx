import { createEffect } from "solid-js"
import { Box } from "@hope-ui/solid"
import { MaybeLoading } from "~/components"
import { useFetch, useRouter } from "~/hooks"
import { password } from "~/store"
import { PResp } from "~/types"
import { handleResp, r } from "~/utils"

const AliDocPreview = () => {
  const { pathname } = useRouter()
  const [loading, post] = useFetch(
    (): PResp<{ access_token: string; preview_url: string }> =>
      r.post("/fs/other", {
        path: pathname(),
        password: password(),
        method: "doc_preview",
      }),
  )

  const loadAliyunSDK = () => {
    return new Promise<void>((resolve, reject) => {
      if (window.aliyun) return resolve()
      const script = document.createElement("script")
      script.src =
        "https://g.alicdn.com/IMM/office-js/1.1.5/aliyun-web-office-sdk.min.js"
      script.async = true
      script.onload = () => resolve()
      script.onerror = () =>
        reject(new Error("Failed to load Aliyun Office SDK"))
      document.body.appendChild(script)
    })
  }

  const init = async () => {
    await loadAliyunSDK()
    const resp = await post()
    handleResp(resp, (data) => {
      const aliyun = window.aliyun
      if (!aliyun) return
      const docOptions = aliyun.config({
        mount: document.querySelector("#office-preview")!,
        url: data.preview_url,
      })
      docOptions.setToken({ token: data.access_token })
    })
  }

  createEffect(() => {
    init()
  })

  return (
    <MaybeLoading loading={loading()}>
      <Box w="$full" h="70vh" id="office-preview"></Box>
    </MaybeLoading>
  )
}

export default AliDocPreview
