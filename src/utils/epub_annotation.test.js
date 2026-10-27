import test from "node:test"

import assert from "node:assert/strict"
import {
  DEFAULT_ANNOTATION_COLOR,
  MAX_NOTE_LENGTH,
  MAX_QUOTE_LENGTH,
  parseEpubAnchor,
  serializeEpubAnchor,
} from "./epub_annotation.ts"

const valid = {
  format: "epub",
  chapter: 2,
  start: 10,
  end: 20,
  quote: "被选中的一段文字",
  color: "#bbf7d0",
  note: "我的笔记",
}

test("锚点序列化后能原样解析回来", () => {
  assert.deepEqual(parseEpubAnchor(serializeEpubAnchor(valid)), valid)
})

test("PDF 的锚点对象不会被当成 EPUB 批注", () => {
  // 同一张表里同时存 PDF / EPUB 两种锚点，必须靠 format 区分
  const pdfAnchor = JSON.stringify({
    id: "abc",
    pageIndex: 0,
    type: "highlight",
  })
  assert.equal(parseEpubAnchor(pdfAnchor), null)
})

test("非法 JSON 与空区间返回 null", () => {
  assert.equal(parseEpubAnchor("{not json"), null)
  assert.equal(
    parseEpubAnchor(JSON.stringify({ ...valid, start: 20, end: 20 })),
    null,
  )
  assert.equal(
    parseEpubAnchor(JSON.stringify({ ...valid, start: 30, end: 20 })),
    null,
  )
})

test("负数偏移与章节被夹到 0", () => {
  const parsed = parseEpubAnchor(
    JSON.stringify({ ...valid, chapter: -3, start: -1, end: 5 }),
  )
  assert.equal(parsed.chapter, 0)
  assert.equal(parsed.start, 0)
  assert.equal(parsed.end, 5)
})

test("非法颜色回落到默认高亮色", () => {
  const parsed = parseEpubAnchor(JSON.stringify({ ...valid, color: "red" }))
  assert.equal(parsed.color, DEFAULT_ANNOTATION_COLOR)
})

test("超长引文与笔记被截断", () => {
  const parsed = parseEpubAnchor(
    JSON.stringify({
      ...valid,
      quote: "字".repeat(MAX_QUOTE_LENGTH + 50),
      note: "字".repeat(MAX_NOTE_LENGTH + 50),
    }),
  )
  assert.equal(parsed.quote.length, MAX_QUOTE_LENGTH)
  assert.equal(parsed.note.length, MAX_NOTE_LENGTH)
})
