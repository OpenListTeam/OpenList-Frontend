import { createSignal } from "solid-js"
import { getMainColor } from "./settings"

export interface AccentPreset {
  name: string
  color: string
}

/** 可选主题色（默认蓝色，与 OpenList 文件管理一致） */
export const ACCENT_PRESETS: AccentPreset[] = [
  { name: "蓝色", color: "#1890ff" },
  { name: "绿色", color: "#52c41a" },
  { name: "青色", color: "#13c2c2" },
  { name: "紫色", color: "#722ed1" },
  { name: "橙色", color: "#fa8c16" },
  { name: "红色", color: "#f5222d" },
]

const STORAGE_KEY = "openlist-accent-color"

const stored =
  typeof localStorage !== "undefined"
    ? (localStorage.getItem(STORAGE_KEY) ?? "")
    : ""

const [accentColor, setAccentColorRaw] = createSignal(stored)

/** 当前主题色：用户选择的颜色优先，否则跟随站点主色 */
export const accent = () => accentColor() || getMainColor()

export { accentColor }

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

const hexToRgb = (hex: string): [number, number, number] => {
  let h = hex.replace("#", "").trim()
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("")
  }
  const num = parseInt(h, 16)
  if (Number.isNaN(num)) return [24, 144, 255]
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

const rgbToHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")

const mix = (hex: string, target: number, ratio: number) => {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(
    r + (target - r) * ratio,
    g + (target - g) * ratio,
    b + (target - b) * ratio,
  )
}

/** 生成 hope-ui 12 级色板，语义与默认 accent 调色板一致 */
const buildPalette = (base: string): Record<string, string> => {
  const [r, g, b] = hexToRgb(base)
  return {
    [`accent1`]: mix(base, 255, 0.92),
    [`accent2`]: mix(base, 255, 0.84),
    [`accent3`]: mix(base, 255, 0.7),
    [`accent4`]: mix(base, 255, 0.52),
    [`accent5`]: mix(base, 255, 0.34),
    [`accent6`]: mix(base, 255, 0.16),
    [`accent7`]: mix(base, 255, 0.06),
    [`accent8`]: mix(base, 0, 0.06),
    [`accent9`]: rgbToHex(r, g, b),
    [`accent10`]: mix(base, 0, 0.14),
    [`accent11`]: mix(base, 0, 0.3),
    [`accent12`]: mix(base, 0, 0.48),
    [`info1`]: mix(base, 255, 0.92),
    [`info2`]: mix(base, 255, 0.84),
    [`info3`]: mix(base, 255, 0.7),
    [`info4`]: mix(base, 255, 0.52),
    [`info5`]: mix(base, 255, 0.34),
    [`info6`]: mix(base, 255, 0.16),
    [`info7`]: mix(base, 255, 0.06),
    [`info8`]: mix(base, 0, 0.06),
    [`info9`]: rgbToHex(r, g, b),
    [`info10`]: mix(base, 0, 0.14),
    [`info11`]: mix(base, 0, 0.3),
    [`info12`]: mix(base, 0, 0.48),
  }
}

/** 把主题色写入 CSS 变量，hope-ui 组件会立即跟随 */
export const applyAccentPalette = (color: string) => {
  if (typeof document === "undefined") return
  const palette = buildPalette(color)
  const root = document.documentElement
  Object.entries(palette).forEach(([key, value]) => {
    root.style.setProperty(`--hope-colors-${key}`, value)
  })
}

/** 设置主题色并持久化到浏览器 */
export const setAccentColor = (color: string) => {
  setAccentColorRaw(color)
  try {
    localStorage.setItem(STORAGE_KEY, color)
  } catch {
    /* ignore */
  }
  applyAccentPalette(color)
}

/** 恢复为站点默认主色 */
export const resetAccentColor = () => {
  setAccentColorRaw("")
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  applyAccentPalette(getMainColor())
}

/** 页面启动时应用已保存的主题色 */
export const initAccent = () => {
  applyAccentPalette(stored || getMainColor())
}
