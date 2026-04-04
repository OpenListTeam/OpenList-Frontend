import * as i18n from "@solid-primitives/i18n"
import { createResource, createSignal } from "solid-js"
export { i18n }

// Only use English as the default language (no crowdin, single language mode)
const langs = {
  "~/lang/en/index.json": "English",
}

// all available languages (only English)
export const languages = [{ code: "en", lang: "English" }]

// Always use English as the default language
const defaultLang = "en"

// Get initial language - always English
export let initialLang = "en"

// Type imports
// use `type` to not include the actual dictionary in the bundle
import type * as en from "~/lang/en/entry"

export type Lang = "en"
export type RawDictionary = typeof en.dict
export type Dictionary = i18n.Flatten<RawDictionary>

// Fetch and flatten the dictionary (only English)
const fetchDictionary = async (_locale: Lang): Promise<Dictionary> => {
  try {
    const dict: RawDictionary = (await import(`~/lang/en/entry.ts`)).dict
    return i18n.flatten(dict) // Flatten dictionary for easier access to keys
  } catch (err) {
    console.error(`Error loading dictionary for locale: English`, err)
    throw new Error(`Failed to load dictionary for English`)
  }
}

// Signals to track current language and dictionary state
export const [currentLang, setCurrentLang] = createSignal<Lang>(initialLang)

export const [dict] = createResource(currentLang, fetchDictionary)
