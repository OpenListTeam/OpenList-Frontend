import { base_path } from "~/utils"

export const useCDN = () => {
  const npm = (name: string, version: string, path: string) => {
    // Available: https://github.com/cnpm/unpkg-white-list
    // https://registry.npmmirror.com/monaco-editor/0.52.2/files/min/vs/loader.js
    return `https://registry.npmmirror.com/${name}/${version}/files/${path}`

    // https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js
    // return `https://cdn.jsdelivr.net/npm/${name}@${version}/${path}`
  }

  const monacoPath = () => {
    return import.meta.env.VITE_LITE === "true"
      ? npm("monaco-editor", "0.52.2", "min/vs")
      : `${base_path}/static/monaco-editor/min/vs`
  }

  const katexCSSPath = () => {
    return import.meta.env.VITE_LITE === "true"
      ? npm("katex", "0.16.11", "dist/katex.min.css")
      : `${base_path}/static/katex/katex.min.css`
  }

  const mermaidJSPath = () => {
    return import.meta.env.VITE_LITE === "true"
      ? npm("mermaid", "11.1.0", "dist/mermaid.min.js")
      : `${base_path}/static/mermaid/mermaid.min.js`
  }

  const ruffleJSPath = () => {
    // ruffle is not available on cnpm white list
    return import.meta.env.VITE_LITE === "true"
      ? "https://res.oplist.org/ruffle/ruffle.js"
      : `${base_path}/static/ruffle/ruffle.js`
  }

  const libHeifPath = () => {
    // libheif-js is not available on cnpm white list
    return import.meta.env.VITE_LITE === "true"
      ? "https://res.oplist.org/libheif"
      : `${base_path}/static/libheif`
  }

  return {
    npm,
    monacoPath,
    katexCSSPath,
    mermaidJSPath,
    ruffleJSPath,
    libHeifPath,
  }
}
