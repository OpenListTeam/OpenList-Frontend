import { For, Show, createMemo } from "solid-js"
import { useColorMode } from "@hope-ui/solid"
import {
  TbStar,
  TbStarFilled,
  TbArrowUpRight,
  TbPhoto,
  TbMovie,
  TbBook,
  TbMusic,
} from "solid-icons/tb"
import { useT } from "~/hooks"
import { resolveMediaCover } from "~/utils/media_cover"
import { accentGradient } from "~/utils/accent"
import {
  formatDuration,
  getMediaName,
  parseAuthors,
  type MediaItem,
} from "~/types"

interface MediaItemDetailProps {
  item: MediaItem
  favorite?: boolean
  onToggleFavorite?: (item: MediaItem, favorite: boolean) => void
  onOpen?: (item: MediaItem) => void
  openLabel?: string
}

const formatSize = (bytes: number) => {
  if (!bytes) return ""
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * 列表视图右侧的详细信息面板。
 * 按媒体类型展示刮削字段，并支持收藏 / 取消收藏。
 */
export const MediaItemDetail = (props: MediaItemDetailProps) => {
  const t = useT()
  const { colorMode } = useColorMode()
  const isDark = createMemo(() => colorMode() === "dark")

  const panelBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.9)",
  )
  const panelBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
  )
  const titleColor = createMemo(() => (isDark() ? "#f1f5f9" : "#0f172a"))
  const labelColor = createMemo(() => (isDark() ? "#64748b" : "#94a3b8"))
  const valueColor = createMemo(() => (isDark() ? "#cbd5e1" : "#334155"))
  const descColor = createMemo(() => (isDark() ? "#94a3b8" : "#475569"))
  const coverBg = createMemo(() =>
    isDark()
      ? "linear-gradient(135deg, #1e293b, #0f172a)"
      : "linear-gradient(135deg, #e2e8f0, #cbd5e1)",
  )

  const rows = createMemo<[string, string][]>(() => {
    const item = props.item
    const list: [string, string][] = []
    const year = (item.release_date || "").slice(0, 4)
    const push = (label: string, value?: string | number) => {
      if (value === undefined || value === null || value === "") return
      list.push([label, String(value)])
    }
    const cast = parseAuthors(item.authors)

    switch (item.media_type) {
      case "video":
        push(t("media.detail.release"), year)
        push(
          t("media.detail.genre"),
          item.genre?.split(",").filter(Boolean).join(" / "),
        )
        push(
          t("media.detail.rating"),
          item.rating > 0 ? item.rating.toFixed(1) : "",
        )
        push(t("media.detail.cast"), cast.slice(0, 8).join(" / "))
        push(
          t("media.detail.season_episode"),
          item.season || item.episode
            ? `S${item.season || 1}E${item.episode || 1}`
            : "",
        )
        push(
          t("media.detail.duration"),
          item.duration ? formatDuration(item.duration) : "",
        )
        break
      case "music":
        push(t("media.detail.album"), item.album_name)
        push(t("media.detail.artist"), item.album_artist || cast.join(" / "))
        push(t("media.detail.genre"), item.genre)
        push(t("media.detail.year"), year)
        push(
          t("media.detail.track"),
          item.track_number
            ? t("media.detail.track_no", { index: item.track_number })
            : "",
        )
        push(
          t("media.detail.duration"),
          item.duration ? formatDuration(item.duration) : "",
        )
        break
      case "book":
        push(t("media.detail.author"), cast.join(" / "))
        push(t("media.detail.publisher"), item.publisher)
        push("ISBN", item.isbn)
        push(t("media.detail.genre"), item.genre)
        push(t("media.detail.publish_year"), year)
        push(
          t("media.detail.rating"),
          item.rating > 0 ? item.rating.toFixed(1) : "",
        )
        break
      case "image":
        push(t("media.detail.location"), cast.join(" / "))
        push(t("media.detail.genre"), item.genre)
        push(t("media.detail.shoot_date"), year)
        break
    }
    push(t("media.detail.size"), formatSize(item.file_size))
    return list
  })

  const description = createMemo(
    () => props.item.plot || props.item.description || props.item.reviews || "",
  )

  const typeIcon = () => {
    switch (props.item.media_type) {
      case "video":
        return TbMovie
      case "music":
        return TbMusic
      case "book":
        return TbBook
      default:
        return TbPhoto
    }
  }

  return (
    <div
      style={{
        position: "sticky",
        top: "16px",
        background: panelBg(),
        border: `1px solid ${panelBorder()}`,
        "border-radius": "12px",
        padding: "16px",
        "backdrop-filter": "blur(12px)",
        "-webkit-backdrop-filter": "blur(12px)",
        "max-height": "calc(100vh - 140px)",
        overflow: "auto",
      }}
    >
      {/* 封面 */}
      <div
        style={{
          position: "relative",
          width: "100%",
          "aspect-ratio": props.item.media_type === "music" ? "1 / 1" : "2 / 3",
          "max-height": "300px",
          "border-radius": "10px",
          overflow: "hidden",
          background: coverBg(),
          "margin-bottom": "14px",
        }}
      >
        <Show
          when={props.item.cover}
          fallback={
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                background: accentGradient(),
                color: "white",
              }}
            >
              {(() => {
                const Icon = typeIcon()
                return <Icon size={44} style={{ opacity: 0.85 }} />
              })()}
            </div>
          }
        >
          <img
            src={resolveMediaCover(props.item.cover)}
            alt={getMediaName(props.item)}
            style={{
              width: "100%",
              height: "100%",
              "object-fit": "cover",
            }}
          />
        </Show>
        <Show when={props.onToggleFavorite}>
          <button
            title={
              props.favorite
                ? t("media.detail.unfavorite")
                : t("media.detail.favorite")
            }
            aria-label={
              props.favorite
                ? t("media.detail.unfavorite")
                : t("media.detail.favorite")
            }
            onClick={(e) => {
              e.stopPropagation()
              props.onToggleFavorite?.(props.item, !props.favorite)
            }}
            style={{
              position: "absolute",
              top: "8px",
              right: "8px",
              width: "34px",
              height: "34px",
              "border-radius": "50%",
              border: "1px solid rgba(255,255,255,0.25)",
              background: "rgba(0,0,0,0.45)",
              color: props.favorite ? "#fbbf24" : "#e2e8f0",
              cursor: "pointer",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              "backdrop-filter": "blur(6px)",
            }}
          >
            {props.favorite ? <TbStarFilled size={18} /> : <TbStar size={18} />}
          </button>
        </Show>
      </div>

      {/* 标题 */}
      <div
        style={{
          color: titleColor(),
          "font-size": "16px",
          "font-weight": "600",
          "line-height": "1.35",
          "margin-bottom": "4px",
          "word-break": "break-word",
        }}
      >
        {getMediaName(props.item)}
      </div>
      <div
        style={{
          color: labelColor(),
          "font-size": "12px",
          "margin-bottom": "12px",
        }}
      >
        {props.item.file_name}
      </div>

      {/* 字段 */}
      <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
        <For each={rows()}>
          {([label, value]) => (
            <div
              style={{
                display: "grid",
                "grid-template-columns": "64px minmax(0, 1fr)",
                gap: "10px",
                "font-size": "12.5px",
                "line-height": "1.5",
              }}
            >
              <span style={{ color: labelColor() }}>{label}</span>
              <span style={{ color: valueColor(), "word-break": "break-word" }}>
                {value}
              </span>
            </div>
          )}
        </For>
      </div>

      {/* 简介 */}
      <Show when={description()}>
        <div
          style={{
            "margin-top": "14px",
            "padding-top": "12px",
            "border-top": `1px solid ${panelBorder()}`,
          }}
        >
          <div
            style={{
              color: labelColor(),
              "font-size": "12px",
              "margin-bottom": "6px",
            }}
          >
            {t("media.detail.description")}
          </div>
          <div
            style={{
              color: descColor(),
              "font-size": "12.5px",
              "line-height": "1.65",
              "white-space": "pre-wrap",
              display: "-webkit-box",
              "-webkit-line-clamp": "8",
              "-webkit-box-orient": "vertical",
              overflow: "hidden",
            }}
          >
            {description()}
          </div>
        </div>
      </Show>

      {/* 打开 */}
      <Show when={props.onOpen}>
        <button
          onClick={() => props.onOpen?.(props.item)}
          style={{
            "margin-top": "16px",
            width: "100%",
            padding: "9px 14px",
            "border-radius": "9px",
            border: "none",
            background: accentGradient(),
            color: "white",
            "font-size": "13px",
            "font-weight": "500",
            cursor: "pointer",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            gap: "6px",
          }}
        >
          <TbArrowUpRight size={15} />
          {props.openLabel || t("media.detail.open")}
        </button>
      </Show>
    </div>
  )
}
