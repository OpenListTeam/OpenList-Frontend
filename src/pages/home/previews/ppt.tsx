import { BoxWithFullScreen, Error as Erro, FullLoading } from "~/components"
import { Box, IconButton, Tooltip } from "@hope-ui/solid"
import { loadScript, loadCSS } from "~/utils"
import { createSignal, onMount, onCleanup, Show } from "solid-js"
import { useLink, useT } from "~/hooks"
import { VsScreenFull, VsScreenNormal } from "solid-icons/vs"

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
  }

  // 响应式缩放ppt内容以适配移动端
  const setupResponsiveScale = () => {
    if (!resultRef || !containerRef) return
    const result = resultRef
    const container = containerRef
    const observer = new ResizeObserver(() => {
      const containerWidth = container.clientWidth
      const contentWidth = result.scrollWidth
      if (contentWidth > containerWidth) {
        result.style.zoom = `${containerWidth / contentWidth}`
      } else {
        result.style.zoom = ""
      }
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
