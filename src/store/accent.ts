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
  { name: "Emerald", color: "#10b981" },
  { name: "Teal", color: "#0d9488" },
  { name: "Violet", color: "#7c3aed" },
  { name: "Amber", color: "#d97706" },
  { name: "Rose", color: "#e11d48" },
]

const STORAGE_KEY = "openlist-accent-color"

const stored =
  typeof localStorage !== "undefined"
    ? (localStorage.getItem(STORAGE_KEY) ?? "")
    : ""

const [accentColor, setAccentColorRaw] = createSignal(stored)

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
const buildPalette = (base: string): Record<string, string> => {
  const [h, s, l] = hexToHsl(base)
  const sat = Math.max(s, 0.55)
  const baseL = clamp(l, 0.38, 0.56)
  const step = (lightness: number, satMul = 1) =>
    hslToHex(h, clamp(sat * satMul, 0.2, 1), lightness)

  // Steps 1-8: soft tints that descend into the solid color smoothly.
  const top = 0.965
  const bottom = Math.min(0.72, Math.max(0.5, baseL + 0.07))
  const scale = Array.from({ length: 8 }, (_, i) => {
    const lightness = top - ((top - bottom) * i) / 7
    const saturation = 0.78 + 0.03 * i
    return step(lightness, saturation)
  })
  const solid = hslToHex(h, sat, baseL)
  const hover = hslToHex(h, sat, clamp(baseL - 0.04))
  const active = hslToHex(h, sat, clamp(baseL - 0.08))
  const emphasis = hslToHex(h, sat, clamp(baseL - 0.14))

  const entries: Record<string, string> = {}
  scale.forEach((color, i) => {
    entries[`accent${i + 1}`] = color
    entries[`info${i + 1}`] = color
  })
  const rest = [solid, hover, active, emphasis]
  rest.forEach((color, i) => {
    entries[`accent${i + 9}`] = color
    entries[`info${i + 9}`] = color
  })
  return entries
}

/** Write the palette to CSS variables so hope-ui components update live. */
export const applyAccentPalette = (color: string) => {
  if (typeof document === "undefined") return
  const palette = buildPalette(color)
  const root = document.documentElement
  Object.entries(palette).forEach(([key, value]) => {
    root.style.setProperty(`--hope-colors-${key}`, value)
  })
}

const PALETTE_KEYS = [
  ...Array.from({ length: 12 }, (_, i) => `accent${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `info${i + 1}`),
]

/** Remove inline overrides so the original theme palette (e.g. login page) is used. */
export const clearAccentPalette = () => {
  if (typeof document === "undefined") return
  const root = document.documentElement
  PALETTE_KEYS.forEach((key) =>
    root.style.removeProperty(`--hope-colors-${key}`),
  )
}

/** Set and persist the accent color. */
export const setAccentColor = (color: string) => {
  setAccentColorRaw(color)
  try {
    localStorage.setItem(STORAGE_KEY, color)
  } catch {
    /* ignore */
  }
  applyAccentPalette(color)
}

/** Restore the site default color. */
export const resetAccentColor = () => {
  setAccentColorRaw("")
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  applyAccentPalette(getMainColor())
}

/** Apply the saved accent on startup. */
export const initAccent = () => {
  applyAccentPalette(stored || getMainColor())
}
