import { BoxWithFullScreen, Error as Erro, FullLoading } from "~/components"
import { Box, Button, IconButton, Tooltip } from "@hope-ui/solid"
import { loadScript, loadCSS } from "./load_external"
import { createSignal, onMount, onCleanup, Show } from "solid-js"
import { useLink, useT } from "~/hooks"
import { VsScreenFull, VsScreenNormal } from "solid-icons/vs"
import {
  HiOutlineMagnifyingGlassPlus,
  HiOutlineMagnifyingGlassMinus,
} from "solid-icons/hi"

// 声明全局jQuery和pptxToHtml方法
declare global {
  interface Window {
    $: any
    jQuery: any
  }
}

const PPTViewerApp = () => {
  const t = useT()
  const { currentObjLink } = useLink()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal(false)
  const [isFullscreen, setIsFullscreen] = createSignal(false)
  // null = auto-fit, number = manual zoom level
  const [zoom, setZoom] = createSignal<number | null>(null)
  let containerRef: HTMLDivElement | undefined
  let shadowHostRef: HTMLDivElement | undefined
  let resultRef: HTMLDivElement | undefined

  // 将已加载的CSS注入Shadow DOM
  const injectStylesToShadow = (shadow: ShadowRoot) => {
    document.querySelectorAll('link[id$="-css"]').forEach((el) => {
      if (!shadow.getElementById(el.id)) {
        shadow.appendChild(el.cloneNode(true))
      }
    })
  }

  // 初始化PPT预览
  const initPPTViewer = async () => {
    try {
      setLoading(true)
      setError(false)

      const baseUrl = "https://res.oplist.org.cn/ppt.js"

      // 加载CSS文件
      await Promise.all([
        loadCSS(`${baseUrl}/css/pptxjs.css`, "pptxjs-css"),
        loadCSS(`${baseUrl}/css/nv.d3.min.css`, "nv-d3-css"),
      ])

      // 按顺序加载JS文件
      await loadScript(`${baseUrl}/js/jquery-1.11.3.min.js`, "jquery-script")
      // 使用JSZip 2.x版本，不支持3.x
      await loadScript(
        "https://unpkg.com/jszip@2.6.1/dist/jszip.min.js",
        "jszip-script",
      )
      await loadScript(`${baseUrl}/js/filereader.js`, "filereader-script")
      await loadScript(`${baseUrl}/js/d3.min.js`, "d3-script")
      await loadScript(`${baseUrl}/js/nv.d3.min.js`, "nv-d3-script")
      await loadScript(`${baseUrl}/js/pptxjs.js`, "pptxjs-script")
      await loadScript(`${baseUrl}/js/divs2slides.js`, "divs2slides-script")

      // 等待jQuery加载完成
      if (!window.$ || !window.jQuery) {
        throw new Error("jQuery not loaded")
      }

      // 将CSS注入Shadow DOM
      if (shadowHostRef?.shadowRoot) {
        injectStylesToShadow(shadowHostRef.shadowRoot)
      }

      // 初始化pptxToHtml（渲染到Shadow DOM内的resultRef）
      if (resultRef) {
        window.$(resultRef).pptxToHtml({
          pptxFileUrl: currentObjLink(),
          slideMode: false,
          keyBoardShortCut: false,
          slideModeConfig: {
            first: 1,
            nav: false,
            navTxtColor: "white",
            navNextTxt: "&#8250;",
            navPrevTxt: "&#8249;",
            showPlayPauseBtn: false,
            keyBoardShortCut: false,
            showSlideNum: false,
            showTotalSlideNum: false,
            autoSlide: false,
            randomAutoSlide: false,
            loop: false,
            background: "black",
            transition: "default",
            transitionTime: 1,
          },
        })

        // 监听加载完成事件
        setTimeout(() => {
          setLoading(false)
        }, 2000)
      }
    } catch (e) {
      console.error("PPT初始化失败:", e)
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
        if (resultRef) {
          const slides = resultRef.querySelectorAll(".slide")
          slides.forEach((slide: any) => {
            slide.style.width = "99%"
            slide.style.margin = "0 auto"
          })
        }
      })
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false)
        if (resultRef) {
          const slides = resultRef.querySelectorAll(".slide")
          slides.forEach((slide: any) => {
            slide.style.width = ""
            slide.style.margin = ""
          })
        }
      })
    }
  }

  // 监听全屏变化
  const handleFullscreenChange = () => {
    if (!document.fullscreenElement) {
      setIsFullscreen(false)
      if (resultRef) {
        const slides = resultRef.querySelectorAll(".slide")
        slides.forEach((slide: any) => {
          slide.style.width = ""
          slide.style.margin = ""
        })
      }
    }
    applyScale()
  }

  // 应用缩放
  const applyScale = () => {
    if (!resultRef || !containerRef) return
    const z = zoom()
    if (z === null) {
      // auto-fit: 缩放到容器宽度
      const containerWidth = containerRef.clientWidth
      const contentWidth = resultRef.scrollWidth
      if (contentWidth > containerWidth) {
        resultRef.style.zoom = `${containerWidth / contentWidth}`
      } else {
        resultRef.style.zoom = ""
      }
    } else {
      resultRef.style.zoom = `${z}`
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
    // 创建Shadow DOM，将PPT内容隔离在里面，防止pptxjs的高z-index影响外部
    if (shadowHostRef) {
      const shadow = shadowHostRef.attachShadow({ mode: "open" })
      resultRef = document.createElement("div")
      resultRef.id = "ppt-result"
      resultRef.style.cssText = "width:100%;height:100%;"
      shadow.appendChild(resultRef)
    }
    initPPTViewer()
    setupResponsiveScale()
    document.addEventListener("fullscreenchange", handleFullscreenChange)
  })

  onCleanup(() => {
    document.removeEventListener("fullscreenchange", handleFullscreenChange)
  })

  return (
    <BoxWithFullScreen w="$full" h="70vh" pos="relative">
      {/* PPT容器 */}
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
        {/* Shadow DOM宿主 - 隔离pptxjs生成的高z-index元素 */}
        <div
          ref={shadowHostRef}
          style={{
            width: "100%",
            height: "100%",
            display: loading() || error() ? "none" : "block",
          }}
        />

        {/* 加载状态 */}
        <Show when={loading()}>
          <FullLoading />
        </Show>

        {/* 错误状态 */}
        <Show when={error()}>
          <Erro msg={t("preview.failed_load_ppt")} h="70vh" />
        </Show>
      </div>

      {/* 缩放控制 */}
      <Box
        pos="absolute"
        top="$2"
        left="$2"
        zIndex="9999"
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
        zIndex="9999"
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
    </BoxWithFullScreen>
  )
}

export default PPTViewerApp
