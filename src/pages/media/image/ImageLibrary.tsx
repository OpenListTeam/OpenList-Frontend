import { createSignal, Show, For, onCleanup, onMount } from "solid-js"
import { accent } from "~/utils/accent"
import { MediaLayout } from "../MediaLayout"
import { MediaBrowser } from "../MediaBrowser"
import type { MediaItem } from "~/types"
import { getMediaName } from "~/types"
import { createSignedProxyUrl, mediaItemPath } from "~/utils/media_api"
import { useT } from "~/hooks"
import { formatMediaSize } from "../ui"

// ==================== 图片预览器 ====================
const ImageViewer = (props: {
  items: MediaItem[]
  initialIndex: number
  onClose: () => void
}) => {
  const t = useT()
  const [currentIndex, setCurrentIndex] = createSignal(props.initialIndex)
  const [isFullscreen, setIsFullscreen] = createSignal(false)
  const [scale, setScale] = createSignal(1)

  const current = () => props.items[currentIndex()]
  // 使用签名后的 /p 代理地址（带 force 避免 302 到外部存储的 CORS 问题），路径已做 URL 编码
  const signedImageUrl = createSignedProxyUrl(() => mediaItemPath(current()))
  const imageUrl = () => signedImageUrl()

  const prev = () => {
    setCurrentIndex((i) => (i - 1 + props.items.length) % props.items.length)
    setScale(1)
  }
  const next = () => {
    setCurrentIndex((i) => (i + 1) % props.items.length)
    setScale(1)
  }

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") prev()
    else if (e.key === "ArrowRight") next()
    else if (e.key === "Escape") props.onClose()
    else if (e.key === "f" || e.key === "F") toggleFullscreen()
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKey)
  })
  onCleanup(() => {
    document.removeEventListener("keydown", handleKey)
    if (document.fullscreenElement) document.exitFullscreen()
  })

  return (
    <div
      style={{
        position: "fixed",
        inset: "0",
        "z-index": "300",
        background: "rgba(0,0,0,0.95)",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      {/* 顶部工具栏 */}
      <div
        style={{
          position: "absolute",
          top: "0",
          left: "0",
          right: "0",
          padding: "16px 20px",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)",
          "z-index": "1",
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.7)", "font-size": "14px" }}>
          {getMediaName(current())}
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <span
            style={{
              color: "rgba(255,255,255,0.5)",
              "font-size": "13px",
              "line-height": "32px",
            }}
          >
            {currentIndex() + 1} / {props.items.length}
          </span>
          <button
            onClick={toggleFullscreen}
            style={viewerBtnStyle}
            title={t("media.image.fullscreen")}
          >
            {isFullscreen() ? "⊡" : "⊞"}
          </button>
          <button
            onClick={() => setScale((s) => Math.min(s + 0.25, 4))}
            style={viewerBtnStyle}
            title={t("media.image.zoom_in")}
          >
            +
          </button>
          <button
            onClick={() => setScale((s) => Math.max(s - 0.25, 0.25))}
            style={viewerBtnStyle}
            title={t("media.image.zoom_out")}
          >
            −
          </button>
          <button
            onClick={() => setScale(1)}
            style={viewerBtnStyle}
            title={t("media.image.reset")}
          >
            ↺
          </button>
          <button
            onClick={props.onClose}
            style={{
              ...viewerBtnStyle,
              background: "rgba(239,68,68,0.2)",
              color: "#f87171",
            }}
            title={t("media.image.close")}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 上一张 */}
      <button
        onClick={prev}
        style={{
          position: "absolute",
          left: "16px",
          top: "50%",
          transform: "translateY(-50%)",
          background: "rgba(255,255,255,0.1)",
          border: "none",
          "border-radius": "50%",
          width: "48px",
          height: "48px",
          color: "white",
          "font-size": "20px",
          cursor: "pointer",
          "z-index": "1",
          transition: "background 0.2s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.2)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.1)"
        }}
      >
        ‹
      </button>

      {/* 图片 */}
      <img
        src={imageUrl()}
        alt={getMediaName(current())}
        style={{
          "max-width": "90vw",
          "max-height": "85vh",
          "object-fit": "contain",
          transform: `scale(${scale()})`,
          transition: "transform 0.2s ease",
          "border-radius": "4px",
          "user-select": "none",
        }}
        draggable={false}
      />

      {/* 下一张 */}
      <button
        onClick={next}
        style={{
          position: "absolute",
          right: "16px",
          top: "50%",
          transform: "translateY(-50%)",
          background: "rgba(255,255,255,0.1)",
          border: "none",
          "border-radius": "50%",
          width: "48px",
          height: "48px",
          color: "white",
          "font-size": "20px",
          cursor: "pointer",
          "z-index": "1",
          transition: "background 0.2s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.2)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.1)"
        }}
      >
        ›
      </button>

      {/* 底部缩略图条 */}
      <div
        style={{
          position: "absolute",
          bottom: "0",
          left: "0",
          right: "0",
          padding: "12px 20px",
          display: "flex",
          gap: "6px",
          "overflow-x": "auto",
          background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
          "justify-content": "center",
        }}
      >
        <For
          each={props.items.slice(
            Math.max(0, currentIndex() - 5),
            currentIndex() + 6,
          )}
        >
          {(item, i) => {
            const realIndex = Math.max(0, currentIndex() - 5) + i()
            const thumbUrl = createSignedProxyUrl(() => mediaItemPath(item))
            return (
              <img
                src={thumbUrl()}
                onClick={() => {
                  setCurrentIndex(realIndex)
                  setScale(1)
                }}
                style={{
                  width: "48px",
                  height: "48px",
                  "object-fit": "cover",
                  "border-radius": "4px",
                  cursor: "pointer",
                  opacity: realIndex === currentIndex() ? "1" : "0.5",
                  border:
                    realIndex === currentIndex()
                      ? `2px solid ${accent()}`
                      : "2px solid transparent",
                  transition: "opacity 0.2s",
                  "flex-shrink": "0",
                }}
                loading="lazy"
              />
            )
          }}
        </For>
      </div>
    </div>
  )
}

const viewerBtnStyle = {
  background: "rgba(255,255,255,0.1)",
  border: "none",
  "border-radius": "6px",
  color: "rgba(255,255,255,0.8)",
  width: "32px",
  height: "32px",
  cursor: "pointer",
  "font-size": "14px",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
}

// ==================== 图片卡片 ====================
const ImageCard = (props: { item: MediaItem }) => {
  // 签名 + 编码后的 /p 代理地址，见 createSignedProxyUrl
  const imageUrl = createSignedProxyUrl(() => mediaItemPath(props.item))
  const [hover, setHover] = createSignal(false)
  return (
    <div
      style={{
        position: "relative",
        "border-radius": "8px",
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.06)",
        transition: "transform 0.2s, box-shadow 0.2s",
        background: "#1e293b",
      }}
      onMouseEnter={(e) => {
        setHover(true)
        e.currentTarget.style.transform = "scale(1.02)"
        e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.4)"
      }}
      onMouseLeave={(e) => {
        setHover(false)
        e.currentTarget.style.transform = "scale(1)"
        e.currentTarget.style.boxShadow = "none"
      }}
    >
      <img
        src={imageUrl()}
        alt={getMediaName(props.item)}
        style={{
          width: "100%",
          height: "auto",
          display: "block",
        }}
        loading="lazy"
      />
      <Show when={hover()}>
        <div
          style={{
            position: "absolute",
            inset: "auto 0 0 0",
            padding: "10px 12px",
            background:
              "linear-gradient(to top, rgba(0,0,0,0.92), rgba(0,0,0,0.4), transparent)",
            color: "#e2e8f0",
            "pointer-events": "none",
          }}
        >
          <div
            style={{
              "font-size": "12px",
              "font-weight": "500",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
              "margin-bottom": "3px",
            }}
          >
            {getMediaName(props.item)}
          </div>
          <div
            style={{
              "font-size": "10px",
              color: "rgba(148,163,184,0.9)",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}
          >
            {[
              props.item.release_date?.slice(0, 10),
              formatMediaSize(props.item.file_size),
              props.item.description,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </Show>
    </div>
  )
}

// ==================== 图片库主页 ====================
const ImageLibrary = () => {
  const t = useT()
  const [viewerItems, setViewerItems] = createSignal<MediaItem[]>([])
  const [viewerIndex, setViewerIndex] = createSignal(0)
  const [showViewer, setShowViewer] = createSignal(false)

  // 当前页所有图片，由 MediaBrowser 通过 onItemsChange 回调更新
  const [currentPageItems, setCurrentPageItems] = createSignal<MediaItem[]>([])

  const handleItemClick = (item: MediaItem) => {
    const allItems = currentPageItems()
    const idx = allItems.findIndex((i) => i.id === item.id)
    setViewerItems(allItems)
    setViewerIndex(idx >= 0 ? idx : 0)
    setShowViewer(true)
  }

  return (
    <MediaLayout title={t("media.image.title")}>
      <Show when={showViewer()}>
        <ImageViewer
          items={viewerItems()}
          initialIndex={viewerIndex()}
          onClose={() => setShowViewer(false)}
        />
      </Show>

      <MediaBrowser
        mediaType="image"
        onItemsChange={(items) => setCurrentPageItems(items)}
        onItemClick={(item) => handleItemClick(item)}
        renderCard={(item) => <ImageCard item={item} />}
        renderListRow={(item) => {
          const rowUrl = createSignedProxyUrl(() => mediaItemPath(item))
          return (
            <>
              <img
                src={rowUrl()}
                style={{
                  width: "48px",
                  height: "48px",
                  "object-fit": "cover",
                  "border-radius": "4px",
                  "flex-shrink": "0",
                }}
                loading="lazy"
              />
              <div style={{ flex: "1", "min-width": "0" }}>
                <div
                  style={{
                    color: "#e2e8f0",
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
                    color: "#64748b",
                    "font-size": "12px",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                >
                  {[item.description, item.folder_path]
                    .filter(Boolean)
                    .join(" · ") || item.file_name}
                </div>
              </div>
              <div
                style={{
                  color: "#475569",
                  "font-size": "12px",
                  "text-align": "right",
                  "flex-shrink": "0",
                  "line-height": "1.5",
                }}
              >
                <div>{item.release_date?.slice(0, 10)}</div>
                <div>{formatMediaSize(item.file_size)}</div>
              </div>
            </>
          )
        }}
      />
    </MediaLayout>
  )
}

export default ImageLibrary
