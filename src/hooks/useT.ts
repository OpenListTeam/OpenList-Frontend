import { dict, i18n, languages } from "~/app/i18n"
import { firstUpperCase } from "~/utils"

const translator = i18n.translator(dict)

const resolveTranslation = (
  key: string,
  params?: i18n.BaseTemplateArgs,
): string | undefined => {
  const template = translator(key)
  if (typeof template !== "string") {
    return undefined
  }

  if (params) {
    return i18n.resolveTemplate(template, params) || template
  }

  return template
}
export const useT = () => {
  return (
    key: string,
    params?: i18n.BaseTemplateArgs | undefined,
    defaultValue?: string | undefined,
  ): string => {
    const translatedValue = resolveTranslation(key, params)

    if (translatedValue) return translatedValue
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
