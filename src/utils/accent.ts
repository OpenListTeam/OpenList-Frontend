import { changeColor } from "seemly"
import { accent } from "~/store/accent"

/** 当前主题色 */
export { accent }

/** 主按钮/强调块渐变 */
export const accentGradient = () =>
  `linear-gradient(135deg, ${accent()}, ${changeColor(accent(), { alpha: 0.72 })})`

/** 进度条/细条渐变 */
export const accentBar = () =>
  `linear-gradient(90deg, ${accent()}, ${changeColor(accent(), { alpha: 0.62 })})`

/** 主题色阴影 */
export const accentShadow = (alpha = 0.4) => changeColor(accent(), { alpha })
