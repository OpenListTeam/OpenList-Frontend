import { BoxWithFullScreen, FullLoading, Error as Erro } from "~/components"
import { Box, Button, IconButton, Tooltip } from "@hope-ui/solid"
import { loadScript } from "./load_external"
import { createSignal, onMount, onCleanup, Show } from "solid-js"
import { useLink, useT } from "~/hooks"
import { VsScreenFull, VsScreenNormal } from "solid-icons/vs"
import {
  HiOutlineMagnifyingGlassPlus,
  HiOutlineMagnifyingGlassMinus,
} from "solid-icons/hi"

// 声明全局docx类型
declare global {
  interface Window {
    docx: any
  }
}

const DocViewerApp = () => {
  const t = useT()
  const { currentObjLink } = useLink()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal(false)
  const [isFullscreen, setIsFullscreen] = createSignal(false)
  // null = auto-fit, number = manual zoom level
  const [zoom, setZoom] = createSignal<number | null>(null)
  let containerRef: HTMLDivElement | undefined
  let resultRef: HTMLDivElement | undefined

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
      const fileUrl = currentObjLink()
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
    applyScale()
  }

  // 应用缩放
  const applyScale = () => {
    if (!resultRef || !containerRef) return
    const wrapper = resultRef.querySelector(
      ".docx-preview-container",
    ) as HTMLElement
    if (!wrapper) return
    const z = zoom()
    if (z === null) {
      // auto-fit: 缩放到容器宽度
      const containerWidth = containerRef.clientWidth
      const contentWidth = wrapper.scrollWidth
      if (contentWidth > containerWidth) {
        wrapper.style.zoom = `${containerWidth / contentWidth}`
      } else {
        wrapper.style.zoom = ""
      }
    } else {
      wrapper.style.zoom = `${z}`
    }
  }

  // 缩放控制
  const zoomStep = 0.1
  const zoomIn = () => {
    const current = zoom() ?? 1
    setZoom(Math.min(current + zoomStep, 3))
    applyScale()
  }
  const zoomOut = () => {
    const current = zoom() ?? 1
    setZoom(Math.max(current - zoomStep, 0.3))
    applyScale()
  }
  const zoomReset = () => {
    setZoom(null)
    applyScale()
  }

  const setupResponsiveScale = () => {
    if (!resultRef || !containerRef) return
    const result = resultRef
    const container = containerRef
    const observer = new ResizeObserver(() => {
      if (zoom() === null) applyScale()
    })
    observer.observe(container)
    onCleanup(() => observer.disconnect())
  }

  onMount(() => {
    initDocViewer()
    setupResponsiveScale()
    document.addEventListener("fullscreenchange", handleFullscreenChange)
  })

  onCleanup(() => {
    document.removeEventListener("fullscreenchange", handleFullscreenChange)
    // 清理加载的脚本和样式（可选）
  })

  return (
    <BoxWithFullScreen w="$full" h="70vh" pos="relative">
      {/* 缩放控制 */}
      <Box
        pos="absolute"
        top="$2"
        left="$2"
        zIndex="10"
        display="flex"
        alignItems="center"
        gap="$1"
        opacity="0.7"
        transition="opacity 0.2s"
        _hover={{ opacity: "1" }}
      >
        <IconButton
          size="sm"
          colorScheme="neutral"
          aria-label="Zoom Out"
          icon={<HiOutlineMagnifyingGlassMinus />}
          onClick={zoomOut}
        />
        <Tooltip
          withArrow
          label={
            zoom() === null
              ? t("home.preview.auto_fit")
              : t("home.preview.reset_zoom")
          }
        >
          <Button size="sm" colorScheme="neutral" onClick={zoomReset}>
            {zoom() === null ? "Auto" : `${Math.round((zoom() ?? 1) * 100)}%`}
          </Button>
        </Tooltip>
        <IconButton
          size="sm"
          colorScheme="neutral"
          aria-label="Zoom In"
          icon={<HiOutlineMagnifyingGlassPlus />}
          onClick={zoomIn}
        />
      </Box>

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
            "min-width": "0",
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
          <Erro msg={t("preview.failed_load_doc")} h="70vh" />
        </Show>
      </div>
    </BoxWithFullScreen>
  )
}

export default DocViewerApp
