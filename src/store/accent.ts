import { createSignal } from "solid-js"
import { getMainColor } from "./settings"

export interface AccentPreset {
  name: string
  color: string
}

/**
 * Curated accent presets.
 * Default follows the site main color (OpenList blue); presets are refined
 * mid-tone colors that read well on both light and dark surfaces.
 */
export const ACCENT_PRESETS: AccentPreset[] = [
  { name: "Blue", color: "#2563eb" },
  { name: "Indigo", color: "#4f46e5" },
  { name: "Sky", color: "#0284c7" },
  { name: "Teal", color: "#0d9488" },
  { name: "Emerald", color: "#059669" },
  { name: "Olive", color: "#65a30d" },
  { name: "Amber", color: "#b45309" },
  { name: "Rose", color: "#be123c" },
  { name: "Violet", color: "#7c3aed" },
  { name: "Slate", color: "#475569" },
]

const STORAGE_KEY = "openlist-accent-color"
// 是否允许媒体主题色覆盖 hope-ui 的全局色板（默认开启，但只在媒体库页面生效）
const ENABLED_KEY = "openlist-media-accent-enabled"

const stored =
  typeof localStorage !== "undefined"
    ? (localStorage.getItem(STORAGE_KEY) ?? "")
    : ""

const storedEnabled =
  typeof localStorage !== "undefined" ? localStorage.getItem(ENABLED_KEY) : null

const [accentColor, setAccentColorRaw] = createSignal(stored)

const [mediaAccentEnabledRaw, setMediaAccentEnabledRaw] = createSignal(
  storedEnabled === null ? true : storedEnabled === "true",
)

/** 媒体主题色是否启用（关闭后媒体页同样使用站点默认色板） */
export const mediaAccentEnabled = mediaAccentEnabledRaw

export const setMediaAccentEnabled = (enabled: boolean) => {
  setMediaAccentEnabledRaw(enabled)
  try {
    localStorage.setItem(ENABLED_KEY, String(enabled))
  } catch {
    /* ignore */
  }
}

/** Current accent: user selection first, otherwise the site main color. */
export const accent = () => accentColor() || getMainColor()

export { accentColor }

// ==================== color helpers ====================

const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v))

const hexToRgb = (hex: string): [number, number, number] => {
  let h = hex.replace("#", "").trim()
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("")
  }
  const num = parseInt(h, 16)
  if (Number.isNaN(num)) return [37, 99, 235]
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

const rgbToHex = (r: number, g: number, b: number) =>
  "#" +
  [r, g, b]
    .map((v) =>
      Math.round(clamp(v, 0, 255))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")

export const hexToHsl = (hex: string): [number, number, number] => {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6
      break
    case g:
      h = ((b - r) / d + 2) / 6
      break
    default:
      h = ((r - g) / d + 4) / 6
  }
  return [h * 360, s, l]
}

export const hslToHex = (h: number, s: number, l: number): string => {
  h = ((h % 360) + 360) % 360
  s = clamp(s)
  l = clamp(l)
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255)
}

/** Shift lightness by delta (-1..1), keeping hue and saturation. */
export const shiftLightness = (hex: string, delta: number): string => {
  const [h, s, l] = hexToHsl(hex)
  return hslToHex(h, s, clamp(l + delta))
}

/**
 * Build a 12-step palette around the base color using HSL lightness steps,
 * so hover/active/subtle states stay clean instead of turning muddy.
 */
/**
 * 按明暗模式生成 12 级色板。
 * hope-ui 的暗色变量挂在 body.hope-ui-dark 上，会覆盖 html 上的内联变量，
 * 因此暗色模式需要单独生成一套方向相反（深→亮）的色阶，否则配色看起来「没生效」。
 */
const buildPalette = (base: string, dark: boolean): Record<string, string> => {
  const [h, s, l] = hexToHsl(base)
  const sat = Math.max(s, 0.55)
  const baseL = clamp(l, 0.38, 0.56)
  const entries: Record<string, string> = {}
  const put = (index: number, color: string) => {
    entries[`accent${index}`] = color
    entries[`info${index}`] = color
  }

  if (dark) {
    // 暗色：1-8 由近黑逐级提亮（背景/边框），9 实心，10 hover，11 文本，12 高对比文本
    const lows = [0.12, 0.15, 0.19, 0.23, 0.27, 0.31, 0.36, 0.42]
    lows.forEach((lightness, i) => {
      const saturation = clamp(sat * (0.4 + 0.06 * i), 0.15, 1)
      put(i + 1, hslToHex(h, saturation, lightness))
    })
    const solid = hslToHex(h, sat, clamp(baseL, 0.45, 0.58))
    const hover = hslToHex(h, sat, clamp(baseL + 0.05))
    const text = hslToHex(h, Math.min(sat, 0.9), 0.72)
    const contrast = hslToHex(h, Math.min(sat, 0.75), 0.92)
    ;[solid, hover, text, contrast].forEach((color, i) => put(i + 9, color))
    return entries
  }

  // 亮色：1-8 由近白逐级加深（背景/边框），9 实心，10 hover，11 文本，12 高对比文本
  const top = 0.965
  const bottom = Math.min(0.72, Math.max(0.5, baseL + 0.07))
  Array.from({ length: 8 }, (_, i) => {
    const lightness = top - ((top - bottom) * i) / 7
    const saturation = clamp(sat * (0.78 + 0.03 * i), 0.2, 1)
    put(i + 1, hslToHex(h, saturation, lightness))
  })
  const solid = hslToHex(h, sat, baseL)
  const hover = hslToHex(h, sat, clamp(baseL - 0.04))
  const text = hslToHex(h, sat, clamp(baseL - 0.18))
  const contrast = hslToHex(h, sat, clamp(baseL - 0.26))
  ;[solid, hover, text, contrast].forEach((color, i) => put(i + 9, color))
  return entries
}

const isDarkMode = () =>
  typeof document !== "undefined" &&
  document.body.classList.contains("hope-ui-dark")

/**
 * 把色板转换成 CSS 变量表，便于只作用在指定容器上。
 * 作用域化写入（而不是写 html/body）可以避免媒体主题色污染文件页、管理页等其它页面。
 */
export const accentPaletteStyleVars = (
  color: string,
  dark = isDarkMode(),
): Record<string, string> => {
  const palette = buildPalette(color, dark)
  const vars: Record<string, string> = {}
  Object.entries(palette).forEach(([key, value]) => {
    vars[`--hope-colors-${key}`] = value
  })
  return vars
}

/** Write the palette to CSS variables so hope-ui components update live. */
export const applyAccentPalette = (color: string, dark = isDarkMode()) => {
  if (typeof document === "undefined") return
  const vars = accentPaletteStyleVars(color, dark)
  // 同时写入 html 与 body：body 上的内联变量优先级高于 .hope-ui-dark 的暗色变量
  ;[document.documentElement, document.body].forEach((el) => {
    Object.entries(vars).forEach(([key, value]) => {
      el.style.setProperty(key, value)
    })
  })
}

const PALETTE_KEYS = [
  ...Array.from({ length: 12 }, (_, i) => `accent${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `info${i + 1}`),
]

/** Remove inline overrides so the original theme palette (e.g. login page) is used. */
export const clearAccentPalette = () => {
  if (typeof document === "undefined") return
  ;[document.documentElement, document.body].forEach((el) => {
    PALETTE_KEYS.forEach((key) =>
      el.style.removeProperty(`--hope-colors-${key}`),
    )
  })
}

/**
 * Set and persist the accent color.
 * 这里不直接写全局 CSS 变量：由 App 的 effect 根据当前路由决定是否生效，
 * 避免在文件页/管理页选色时污染整站配色。
 */
export const setAccentColor = (color: string) => {
  setAccentColorRaw(color)
  try {
    localStorage.setItem(STORAGE_KEY, color)
  } catch {
    /* ignore */
  }
}

/** Restore the site default color. */
export const resetAccentColor = () => {
  setAccentColorRaw("")
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
