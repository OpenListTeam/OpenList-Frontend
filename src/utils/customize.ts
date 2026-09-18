import { getSetting } from "~/store/settings"
import { isTsWorker } from "~/utils/backend"

/**
 * 运行时注入自定义内容，并补齐站点图标。
 *
 * ## 为什么需要这一层
 *
 * 前端产物 `index.html` 里保留了字面量占位符，等后端做字符串替换：
 *
 *   <!-- customize head -->     ← 期望被替换成 customize_head 设置值
 *   <!-- customize body -->     ← 期望被替换成 customize_body 设置值
 *
 * Go 后端在 `server/static/static.go` 的 `UpdateIndex()` 里完成替换；而
 * TS 后端 / 纯静态部署的 HTML 不经该流程，占位符会原样下发到浏览器并被当作
 * 注释忽略 —— 表现为「设置保存成功但页面无任何变化」。因此这里在前端
 * settings 加载完成后补做一次注入。
 *
 * ## 与 Go 后端兼容的三条约束（重要，改动前请先读完）
 *
 * 1) **是否注入，只看占位符还在不在。**
 *    Go 的 `replaceStrings()` 是 `strings.Replace(content, old, new, 1)`，
 *    即**无条件替换**（设置为空时也替换成空字符串），所以 Go 下发的 HTML 里
 *    占位符必然消失。反过来，占位符还在就说明没有任何服务端注入过这份 HTML，
 *    由前端接手。这个判据同时覆盖四种组合：
 *      - Go 后端服务 HTML        → 占位符已消失 → 跳过（不重复注入）
 *      - 静态/CDN 直出的 HTML + Go 后端 → 占位符仍在 → 注入（HTMl 没经过 Go）
 *      - TS 后端（未做服务端注入） → 占位符仍在 → 注入
 *      - 将来若 TS 后端也加了服务端注入 → 占位符被替换 → 自动跳过
 *
 * 2) **管理页不注入自定义片段**：Go 的 `noRoute` 对 `/@manage` 返回
 *    `conf.ManageHtml`（只做了 favicon/logo/title/main_color 替换，
 *    **不含** customize），因此这里在非 TS 后端下复刻该行为。
 *
 * 3) **图标只在 href 仍是构建期默认值时替换**：Go 的 `replaceMap1` 已经把默认
 *    地址换成设置值（只替换第一次出现），所以「href 已不是默认值」即代表服务端
 *    改过了，前端绝不再动，避免两边用不同来源的值互相覆盖。
 *
 * ## 已知局限（走前端注入的固有代价）
 *
 * 注入发生在 settings 接口返回之后，因此：
 *   - 自定义 CSS 会有一次首屏闪烁（FOUC）；
 *   - JS 被禁用 / bundle 加载失败 / 初始化异常时，自定义内容完全失效；
 *   - 对爬虫与社交分享卡片无效（它们不执行 JS），初始 HTML 的
 *     `<title>` 仍是构建期默认值。
 *   - 注入位置为 `<head>` / `<body>` 内占位符原位置（与 Go 一致），
 *     而非追加到末尾。
 */

/** 占位符注释文本（与 OpenList-Frontend/index.html、Go 版 UpdateIndex() 一致）。 */
const HEAD_ANCHOR = "customize head"
const BODY_ANCHOR = "customize body"

/** index.html 里硬编码的默认图标地址，用于判断服务端是否已经替换过。 */
const DEFAULT_FAVICON = "https://res.oplist.org/logo/logo.svg"
const DEFAULT_APPLE_TOUCH_ICON = "https://res.oplist.org/logo/logo.png"

/** 管理页路径段（Go 端对应 conf.ManageHtml）。 */
const MANAGE_SEGMENT = "/@manage"

/** 幂等标记：一次页面加载只注入一次。 */
let applied = false

/**
 * 在 root 下查找文本恰为 text 的注释节点（即占位符锚点）。
 *
 * 只比注释文本、不做 HTML 字符串匹配，因此自定义内容里若恰好出现同样的
 * 文本也不会被误判成锚点。
 */
function findAnchor(root: Element | null, text: string): Comment | null {
  if (!root) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
  let node = walker.nextNode()
  while (node) {
    if ((node.nodeValue ?? "").trim() === text) return node as Comment
    node = walker.nextNode()
  }
  return null
}

/**
 * 重建 `<script>` 节点。
 *
 * 通过 innerHTML / cloneNode 插入的 `<script>` **不会执行**（HTML 规范里
 * 由解析器插入的脚本才会跑），因此必须手工建一个 script 元素并复制属性与
 * 文本，浏览器会正常执行它。
 */
function rebuildScript(source: HTMLScriptElement): HTMLScriptElement {
  const script = document.createElement("script")
  for (const attr of Array.from(source.attributes)) {
    script.setAttribute(attr.name, attr.value)
  }
  script.textContent = source.textContent ?? ""
  return script
}

/**
 * 用一段 HTML 片段替换占位符锚点。
 *
 * 之所以「替换」而不是「追加」：替换后锚点消失，语义与 Go 完全一致
 * （Go 就是把占位符原地换掉），同时也让重复调用天然变成 no-op。
 */
function replaceAnchor(anchor: Comment, html: string): void {
  const parent = anchor.parentNode
  if (!parent) return
  const template = document.createElement("template")
  template.innerHTML = html

  const fragment = document.createDocumentFragment()
  for (const node of Array.from(template.content.childNodes)) {
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      (node as Element).tagName === "SCRIPT"
    ) {
      fragment.appendChild(rebuildScript(node as HTMLScriptElement))
    } else {
      // template.content 中的节点已脱离文档，可直接搬移，无需再 clone
      fragment.appendChild(node)
    }
  }
  parent.insertBefore(fragment, anchor)
  anchor.remove()
}

/** 当前路径是否为管理页（兼容 base_path 部署：/<base>/@manage/...）。 */
function isManagePath(pathname: string): boolean {
  const index = pathname.indexOf(MANAGE_SEGMENT)
  if (index < 0) return false
  const next = pathname[index + MANAGE_SEGMENT.length]
  return next === undefined || next === "/"
}

/**
 * 只在参数一致时替换 href。
 *
 * `expected` 是 index.html 里的构建期默认值：href 已不是它，说明服务端
 * （Go 的 UpdateHtml/ManageHtml 都会做这一步）已经替换过，前端不再插手。
 */
function replaceHrefIfDefault(
  link: Element | null,
  value: string | undefined,
  expected: string,
): void {
  if (!link || !value) return
  if ((link.getAttribute("href") ?? "") !== expected) return
  link.setAttribute("href", value)
}

/** 注入 customize_head / customize_body（仅在占位符仍在时）。 */
function applyCustomFragments(): void {
  const headAnchor = findAnchor(document.head, HEAD_ANCHOR)
  const bodyAnchor = findAnchor(document.body, BODY_ANCHOR)

  if (!headAnchor && !bodyAnchor) {
    // Go 后端（或将来做了服务端注入的 TS 后端）已完成注入，不能再来一遍，
    // 否则自定义 JS 会执行两次、customize_body 的内容会出现两份。
    console.debug(
      "[customize] 未发现 customize 占位符，视为服务端已注入，跳过自定义片段",
    )
    return
  }

  // 复刻 Go noRoute 的行为：/@manage 用的是不含 customize 的 ManageHtml。
  // 非 TS 后端（Go / 后端类型未知）按 Go 处理；TS 后端没有这个页面拆分。
  if (!isTsWorker() && isManagePath(location.pathname)) {
    console.debug(
      "[customize] 管理页在 Go 后端下不注入 customize（对齐 ManageHtml），跳过自定义片段",
    )
    return
  }

  const head = getSetting("customize_head")
  const body = getSetting("customize_body")
  if (headAnchor && head) replaceAnchor(headAnchor, head)
  if (bodyAnchor && body) replaceAnchor(bodyAnchor, body)
}

/**
 * 站点图标：`favicon` 在前端代码里没有任何消费方，过去只能靠服务端注入；
 * `apple-touch-icon` 与 Go 一致取 `logo` 设置的第一行。
 */
function applyBrandIcons(): void {
  replaceHrefIfDefault(
    document.querySelector('link[rel="shortcut icon"], link[rel="icon"]'),
    getSetting("favicon"),
    DEFAULT_FAVICON,
  )
  replaceHrefIfDefault(
    document.querySelector('link[rel="apple-touch-icon"]'),
    getSetting("logo").split("\n")[0]?.trim(),
    DEFAULT_APPLE_TOUCH_ICON,
  )
}

/** 注入自定义 CSS/JS 与站点图标（幂等，可安全重复调用）。 */
export const applyCustomize = (): void => {
  if (applied) return
  applied = true
  applyCustomFragments()
  applyBrandIcons()
}
