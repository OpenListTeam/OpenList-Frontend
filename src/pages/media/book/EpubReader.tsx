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
import { me } from "~/store"
import { UserMethods } from "~/types"
import { notify } from "~/utils"
import {
  ANNOTATION_COLORS,
  ANNOTATION_MARK_ATTR,
  DEFAULT_ANNOTATION_COLOR,
  MAX_NOTE_LENGTH,
  applyHighlights,
  parseEpubAnchor,
  selectionAnchor,
  serializeEpubAnchor,
  type EpubAnnotationAnchor,
} from "~/utils/epub_annotation"
import {
  getMediaAnnotations,
  syncMediaAnnotations,
  type MediaAnnotationRow,
} from "~/utils/media_api"

interface StoredAnnotation {
  remote_id: string
  data: EpubAnnotationAnchor
}

interface PendingSelection {
  chapter: number
  start: number
  end: number
  quote: string
}

const newAnnotationId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `epub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * 媒体库 EPUB 阅读器。
 *
 * 旧实现运行时从 cdnjs 拉 epub.js：离线/内网部署直接不可用，还引入了
 * 第三方脚本的供应链风险。现在改为就地解包（浏览器原生 DecompressionStream），
 * 章节以 sandbox iframe srcdoc 渲染，图片走 blob URL，全程不请求外部域名。
 *
 * 批注以「章节序号 + 章节内字符偏移」为锚点存后端；高亮在 iframe 内用
 * <mark> 包裹，点击高亮可编辑笔记或删除。
 */
export const EpubReader = (props: {
  url: string
  title: string
  itemId?: number
}) => {
  const t = useT()
  const [book, setBook] = createSignal<EpubBook | null>(null)
  const [chapterIndex, setChapterIndex] = createSignal(0)
  const [showToc, setShowToc] = createSignal(false)
  const [showAnnotations, setShowAnnotations] = createSignal(false)
  const [annotations, setAnnotations] = createSignal<StoredAnnotation[]>([])
  const [activeColor, setActiveColor] = createSignal<string>(
    DEFAULT_ANNOTATION_COLOR,
  )
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [draftNote, setDraftNote] = createSignal("")
  const [pendingSelection, setPendingSelection] =
    createSignal<PendingSelection | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")

  let disposed = false
  let loaded: EpubBook | null = null
  let frame: HTMLIFrameElement | undefined
  // 跨章节跳转时先记下要高亮的批注，等目标章节 iframe 加载完再滚动
  let pendingScrollId: string | null = null

  const canAnnotate = () => {
    const user = me()
    return !!user?.id && !UserMethods.is_guest(user)
  }

  const push = async (upserts: MediaAnnotationRow[], deletes: string[]) => {
    if (!props.itemId) return false
    try {
      const resp = await syncMediaAnnotations({
        item_id: props.itemId,
        upserts,
        deletes,
      })
      return resp.code === 200
    } catch {
      return false
    }
  }

  const loadAnnotations = async () => {
    if (!props.itemId || !canAnnotate()) return
    try {
      const resp = await getMediaAnnotations(props.itemId)
      const list = (resp.data ?? []).flatMap((row) => {
        const data = parseEpubAnchor(row.anchor)
        return data ? [{ remote_id: row.remote_id, data }] : []
      })
      if (disposed) return
      setAnnotations(list)
      applyCurrentHighlights()
    } catch (e) {
      // 拉不到历史批注不影响阅读
      console.warn("[epub] 批注加载失败", e)
    }
  }

  onMount(() => {
    const loadBook = async () => {
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
          setError(
            t("media.book.load_failed") + ": " + (e?.message ?? String(e)),
          )
        }
      } finally {
        if (!disposed) setLoading(false)
      }
    }
    void loadBook()
    void loadAnnotations()
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

  const scrollToMark = (id: string) => {
    const marks = frame?.contentDocument?.querySelectorAll(
      `mark[${ANNOTATION_MARK_ATTR}]`,
    )
    for (const mark of Array.from(marks ?? [])) {
      if (mark.getAttribute(ANNOTATION_MARK_ATTR) === id) {
        mark.scrollIntoView({ block: "center" })
        return
      }
    }
  }

  const applyCurrentHighlights = () => {
    const body = frame?.contentDocument?.body
    if (!body) return
    const current = chapterIndex()
    applyHighlights(
      body,
      annotations()
        .filter((a) => a.data.chapter === current)
        .map((a) => ({
          id: a.remote_id,
          start: a.data.start,
          end: a.data.end,
          color: a.data.color,
        })),
    )
    if (pendingScrollId) {
      scrollToMark(pendingScrollId)
      pendingScrollId = null
    }
  }

  const selectAnnotation = (id: string) => {
    const anno = annotations().find((a) => a.remote_id === id)
    if (!anno) return
    setShowAnnotations(true)
    setEditingId(id)
    setDraftNote(anno.data.note)
    if (anno.data.chapter !== chapterIndex()) {
      pendingScrollId = id
      setChapterIndex(anno.data.chapter)
      return
    }
    scrollToMark(id)
  }

  /** 记录 iframe 里的选区；点工具栏前用户可能已经失焦，所以鼠标抬起时就存下来 */
  const captureSelection = () => {
    const frameDoc = frame?.contentDocument
    const body = frameDoc?.body
    const selection = frameDoc?.getSelection()
    if (!body || !selection || selection.rangeCount === 0) {
      setPendingSelection(null)
      return
    }
    const offsets = selectionAnchor(body, selection.getRangeAt(0))
    setPendingSelection(
      offsets ? { chapter: chapterIndex(), ...offsets } : null,
    )
  }

  const handleFrameClick = (ev: MouseEvent) => {
    const target = ev.target as Element | null
    // 外链（loadEpub 已改成 href="#" + data-href）交给父页面打开：
    // 沙箱 iframe 自己导航到第三方页面时地址栏不可见，是典型钓鱼场景。
    const link = target?.closest?.("a[data-href]")
    const href = link?.getAttribute("data-href")
    if (href) {
      ev.preventDefault()
      window.open(href, "_blank", "noopener,noreferrer")
      return
    }
    const mark = target?.closest?.(`mark[${ANNOTATION_MARK_ATTR}]`)
    const id = mark?.getAttribute(ANNOTATION_MARK_ATTR)
    if (id) selectAnnotation(id)
  }

  const handleFrameLoad = (e: Event & { currentTarget: HTMLIFrameElement }) => {
    const frameDoc = e.currentTarget.contentDocument
    if (!frameDoc) return
    frame = e.currentTarget
    frameDoc.addEventListener("click", handleFrameClick)
    frameDoc.addEventListener("mouseup", captureSelection)
    frameDoc.addEventListener("keyup", captureSelection)
    setPendingSelection(null)
    applyCurrentHighlights()
  }

  const addHighlight = async () => {
    if (!props.itemId) return
    if (!canAnnotate()) {
      notify.warning(t("media.book.annotations_login_required"))
      return
    }
    const selection = pendingSelection()
    if (!selection) {
      notify.warning(t("media.book.select_text_first"))
      return
    }
    const data: EpubAnnotationAnchor = {
      format: "epub",
      chapter: selection.chapter,
      start: selection.start,
      end: selection.end,
      quote: selection.quote,
      color: activeColor(),
      note: "",
    }
    const remoteId = newAnnotationId()
    const ok = await push(
      [{ remote_id: remoteId, anchor: serializeEpubAnchor(data) }],
      [],
    )
    if (!ok) {
      notify.error(t("media.book.annotation_save_failed"))
      return
    }
    setAnnotations([...annotations(), { remote_id: remoteId, data }])
    setPendingSelection(null)
    setShowAnnotations(true)
    setEditingId(remoteId)
    setDraftNote("")
    applyCurrentHighlights()
    notify.success(t("media.book.annotation_saved"))
  }

  const saveNote = async () => {
    const id = editingId()
    if (!id) return
    const current = annotations().find((a) => a.remote_id === id)
    if (!current) return
    const note = draftNote().slice(0, MAX_NOTE_LENGTH)
    if (note === current.data.note) {
      setEditingId(null)
      return
    }
    const data = { ...current.data, note }
    const ok = await push(
      [{ remote_id: id, anchor: serializeEpubAnchor(data) }],
      [],
    )
    if (!ok) {
      notify.error(t("media.book.annotation_save_failed"))
      return
    }
    setAnnotations(
      annotations().map((a) =>
        a.remote_id === id ? { remote_id: id, data } : a,
      ),
    )
    setEditingId(null)
    notify.success(t("media.book.annotation_saved"))
  }

  const removeAnnotation = async (id: string) => {
    if (!(await push([], [id]))) {
      notify.error(t("media.book.annotation_delete_failed"))
      return
    }
    setAnnotations(annotations().filter((a) => a.remote_id !== id))
    if (editingId() === id) setEditingId(null)
    applyCurrentHighlights()
    notify.success(t("media.book.annotation_deleted"))
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
        <button
          onClick={() => setShowAnnotations(!showAnnotations())}
          style={readerBtnStyle}
          title={t("media.book.annotations")}
        >
          {t("media.book.annotations")}
          {annotations().length > 0 ? ` (${annotations().length})` : ""}
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

      {/* 有资源因超过解压上限被跳过时给出提示，避免用户只看到裂图 */}
      <Show when={(book()?.skippedEntries ?? 0) > 0}>
        <div
          style={{
            padding: "6px 16px",
            background: "rgba(251,191,36,0.12)",
            color: "#fbbf24",
            "font-size": "12px",
            "flex-shrink": "0",
          }}
        >
          {t("media.book.skipped_resources", {
            count: book()!.skippedEntries,
          })}
        </div>
      </Show>

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
            {/*
              保留 allow-same-origin 的唯一原因：章节里的图片/字体是父页面创建的 blob: URL，
              沙箱 iframe 若没有同源身份（opaque origin）会拒绝加载它们。
              安全性由两点保证：
              1) 不授予 allow-scripts，iframe 内脚本完全无法执行，同源身份拿不到任何能力；
              2) 文档头部的 CSP（buildChapterDoc）把网络请求限制在 blob:/data:。
              若以后改成 data: URI 内联图片，可以去掉 allow-same-origin。
              注意：下面的 handleFrameLoad 依赖 contentDocument 拦截外链点击，
              一旦为了某些 EPUB 打开 allow-scripts，同源脚本就能绕过这层拦截，
              届时必须改成在 buildChapterDoc 里注入处理逻辑，或去掉 allow-same-origin。
            */}
            <iframe
              title={chapter()?.title ?? props.title}
              srcdoc={doc()}
              sandbox="allow-same-origin"
              onLoad={handleFrameLoad}
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                background: "#1e1e2e",
              }}
            />
          </Show>
        </div>

        {/* 批注侧边栏 */}
        <Show when={showAnnotations()}>
          <div
            style={{
              width: "280px",
              "flex-shrink": "0",
              background: "rgba(0,0,0,0.35)",
              "border-left": "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              "flex-direction": "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "12px",
                "border-bottom": "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                }}
              >
                <span
                  style={{
                    color: "#64748b",
                    "font-size": "11px",
                    "font-weight": "700",
                    "text-transform": "uppercase",
                    "letter-spacing": "0.08em",
                  }}
                >
                  {t("media.book.annotations")}
                </span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <For each={ANNOTATION_COLORS}>
                    {(color) => (
                      <button
                        onClick={() => setActiveColor(color)}
                        style={{
                          width: "14px",
                          height: "14px",
                          "border-radius": "50%",
                          background: color,
                          cursor: "pointer",
                          border:
                            activeColor() === color
                              ? "2px solid #e2e8f0"
                              : "1px solid rgba(0,0,0,0.4)",
                        }}
                      />
                    )}
                  </For>
                </div>
              </div>
              <button
                onClick={() => void addHighlight()}
                style={{
                  ...readerBtnStyle,
                  width: "100%",
                  "margin-top": "10px",
                }}
              >
                {t("media.book.add_highlight")}
              </button>
            </div>

            <div style={{ flex: "1", "overflow-y": "auto", padding: "8px" }}>
              <Show
                when={annotations().length > 0}
                fallback={
                  <div
                    style={{
                      color: "#475569",
                      "font-size": "13px",
                      padding: "12px",
                    }}
                  >
                    {annotations().length === 0 && !canAnnotate()
                      ? t("media.book.annotations_login_required")
                      : t("media.book.annotations_empty")}
                  </div>
                }
              >
                <For each={annotations()}>
                  {(anno) => (
                    <div
                      onClick={() => selectAnnotation(anno.remote_id)}
                      style={{
                        padding: "8px",
                        "border-radius": "6px",
                        "margin-bottom": "4px",
                        cursor: "pointer",
                        background:
                          editingId() === anno.remote_id
                            ? "rgba(24,144,255,0.15)"
                            : "transparent",
                      }}
                    >
                      <div
                        style={{
                          "font-size": "11px",
                          color: "#64748b",
                          "margin-bottom": "2px",
                        }}
                      >
                        {chapters()[anno.data.chapter]?.title ??
                          `#${anno.data.chapter + 1}`}
                      </div>
                      <div
                        style={{
                          "font-size": "13px",
                          color: "#cbd5e1",
                          "line-height": "1.5",
                          "max-height": "3em",
                          overflow: "hidden",
                        }}
                      >
                        {anno.data.quote}
                      </div>
                      <Show when={anno.data.note}>
                        <div
                          style={{
                            "font-size": "12px",
                            color: "#94a3b8",
                            "margin-top": "4px",
                          }}
                        >
                          {anno.data.note}
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
            </div>

            <Show when={editingId()}>
              <div
                style={{
                  padding: "10px",
                  "border-top": "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <textarea
                  value={draftNote()}
                  placeholder={t("media.book.note_placeholder")}
                  onInput={(e) => setDraftNote(e.currentTarget.value)}
                  style={{
                    width: "100%",
                    height: "72px",
                    resize: "vertical",
                    background: "rgba(0,0,0,0.35)",
                    color: "#e2e8f0",
                    border: "1px solid rgba(255,255,255,0.12)",
                    "border-radius": "6px",
                    padding: "8px",
                    "font-size": "13px",
                    "box-sizing": "border-box",
                  }}
                />
                <div
                  style={{ display: "flex", gap: "6px", "margin-top": "8px" }}
                >
                  <button
                    onClick={() => void saveNote()}
                    style={readerBtnStyle}
                  >
                    {t("media.book.save")}
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    style={readerBtnStyle}
                  >
                    {t("media.book.cancel")}
                  </button>
                  <div style={{ flex: "1" }} />
                  <button
                    onClick={() => void removeAnnotation(editingId()!)}
                    style={{ ...readerBtnStyle, color: "#f87171" }}
                  >
                    {t("media.book.delete")}
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
