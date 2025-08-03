// api and base_path both don't endsWith /

export let base_path = ""
export const setBasePath = (path: string) => {
  base_path = path
  if (!base_path.startsWith("/")) {
    base_path = "/" + base_path
  }
  if (base_path.endsWith("/")) {
    base_path = base_path.slice(0, -1)
  }
}
if (window.OPENLIST_CONFIG.base_path) {
  setBasePath(window.OPENLIST_CONFIG.base_path)
}

export let api = import.meta.env.VITE_API_URL as string
if (window.OPENLIST_CONFIG.api) {
  api = window.OPENLIST_CONFIG.api
}
if (api === "/") {
  api = location.origin + base_path
}
if (api.endsWith("/")) {
  api = api.slice(0, -1)
}

export const dynamicBase =
  window.__dynamic_base__ || window.OPENLIST_CONFIG.cdn || ""

export const getNpmCDN = (name: string, version: string, path: string) => {
  // get version from package.json
  return `https://registry.npmmirror.com/${name}/${version}/files/${path}`
}

export const getMonacoPath = () => {
  return import.meta.env.VITE_LITE == "true"
    ? getNpmCDN("monaco-editor", "0.52.2", "min/vs")
    : `${dynamicBase}/static/monaco-editor/min/vs`
}

export const getKatexCSSPath = () => {
  return import.meta.env.VITE_LITE == "true"
    ? getNpmCDN("katex", "0.16.11", "dist/katex.min.css")
    : `${dynamicBase}/static/katex/katex.min.css`
}

export const getMermaidJSPath = () => {
  return import.meta.env.VITE_LITE == "true"
    ? getNpmCDN("mermaid", "11.1.0", "dist/mermaid.min.js")
    : `${dynamicBase}/static/mermaid/mermaid.min.js`
}
