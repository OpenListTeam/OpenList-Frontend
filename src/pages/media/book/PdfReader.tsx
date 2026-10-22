import EmbedPDF from "@embedpdf/snippet"
import pdfiumWasmUrl from "@embedpdf/snippet/dist/pdfium.wasm?url"
import { Show, createSignal, onMount } from "solid-js"
import { useColorMode } from "@hope-ui/solid"
import { base_path } from "~/utils"
import { useT } from "~/hooks"
import { currentLang } from "~/app/i18n"

/**
 * 媒体库 PDF 阅读器。
 *
 * 之前是运行时从 cdnjs 拉 pdf.js（离线部署不可用、且引入供应链风险），
 * 现在复用前端已有的 @embedpdf/snippet（已随包发布，含 self-host 的 pdfium wasm），
 * 不再有任何第三方 CDN 依赖。分页、缩放、目录由查看器自带工具栏提供。
 */
export const PdfReader = (props: { url: string; title: string }) => {
  const t = useT()
  const { colorMode } = useColorMode()
  const [error, setError] = createSignal("")
  let container: HTMLDivElement | undefined

  onMount(() => {
    if (!container) return
    try {
      // wasm 必须是绝对地址，随前端产物一起部署
      const wasmUrl = new URL(pdfiumWasmUrl, location.href + base_path).href
      EmbedPDF.init({
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
    } catch (e: any) {
      setError(
        t("media.book.pdf_load_failed") + ": " + (e?.message ?? String(e)),
      )
    }
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
