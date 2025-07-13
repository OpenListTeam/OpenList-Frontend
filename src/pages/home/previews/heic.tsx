import { Error, FullLoading } from "~/components"
import { useRouter, useT } from "~/hooks"
import { objStore } from "~/store"
import { onCleanup, onMount, createSignal, Show } from "solid-js"

const Preview = () => {
  const t = useT()
  const { replace } = useRouter()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal(false)

  // 获取当前目录下所有HEIC文件
  let heicFiles = objStore.objs.filter((obj) =>
    /\.(heic|heif|avif|vvc|avc|jpeg|jpg)$/i.test(obj.name),
  )

  if (heicFiles.length === 0) {
    heicFiles = [objStore.obj]
  }

  // 键盘导航功能：左右箭头切换文件
  const onKeydown = (e: KeyboardEvent) => {
    const index = heicFiles.findIndex((f) => f.name === objStore.obj.name)
    if (e.key === "ArrowLeft" && index > 0) {
      replace(heicFiles[index - 1].name)
    } else if (e.key === "ArrowRight" && index < heicFiles.length - 1) {
      replace(heicFiles[index + 1].name)
    }
  }

  let libheif: any
  let decoder: any
  let canvas: HTMLCanvasElement | undefined

  onMount(() => {
    window.addEventListener("keydown", onKeydown)
    initLibheif()
  })

  onCleanup(() => {
    window.removeEventListener("keydown", onKeydown)
    if (libheif && decoder) {
      decoder.free()
      decoder = null
    }
    libheif = null
  })

  // 初始化libheif库
  const initLibheif = async () => {
    setLoading(true)
    setError(false)

    try {
      // 动态加载libheif脚本
      if (!window.libheif) {
        await loadScript("/static/libheif/libheif.js", "libheif-script")
      }

      // 加载WASM文件
      const wasmBinary = await fetchWasm("/static/libheif/libheif.wasm")

      // 初始化libheif
      libheif = window.libheif({ wasmBinary })
      decoder = new libheif.HeifDecoder()

      // 加载并解码当前HEIC文件
      await loadAndDecode(objStore.raw_url)
    } catch (e) {
      console.error("HEIC初始化失败:", e)
      setError(true)
      setLoading(false)
    }
  }

  // 加载脚本
  const loadScript = (src: string, id: string) =>
    new Promise<void>((resolve, reject) => {
      const script = document.createElement("script")
      script.src = src
      script.id = id
      script.onload = () => resolve()
      script.onerror = () => reject(`脚本加载失败: ${src}`)
      document.head.appendChild(script)
    })

  // 获取WASM文件
  const fetchWasm = async (url: string) => {
    const response = await fetch(url)
    if (!response.ok) throw `WASM加载失败: ${url}`
    return await response.arrayBuffer()
  }

  // 加载并解码HEIC文件
  const loadAndDecode = async (url: string) => {
    try {
      setLoading(true)
      setError(false)

      // 获取HEIC文件
      const response = await fetch(url)
      if (!response.ok) throw "文件获取失败"
      const buffer = await response.arrayBuffer()

      // 解码HEIC文件
      const images = decoder.decode(buffer)
      if (!images || images.length === 0) {
        throw "没有可解码的图像"
      }

      // 显示第一张图像
      const image = images[0]
      await displayImage(image)
      setLoading(false)
    } catch (e) {
      console.error("HEIC解码失败:", e)
      setError(true)
      setLoading(false)
    }
  }

  // 在canvas上显示图像
  const displayImage = (image: any) => {
    return new Promise<void>((resolve) => {
      if (!canvas) return resolve()

      const width = image.get_width()
      const height = image.get_height()

      // 调整canvas尺寸
      canvas.width = width
      canvas.height = height

      // 创建ImageData对象
      const imageData = new ImageData(width, height)

      // 显示图像
      image.display(imageData, (displayData: ImageData | null) => {
        if (!displayData || !canvas) return resolve()

        const ctx = canvas.getContext("2d")
        if (!ctx) return resolve()

        ctx.putImageData(displayData, 0, 0)
        resolve()
      })
    })
  }

  return (
    <div
      id="heic-container"
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

      {/* 加载状态 */}
      <Show when={loading()}>
        <FullLoading />
      </Show>

      {/* 错误状态 */}
      <Show when={error()}>
        <Error msg={t("preview.failed_load_heic")} h="75vh" />
      </Show>
    </div>
  )
}

export default Preview
