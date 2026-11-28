import test from "node:test"
import assert from "node:assert/strict"
import { nextRunTimes, parseCronSpec } from "./cron.ts"

/**
 * 这些用例与后端 pkg/cron/cron_test.go 一一对应。
 * 前端的执行时间预览必须与后端调度结果一致，否则用户会看到错误的下一次执行时间。
 */

const at = (s) => new Date(s)

const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`

test("DOM 与 DOW 同时受限时任一命中即可", () => {
  // 2026-11-13 既是 13 日也是周五，应命中当天。
  const runs = nextRunTimes(["0 0 13 * 5"], at("2026-11-12T00:00:00"), 1)
  assert.equal(fmt(runs[0]), "2026-11-13 00:00")
  // 2026-11-14（周六）之后：13 日已过，下一个命中是 2026-11-20 周五。
  const later = nextRunTimes(["0 0 13 * 5"], at("2026-11-14T00:00:00"), 1)
  assert.equal(fmt(later[0]), "2026-11-20 00:00")
})

test("覆盖全部取值的 DOM 仍是受限字段，需与受限的 DOW 做 OR", () => {
  // "1-31" 覆盖全部日期但不是通配语法，因此仍按 OR 组合，等同于每天执行。
  const runs = nextRunTimes(["0 0 1-31 * 1"], at("2026-11-10T00:00:00"), 1)
  assert.equal(fmt(runs[0]), "2026-11-11 00:00")
})

test("以 * 开头的步进字段仍是通配语法，按 AND 组合", () => {
  // "*/2" 是通配语法：既要满足 DOM 的奇数日，也要满足 DOW 的周一。
  const runs = nextRunTimes(["0 0 */2 * 1"], at("2026-11-10T00:00:00"), 1)
  assert.equal(fmt(runs[0]), "2026-11-23 00:00")
})

test("闰日规则跨平年仍能计算下一次触发时间", () => {
  // 8 年搜索窗口必须覆盖跨世纪的最长间隔；一年窗口会返回"无下一次执行"。
  const runs = nextRunTimes(["0 0 29 2 *"], at("2026-03-01T00:00:00"), 1)
  assert.equal(runs.length, 1)
  assert.equal(fmt(runs[0]), "2028-02-29 00:00")
})

test("真正无解的规则返回空列表而不是错误的时间", () => {
  // 2 月没有 30 日。
  assert.deepEqual(
    nextRunTimes(["0 0 30 2 *"], at("2026-03-01T00:00:00"), 1),
    [],
  )
})

test("通配语法按字段单独判定", () => {
  const parsed = parseCronSpec("*/5 1,2 1-3 * 0")
  assert.notEqual(parsed, null)
  assert.equal(parsed.minute.wildcard, true)
  assert.equal(parsed.hour.wildcard, false)
  assert.equal(parsed.dayOfMonth.wildcard, false)
  assert.equal(parsed.month.wildcard, true)
  assert.equal(parsed.dayOfWeek.wildcard, false)
})

test("7 归一为周日 0", () => {
  const runs = nextRunTimes(["0 0 * * 7"], at("2026-11-28T12:00:00"), 1)
  assert.equal(fmt(runs[0]), "2026-11-29 00:00")
  assert.equal(runs[0].getDay(), 0)
})
