import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js"
import { buildChapterDoc, loadEpub, type EpubBook } from "~/utils/epub"
import { useT } from "~/hooks"
import { readerBtnStyle } from "./reader_style"

/**
 * 媒体库 EPUB 阅读器。
 *
 * 旧实现运行时从 cdnjs 拉 epub.js：离线/内网部署直接不可用，还引入了
 * 第三方脚本的供应链风险。现在改为就地解包（浏览器原生 DecompressionStream），
 * 章节以 sandbox iframe srcdoc 渲染，图片走 blob URL，全程不请求外部域名。
 */
export const EpubReader = (props: { url: string; title: string }) => {
  const t = useT()
  const [book, setBook] = createSignal<EpubBook | null>(null)
  const [chapterIndex, setChapterIndex] = createSignal(0)
  const [showToc, setShowToc] = createSignal(false)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")

  let disposed = false
  let loaded: EpubBook | null = null

  onMount(async () => {
    try {
      const epub = await loadEpub(props.url)
      if (disposed) {
        epub.revoke()
        return
      }
      loaded = epub
      setBook(epub)
    } catch (e: any) {
      if (!disposed) {
        setError(t("media.book.load_failed") + ": " + (e?.message ?? String(e)))
      }
    } finally {
      if (!disposed) setLoading(false)
    }
  })

  onCleanup(() => {
    disposed = true
    loaded?.revoke()
  })

  const chapters = createMemo(() => book()?.chapters ?? [])
  const chapter = createMemo(() => chapters()[chapterIndex()])
  const doc = createMemo(() => {
    const c = chapter()
    return c ? buildChapterDoc(c) : ""
  })

  const go = (delta: number) => {
    const next = chapterIndex() + delta
    if (next >= 0 && next < chapters().length) setChapterIndex(next)
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
          title={t("media.book.toc")}
        >
          ☰ {t("media.book.toc")}
        </button>
        <div style={{ flex: "1" }} />
        <button
          disabled={chapterIndex() <= 0}
          onClick={() => go(-1)}
          style={{
            ...readerBtnStyle,
            opacity: chapterIndex() <= 0 ? "0.4" : "1",
          }}
        >
          ← {t("media.book.prev_chapter")}
        </button>
        <span style={{ color: "#475569", "font-size": "12px" }}>
          {chapters().length > 0
            ? `${chapterIndex() + 1} / ${chapters().length}`
            : "-"}
        </span>
        <button
          disabled={chapterIndex() >= chapters().length - 1}
          onClick={() => go(1)}
          style={{
            ...readerBtnStyle,
            opacity: chapterIndex() >= chapters().length - 1 ? "0.4" : "1",
          }}
        >
          {t("media.book.next_chapter")} →
        </button>
      </div>

      {/* 主体 */}
      <div style={{ flex: "1", display: "flex", overflow: "hidden" }}>
        {/* 目录侧边栏 */}
        <Show when={showToc()}>
          <div
            style={{
              width: "240px",
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
              {t("media.book.toc")}
            </div>
            <Show
              when={chapters().length > 0}
              fallback={
                <div style={{ color: "#475569", "font-size": "13px" }}>
                  {loading() ? t("media.book.loading") : t("media.book.no_toc")}
                </div>
              }
            >
              <For each={chapters()}>
                {(item, index) => (
                  <div
                    onClick={() => {
                      setChapterIndex(index())
                      setShowToc(false)
                    }}
                    style={{
                      padding: "6px 8px",
                      "border-radius": "6px",
                      cursor: "pointer",
                      color: index() === chapterIndex() ? "#a5b4fc" : "#94a3b8",
                      background:
                        index() === chapterIndex()
                          ? "rgba(24,144,255,0.15)"
                          : "transparent",
                      "font-size": "13px",
                      "margin-bottom": "2px",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                      transition: "background 0.15s",
                    }}
                    title={item.title}
                  >
                    {item.title}
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>

        {/* 章节渲染区：sandbox 禁止脚本，srcdoc 内联全部资源 */}
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
              {t("media.book.loading")}
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
          <Show when={!error() && chapter()}>
            {/* 保留同源以便加载 blob: 图片/字体，但不开 allow-scripts，脚本仍被完全禁用 */}
            <iframe
              title={chapter()?.title ?? props.title}
              srcdoc={doc()}
              sandbox="allow-same-origin"
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                background: "#1e1e2e",
              }}
            />
          </Show>
        </div>
      </div>
    </div>
  )
}
