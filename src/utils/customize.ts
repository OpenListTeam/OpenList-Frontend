import { getSetting } from "~/store/settings"

/**
 * 运行时注入自定义内容（对齐 Go 后端服务端注入 index.html 的
 * `<!-- customize head -->` / `<!-- customize body -->` 占位符）。
 *
 * Go 后端在返回 HTML 前完成占位符替换；TS/静态部署前端 HTML 不经后端，
 * 因此无法走服务端注入，改由前端在 settings 加载完成后动态注入：
 *   customize_head -> 注入到 <head> 末尾
 *   customize_body -> 注入到 <body> 末尾
 *
 * 注意：insertAdjacentHTML / innerHTML 不会执行插入的 <script>，这里用
 * <template> 解析后对 <script> 节点重建，确保自定义 JS 能真正执行。
 */
function injectFragment(target: ParentNode, html: string): void {
  if (!html) return
  const template = document.createElement("template")
  template.innerHTML = html
  const nodes = Array.from(template.content.childNodes)
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element
      if (el.tagName === "SCRIPT") {
        const script = document.createElement("script")
        for (const attr of Array.from(el.attributes)) {
          script.setAttribute(attr.name, attr.value)
        }
        script.textContent = el.textContent || ""
        target.appendChild(script)
      } else {
        target.appendChild(node.cloneNode(true))
      }
    } else {
      target.appendChild(node.cloneNode(true))
    }
  }
}

/** 注入自定义 CSS/JS（customize_head + customize_body） */
export const applyCustomize = (): void => {
  injectFragment(document.head, getSetting("customize_head"))
  injectFragment(document.body, getSetting("customize_body"))
}
