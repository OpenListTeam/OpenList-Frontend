import { resolveMediaCover } from "~/utils/media_cover"
import { accentGradient } from "~/utils/accent"
import {
  createSignal,
  createResource,
  createMemo,
  Show,
  For,
  onMount,
  onCleanup,
  createEffect,
} from "solid-js"
import { useColorMode } from "@hope-ui/solid"
import { MediaLayout } from "../MediaLayout"
import { MediaBrowser } from "../MediaBrowser"
import { formatMediaSize, mediaBackBtn, mediaPrimaryBtn } from "../ui"
import {
  createSignedProxyUrl,
  getMediaItem,
  getMediaStreamUrl,
} from "~/utils/media_api"
import type { MediaItem, EpisodeInfo } from "~/types"
import { getMediaName, parseAuthors, parseEpisodes } from "~/types"
import { api } from "~/utils"
import { encodePath } from "~/utils/path"

// ==================== PDF阅读器 ====================
const PDFReader = (props: { url: string; title: string }) => {
  const [currentPage, setCurrentPage] = createSignal(1)
  const [totalPages, setTotalPages] = createSignal(0)
  const [jumpInput, setJumpInput] = createSignal("")
  const [scale, setScale] = createSignal(1.2)
  const [toc, setToc] = createSignal<Array<{ title: string; page: number }>>([])
  const [showToc, setShowToc] = createSignal(false)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")

  let canvasRef: HTMLCanvasElement | undefined
  let pdfDoc: any = null

  const renderPage = async (num: number) => {
    if (!pdfDoc || !canvasRef) return
    setLoading(true)
    try {
      const page = await pdfDoc.getPage(num)
      const viewport = page.getViewport({ scale: scale() })
      const ctx = canvasRef.getContext("2d")!
      canvasRef.width = viewport.width
      canvasRef.height = viewport.height
      await page.render({ canvasContext: ctx, viewport }).promise
    } finally {
      setLoading(false)
    }
  }

  onMount(async () => {
    // 动态加载 pdf.js CDN
    const pdfjsLib = (window as any).pdfjsLib
    if (!pdfjsLib) {
      const script = document.createElement("script")
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
      script.onload = () => initPDF()
      document.head.appendChild(script)
    } else {
      initPDF()
    }
  })

  const initPDF = async () => {
    try {
      const pdfjsLib = (window as any).pdfjsLib
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
      pdfDoc = await pdfjsLib.getDocument(props.url).promise
      setTotalPages(pdfDoc.numPages)

      // 提取目录
      const outline = await pdfDoc.getOutline()
      if (outline) {
        const items: Array<{ title: string; page: number }> = []
        for (const item of outline.slice(0, 50)) {
          try {
            const dest = await pdfDoc.getDestination(item.dest)
            if (dest) {
              const ref = dest[0]
              const pageIdx = await pdfDoc.getPageIndex(ref)
              items.push({ title: item.title, page: pageIdx + 1 })
            }
          } catch {}
        }
        setToc(items)
      }

      await renderPage(1)
    } catch (e: any) {
      setError("PDF加载失败：" + (e?.message ?? String(e)))
      setLoading(false)
    }
  }

  createEffect(() => {
    const p = currentPage()
    const s = scale()
    if (pdfDoc) renderPage(p)
  })

  const goPage = (p: number) => {
    const total = totalPages()
    if (p >= 1 && p <= total) setCurrentPage(p)
  }

  const handleJump = () => {
    const p = parseInt(jumpInput())
    if (!isNaN(p)) goPage(p)
    setJumpInput("")
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* 工具栏 */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 16px",
          background: "rgba(0,0,0,0.5)",
          "border-bottom": "1px solid rgba(255,255,255,0.08)",
          "flex-shrink": "0",
        }}
      >
        <button
          onClick={() => setShowToc(!showToc())}
          style={readerBtnStyle}
          title="目录"
        >
          ☰ 目录
        </button>
        <div style={{ flex: "1" }} />
        {/* 缩放 */}
        <button
          onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
          style={readerBtnStyle}
        >
          －
        </button>
        <span
          style={{
            color: "#94a3b8",
            "font-size": "12px",
            "min-width": "40px",
            "text-align": "center",
          }}
        >
          {Math.round(scale() * 100)}%
        </span>
        <button
          onClick={() => setScale((s) => Math.min(3, s + 0.2))}
          style={readerBtnStyle}
        >
          ＋
        </button>
        <div
          style={{
            width: "1px",
            height: "20px",
            background: "rgba(255,255,255,0.1)",
            margin: "0 4px",
          }}
        />
        {/* 翻页 */}
        <button
          disabled={currentPage() <= 1}
          onClick={() => goPage(currentPage() - 1)}
          style={{
            ...readerBtnStyle,
            opacity: currentPage() <= 1 ? "0.4" : "1",
          }}
        >
          ← 上一页
        </button>
        <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
          <input
            type="number"
            value={jumpInput() || currentPage()}
            onInput={(e) => setJumpInput(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJump()}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              "border-radius": "5px",
              color: "#e2e8f0",
              padding: "3px 6px",
              "font-size": "12px",
              width: "52px",
              outline: "none",
              "text-align": "center",
            }}
          />
          <span style={{ color: "#475569", "font-size": "12px" }}>
            / {totalPages()}
          </span>
          <button onClick={handleJump} style={readerBtnStyle}>
            跳转
          </button>
        </div>
        <button
          disabled={currentPage() >= totalPages()}
          onClick={() => goPage(currentPage() + 1)}
          style={{
            ...readerBtnStyle,
            opacity: currentPage() >= totalPages() ? "0.4" : "1",
          }}
        >
          下一页 →
        </button>
      </div>

      {/* 主体 */}
      <div style={{ flex: "1", display: "flex", overflow: "hidden" }}>
        {/* 目录侧边栏 */}
        <Show when={showToc()}>
          <div
            style={{
              width: "220px",
              "flex-shrink": "0",
              background: "rgba(0,0,0,0.35)",
              "border-right": "1px solid rgba(255,255,255,0.08)",
              "overflow-y": "auto",
              padding: "12px",
            }}
          >
            <div
              style={{
                color: "#64748b",
                "font-size": "11px",
                "font-weight": "700",
                "text-transform": "uppercase",
                "letter-spacing": "0.08em",
                "margin-bottom": "10px",
              }}
            >
              目录
            </div>
            <Show
              when={toc().length > 0}
              fallback={
                <div style={{ color: "#475569", "font-size": "13px" }}>
                  暂无目录
                </div>
              }
            >
              <For each={toc()}>
                {(item) => (
                  <div
                    onClick={() => goPage(item.page)}
                    style={{
                      padding: "6px 8px",
                      "border-radius": "6px",
                      cursor: "pointer",
                      color:
                        currentPage() === item.page ? "#a5b4fc" : "#94a3b8",
                      background:
                        currentPage() === item.page
                          ? "rgba(24,144,255,0.15)"
                          : "transparent",
                      "font-size": "13px",
                      "margin-bottom": "2px",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                      transition: "background 0.15s",
                    }}
                    title={`${item.title} (第${item.page}页)`}
                  >
                    {item.title}
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>

        {/* Canvas渲染区 */}
        <div
          style={{
            flex: "1",
            overflow: "auto",
            display: "flex",
            "justify-content": "center",
            background: "#2a2a3e",
            padding: "20px",
          }}
        >
          <Show when={error()}>
            <div
              style={{
                color: "#f87171",
                "font-size": "14px",
                "padding-top": "60px",
              }}
            >
              {error()}
            </div>
          </Show>
          <Show when={!error()}>
            <div style={{ position: "relative" }}>
              <Show when={loading()}>
                <div
                  style={{
                    position: "absolute",
                    inset: "0",
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                    background: "rgba(0,0,0,0.4)",
                    "z-index": "1",
                    color: "#94a3b8",
                    "font-size": "14px",
                  }}
                >
                  加载中...
                </div>
              </Show>
              <canvas
                ref={canvasRef}
                style={{
                  display: "block",
                  "box-shadow": "0 4px 24px rgba(0,0,0,0.5)",
                }}
              />
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}

// ==================== EPUB阅读器 ====================
const EPUBReader = (props: { url: string; title: string }) => {
  const [toc, setToc] = createSignal<Array<{ label: string; href: string }>>([])
  const [showToc, setShowToc] = createSignal(false)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")
  let viewerRef: HTMLDivElement | undefined
  let book: any = null
  let rendition: any = null

  onMount(() => {
    const epubjs = (window as any).ePub
    if (!epubjs) {
      const script = document.createElement("script")
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/epub.js/0.3.93/epub.min.js"
      script.onload = () => initEpub()
      document.head.appendChild(script)
    } else {
      initEpub()
    }
  })

  const initEpub = () => {
    try {
      const ePub = (window as any).ePub
      book = ePub(props.url)
      rendition = book.renderTo(viewerRef!, {
        width: "100%",
        height: "100%",
        spread: "none",
      })
      rendition.display()
      rendition.themes.default({
        body: {
          background: "#1e1e2e !important",
          color: "#e2e8f0 !important",
          "font-family": "'Georgia', serif !important",
          "line-height": "1.8 !important",
          padding: "20px 40px !important",
        },
        a: { color: "#a5b4fc !important" },
      })
      book.ready.then(() => {
        setLoading(false)
        book.navigation.toc.forEach((item: any) => {
          setToc((prev) => [...prev, { label: item.label, href: item.href }])
        })
      })
    } catch (e: any) {
      setError("EPUB加载失败：" + (e?.message ?? String(e)))
      setLoading(false)
    }
  }

  onCleanup(() => {
    rendition?.destroy()
    book?.destroy()
  })

  const goToc = (href: string) => {
    rendition?.display(href)
    setShowToc(false)
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* 工具栏 */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 16px",
          background: "rgba(0,0,0,0.5)",
          "border-bottom": "1px solid rgba(255,255,255,0.08)",
          "flex-shrink": "0",
        }}
      >
        <button
          onClick={() => setShowToc(!showToc())}
          style={readerBtnStyle}
          title="目录"
        >
          ☰ 目录
        </button>
        <div style={{ flex: "1" }} />
        <button onClick={() => rendition?.prev()} style={readerBtnStyle}>
          ← 上一页
        </button>
        <button onClick={() => rendition?.next()} style={readerBtnStyle}>
          下一页 →
        </button>
      </div>

      {/* 主体 */}
      <div style={{ flex: "1", display: "flex", overflow: "hidden" }}>
        {/* 目录侧边栏 */}
        <Show when={showToc()}>
          <div
            style={{
              width: "220px",
              "flex-shrink": "0",
              background: "rgba(0,0,0,0.35)",
              "border-right": "1px solid rgba(255,255,255,0.08)",
              "overflow-y": "auto",
              padding: "12px",
            }}
          >
            <div
              style={{
                color: "#64748b",
                "font-size": "11px",
                "font-weight": "700",
                "text-transform": "uppercase",
                "letter-spacing": "0.08em",
                "margin-bottom": "10px",
              }}
            >
              目录
            </div>
            <Show
              when={toc().length > 0}
              fallback={
                <div style={{ color: "#475569", "font-size": "13px" }}>
                  加载中...
                </div>
              }
            >
              <For each={toc()}>
                {(item) => (
                  <div
                    onClick={() => goToc(item.href)}
                    style={{
                      padding: "6px 8px",
                      "border-radius": "6px",
                      cursor: "pointer",
                      color: "#94a3b8",
                      "font-size": "13px",
                      "margin-bottom": "2px",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(24,144,255,0.15)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    {item.label}
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>

        {/* EPUB渲染区 */}
        <div
          style={{
            flex: "1",
            overflow: "hidden",
            background: "#1e1e2e",
            position: "relative",
          }}
        >
          <Show when={loading()}>
            <div
              style={{
                position: "absolute",
                inset: "0",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                color: "#94a3b8",
                "font-size": "14px",
                "z-index": "1",
              }}
            >
              加载中...
            </div>
          </Show>
          <Show when={error()}>
            <div
              style={{
                color: "#f87171",
                "font-size": "14px",
                padding: "60px 20px",
              }}
            >
              {error()}
            </div>
          </Show>
          <div ref={viewerRef} style={{ width: "100%", height: "100%" }} />
        </div>
      </div>
    </div>
  )
}

// ==================== 书籍阅读器（外层容器） ====================
const BookReader = (props: {
  item: MediaItem
  // 可选：指定播放的文件路径和标题（用于选集阅读）
  filePath?: string
  title?: string
  onClose: () => void
}) => {
  // 优先使用传入的 filePath，否则拼接 folder_path + "/" + file_name
  const resolvedPath = () => {
    if (props.filePath) return props.filePath
    const folder = props.item.folder_path?.replace(/\/$/, "") ?? ""
    return `${folder}/${props.item.file_name}`
  }
  // 签名 + 编码后的代理地址；就绪前为 undefined，避免先发出必然 401 的请求
  const signedFileUrl = createSignedProxyUrl(resolvedPath)
  const fileUrl = () => signedFileUrl() ?? ""
  const readerTitle = () => props.title ?? getMediaName(props.item)
  const fileNameForExt = () => {
    const path = props.filePath ?? props.item.file_name ?? ""
    return path.split("/").pop() ?? path
  }
  const ext = () => fileNameForExt().split(".").pop()?.toLowerCase() ?? ""
  const isPDF = () => ext() === "pdf"
  const isEpub = () => ext() === "epub"

  return (
    <div
      style={{
        position: "fixed",
        inset: "0",
        "z-index": "200",
        background: "#1a1a2e",
        display: "flex",
        "flex-direction": "column",
      }}
    >
      {/* 顶部标题栏 */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "12px",
          padding: "10px 20px",
          background: "rgba(0,0,0,0.6)",
          "border-bottom": "1px solid rgba(255,255,255,0.08)",
          "flex-shrink": "0",
        }}
      >
        <span style={{ "font-size": "18px" }}>📖</span>
        <span
          style={{
            color: "#e2e8f0",
            "font-size": "14px",
            "font-weight": "500",
            flex: "1",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {readerTitle()}
        </span>
        <button
          onClick={props.onClose}
          style={{ ...readerBtnStyle, color: "#f87171" }}
          title="关闭"
        >
          ✕ 关闭
        </button>
      </div>

      {/* 阅读器主体 */}
      <div style={{ flex: "1", overflow: "hidden" }}>
        <Show when={isPDF() && fileUrl()}>
          <PDFReader url={fileUrl()} title={getMediaName(props.item)} />
        </Show>
        <Show when={isEpub() && fileUrl()}>
          <EPUBReader url={fileUrl()} title={getMediaName(props.item)} />
        </Show>
        <Show when={!isPDF() && !isEpub()}>
          <div
            style={{
              flex: "1",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              "flex-direction": "column",
              gap: "16px",
              color: "#475569",
              height: "100%",
            }}
          >
            <div style={{ "font-size": "64px" }}>📄</div>
            <div style={{ "font-size": "16px" }}>
              暂不支持在线阅读此格式（{ext().toUpperCase()}）
            </div>
            <a
              href="#"
              onClick={async (e) => {
                e.preventDefault()
                // /d 同样受签名保护：点击时取后端签名直链再下载
                const resp = await getMediaStreamUrl({ path: resolvedPath() })
                const url =
                  resp.code === 200 && resp.data?.url
                    ? resp.data.url
                    : `${api}/d${encodePath(resolvedPath())}`
                window.open(url, "_blank")
              }}
              style={{ ...mediaPrimaryBtn, "text-decoration": "none" }}
            >
              ⬇ 下载文件
            </a>
          </div>
        </Show>
      </div>
    </div>
  )
}

const readerBtnStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  "border-radius": "6px",
  color: "#94a3b8",
  padding: "5px 10px",
  "font-size": "13px",
  cursor: "pointer",
}

// ==================== 书籍卡片 ====================
const BookCard = (props: { item: MediaItem }) => {
  const { colorMode } = useColorMode()
  const isDark = createMemo(() => colorMode() === "dark")
  const cardBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
  )
  const cardBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)",
  )
  const coverBg = createMemo(() => (isDark() ? "#1e293b" : "#e2e8f0"))
  const coverFallbackBg = createMemo(() =>
    isDark()
      ? "linear-gradient(135deg, #1e293b, #0f172a)"
      : "linear-gradient(135deg, #e2e8f0, #cbd5e1)",
  )
  const titleColor = createMemo(() => (isDark() ? "#e2e8f0" : "#1e293b"))
  const subColor = createMemo(() => (isDark() ? "#64748b" : "#94a3b8"))
  const badgeColor = createMemo(() => (isDark() ? "#94a3b8" : "#64748b"))
  const name = () => getMediaName(props.item)
  const [hover, setHover] = createSignal(false)
  const authors = () => parseAuthors(props.item.authors)
  return (
    <div
      style={{
        background: cardBg(),
        "border-radius": "10px",
        overflow: "hidden",
        border: `1px solid ${cardBorder()}`,
        transition: "transform 0.2s, box-shadow 0.2s",
      }}
      onMouseEnter={(e) => {
        setHover(true)
        e.currentTarget.style.transform = "translateY(-4px)"
        e.currentTarget.style.boxShadow = isDark()
          ? "0 12px 32px rgba(0,0,0,0.4)"
          : "0 12px 32px rgba(0,0,0,0.15)"
      }}
      onMouseLeave={(e) => {
        setHover(false)
        e.currentTarget.style.transform = "translateY(0)"
        e.currentTarget.style.boxShadow = "none"
      }}
    >
      {/* 封面 */}
      <div
        style={{
          position: "relative",
          "padding-top": "140%",
          background: coverBg(),
        }}
      >
        <Show
          when={props.item.cover}
          fallback={
            <div
              style={{
                position: "absolute",
                inset: "0",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "flex-direction": "column",
                gap: "8px",
                background: coverFallbackBg(),
              }}
            >
              <span style={{ "font-size": "40px" }}>📚</span>
              <span
                style={{
                  color: subColor(),
                  "font-size": "11px",
                  "text-align": "center",
                  padding: "0 8px",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                  width: "100%",
                }}
              >
                {name()}
              </span>
            </div>
          }
        >
          <img
            src={resolveMediaCover(props.item.cover)}
            alt={name()}
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              "object-fit": "cover",
            }}
            loading="lazy"
          />
        </Show>
        {/* 格式角标 */}
        <div
          style={{
            position: "absolute",
            bottom: "6px",
            right: "6px",
            background: "rgba(0,0,0,0.7)",
            "border-radius": "4px",
            padding: "2px 6px",
            "font-size": "10px",
            color: badgeColor(),
            "text-transform": "uppercase",
          }}
        >
          {props.item.file_name?.split(".").pop()}
        </div>
        {/* 悬浮详情 */}
        <Show when={hover()}>
          <div
            style={{
              position: "absolute",
              inset: "0",
              display: "flex",
              "flex-direction": "column",
              "justify-content": "flex-end",
              gap: "5px",
              padding: "12px",
              background:
                "linear-gradient(to top, rgba(0,0,0,0.94), rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.1))",
              color: "#e2e8f0",
              "font-size": "11px",
              "line-height": "1.5",
              "pointer-events": "none",
            }}
          >
            <Show when={authors().length > 0}>
              <div>作者：{authors().slice(0, 3).join(" / ")}</div>
            </Show>
            <Show when={props.item.description || props.item.plot}>
              <div
                style={{
                  display: "-webkit-box",
                  "-webkit-line-clamp": "4",
                  "-webkit-box-orient": "vertical",
                  overflow: "hidden",
                  color: "rgba(226,232,240,0.8)",
                }}
              >
                {props.item.description || props.item.plot}
              </div>
            </Show>
            <div
              style={{ color: "rgba(148,163,184,0.9)", "font-size": "10px" }}
            >
              {[
                props.item.publisher,
                props.item.release_date?.slice(0, 4),
                formatMediaSize(props.item.file_size),
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </Show>
      </div>
      {/* 信息 */}
      <div style={{ padding: "10px 12px" }}>
        <div
          style={{
            color: titleColor(),
            "font-size": "13px",
            "font-weight": "500",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            "margin-bottom": "3px",
          }}
          title={name()}
        >
          {name()}
        </div>
        <div
          style={{
            color: subColor(),
            "font-size": "11px",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
          title={[
            authors()[0],
            props.item.release_date?.slice(0, 4),
            formatMediaSize(props.item.file_size),
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          {[
            authors()[0],
            props.item.release_date?.slice(0, 4),
            formatMediaSize(props.item.file_size),
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </div>
  )
}

// ==================== 书籍详情 ====================
const BookDetail = (props: { id: string; onBack: () => void }) => {
  const { colorMode } = useColorMode()
  const isDark = createMemo(() => colorMode() === "dark")
  const titleColor = createMemo(() => (isDark() ? "#f1f5f9" : "#0f172a"))
  const metaColor = createMemo(() => (isDark() ? "#94a3b8" : "#475569"))
  const subMetaColor = createMemo(() => (isDark() ? "#64748b" : "#94a3b8"))
  const plotTitleColor = createMemo(() => (isDark() ? "#64748b" : "#94a3b8"))
  const plotColor = createMemo(() => (isDark() ? "#cbd5e1" : "#334155"))
  const coverFallbackBg = createMemo(() =>
    isDark()
      ? "linear-gradient(135deg, #1e293b, #0f172a)"
      : "linear-gradient(135deg, #e2e8f0, #cbd5e1)",
  )

  const [item] = createResource(
    () => parseInt(props.id),
    async (id) => {
      const resp = await getMediaItem(id)
      if (resp.code === 200) return resp.data
      return null
    },
  )
  const [showReader, setShowReader] = createSignal(false)
  // 当前阅读的选集（null 表示阅读主文件）
  const [currentEpisode, setCurrentEpisode] = createSignal<EpisodeInfo | null>(
    null,
  )

  return (
    <Show
      when={item()}
      fallback={
        <div
          style={{
            "text-align": "center",
            padding: "60px",
            color: subMetaColor(),
          }}
        >
          {item.loading ? "加载中..." : "资源不存在"}
        </div>
      }
    >
      {(data) => (
        <>
          <Show when={showReader()}>
            <BookReader
              item={data()}
              filePath={
                currentEpisode()
                  ? `${data().folder_path?.replace(/\/$/, "")}/${data().file_name}/${currentEpisode()!.file_name}`
                  : undefined
              }
              title={
                currentEpisode()
                  ? currentEpisode()!.index > 0
                    ? `第${currentEpisode()!.index}册 ${currentEpisode()!.title}`
                    : currentEpisode()!.title
                  : undefined
              }
              onClose={() => setShowReader(false)}
            />
          </Show>

          <button onClick={props.onBack} style={mediaBackBtn(isDark())}>
            ← 返回
          </button>

          <div style={{ display: "flex", gap: "28px", "flex-wrap": "wrap" }}>
            {/* 封面 */}
            <div style={{ "flex-shrink": "0" }}>
              <Show
                when={data().cover}
                fallback={
                  <div
                    style={{
                      width: "180px",
                      height: "252px",
                      background: coverFallbackBg(),
                      "border-radius": "10px",
                      display: "flex",
                      "align-items": "center",
                      "justify-content": "center",
                      "font-size": "64px",
                    }}
                  >
                    📚
                  </div>
                }
              >
                <img
                  src={resolveMediaCover(data().cover)}
                  style={{
                    width: "180px",
                    height: "252px",
                    "object-fit": "cover",
                    "border-radius": "10px",
                    "box-shadow": "0 16px 40px rgba(0,0,0,0.4)",
                  }}
                />
              </Show>
            </div>

            {/* 信息 */}
            <div style={{ flex: "1", "min-width": "240px" }}>
              <h1
                style={{
                  margin: "0 0 8px",
                  "font-size": "24px",
                  color: titleColor(),
                }}
              >
                {getMediaName(data())}
              </h1>
              <Show when={parseAuthors(data().authors).length > 0}>
                <div
                  style={{
                    color: metaColor(),
                    "font-size": "14px",
                    "margin-bottom": "8px",
                  }}
                >
                  作者：{parseAuthors(data().authors).join(" / ")}
                </div>
              </Show>
              <Show when={data().publisher}>
                <div
                  style={{
                    color: subMetaColor(),
                    "font-size": "13px",
                    "margin-bottom": "4px",
                  }}
                >
                  出版社：{data().publisher}
                </div>
              </Show>
              <Show when={data().release_date}>
                <div
                  style={{
                    color: subMetaColor(),
                    "font-size": "13px",
                    "margin-bottom": "4px",
                  }}
                >
                  出版年：{data().release_date?.slice(0, 4)}
                </div>
              </Show>
              <Show when={data().isbn}>
                <div
                  style={{
                    color: subMetaColor(),
                    "font-size": "13px",
                    "margin-bottom": "4px",
                  }}
                >
                  ISBN：{data().isbn}
                </div>
              </Show>
              <Show when={data().rating > 0}>
                <div
                  style={{
                    color: "#fbbf24",
                    "font-size": "14px",
                    "margin-bottom": "12px",
                  }}
                >
                  ⭐ {data().rating.toFixed(1)}
                </div>
              </Show>

              {/* 无选集：直接显示阅读按钮 */}
              <Show when={parseEpisodes(data().episodes).length === 0}>
                <button
                  onClick={() => {
                    setCurrentEpisode(null)
                    setShowReader(true)
                  }}
                  style={{
                    background: accentGradient(),
                    border: "none",
                    "border-radius": "10px",
                    color: "white",
                    padding: "10px 24px",
                    "font-size": "14px",
                    "font-weight": "600",
                    cursor: "pointer",
                    "margin-bottom": "20px",
                  }}
                >
                  📖 阅读
                </button>
              </Show>

              {/* 选集列表（路径合并模式下有选集时显示） */}
              <Show when={parseEpisodes(data().episodes).length > 0}>
                {(_) => {
                  const episodes = parseEpisodes(data().episodes)
                  return (
                    <div style={{ "margin-bottom": "20px" }}>
                      <h3
                        style={{
                          color: plotTitleColor(),
                          "font-size": "12px",
                          "font-weight": "600",
                          "text-transform": "uppercase",
                          "letter-spacing": "0.08em",
                          "margin-bottom": "10px",
                        }}
                      >
                        选集（共 {episodes.length} 册）
                      </h3>
                      <div
                        style={{
                          display: "grid",
                          "grid-template-columns":
                            "repeat(auto-fill, minmax(110px, 1fr))",
                          gap: "6px",
                          "max-height": "220px",
                          "overflow-y": "auto",
                          "padding-right": "4px",
                        }}
                      >
                        <For each={episodes}>
                          {(ep) => {
                            const isActive = () =>
                              currentEpisode()?.file_name === ep.file_name
                            const label =
                              ep.index > 0
                                ? `第${ep.index}册${ep.title ? " " + ep.title : ""}`
                                : ep.title || ep.file_name
                            return (
                              <button
                                onClick={() => {
                                  setCurrentEpisode(ep)
                                  setShowReader(true)
                                }}
                                title={ep.file_name}
                                style={{
                                  background: isActive()
                                    ? accentGradient()
                                    : isDark()
                                      ? "rgba(255,255,255,0.06)"
                                      : "rgba(0,0,0,0.05)",
                                  border: isActive()
                                    ? "none"
                                    : `1px solid ${
                                        isDark()
                                          ? "rgba(255,255,255,0.1)"
                                          : "rgba(0,0,0,0.1)"
                                      }`,
                                  "border-radius": "7px",
                                  color: isActive()
                                    ? "white"
                                    : isDark()
                                      ? "#94a3b8"
                                      : "#475569",
                                  padding: "7px 9px",
                                  "font-size": "12px",
                                  cursor: "pointer",
                                  "text-align": "left",
                                  overflow: "hidden",
                                  "text-overflow": "ellipsis",
                                  "white-space": "nowrap",
                                  transition: "all 0.15s",
                                  "box-shadow": isActive()
                                    ? "0 2px 8px rgba(24,144,255,0.4)"
                                    : "none",
                                }}
                              >
                                📖 {label}
                              </button>
                            )
                          }}
                        </For>
                      </div>
                    </div>
                  )
                }}
              </Show>

              {/* 内容简介 */}
              <Show when={data().plot || data().description}>
                <div>
                  <h3
                    style={{
                      color: plotTitleColor(),
                      "font-size": "12px",
                      "font-weight": "600",
                      "text-transform": "uppercase",
                      "letter-spacing": "0.08em",
                      "margin-bottom": "8px",
                    }}
                  >
                    内容简介
                  </h3>
                  <p
                    style={{
                      color: plotColor(),
                      "font-size": "14px",
                      "line-height": "1.7",
                      margin: "0",
                    }}
                  >
                    {data().plot || data().description}
                  </p>
                </div>
              </Show>
            </div>
          </div>
        </>
      )}
    </Show>
  )
}

// ==================== 书籍库主页 ====================
const BookLibrary = () => {
  const [selectedId, setSelectedId] = createSignal<string | null>(null)

  return (
    <MediaLayout title="📚 书籍库">
      <Show
        when={selectedId()}
        fallback={
          <MediaBrowser
            mediaType="book"
            onItemClick={(item) => setSelectedId(String(item.id))}
            renderCard={(item) => <BookCard item={item} />}
            renderListRow={(item) => {
              const { colorMode: cm } = useColorMode()
              const dark = createMemo(() => cm() === "dark")
              return (
                <>
                  <Show
                    when={item.cover}
                    fallback={<span style={{ "font-size": "20px" }}>📚</span>}
                  >
                    <img
                      src={resolveMediaCover(item.cover)}
                      style={{
                        width: "32px",
                        height: "44px",
                        "object-fit": "cover",
                        "border-radius": "4px",
                      }}
                    />
                  </Show>
                  <div style={{ flex: "1", "min-width": "0" }}>
                    <div
                      style={{
                        color: dark() ? "#e2e8f0" : "#1e293b",
                        "font-size": "14px",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                      }}
                    >
                      {getMediaName(item)}
                    </div>
                    <div
                      style={{
                        color: dark() ? "#475569" : "#94a3b8",
                        "font-size": "12px",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                      }}
                    >
                      {[
                        parseAuthors(item.authors).slice(0, 2).join(" / "),
                        item.publisher,
                        item.release_date?.slice(0, 4),
                      ]
                        .filter(Boolean)
                        .join(" · ") || item.file_name}
                    </div>
                  </div>
                  <div
                    style={{
                      color: dark() ? "#475569" : "#94a3b8",
                      "font-size": "12px",
                      "text-align": "right",
                      "flex-shrink": "0",
                      "line-height": "1.5",
                    }}
                  >
                    <div>{formatMediaSize(item.file_size)}</div>
                    <div>{item.file_name?.split(".").pop()?.toUpperCase()}</div>
                  </div>
                </>
              )
            }}
          />
        }
      >
        <BookDetail id={selectedId()!} onBack={() => setSelectedId(null)} />
      </Show>
    </MediaLayout>
  )
}

export default BookLibrary
