import test from "node:test"
import assert from "node:assert/strict"
import EventTarget from "./EventTarget.js"

test("emit 把 detail 传给监听器", () => {
  const target = new EventTarget()
  const received = []
  target.addEventListener("seeked", (e) => received.push(e.detail))
  target.emit("seeked", { time: 1.5 })
  assert.deepEqual(received, [{ time: 1.5 }])
})

test("多个监听器按注册顺序调用", () => {
  const target = new EventTarget()
  const order = []
  target.addEventListener("play", () => order.push(1))
  target.addEventListener("play", () => order.push(2))
  target.emit("play")
  assert.deepEqual(order, [1, 2])
})

test("removeEventListener 之后不再收到事件", () => {
  const target = new EventTarget()
  let calls = 0
  const fn = () => calls++
  target.addEventListener("pause", fn)
  target.emit("pause")
  target.removeEventListener("pause", fn)
  target.emit("pause")
  assert.equal(calls, 1)
})

test("移除未注册的监听器不抛错", () => {
  const target = new EventTarget()
  assert.doesNotThrow(() => target.removeEventListener("timeupdate", () => {}))
})

test("没有监听器时 emit 不抛错", () => {
  const target = new EventTarget()
  assert.doesNotThrow(() => target.emit("ended"))
})

test("不同类型的事件互不影响", () => {
  const target = new EventTarget()
  const types = []
  target.addEventListener("a", (e) => types.push(e.type))
  target.addEventListener("b", (e) => types.push(e.type))
  target.emit("a")
  assert.deepEqual(types, ["a"])
})
