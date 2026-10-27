import { changeColor } from "seemly"
import { accent, shiftLightness } from "~/store/accent"

/** Current accent color. */
export { accent }

/** Primary button / hero block gradient (subtle light-to-dark shift). */
export const accentGradient = () =>
  `linear-gradient(135deg, ${shiftLightness(accent(), 0.05)}, ${shiftLightness(accent(), -0.08)})`

/** Progress bar / thin indicator gradient. */
export const accentBar = () =>
  `linear-gradient(90deg, ${shiftLightness(accent(), 0.03)}, ${accent()})`

/** Accent glow / shadow. */
export const accentShadow = (alpha = 0.4) => changeColor(accent(), { alpha })
