import { Component, lazy } from "solid-js"
import { getIframePreviews, me, getSettingBool } from "~/store"
import { Obj, ObjType, UserMethods, UserPermissions } from "~/types"
import { ext } from "~/utils"
import { generateIframePreview } from "./iframe"
import { useRouter } from "~/hooks"
import { isArchive } from "~/store/archive"

type Ext = string[] | "*" | ((name: string) => boolean)
type Prior = boolean | (() => boolean)

const extsContains = (exts: Ext | undefined, name: string): boolean => {
  if (exts === undefined) {
    return false
  } else if (exts === "*") {
    return true
  } else if (typeof exts === "function") {
    return (exts as (name: string) => boolean)(name)
  } else {
    return (exts as string[]).includes(ext(name).toLowerCase())
  }
}

const isPrior = (p: Prior): boolean => {
  if (typeof p === "boolean") {
    return p
  }
  return p()
}

export interface Preview {
  name: string
  type?: ObjType
  exts?: Ext
  provider?: RegExp
  component: Component
  prior: Prior
}

export type PreviewComponent = Pick<Preview, "name" | "component">

const previews: Preview[] = [
  // ... (The array of preview definitions remains unchanged)
  {
    name: "HTML render",
    exts: ["html"],
    component: lazy(() => import("./html")),
    prior: true,
  },
  {
    name: "Aliyun Video Previewer",
    type: ObjType.VIDEO,
    provider: /^Aliyundrive(Open)?$/,
    component: lazy(() => import("./aliyun_video")),
    prior: true,
  },
  {
    name: "Markdown",
    type: ObjType.TEXT,
    component: lazy(() => import("./markdown")),
    prior: true,
  },
  {
    name: "Flash",
    exts: ["swf"],
    component: lazy(() => import("./flash")),
    prior: true,
  },
  {
    name: "Markdown with word wrap",
    type: ObjType.TEXT,
    component: lazy(() => import("./markdown_with_word_wrap")),
    prior: true,
  },
  {
    name: "Url Open",
    exts: ["url"],
    component: lazy(() => import("./url")),
    prior: true,
  },
  {
    name: "Text Editor",
    type: ObjType.TEXT,
    exts: ["url"],
    component: lazy(() => import("./text-editor")),
    prior: true,
  },
  {
    name: "Image",
    type: ObjType.IMAGE,
    component: lazy(() => import("./image")),
    prior: true,
  },
  {
    name: "Video",
    type: ObjType.VIDEO,
    component: lazy(() => import("./video")),
    prior: true,
  },
  {
    name: "Audio",
    type: ObjType.AUDIO,
    component: lazy(() => import("./audio")),
    prior: true,
  },
  {
    name: "Ipa",
    exts: ["ipa", "tipa"],
    component: lazy(() => import("./ipa")),
    prior: true,
  },
  {
    name: "Plist",
    exts: ["plist"],
    component: lazy(() => import("./plist")),
    prior: true,
  },
  {
    name: "HEIC",
    exts: ["heic", "heif", "avif", "vvc", "avc", "jpeg", "jpg"],
    component: lazy(() => import("./heic")),
    prior: true,
  },
  {
    name: "Aliyun Office Previewer",
    exts: ["doc", "docx", "ppt", "pptx", "xls", "xlsx", "pdf"],
    provider: /^Aliyundrive(Share)?$/,
    component: lazy(() => import("./aliyun_office")),
    prior: true,
  },
  {
    name: "Asciinema",
    exts: ["cast"],
    component: lazy(() => import("./asciinema")),
    prior: true,
  },
  {
    name: "Video360",
    type: ObjType.VIDEO,
    component: lazy(() => import("./video360")),
    prior: true,
  },
  {
    name: "Archive Preview",
    exts: (name: string) => {
      const index = UserPermissions.findIndex(
        (item) => item === "read_archives",
      )
      if (!UserMethods.can(me(), index)) return false
      return isArchive(name)
    },
    component: lazy(() => import("./archive")),
    prior: () => getSettingBool("preview_archives_by_default"),
  },
]

export const getPreviews = (
  file: Obj & { provider: string },
): PreviewComponent[] => {
  const { searchParams } = useRouter()
  const typeOverride =
    ObjType[searchParams["type"]?.toUpperCase() as keyof typeof ObjType]
  const res: PreviewComponent[] = []
  const subsequent: PreviewComponent[] = []

  // Step 1: Run the original logic to find all matching previews.
  previews.forEach((preview) => {
    if (preview.provider && !preview.provider.test(file.provider)) {
      return
    }
    if (
      preview.type === file.type ||
      (typeOverride && preview.type === typeOverride) ||
      extsContains(preview.exts, file.name)
    ) {
      const r = { name: preview.name, component: preview.component }
      if (isPrior(preview.prior)) {
        res.push(r)
      } else {
        subsequent.push(r)
      }
    }
  })
  const iframePreviews = getIframePreviews(file.name)
  res.push(
    ...iframePreviews.map((preview) => ({
      name: preview.key,
      component: generateIframePreview(preview.value),
    })),
  )

  // ==================== NEW LOGIC START ====================
  // Step 2: Check conditions for the special case.
  const noPreviewsFound = res.length === 0 && subsequent.length === 0
  const isSmallFile = file.size < 1 * 1024 * 1024

  // Step 3: Handle the "Download" option and special case previews.
  if (noPreviewsFound && isSmallFile) {
    // This is the special case: no previews found for a small file.
    // The list "res" is currently empty.

    // 1. Add "Download" as the very first option.
    res.push({
      name: "Download",
      component: lazy(() => import("./download")),
    })

    // 2. Then, add the default text previews after "Download".
    const textPreviewsToAdd = previews
      .filter((p) =>
        ["Markdown", "Markdown with word wrap", "Text Editor"].includes(p.name),
      )
      .map((p) => ({ name: p.name, component: p.component }))
    res.push(...textPreviewsToAdd)
  } else {
    // This is the normal case for all other files.
    // "res" may contain previews for videos, documents, etc.
    // Add "Download" as the last fallback option in the high-priority list.
    res.push({
      name: "Download",
      component: lazy(() => import("./download")),
    })
  }
  // ==================== NEW LOGIC END ====================

  // Step 4: Return the combined list.
  return res.concat(subsequent)
}
