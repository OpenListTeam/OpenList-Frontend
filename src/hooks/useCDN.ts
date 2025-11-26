import { joinBase } from "~/utils"
import packageJson from "../../package.json"

export const useCDN = () => {
  const static_path = joinBase("static")

  const npm = (name: string, version: string, path: string) => {
    // Available: https://github.com/cnpm/unpkg-white-list
    // https://registry.npmmirror.com/monaco-editor/0.55.1/files/min/vs/loader.js
    return `https://registry.npmmirror.com/${name}/${version}/files/${path}`

    // https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs/loader.js
    // return `https://cdn.jsdelivr.net/npm/${name}@${version}/${path}`
  }

  const monacoPath = () => {
    return import.meta.env.VITE_LITE === "true"
      ? npm("monaco-editor", "0.55.1", "min/vs")
      : `${static_path}/monaco-editor/vs`
  }

  const katexCSSPath = () => {
    return import.meta.env.VITE_LITE === "true"
      ? npm("katex", "0.16.11", "dist/katex.min.css")
      : `${static_path}/katex/katex.min.css`
  }

  const mermaidJSPath = () => {
    return import.meta.env.VITE_LITE === "true"
      ? npm("mermaid", "11.1.0", "dist/mermaid.min.js")
      : `${static_path}/mermaid/mermaid.min.js`
  }

  const ruffleJSPath = () => {
    return import.meta.env.VITE_LITE === "true"
      ? npm(
          packageJson.name,
          packageJson.version,
          "dist/static/ruffle/ruffle.js",
        )
      : `${static_path}/ruffle/ruffle.js`
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

  return {
    npm,
    monacoPath,
    katexCSSPath,
    mermaidJSPath,
    ruffleJSPath,
    libHeifPath,
    libAssPath,
    fontsPath,
  }
}
