import { dict, i18n, languages } from "~/app/i18n"
import { firstUpperCase } from "~/utils"

export const useT = () => {
  const t = i18n.translator(dict)
  const tt = (key: string, params?: i18n.BaseTemplateArgs) => {
    return i18n.resolveTemplate ? i18n.resolveTemplate(key, params) : t(key)
  }
  return (
    key: string,
    params?: i18n.BaseTemplateArgs | undefined,
    defaultValue?: string | undefined,
  ) => {
    const value = params
      ? (tt(key, params) as string | undefined)
      : (t(key) as string | undefined)

    if (value) return value

    if (defaultValue) return defaultValue

    if (import.meta.env.DEV) return key

    return formatKeyAsDisplay(key)
  }
}

const formatKeyAsDisplay = (key: string): string => {
  let lastDotIndex = key.lastIndexOf(".")
  if (lastDotIndex === key.length - 1) {
    lastDotIndex = key.lastIndexOf(".", lastDotIndex - 1)
  }
  const last = key.slice(lastDotIndex + 1)
  return firstUpperCase(last).split("_").join(" ")
}
