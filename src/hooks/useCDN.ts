import { joinBase } from "~/utils"
import packageJson from "../../package.json"

export const useCDN = () => {
  const static_path = joinBase("static")

  // OpenList Resource CDN: https://github.com/OpenListTeam/OpenList-Resource
  const resource = "https://res.oplist.org.cn"

  // npmmirror CDN, whitelist
  // Available: https://github.com/cnpm/unpkg-white-list
  const npm = (name: string, version: string, path: string) => {
    // https://registry.npmmirror.com/monaco-editor/0.55.1/files/min/vs/loader.js
    return `https://registry.npmmirror.com/${name}/${version}/files/${path}`

    // https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs/loader.js
    // return `https://cdn.jsdelivr.net/npm/${name}@${version}/${path}`
  }

  const res = (path: string) => {
    return `${resource}/${path}`
  }

  const monacoPath = () => {
    return import.meta.env.VITE_LITE === "true"
      ? npm("monaco-editor", "0.55.1", "min/vs")
      : `${static_path}/monaco-editor/vs`
  }

  const katexCSSPath = () => {
    return import.meta.env.VITE_LITE === "true"
      ? npm("katex", "0.16.45", "dist/katex.min.css")
      : `${static_path}/katex/katex.min.css`
  }

  const mermaidJSPath = () => {
    return import.meta.env.VITE_LITE === "true"
      ? npm("mermaid", "11.15.0", "dist/mermaid.min.js")
      : `${static_path}/mermaid/mermaid.min.js`
  }

  const libHeifPath = () => {
    return import.meta.env.VITE_LITE === "true"
      ? npm(packageJson.name, packageJson.version, "dist/static/libheif")
      : `${static_path}/libheif`
  }

  const libAssPath = () => {
    return import.meta.env.VITE_LITE === "true"
      ? npm(packageJson.name, packageJson.version, "dist/static/libass-wasm")
      : `${static_path}/libass-wasm`
  }

  const fontsPath = () => {
    return import.meta.env.VITE_LITE === "true"
      ? npm(packageJson.name, packageJson.version, "dist/static/fonts")
      : `${static_path}/fonts`
  }

  // Office preview libs — always served from resource CDN (not bundled locally)
  const pptBasePath = () => res("ppt.js")
  const docxPreviewPath = () => res("docxjs/dist/docx-preview.min.js")
  const excelJSPath = () => res("exceljs/exceljs.min.js")

  return {
    npm,
    res,
    monacoPath,
    katexCSSPath,
    mermaidJSPath,
    libHeifPath,
    libAssPath,
    fontsPath,
    pptBasePath,
    docxPreviewPath,
    excelJSPath,
  }
}
