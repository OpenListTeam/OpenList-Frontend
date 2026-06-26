import { Error, FullLoading, ImageWithError } from "~/components"
import { useCDN, useRouter, useT } from "~/hooks"
import { ext, loadScriptIIFE } from "~/utils"
import { objStore } from "~/store"
import { Obj, ObjType } from "~/types"
import {
  createEffect,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js"

const HEIF_EXTS = new Set(["heic", "heif", "avif", "vvc", "avc"])
const isHeif = (name: string) => HEIF_EXTS.has(ext(name))

interface PreviewProps {
  images?: Obj[]
  navigate?: (name: string) => void
}

const HeifView = (props: { src: string }) => {
  const t = useT()
  const { libHeifPath } = useCDN()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal(false)
  let canvas: HTMLCanvasElement | undefined
  let libheif: any
  let decoder: any

  const decode = async (url: string) => {
    try {
      setLoading(true)
      setError(false)
      if (!window.libheif) {
        await loadScriptIIFE(`${libHeifPath()}/libheif.js`, "libheif-script")
      }
      if (!libheif) {
        const wasm = await fetch(`${libHeifPath()}/libheif.wasm`).then((r) => {
          if (!r.ok) throw "WASM load failed"
          return r.arrayBuffer()
        })
        libheif = window.libheif({ wasmBinary: wasm })
        decoder = new libheif.HeifDecoder()
      }
      const buffer = await fetch(url).then((r) => {
        if (!r.ok) throw "File fetch failed"
        return r.arrayBuffer()
      })
      const images = decoder.decode(buffer)
      if (!images?.length) throw "No decodable image"
      const img = images[0]
      const w = img.get_width()
      const h = img.get_height()
      if (!canvas) return
      canvas.width = w
      canvas.height = h
      const imageData = new ImageData(w, h)
      await new Promise<void>((resolve) => {
        img.display(imageData, (data: ImageData | null) => {
          if (!data || !canvas) return resolve()
          canvas.getContext("2d")?.putImageData(data, 0, 0)
          resolve()
        })
      })
      setLoading(false)
    } catch (e) {
      console.error("HEIF decode failed:", e)
      setError(true)
      setLoading(false)
    }
  }

  createEffect(() => {
    if (props.src) decode(props.src)
  })

  onCleanup(() => {
    decoder = null
    libheif = null
  })

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "75vh",
        display: "flex",
        "justify-content": "center",
        "align-items": "center",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvas}
        style={{
          "max-width": "100%",
          "max-height": "100%",
          "object-fit": "contain",
          display: loading() || error() ? "none" : "block",
        }}
      />
      <Show when={loading()}>
        <FullLoading />
      </Show>
      <Show when={error()}>
        <Error msg={t("home.preview.failed_load_img")} h="75vh" />
      </Show>
    </div>
  )
}

const Preview = (props: PreviewProps) => {
  const t = useT()
  const { replace } = useRouter()
  let images =
    props.images ||
    objStore.objs.filter(
      (obj) => obj.type === ObjType.IMAGE || isHeif(obj.name),
    )
  if (images.length === 0) {
    images = [objStore.obj]
  }

  const prev = () => {
    const index = images.findIndex((f) => f.name === objStore.obj.name)
    if (index > 0) {
      if (props.navigate) {
        props.navigate(images[index - 1].name)
      } else {
        replace(images[index - 1].name)
      }
    }
  }

  const next = () => {
    const index = images.findIndex((f) => f.name === objStore.obj.name)
    if (index < images.length - 1) {
      if (props.navigate) {
        props.navigate(images[index + 1].name)
      } else {
        replace(images[index + 1].name)
      }
    }
  }

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      prev()
    } else if (e.key === "ArrowRight") {
      next()
    }
  }
  onMount(() => {
    window.addEventListener("keydown", onKeydown)
  })
  onCleanup(() => {
    window.removeEventListener("keydown", onKeydown)
  })

  return (
    <Switch
      fallback={
        <ImageWithError
          maxH="75vh"
          rounded="$lg"
          src={objStore.raw_url}
          fallback={<FullLoading />}
          fallbackErr={<Error msg={t("home.preview.failed_load_img")} />}
        />
      }
    >
      <Match when={isHeif(objStore.obj.name)}>
        <HeifView src={objStore.raw_url} />
      </Match>
    </Switch>
  )
}

export default Preview
