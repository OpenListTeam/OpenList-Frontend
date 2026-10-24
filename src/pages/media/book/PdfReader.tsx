import EmbedPDF from "@embedpdf/snippet"
import pdfiumWasmUrl from "@embedpdf/snippet/dist/pdfium.wasm?url"
import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { useColorMode } from "@hope-ui/solid"
import { base_path } from "~/utils"
import { useT } from "~/hooks"
import { currentLang } from "~/app/i18n"
import { me } from "~/store"
import { UserMethods } from "~/types"
import { notify } from "~/utils"
import {
  getMediaAnnotations,
  syncMediaAnnotations,
  type MediaAnnotationRow,
} from "~/utils/media_api"
import { createAnnotationQueue } from "~/utils/annotation_queue"

/**
 * 查看器原生的批注对象。只有 id 需要被类型化（做去重和同步主键），
 * 其余字段（pageIndex、rect、quadPoints、inkList…）原样存库、原样回灌。
 */
interface ViewerAnnotation {
  id: string
  [key: string]: unknown
}

interface ViewerAnnotationEvent {
  type: "create" | "update" | "delete" | "loaded"
  annotation?: ViewerAnnotation
}

/**
 * EmbedPDF 批注插件能力的最小结构定义。
 * 直接引 @embedpdf/plugin-annotation 的类型会越过 snippet 的公开入口，
 * 这里只声明用到的方法，避免跟内部包路径耦合。
 */
interface ViewerAnnotationCapability {
  // 第二个参数是文档 id：不传时插件会去取“当前活动文档”，
  // 而文档还没加载完时活动文档是 null，导入会被丢进一个取不出来的队列。
  importAnnotations: (
    items: { annotation: ViewerAnnotation }[],
    documentId?: string,
  ) => void
  onAnnotationEvent: (cb: (ev: ViewerAnnotationEvent) => void) => () => void
}

interface ViewerDocumentManagerCapability {
  getActiveDocumentId?: () => string | null
}

/** 反序列化后端保存的批注：created/modified 存的是 ISO 字符串，回灌前要还原成 Date */
const reviveAnnotation = (raw: string): ViewerAnnotation | null => {
  try {
    const obj = JSON.parse(raw) as ViewerAnnotation
    if (!obj || typeof obj.id !== "string" || obj.id === "") return null
    for (const key of ["created", "modified"]) {
      const value = obj[key]
      if (typeof value === "string") obj[key] = new Date(value)
    }
    return obj
  } catch {
    return null
  }
}

/**
 * 媒体库 PDF 阅读器。
 *
 * 查看器本身（@embedpdf/snippet）自带批注能力：高亮、下划线、画笔、文本框等。
 * 这里做两件事把它接到后端：
 *   1. 打开时把库里保存的批注回灌给查看器；
 *   2. 订阅 create/update/delete 事件，合并后增量写库（访客/未登录不保存）。
 */
export const PdfReader = (props: {
  url: string
  title: string
  itemId?: number
}) => {
  const t = useT()
  const { colorMode } = useColorMode()
  const [error, setError] = createSignal("")
  let container: HTMLDivElement | undefined

  // 批注是用户私有数据，访客是公共账号，写进去会互相覆盖，因此只对登录用户启用
  const canAnnotate = () => {
    const user = me()
    return !!user?.id && !UserMethods.is_guest(user)
  }

  onMount(() => {
    if (!container) return
    let disposed = false
    let unsubscribe: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let flushing = false
    // 只提示一次：同一轮失败会持续重试，反复弹窗只会打扰用户
    let saveErrorNotified = false
    const queue = createAnnotationQueue<ViewerAnnotation>()

    const notifySaveError = (detail: unknown) => {
      if (saveErrorNotified) return
      saveErrorNotified = true
      notify.error(t("media.book.annotation_save_failed"))
      console.warn("[pdf] 批注保存失败", detail)
    }

    const toDraft = (a: ViewerAnnotation): MediaAnnotationRow => ({
      remote_id: a.id,
      anchor: JSON.stringify(a),
    })

    const flush = async () => {
      const itemId = props.itemId
      if (flushing || !itemId) return
      if (queue.size() === 0) return
      flushing = true
      let failed = false
      // 先取走本批变更：请求期间新产生的改动会落进新的队列，下一轮再提交
      const batch = queue.take()
      try {
        const resp = await syncMediaAnnotations({
          item_id: itemId,
          upserts: batch.upserts.map(toDraft),
          deletes: batch.deletes,
        })
        if (resp.code === 200) {
          saveErrorNotified = false
          return
        }
        // 4xx 说明这批数据本身被拒绝（超长 / 无权访问），重试也不会成功，
        // 继续放回队列只会无限重试，这里直接丢弃并提示用户。
        if (resp.code >= 400 && resp.code < 500) {
          notifySaveError(resp.message || `HTTP ${resp.code}`)
          return
        }
        throw new Error(resp.message || `HTTP ${resp.code}`)
      } catch (e) {
        // 断网 / 服务端 5xx 时不能静默丢弃：放回队列，下次改动一起重试。
        // restore 会保留请求期间产生的新操作，旧内容不会覆盖新编辑。
        failed = true
        queue.restore(batch)
        notifySaveError(e)
      } finally {
        flushing = false
        // 请求期间若又产生了改动，这里补一次调度，避免要等到下一次操作才提交；
        // 失败时不自动重试，防止服务端不可用时变成 800ms 一次的死循环。
        if (!failed && queue.size() > 0) {
          schedule()
        }
      }
    }

    const schedule = () => {
      clearTimeout(timer)
      // 连续拖拽/连笔会产生大量事件，合并成一次请求
      timer = setTimeout(() => void flush(), 800)
    }

    // 切到后台时把待提交的批注立刻写掉，避免只停在内存里
    const flushOnHide = () => {
      if (document.visibilityState === "hidden") void flush()
    }
    document.addEventListener("visibilitychange", flushOnHide)

    // 文档加载完成前活动文档 id 是 null，此时导入批注会被丢进一个取不出来的队列，
    // 所以先等 id 出现（最多 10s），再带着 id 导入。
    const waitForDocumentId = async (
      documents?: ViewerDocumentManagerCapability,
    ): Promise<string | null> => {
      for (let i = 0; i < 100; i++) {
        if (disposed) return null
        const id = documents?.getActiveDocumentId?.() ?? null
        if (id) return id
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return null
    }

    const setupAnnotations = async (
      editor: NonNullable<ReturnType<typeof EmbedPDF.init>>,
    ) => {
      // registry 在查看器启动完成后才 resolve
      const registry = await editor.registry
      if (disposed) return
      const plugins = registry as unknown as {
        getPlugin: (id: string) => { provides: () => unknown } | null
      }
      const capability = plugins.getPlugin("annotation")?.provides() as
        ViewerAnnotationCapability | undefined
      if (!capability) {
        console.warn("[pdf] 未找到批注插件，本次批注不会保存")
        return
      }

      const canSave = !!props.itemId && canAnnotate()
      // 先订阅变更，避免等待文档期间用户的操作被漏掉
      if (canSave) {
        unsubscribe = capability.onAnnotationEvent((ev) => {
          // loaded 是文档自带批注装载完成的信号，不是用户改动
          if (!ev || ev.type === "loaded" || !ev.annotation?.id) return
          const id = ev.annotation.id
          if (ev.type === "delete") queue.remove(id)
          else queue.upsert(ev.annotation)
          schedule()
        })
      }

      const documents = plugins.getPlugin("document-manager")?.provides() as
        ViewerDocumentManagerCapability | undefined
      const documentId = await waitForDocumentId(documents)
      if (disposed || !documentId) {
        console.warn("[pdf] 文档未就绪，跳过批注回灌")
        return
      }
      if (!canSave) return

      try {
        const resp = await getMediaAnnotations(props.itemId!)
        const items = (resp.data ?? [])
          .map((row) => reviveAnnotation(row.anchor))
          .filter((a): a is ViewerAnnotation => a !== null)
        if (items.length > 0 && !disposed) {
          capability.importAnnotations(
            items.map((annotation) => ({ annotation })),
            documentId,
          )
        }
      } catch (e) {
        // 拉取失败不影响阅读，最多这次看不到历史批注
        console.warn("[pdf] 批注加载失败", e)
      }
    }

    try {
      // wasm 必须是绝对地址，随前端产物一起部署
      const wasmUrl = new URL(pdfiumWasmUrl, location.href + base_path).href
      const editor = EmbedPDF.init({
        type: "container",
        target: container,
        src: props.url,
        theme: { preference: colorMode() },
        i18n: {
          defaultLocale: currentLang(),
          fallbackLocale: "en",
        },
        wasmUrl,
      })
      if (editor) {
        void setupAnnotations(editor).catch((e) => {
          console.warn("[pdf] 批注功能初始化失败", e)
        })
      }
    } catch (e: any) {
      setError(
        t("media.book.pdf_load_failed") + ": " + (e?.message ?? String(e)),
      )
    }

    onCleanup(() => {
      disposed = true
      clearTimeout(timer)
      unsubscribe?.()
      document.removeEventListener("visibilitychange", flushOnHide)
      // 关闭阅读器时把还没提交的改动立刻写掉
      void flush()
    })
  })

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        overflow: "hidden",
        background: "#1e1e2e",
      }}
    >
      <div
        style={{
          padding: "8px 16px",
          "border-bottom": "1px solid rgba(255,255,255,0.08)",
          color: "#94a3b8",
          "font-size": "13px",
          "flex-shrink": "0",
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
        }}
      >
        {props.title}
      </div>
      <Show when={error()}>
        <div style={{ color: "#f87171", padding: "24px", "font-size": "14px" }}>
          {error()}
        </div>
      </Show>
      <div ref={container} style={{ flex: "1", "min-height": "0" }} />
    </div>
  )
}
