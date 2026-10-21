import { accentGradient } from "~/utils/accent"

/**
 * 媒体库统一的按钮 / 标签样式。
 * 各详情页此前各写一套圆角、内边距和配色，这里收敛为同一组 token。
 */
export const mediaBtnBase = {
  border: "none",
  "border-radius": "10px",
  "font-size": "14px",
  "font-weight": "600",
  cursor: "pointer",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  gap: "8px",
  padding: "10px 22px",
  transition: "opacity 0.15s, transform 0.15s",
} as const

export const mediaPrimaryBtn = {
  ...mediaBtnBase,
  background: accentGradient(),
  color: "#fff",
} as const

export const mediaSecondaryBtn = (isDark: boolean) => ({
  ...mediaBtnBase,
  "font-weight": "500",
  background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
  border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"}`,
  color: isDark ? "#cbd5e1" : "#334155",
})

export const mediaBackBtn = (isDark: boolean) => ({
  ...mediaSecondaryBtn(isDark),
  padding: "8px 16px",
  "font-size": "13px",
  "border-radius": "8px",
  "margin-bottom": "24px",
})

export const mediaChip = (isDark: boolean) => ({
  background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
  "border-radius": "999px",
  padding: "3px 10px",
  color: isDark ? "#94a3b8" : "#64748b",
  "font-size": "12px",
})

export const mediaMetaText = (isDark: boolean) => ({
  color: isDark ? "#64748b" : "#94a3b8",
  "font-size": "14px",
})
