/**
 * EPUB 批注的锚点与高亮工具。
 *
 * EPUB 章节是重新排版渲染的，不能用像素坐标定位。这里用「章节序号 + 章节内
 * 纯文本字符偏移」做锚点：只要章节内容不变，窗口大小、字号、字体怎么变都能
 * 复原到同一段文字。锚点本身以 JSON 存进后端的 media_annotations.anchor，
 * 与 PDF 的批注对象共用同一张表，靠 format 字段区分。
 */

export const EPUB_ANNOTATION_FORMAT = "epub"

/** 默认高亮色（淡黄），与 ANNOTATION_COLORS 的第一项保持一致 */
export const DEFAULT_ANNOTATION_COLOR = "#fde68a"

/** 可选高亮色：都取低饱和度，深色主题下不刺眼 */
export const ANNOTATION_COLORS = [
  "#fde68a",
  "#bbf7d0",
  "#bfdbfe",
  "#fecaca",
] as const

/** 引文只用于列表展示，截断避免整章被复制进库 */
export const MAX_QUOTE_LENGTH = 300
/** 笔记长度上限，与后端 64KB 限制留足余量 */
export const MAX_NOTE_LENGTH = 2000

/** 高亮元素上的标记属性，渲染与点击都靠它 */
export const ANNOTATION_MARK_ATTR = "data-epub-anno"

export interface EpubAnnotationAnchor {
  format: typeof EPUB_ANNOTATION_FORMAT
  /** 章节在 spine 中的序号（0 起） */
  chapter: number
  /** 章节纯文本中的起始字符偏移 */
  start: number
  /** 结束偏移（不含） */
  end: number
  /** 选中的原文，用于列表展示与偏移失效时的校验 */
  quote: string
  /** 高亮颜色（#rrggbb） */
  color: string
  /** 用户笔记 */
  note: string
}

const toIndex = (value: unknown, fallback = 0): number => {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.floor(n))
}

const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)

/**
 * 解析后端保存的锚点。
 * 解析失败或不是 EPUB 批注时返回 null——同一张表里还躺着 PDF 的批注对象。
 */
export const parseEpubAnchor = (raw: string): EpubAnnotationAnchor | null => {
  let obj: Partial<EpubAnnotationAnchor>
  try {
    obj = JSON.parse(raw) as Partial<EpubAnnotationAnchor>
  } catch {
    return null
  }
  if (!obj || obj.format !== EPUB_ANNOTATION_FORMAT) return null
  const start = toIndex(obj.start)
  const end = toIndex(obj.end)
  if (end <= start) return null
  return {
    format: EPUB_ANNOTATION_FORMAT,
    chapter: toIndex(obj.chapter),
    start,
    end,
    quote:
      typeof obj.quote === "string" ? obj.quote.slice(0, MAX_QUOTE_LENGTH) : "",
    color: isHexColor(obj.color) ? obj.color : DEFAULT_ANNOTATION_COLOR,
    note:
      typeof obj.note === "string" ? obj.note.slice(0, MAX_NOTE_LENGTH) : "",
  }
}

export const serializeEpubAnchor = (anchor: EpubAnnotationAnchor): string =>
  JSON.stringify(anchor)

/**
 * 计算 (node, offset) 在 root 纯文本中的字符位置。
 * 用 Range.toString() 而不是自己遍历文本节点，是为了让 startContainer 落在
 * 元素节点（比如选中整段）时也能算对。
 */
export const textOffset = (
  root: HTMLElement,
  node: Node,
  offset: number,
): number => {
  if (!root.contains(node)) return -1
  const range = root.ownerDocument.createRange()
  range.selectNodeContents(root)
  try {
    range.setEnd(node, offset)
  } catch {
    return -1
  }
  return range.toString().length
}

/** 把 iframe 里的选区换算成锚点；选区为空或跨出正文时返回 null */
export const selectionAnchor = (
  root: HTMLElement,
  range: Range,
): { start: number; end: number; quote: string } | null => {
  const start = textOffset(root, range.startContainer, range.startOffset)
  const end = textOffset(root, range.endContainer, range.endOffset)
  if (start < 0 || end <= start) return null
  // 空白折叠一下，避免跨段选中时引文里塞满换行
  const quote = range.toString().replace(/\s+/g, " ").trim()
  if (!quote) return null
  return { start, end, quote: quote.slice(0, MAX_QUOTE_LENGTH) }
}

/** 字符偏移换算回 DOM Range；越界或找不到对应文本时返回 null */
export const resolveRange = (
  root: HTMLElement,
  start: number,
  end: number,
): Range | null => {
  if (end <= start) return null
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let cursor = 0
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    const length = text.data.length
    if (!startNode && cursor + length >= start) {
      startNode = text
      startOffset = start - cursor
    }
    if (!endNode && cursor + length >= end) {
      endNode = text
      endOffset = end - cursor
      break
    }
    cursor += length
  }
  if (!startNode || !endNode) return null
  const range = doc.createRange()
  range.setStart(startNode, Math.min(startOffset, startNode.data.length))
  range.setEnd(endNode, Math.min(endOffset, endNode.data.length))
  return range
}

/** 去掉所有高亮包裹，把文本节点合并回去（保证下次按偏移定位仍然准确） */
export const clearHighlights = (doc: Document) => {
  doc.querySelectorAll(`mark[${ANNOTATION_MARK_ATTR}]`).forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  })
}

export interface HighlightInput {
  id: string
  start: number
  end: number
  color: string
}

/**
 * 重画本章所有高亮。
 * 从后往前包，前面（更靠前）的区间不会受已插入的 mark 影响；
 * 区间重叠时会产生嵌套 mark，文本内容不变，偏移依旧成立。
 */
export const applyHighlights = (root: HTMLElement, items: HighlightInput[]) => {
  clearHighlights(root.ownerDocument)
  const sorted = [...items].sort((a, b) => b.start - a.start)
  for (const item of sorted) {
    const range = resolveRange(root, item.start, item.end)
    if (!range) continue
    const mark = root.ownerDocument.createElement("mark")
    mark.setAttribute(ANNOTATION_MARK_ATTR, item.id)
    mark.style.backgroundColor = item.color
    mark.style.color = "inherit"
    mark.style.borderRadius = "2px"
    mark.style.cursor = "pointer"
    try {
      mark.appendChild(range.extractContents())
      range.insertNode(mark)
    } catch {
      // 跨表格/绝对定位等异常结构时放弃这一条，不影响本章其余批注
    }
  }
}
