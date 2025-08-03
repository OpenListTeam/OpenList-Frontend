import { Error, FullLoading } from "~/components"
import { useCDN, useRouter, useT } from "~/hooks"
import { objStore } from "~/store"
import { onCleanup, onMount, createSignal, Show } from "solid-js"

const Preview = () => {
  const t = useT()
  const { replace } = useRouter()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal(false)
  const { ruffleJSPath } = useCDN()

  // 获取当前目录下所有SWF文件
  let swfFiles = objStore.objs.filter((obj) =>
    obj.name.toLowerCase().endsWith(".swf"),
  )

  if (swfFiles.length === 0) {
    swfFiles = [objStore.obj]
  }

  // 键盘导航功能：左右箭头切换SWF文件
  const onKeydown = (e: KeyboardEvent) => {
    const index = swfFiles.findIndex((f) => f.name === objStore.obj.name)
    if (e.key === "ArrowLeft" && index > 0) {
      replace(swfFiles[index - 1].name)
    } else if (e.key === "ArrowRight" && index < swfFiles.length - 1) {
      replace(swfFiles[index + 1].name)
    }
  }

  onMount(() => {
    window.addEventListener("keydown", onKeydown)
    initRufflePlayer()
  })

  onCleanup(() => {
    window.removeEventListener("keydown", onKeydown)
    const player = document.getElementById("ruffle-player")
    player?.remove()
    const ruffleScript = document.getElementById("ruffle-script")
    ruffleScript?.remove()
  })

  const initRufflePlayer = () => {
    setLoading(true)
    setError(false)

    // 清理可能存在的旧播放器
    const oldPlayer = document.getElementById("ruffle-player")
    oldPlayer?.remove()

    // 检查是否已加载Ruffle
    if (window.RufflePlayer) {
      createPlayer()
      return
    }

    // 动态加载Ruffle脚本
    const script = document.createElement("script")
    // script.src = "https://unpkg.com/@ruffle-rs/ruffle"
    script.src = ruffleJSPath()
    script.async = true
    script.id = "ruffle-script"

    script.onload = () => {
      createPlayer()
    }

    script.onerror = () => {
      setError(true)
      setLoading(false)
      console.error("无法加载Ruffle播放器")
    }

    document.head.appendChild(script)
  }

  const createPlayer = () => {
    try {
      const ruffle = window.RufflePlayer.newest()
      const player = ruffle.createPlayer()
      player.id = "ruffle-player"
      player.style.width = "100%"
      player.style.height = "100%"

      const container = document.getElementById("swf-container")
      if (container) {
        container.innerHTML = ""
        container.appendChild(player)

        player.addEventListener("loaded", () => {
          setLoading(false)
        })

        player.addEventListener("error", () => {
          setError(true)
          setLoading(false)
        })

        player.load(objStore.raw_url)
      }
    } catch (e) {
      console.error("Ruffle初始化失败:", e)
      setError(true)
      setLoading(false)
    }
  }

  return (
    <div
      id="swf-container"
      style={{
        position: "relative",
        width: "100%",
        height: "75vh",
        display: "flex",
        "justify-content": "center",
        "align-items": "center",
      }}
    >
      {/* 加载状态 */}
      <Show when={loading()}>
        <FullLoading />
      </Show>

      {/* 错误状态 */}
      <Show when={error()}>
        <Error msg={t("preview.failed_load_swf")} h="75vh" />
      </Show>
    </div>
  )
}

export default Preview
