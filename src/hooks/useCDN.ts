import { joinBase } from "~/utils"

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

  const monacoPath = () => `${static_path}/monaco-editor/vs`

  const katexCSSPath = () => `${static_path}/katex/katex.min.css`

  const mermaidJSPath = () => `${static_path}/mermaid/mermaid.min.js`

  const libHeifPath = () => `${static_path}/libheif`

  const libAssPath = () => `${static_path}/libass-wasm`

  const fontsPath = () => `${static_path}/fonts`

  // Office preview libs — always served from resource CDN (not bundled locally)
  const pptBasePath = () => res("ppt.js")
  const docxPreviewPath = () => res("docxjs/dist/docx-preview.min.js")
  const excelJSPath = () => res("exceljs/exceljs.min.js")
  const rufflePath = () => res("ruffle/ruffle.js")

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
    rufflePath,
  }
}
