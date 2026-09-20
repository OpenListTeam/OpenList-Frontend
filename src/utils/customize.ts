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
 *      - 静态/CDN 直出的 HTML + Go 后端 → 占位符仍在 → 注入（HTML 没经过 Go）
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
 *   - 注入时 `DOMContentLoaded` / `load` 可能已经触发过，依赖这两个事件的自定义
 *     代码需要自己看 `document.readyState`；片段内脚本的执行顺序由本模块保证
 *     （见 `runScripts`），代价是外部脚本会按顺序等待。
 */

/** 占位符注释文本（与 OpenList-Frontend/index.html、Go 版 UpdateIndex() 一致）。 */
const HEAD_ANCHOR = "customize head"
const BODY_ANCHOR = "customize body"

/** index.html 里硬编码的默认图标地址，用于判断服务端是否已经替换过。 */
const DEFAULT_FAVICON = "https://res.oplist.org/logo/logo.svg"
const DEFAULT_APPLE_TOUCH_ICON = "https://res.oplist.org/logo/logo.png"

/** 管理页路径段（Go 端对应 conf.ManageHtml）。 */
const MANAGE_SEGMENT = "/@manage"

/** 注释占位文本：脚本先换成它占住原位置，轮到执行时再换回真正的 script。 */
const SCRIPT_PLACEHOLDER = "customize script"

/**
 * 等待外部脚本加载的上限。
 *
 * 一个卡住不响应的 CDN 不能把后面的脚本一直吊着：超时后降级为「顺序不保证」，
 * 继续执行剩余脚本。
 */
const SCRIPT_LOAD_TIMEOUT = 15000

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
 * 通过 `innerHTML` 解析出来的 `<script>` 带「already started」标记，**永远不会执行**
 * （HTML 规范：解析器在 innerHTML 路径上创建的 script 直接标记为已启动），只有
 * 手工 `createElement` + 复制属性与文本得到的节点，才会在插入文档时正常执行。
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
 * 是否是可执行的「经典脚本」。
 *
 * `type` 缺省即经典脚本，比较时按规范只取 MIME 主类型（`text/javascript; charset=…`
 * 也算）；`module` 与 `application/json` 这类数据块都不会被当经典脚本执行。
 */
function isClassicScript(script: HTMLScriptElement): boolean {
  const type = (script.getAttribute("type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase()
  if (type === "") return true
  return /^(text|application)\/(x-)?(java|ecma)script(\d+\.\d+)?$/.test(type)
}

/**
 * 是否需要「插入后等它加载完」再执行后面的脚本。
 *
 * - 内联脚本、`type="module"`、数据块：不等。模块之间靠 import 自行保证顺序。
 * - `async`：不等 —— 作者显式声明「不关心顺序」。
 * - 其余外部经典脚本：等。`defer` 只对**解析器插入**的脚本生效，运行时插入的节点上
 *   它不起作用，不等就等于把 `defer` 当 `async`，与作者「顺序执行」的意图相反。
 */
function shouldAwaitLoad(script: HTMLScriptElement): boolean {
  if (!(script.getAttribute("src") ?? "").trim()) return false
  if (script.hasAttribute("async")) return false
  return isClassicScript(script)
}

/**
 * 等外部脚本「结算」（load 或 error）。
 *
 * 对经典脚本，`load` 在脚本**执行完之后**才触发，所以等到 load 就等于等到执行完，
 * 之后插入的脚本一定能看到它定义的全局变量。必须在插入文档**之前**调用，否则可能
 * 错过已经派发的事件。失败与超时都不阻塞后续脚本，只打一条警告。
 */
function watchScriptSettled(script: HTMLScriptElement): Promise<void> {
  return new Promise((resolve) => {
    let timer: number | undefined
    let done = false

    const settle = (message?: string) => {
      if (done) return
      done = true
      script.removeEventListener("load", onSettled)
      script.removeEventListener("error", onSettled)
      if (timer !== undefined) clearTimeout(timer)
      if (message) console.warn(message)
      resolve()
    }

    function onSettled(event: Event) {
      settle(
        event.type === "error"
          ? `[customize] 自定义脚本加载失败，继续执行后续脚本：${script.src}`
          : undefined,
      )
    }

    script.addEventListener("load", onSettled)
    script.addEventListener("error", onSettled)
    timer = window.setTimeout(
      () =>
        settle(
          `[customize] 自定义脚本加载超时，继续执行后续脚本：${script.src}`,
        ),
      SCRIPT_LOAD_TIMEOUT,
    )
  })
}

/** 片段里待执行的脚本：占位注释 + 重建后（尚未插入文档）的 script。 */
type PendingScript = [placeholder: Comment, script: HTMLScriptElement]

/**
 * 把片段插到占位符位置（内容立即就位），返回其中需要执行的脚本，交给 `runScripts`。
 *
 * 之所以「替换锚点」而不是「追加」：替换后锚点消失，语义与 Go 完全一致（Go 就是把
 * 占位符原地换掉），同时也让重复调用天然变成 no-op。
 *
 * 这里**不执行**脚本：`innerHTML` 解析出来的 script 带「already started」标记、永远
 * 不会执行，所以先换成注释占位占住原位置。真正的执行交给 `runScripts`，它按文档顺序
 * 逐个把占位换回重建后的 script —— 这样才能保证
 * `<script src="a.js"></script><script>a.init()</script>` 的顺序，
 * 不会出现内联脚本抢在 `a.js` 前面跑的情况（与 Go 后端下解析器行为一致）。
 */
function injectContent(anchor: Comment, html: string): PendingScript[] {
  const parent = anchor.parentNode
  if (!parent) return []

  const template = document.createElement("template")
  template.innerHTML = html

  const pending: PendingScript[] = []
  // querySelectorAll 返回的是静态且文档顺序的列表，可安全地边遍历边 `replaceWith`；
  // 它覆盖任意层级的 script（`<div><script>…</script></div>` 也算），但不会进入嵌套
  // `<template>` 的 content —— 那部分本就应当是惰性的。
  for (const script of Array.from(
    template.content.querySelectorAll<HTMLScriptElement>("script"),
  )) {
    const placeholder = document.createComment(SCRIPT_PLACEHOLDER)
    script.replaceWith(placeholder)
    pending.push([placeholder, rebuildScript(script)])
  }

  const fragment = document.createDocumentFragment()
  for (const node of Array.from(template.content.childNodes)) {
    // template.content 中的节点已脱离文档，可直接搬移，无需再 clone
    fragment.appendChild(node)
  }
  parent.insertBefore(fragment, anchor)
  anchor.remove()
  return pending
}

/**
 * 按文档顺序执行片段里的脚本。
 *
 * 需要等待的外部脚本（见 `shouldAwaitLoad`）会先插入、等它加载并执行完（load 事件）
 * 再继续下一个，从而复刻「Go 后端下由解析器顺序执行」的语义，解决
 * `<script src="a.js"></script><script>使用 a.js 里的东西</script>` 报错的问题。
 *
 * 等待只影响后续脚本：片段里的 CSS/DOM 在 `injectContent` 里已经就位，不会出现
 * 「页面缺内容」。
 */
async function runScripts(pending: PendingScript[]): Promise<void> {
  for (const [placeholder, script] of pending) {
    // 前面的自定义脚本可能已经把这块内容删掉/换掉，占位不在文档里就跳过。
    if (!placeholder.isConnected) continue
    const settled = shouldAwaitLoad(script) ? watchScriptSettled(script) : null
    placeholder.replaceWith(script)
    if (settled) await settled
  }
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
 * （Go 在 UpdateIndex() 里对 ManageHtml / IndexHtml 都做过这一步）已经替换过，
 * 前端不再插手。
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
async function applyCustomFragments(): Promise<void> {
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

  // 两段内容先一起插入（自定义 CSS / DOM 立即可见，不被慢脚本拖住），再让脚本按文档
  // 顺序执行：head 的脚本跑完，body 的脚本才开始（与解析器顺序一致）。
  const headPending = headAnchor && head ? injectContent(headAnchor, head) : []
  const bodyPending = bodyAnchor && body ? injectContent(bodyAnchor, body) : []
  await runScripts(headPending)
  await runScripts(bodyPending)
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
  // 片段里的脚本是异步按顺序执行的（见 runScripts），这里只保证内容已插入。
  applyCustomFragments().catch((e) =>
    console.error("[customize] 注入自定义内容失败", e),
  )
  applyBrandIcons()
}
