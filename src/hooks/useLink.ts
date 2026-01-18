import { objStore, selectedObjs, State, me, getSetting } from "~/store"
import { Obj, ArchiveObj } from "~/types"
import {
  base_path,
  api,
  encodePath,
  pathDir,
  pathJoin,
  standardizePath,
} from "~/utils"
import { useRouter, useUtil } from "."
import { cookieStorage } from "@solid-primitives/storage"

type URLType = "preview" | "direct" | "proxy"

// Check if current access is from external network (matching configured domain)
const isExternalAccess = (): boolean => {
  const customDomain = getSetting("share_url_domain")
  if (!customDomain) return false

  try {
    let configuredUrl = customDomain.trim()
    if (
      !configuredUrl.startsWith("http://") &&
      !configuredUrl.startsWith("https://")
    ) {
      configuredUrl = "https://" + configuredUrl
    }
    const configuredHost = new URL(configuredUrl).host
    const currentHost = location.host
    return (
      currentHost === configuredHost ||
      currentHost.endsWith("." + configuredHost)
    )
  } catch {
    return false
  }
}

// Get the host URL for direct/share links
// Smart routing: always use current origin (location.origin)
// This ensures internal users get internal links, external users get external links
const getCustomHost = (isShare: boolean): string => {
  // Always use current origin for consistency
  // This provides smart routing automatically:
  // - External access via ol.miyakko.de → links use ol.miyakko.de
  // - Internal access via 192.168.x.x → links use 192.168.x.x
  return location.origin + base_path
}

// Extract sharing ID from a share path (/@s/{sid}/...)
const extractSharingId = (sharePath: string): string => {
  // sharePath format: /@s/{sid} or /@s/{sid}/path/to/file
  // Remove /@s prefix first
  const withoutPrefix = sharePath.startsWith("/@s/")
    ? sharePath.substring(4)
    : sharePath.substring(3)
  const slashIndex = withoutPrefix.indexOf("/")
  if (slashIndex === -1) {
    return withoutPrefix // Single file share: /@s/{sid}
  }
  return withoutPrefix.substring(0, slashIndex) // Folder share: /@s/{sid}/...
}

// Extract the path after sharing ID from a share path
const extractPathAfterSid = (sharePath: string): string => {
  // sharePath format: /@s/{sid} or /@s/{sid}/path/to/file
  const withoutPrefix = sharePath.startsWith("/@s/")
    ? sharePath.substring(4)
    : sharePath.substring(3)
  const slashIndex = withoutPrefix.indexOf("/")
  if (slashIndex === -1) {
    return "" // Single file share, no path after sid
  }
  return withoutPrefix.substring(slashIndex) // Returns /path/to/file
}

// get download url by dir and obj
export const getLinkByDirAndObj = (
  dir: string,
  obj: Obj,
  type: URLType = "direct",
  isShare: boolean,
  encodeAll?: boolean,
) => {
  let sharingId = ""
  let isSingleFileShare = false

  if (type !== "preview") {
    if (isShare) {
      // For share pages, extract the sharing ID and path after it
      sharingId = extractSharingId(dir)
      const pathAfterSid = extractPathAfterSid(dir)
      // If pathAfterSid is empty, this is a single file share
      // In that case, we should NOT add obj.name to the path
      // because the backend will use the sharing's file path directly
      isSingleFileShare = pathAfterSid === ""
      dir = pathAfterSid
    } else {
      dir = pathJoin(me().base_path, dir)
    }
  }

  dir = standardizePath(dir, true)
  // For single file share, path should be "/" (root) since backend knows the file
  // For multi-file share or normal access, path includes the filename
  let path = isSingleFileShare ? "/" : `${dir}/${obj.name}`
  path = encodePath(path, encodeAll)
  let host = type === "preview" ? api : getCustomHost(isShare)
  let prefix = isShare ? `/sd/${sharingId}` : type === "direct" ? "/d" : "/p"
  if (type === "preview") {
    prefix = ""
    if (!api.startsWith(location.origin + base_path))
      host = location.origin + base_path
  }
  const { inner_path, archive } = obj as ArchiveObj
  if (archive) {
    prefix = "/ae"
    path = isSingleFileShare ? "/" : `${dir}/${archive.name}`
    path = encodePath(path, encodeAll)
  }
  let ans = `${host}${prefix}${path}`
  if (type !== "preview" && !isShare && obj.sign) {
    ans += `?sign=${obj.sign}`
  }
  if (type !== "preview" && isShare) {
    const pwd = cookieStorage.getItem("browser-password") || ""
    if (pwd) {
      ans += `?pwd=${pwd}`
    }
  }
  if (archive) {
    let inner = `${inner_path}/${obj.name}`
    ans += `${ans.includes("?") ? "&" : "?"}inner=${encodePath(inner, encodeAll)}`
  }
  return ans
}

// get download link by current state and pathname
export const useLink = () => {
  const { pathname, isShare } = useRouter()
  const getLinkByObj = (obj: Obj, type?: URLType, encodeAll?: boolean) => {
    // For share pages, always pass full pathname to preserve sharing ID
    // For non-share pages, use pathDir when viewing a file
    let dir: string
    if (isShare()) {
      dir = pathname() // Keep full path to preserve sharing ID
    } else {
      dir = objStore.state !== State.File ? pathname() : pathDir(pathname())
    }
    return getLinkByDirAndObj(dir, obj, type, isShare(), encodeAll)
  }
  const rawLink = (obj: Obj, encodeAll?: boolean) => {
    return getLinkByObj(obj, "direct", encodeAll)
  }
  return {
    getLinkByObj: getLinkByObj,
    rawLink: rawLink,
    proxyLink: (obj: Obj, encodeAll?: boolean) => {
      return getLinkByObj(obj, "proxy", encodeAll)
    },
    previewPage: (obj: Obj, encodeAll?: boolean) => {
      return getLinkByObj(obj, "preview", encodeAll)
    },
    currentObjLink: (encodeAll?: boolean) => {
      return rawLink(objStore.obj, encodeAll)
    },
  }
}

export const useSelectedLink = () => {
  const { previewPage, rawLink: rawUrl } = useLink()
  const rawLinks = (encodeAll?: boolean) => {
    return selectedObjs()
      .filter((obj) => !obj.is_dir)
      .map((obj) => rawUrl(obj, encodeAll))
  }
  return {
    rawLinks: rawLinks,
    previewPagesText: () => {
      return selectedObjs()
        .map((obj) => previewPage(obj, true))
        .join("\n")
    },
    rawLinksText: (encodeAll?: boolean) => {
      return rawLinks(encodeAll).join("\n")
    },
  }
}

export const useCopyLink = () => {
  const { copy } = useUtil()
  const { previewPagesText, rawLinksText } = useSelectedLink()
  const { currentObjLink } = useLink()
  const { isShare } = useRouter()
  return {
    copySelectedPreviewPage: () => {
      copy(previewPagesText())
    },
    copySelectedRawLink: (encodeAll?: boolean) => {
      // On share pages, copy the current page URL instead of download link
      if (isShare()) {
        copy(location.href)
      } else {
        copy(rawLinksText(encodeAll))
      }
    },
    copyCurrentRawLink: (encodeAll?: boolean) => {
      // On share pages, copy the current page URL instead of download link
      if (isShare()) {
        copy(location.href)
      } else {
        copy(currentObjLink(encodeAll))
      }
    },
  }
}
