/**
 * cron 表达式的前端解析与执行时间预览计算。
 * 语义与后端 pkg/cron 保持一致：标准 5 字段（分 时 日 月 周），
 * 支持 *、单个值、范围（1-5）、列表（1,2,3）和步进（如 "任意/5"、"1-10/2"）。
 */

export interface CronField {
  min: number
  max: number
  values: Set<number>
}

export interface ParsedCron {
  minute: CronField
  hour: CronField
  dayOfMonth: CronField
  month: CronField
  dayOfWeek: CronField
}

const parseCronField = (
  field: string,
  min: number,
  max: number,
): CronField | null => {
  const values = new Set<number>()
  for (const part of field.split(",")) {
    if (part === "") return null
    const slash = part.indexOf("/")
    const expr = slash >= 0 ? part.slice(0, slash) : part
    const stepText = slash >= 0 ? part.slice(slash + 1) : ""
    let low: number
    let high: number
    if (expr === "*" || expr === "?") {
      low = min
      high = max
    } else if (expr.includes("-")) {
      const [a, b] = expr.split("-").map(Number)
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a < min ||
        b > max ||
        a > b
      ) {
        return null
      }
      low = a
      high = b
    } else {
      const v = Number(expr)
      if (!Number.isInteger(v) || v < min || v > max) return null
      low = v
      high = v
    }
    let step = 1
    if (stepText !== "") {
      step = Number(stepText)
      if (!Number.isInteger(step) || step <= 0) return null
    }
    for (let v = low; v <= high; v += step) values.add(v)
  }
  if (values.size === 0) return null
  return { min, max, values }
}

export const parseCronSpec = (spec: string): ParsedCron | null => {
  const fields = spec.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const minute = parseCronField(fields[0], 0, 59)
  const hour = parseCronField(fields[1], 0, 23)
  const dayOfMonth = parseCronField(fields[2], 1, 31)
  const month = parseCronField(fields[3], 1, 12)
  const dayOfWeek = parseCronField(fields[4], 0, 7)
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null
  // crontab 中 7 也表示周日，统一归一为 0 并移除 7，
  // 保证 DOW 的命中集合始终落在 0..6，便于判断是否通配。
  if (dayOfWeek.values.has(7)) {
    dayOfWeek.values.add(0)
    dayOfWeek.values.delete(7)
  }
  return { minute, hour, dayOfMonth, month, dayOfWeek }
}

const matches = (parsed: ParsedCron, t: Date): boolean => {
  // 与后端一致：DOM 和 DOW 同时受限时任一命中即可；
  // 其中一方为通配（覆盖完整范围）时按 AND 处理，只有另一方生效。
  const domFull = parsed.dayOfMonth.values.size === 31
  const dowFull = parsed.dayOfWeek.values.size === 7
  const dayMatches =
    domFull || dowFull
      ? parsed.dayOfMonth.values.has(t.getDate()) &&
        parsed.dayOfWeek.values.has(t.getDay())
      : parsed.dayOfMonth.values.has(t.getDate()) ||
        parsed.dayOfWeek.values.has(t.getDay())
  return (
    parsed.minute.values.has(t.getMinutes()) &&
    parsed.hour.values.has(t.getHours()) &&
    parsed.month.values.has(t.getMonth() + 1) &&
    dayMatches
  )
}

/** 单条表达式严格晚于 after 的下一次触发时间；最多向后搜索一年。 */
const nextAfter = (parsed: ParsedCron, after: Date): Date | null => {
  const next = new Date(after)
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + 1)
  for (let i = 0; i < 527040; i++) {
    if (matches(parsed, next)) return next
    next.setMinutes(next.getMinutes() + 1)
  }
  return null
}

/** 计算一组表达式未来 count 次执行时间（去重、按时间升序）。 */
export const nextRunTimes = (
  specs: string[],
  after: Date,
  count: number,
): Date[] => {
  const parsedList: ParsedCron[] = []
  for (const spec of specs) {
    const parsed = parseCronSpec(spec)
    if (parsed) parsedList.push(parsed)
  }
  const result: Date[] = []
  const seen = new Set<number>()
  let cursor = after
  while (result.length < count) {
    let best: Date | null = null
    for (const parsed of parsedList) {
      const next = nextAfter(parsed, cursor)
      if (next && (!best || next.getTime() < best.getTime())) best = next
    }
    if (!best) break
    if (!seen.has(best.getTime())) {
      seen.add(best.getTime())
      result.push(best)
    }
    cursor = best
  }
  return result
}

/** 执行时间预览的格式化输出，例如 2026-09-15 15:49。 */
export const formatRunTime = (date: Date): string => {
  const full = (v: number) => (v < 10 ? `0${v}` : `${v}`)
  return (
    `${date.getFullYear()}-${full(date.getMonth() + 1)}-${full(
      date.getDate(),
    )} ` + `${full(date.getHours())}:${full(date.getMinutes())}`
  )
}

/** 执行周期预设行类型。 */
export type SpecRowKind = "monthly" | "weekly" | "everyN" | "custom"

export interface SpecRow {
  kind: SpecRowKind
  /** monthly：每月第几天（1-31）。 */
  day: number
  /** weekly：星期几（0=周日 … 6=周六）。 */
  weekday: number
  /** 小时（0-23）。 */
  hour: number
  /** 分钟（0-59）。 */
  minute: number
  /** everyN：间隔分钟数。 */
  n: number
  /** custom：原始表达式。 */
  expr: string
}

export const defaultSpecRow = (): SpecRow => ({
  kind: "everyN",
  day: 1,
  weekday: 1,
  hour: 0,
  minute: 0,
  n: 30,
  expr: "",
})

/** 预设行 → cron 表达式。 */
export const rowToCron = (row: SpecRow): string => {
  switch (row.kind) {
    case "monthly":
      return `${row.minute} ${row.hour} ${row.day} * *`
    case "weekly":
      return `${row.minute} ${row.hour} * * ${row.weekday}`
    case "everyN":
      return `*/${row.n} * * * *`
    default:
      return row.expr.trim()
  }
}

/** cron 表达式 → 预设行；能匹配预设形态的归一为预设，否则按自定义保留原文。 */
export const cronToRow = (spec: string): SpecRow => {
  const fields = spec.trim().split(/\s+/)
  const single = (field: string | undefined) =>
    field !== undefined && /^\d+$/.test(field) ? Number(field) : null
  if (fields.length === 5) {
    const [minute, hour, dom, month, dow] = fields
    const step = minute.startsWith("*/")
    const stepN = step ? Number(minute.slice(2)) : null
    if (
      step &&
      Number.isInteger(stepN) &&
      stepN! > 0 &&
      hour === "*" &&
      dom === "*" &&
      month === "*" &&
      dow === "*"
    ) {
      return { ...defaultSpecRow(), kind: "everyN", n: stepN! }
    }
    const m = single(minute)
    const h = single(hour)
    const d = single(dom)
    const w = single(dow)
    if (
      m !== null &&
      h !== null &&
      d !== null &&
      month === "*" &&
      dow === "*"
    ) {
      return {
        ...defaultSpecRow(),
        kind: "monthly",
        day: d,
        hour: h,
        minute: m,
      }
    }
    if (
      m !== null &&
      h !== null &&
      dom === "*" &&
      month === "*" &&
      w !== null
    ) {
      return {
        ...defaultSpecRow(),
        kind: "weekly",
        weekday: w === 7 ? 0 : w,
        hour: h,
        minute: m,
      }
    }
  }
  return { ...defaultSpecRow(), kind: "custom", expr: spec.trim() }
}
