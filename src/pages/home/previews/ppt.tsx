import { BoxWithFullScreen, Error, FullLoading } from "~/components"
import { objStore } from "~/store"
import { Box, IconButton, Tooltip } from "@hope-ui/solid"
import { createSignal, onMount, onCleanup, Show } from "solid-js"
import { useT } from "~/hooks"
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
      // 使用JSZip 3.x版本，与docx预览器保持一致
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

      // 初始化pptxToHtml
      if (resultRef) {
        window.$(resultRef).pptxToHtml({
          pptxFileUrl: objStore.raw_url,
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
        // 调整幻灯片大小
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
        // 恢复幻灯片大小
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
      // 恢复幻灯片大小
      if (resultRef) {
        const slides = resultRef.querySelectorAll(".slide")
        slides.forEach((slide: any) => {
          slide.style.width = ""
          slide.style.margin = ""
        })
      }
    }
  }

  onMount(() => {
    initPPTViewer()
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
        <div
          ref={resultRef}
          id="ppt-result"
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
          <Error msg={t("preview.failed_load_ppt")} h="70vh" />
        </Show>
      </div>
    </BoxWithFullScreen>
  )
}

export default PPTViewerApp
