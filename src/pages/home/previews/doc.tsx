import { BoxWithFullScreen, Error, FullLoading } from "~/components"
import { objStore } from "~/store"
import { Box, IconButton, Tooltip } from "@hope-ui/solid"
import { createSignal, onMount, onCleanup, Show } from "solid-js"
import { useT } from "~/hooks"
import { VsScreenFull, VsScreenNormal } from "solid-icons/vs"

// 声明全局docx类型
declare global {
  interface Window {
    docx: any
  }
}

const DocViewerApp = () => {
  const t = useT()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal(false)
  const [isFullscreen, setIsFullscreen] = createSignal(false)
  let containerRef: HTMLDivElement | undefined
  let resultRef: HTMLDivElement | undefined

  // 加载外部脚本
  const loadScript = (src: string, id: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      // 检查脚本是否已加载
      if (document.getElementById(id)) {
        resolve()
        return
      }

      const script = document.createElement("script")
      script.src = src
      script.id = id
      script.type = "text/javascript"
      script.onload = () => resolve()
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`))
      document.head.appendChild(script)
    })
  }

  // 加载CSS文件
  const loadCSS = (href: string, id: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      // 检查CSS是否已加载
      if (document.getElementById(id)) {
        resolve()
        return
      }

      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = href
      link.id = id
      link.onload = () => resolve()
      link.onerror = () => reject(new Error(`Failed to load CSS: ${href}`))
      document.head.appendChild(link)
    })
  }

  // 初始化DOCX预览
  const initDocViewer = async () => {
    try {
      setLoading(true)
      setError(false)

      // 加载jszip和docx-preview库
      await loadScript(
        "https://unpkg.com/jszip/dist/jszip.min.js",
        "jszip-script",
      )
      await loadScript(
        "https://res.oplist.org.cn/docxjs/dist/docx-preview.min.js",
        "docx-preview-script",
      )

      // 等待docx库加载完成
      if (!window.docx) {
        throw new Error("docx-preview library not loaded")
      }

      // 获取文件URL并下载
      const fileUrl = objStore.raw_url
      const response = await fetch(fileUrl)
      if (!response.ok) {
        throw new Error("Failed to fetch document file")
      }

      const blob = await response.blob()

      // 使用docx-preview渲染文档
      if (resultRef) {
        await window.docx.renderAsync(blob, resultRef, undefined, {
          className: "docx-preview-container",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          experimental: false,
          trimXmlDeclaration: true,
          useBase64URL: false,
          useMathMLPolyfill: false,
          renderChanges: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        })

        setLoading(false)
      }
    } catch (e) {
      console.error("DOCX初始化失败:", e)
      setError(true)
      setLoading(false)
    }
  }

  // 全屏切换
  const toggleFullscreen = () => {
    if (!containerRef) return

    if (!document.fullscreenElement) {
      containerRef.requestFullscreen().then(() => {
        setIsFullscreen(true)
      })
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false)
      })
    }
  }

  // 监听全屏变化
  const handleFullscreenChange = () => {
    if (!document.fullscreenElement) {
      setIsFullscreen(false)
    }
  }

  onMount(() => {
    initDocViewer()
    document.addEventListener("fullscreenchange", handleFullscreenChange)
  })

  onCleanup(() => {
    document.removeEventListener("fullscreenchange", handleFullscreenChange)
    // 清理加载的脚本和样式（可选）
  })

  return (
    <BoxWithFullScreen w="$full" h="70vh" pos="relative">
      {/* 全屏按钮 */}
      <Box
        pos="absolute"
        top="$2"
        right="$2"
        zIndex="10"
        opacity="0.7"
        transition="opacity 0.2s"
        _hover={{ opacity: "1" }}
      >
        <Tooltip
          withArrow
          label={
            isFullscreen()
              ? t("home.preview.exit_fullscreen")
              : t("home.preview.fullscreen")
          }
        >
          <IconButton
            size="sm"
            colorScheme="neutral"
            aria-label="Toggle Fullscreen"
            icon={isFullscreen() ? <VsScreenNormal /> : <VsScreenFull />}
            onClick={toggleFullscreen}
          />
        </Tooltip>
      </Box>

      {/* DOCX容器 */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          overflow: "auto",
          position: "relative",
          background: "#f5f5f5",
        }}
      >
        <div
          ref={resultRef}
          id="docx-container"
          style={{
            width: "100%",
            height: "100%",
            padding: "20px",
            display: loading() || error() ? "none" : "block",
          }}
        />

        {/* 加载状态 */}
        <Show when={loading()}>
          <FullLoading />
        </Show>

        {/* 错误状态 */}
        <Show when={error()}>
          <Error msg={t("preview.failed_load_doc")} h="70vh" />
        </Show>
      </div>
    </BoxWithFullScreen>
  )
}

export default DocViewerApp
