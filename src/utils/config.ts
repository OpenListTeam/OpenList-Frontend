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

export const getMonacoPath = () => {
  const monaco_cdn =
    window.OPENLIST_CONFIG.monaco_cdn ||
    "https://registry.npmmirror.com/monaco-editor/0.52.2/files/min/vs"
  // @ts-ignore
  const base = window.__dynamic_base__ || "/"
  return import.meta.env.VITE_LOCAL_MONACO
    ? `${base}static/monaco-editor/min/vs`
    : monaco_cdn
}

export const getKatexCSSPath = () => {
  // @ts-ignore
  const base = window.__dynamic_base__ || "/"
  return import.meta.env.VITE_LOCAL_MONACO
    ? `${base}static/katex/dist/katex.min.css`
    : "https://registry.npmmirror.com/katex/0.16.11/files/dist/katex.min.css"
}

export const getMermaidJSPath = () => {
  // @ts-ignore
  const base = window.__dynamic_base__ || "/"
  return import.meta.env.VITE_LOCAL_MONACO
    ? `${base}static/mermaid/dist/mermaid.min.js`
    : "https://registry.npmmirror.com/mermaid/11/files/dist/mermaid.min.js"
}
