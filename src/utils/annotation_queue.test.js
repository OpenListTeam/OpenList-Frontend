import test from "node:test"

import assert from "node:assert/strict"
import { createAnnotationQueue } from "./annotation_queue.ts"

const anno = (id, value = 1) => ({ id, value })

test("upsert 与 delete 对同一 ID 互斥", () => {
  const q = createAnnotationQueue()
  q.upsert(anno("a"))
  q.remove("a")
  let batch = q.take()
  assert.deepEqual(batch.upserts, [])
  assert.deepEqual(batch.deletes, ["a"])

  q.upsert(anno("a"))
  batch = q.take()
  assert.deepEqual(batch.deletes, [])
  assert.equal(batch.upserts.length, 1)
})

test("失败重入队不会用旧内容覆盖请求期间的新编辑", () => {
  const q = createAnnotationQueue()
  q.upsert(anno("a", 1))
  const batch = q.take()

  // 请求还没结束，用户又改了同一条批注
  q.upsert(anno("a", 2))
  q.restore(batch)

  const next = q.take()
  assert.equal(next.upserts.length, 1)
  assert.equal(next.upserts[0].value, 2)
})

test("请求期间被删除的批注，失败重入队后不能再复活", () => {
  const q = createAnnotationQueue()
  q.upsert(anno("a", 1))
  const batch = q.take()

  q.remove("a")
  q.restore(batch)

  const next = q.take()
  assert.deepEqual(next.upserts, [])
  assert.deepEqual(next.deletes, ["a"])
})

test("请求期间被重新创建的批注，失败重入队后不能留下待删除", () => {
  const q = createAnnotationQueue()
  q.remove("a")
  const batch = q.take()

  q.upsert(anno("a", 3))
  q.restore(batch)

  const next = q.take()
  assert.deepEqual(next.deletes, [])
  assert.equal(next.upserts.length, 1)
  assert.equal(next.upserts[0].value, 3)
})

test("没有新操作时失败批次完整恢复", () => {
  const q = createAnnotationQueue()
  q.upsert(anno("a"))
  q.upsert(anno("b"))
  q.remove("c")
  const batch = q.take()
  assert.equal(q.size(), 0)

  q.restore(batch)
  assert.equal(q.size(), 3)
  const next = q.take()
  assert.deepEqual(next.upserts.map((x) => x.id).sort(), ["a", "b"])
  assert.deepEqual(next.deletes, ["c"])
})
