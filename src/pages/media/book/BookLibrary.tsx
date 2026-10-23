import { resolveMediaCover } from "~/utils/media_cover"
import { accentGradient } from "~/utils/accent"
import { createSignal, createResource, createMemo, Show, For } from "solid-js"
import { useColorMode } from "@hope-ui/solid"
import { useT } from "~/hooks"
import { MediaLayout } from "../MediaLayout"
import { MediaBrowser } from "../MediaBrowser"
import { formatMediaSize, mediaBackBtn, mediaPrimaryBtn } from "../ui"
import { PdfReader } from "./PdfReader"
import { EpubReader } from "./EpubReader"
import { readerBtnStyle } from "./reader_style"
import {
  createSignedMediaUrls,
  getMediaItem,
  getMediaStreamUrl,
} from "~/utils/media_api"
import type { MediaItem, EpisodeInfo } from "~/types"
import { getMediaName, parseAuthors, parseEpisodes } from "~/types"
import { api } from "~/utils"
import { encodePath } from "~/utils/path"

// ==================== 书籍阅读器（外层容器） ====================
const BookReader = (props: {
  item: MediaItem
  // 可选：指定播放的文件路径和标题（用于选集阅读）
  filePath?: string
  title?: string
  onClose: () => void
}) => {
  const t = useT()
  // 优先使用传入的 filePath，否则拼接 folder_path + "/" + file_name
  const resolvedPath = () => {
    if (props.filePath) return props.filePath
    const folder = props.item.folder_path?.replace(/\/$/, "") ?? ""
    return `${folder}/${props.item.file_name}`
  }
  // 签名 + 编码后的地址；就绪前为 undefined，避免先发出必然 401 的请求。
  // 阅读器读流需要代理地址（跨域 /p），下载用直链（302 到网盘，不占服务端带宽）。
  const signedUrls = createSignedMediaUrls(resolvedPath)
  const fileUrl = () => signedUrls()?.proxied ?? ""
  const downloadUrl = () => signedUrls()?.direct ?? ""
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
          title={t("global.close")}
        >
          ✕ {t("global.close")}
        </button>
      </div>

      {/* 阅读器主体 */}
      <div style={{ flex: "1", overflow: "hidden" }}>
        <Show when={isPDF() && fileUrl()}>
          <PdfReader
            url={fileUrl()}
            title={getMediaName(props.item)}
            itemId={props.item.id}
          />
        </Show>
        <Show when={isEpub() && fileUrl()}>
          <EpubReader
            url={fileUrl()}
            title={getMediaName(props.item)}
            itemId={props.item.id}
          />
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
              {t("media.book.unsupported_format", {
                ext: ext().toUpperCase(),
              })}
            </div>
            <a
              href={downloadUrl() || "#"}
              target="_blank"
              rel="noopener"
              onClick={async (e) => {
                e.preventDefault()
                // 签名直链在打开阅读器时已经预取，正常情况下点击是同步打开，
                // Safari/部分 Chrome 不会把它判定为“非用户手势”而拦截。
                // 这里用直链而不是 /p 代理：代理会让大文件流量全部走服务端，
                // 且 force 参数会阻止 302 到网盘直链。
                const ready = downloadUrl()
                if (ready) {
                  window.open(ready, "_blank", "noopener")
                  return
                }
                // 极端情况下签名还没就绪：退化为当前页跳转，不会被弹窗拦截
                const resp = await getMediaStreamUrl({ path: resolvedPath() })
                const url =
                  resp.code === 200 && resp.data?.url
                    ? resp.data.url
                    : `${api}/d${encodePath(resolvedPath())}`
                location.assign(url)
              }}
              style={{ ...mediaPrimaryBtn(), "text-decoration": "none" }}
            >
              ⬇ {t("media.book.download_file")}
            </a>
          </div>
        </Show>
      </div>
    </div>
  )
}

// ==================== 书籍卡片 ====================
const BookCard = (props: { item: MediaItem }) => {
  const t = useT()
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
              <div>
                {t("media.book.author")}: {authors().slice(0, 3).join(" / ")}
              </div>
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
  const t = useT()
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
          {item.loading ? t("media.book.loading") : t("media.book.not_found")}
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
                    ? t("media.book.volume", {
                        index: currentEpisode()!.index,
                        title: currentEpisode()!.title ?? "",
                      }).trim()
                    : currentEpisode()!.title
                  : undefined
              }
              onClose={() => setShowReader(false)}
            />
          </Show>

          <button onClick={props.onBack} style={mediaBackBtn(isDark())}>
            ← {t("media.book.back")}
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
                  {t("media.book.author")}:{" "}
                  {parseAuthors(data().authors).join(" / ")}
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
                  {t("media.book.publisher")}: {data().publisher}
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
                  {t("media.book.publish_year")}:{" "}
                  {data().release_date?.slice(0, 4)}
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
                  📖 {t("media.book.read")}
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
                        {t("media.book.episode_count", {
                          count: episodes.length,
                        })}
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
                                ? t("media.book.volume", {
                                    index: ep.index,
                                    title: ep.title ?? "",
                                  }).trim()
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
                    {t("media.book.summary")}
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
  const t = useT()
  const [selectedId, setSelectedId] = createSignal<string | null>(null)

  return (
    <MediaLayout title={t("media.book.title")}>
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
