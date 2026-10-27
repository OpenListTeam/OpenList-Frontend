/**
 * 外部播放器清单。
 * 模板变量：
 *   $durl   = 带签名的下载直链
 *   $edurl  = URL 编码后的直链
 *   $b64url = Base64 编码后的直链（iPlay 使用）
 *   $name   = 文件名（已编码）
 */
export interface ExternalPlayer {
  id: string
  icon: string
  name: string
  scheme: string
  platforms: string[]
  /** 需要条目 id（例如 Emby 深链），由 MediaPlayButton 单独处理 */
  requiresItem?: boolean
}

export const externalPlayers: ExternalPlayer[] = [
  {
    id: "potplayer",
    icon: "potplayer",
    name: "PotPlayer",
    scheme: "potplayer://$durl",
    platforms: ["Windows"],
  },
  {
    id: "vlc",
    icon: "vlc",
    name: "VLC",
    scheme: "vlc://$durl",
    platforms: ["Windows", "MacOS", "Linux", "Android", "iOS"],
  },
  {
    id: "mpv",
    icon: "mpv",
    name: "MPV",
    scheme: "mpv://$durl",
    platforms: ["Windows", "MacOS", "Linux"],
  },
  {
    id: "iina",
    icon: "iina",
    name: "IINA",
    scheme: "iina://weblink?url=$edurl",
    platforms: ["MacOS"],
  },
  {
    id: "figplayer",
    icon: "figplayer",
    name: "Fig Player",
    scheme: "figplayer://weblink?url=$edurl",
    platforms: ["MacOS", "iOS"],
  },
  {
    id: "omniplayer",
    icon: "omniplayer",
    name: "OmniPlayer",
    scheme: "omniplayer://weblink?url=$edurl",
    platforms: ["MacOS", "iOS"],
  },
  {
    id: "vivid",
    icon: "vivid",
    name: "Vivid Player",
    scheme: "vividplayer://play?url=$edurl",
    platforms: ["Windows"],
  },
  {
    id: "infuse",
    icon: "infuse",
    name: "Infuse",
    scheme: "infuse://x-callback-url/play?url=$edurl",
    platforms: ["MacOS", "iOS"],
  },
  {
    id: "nplayer",
    icon: "nplayer",
    name: "nPlayer",
    scheme: "nplayer-$durl",
    platforms: ["Android", "iOS"],
  },
  {
    id: "fileball",
    icon: "fileball",
    name: "Fileball",
    scheme: "filebox://play?url=$edurl",
    platforms: ["MacOS", "iOS"],
  },
  {
    id: "iplay",
    icon: "iplay",
    name: "iPlay",
    scheme: "iplay://play/any?type=url&url=$b64url",
    platforms: ["Windows", "MacOS", "Android", "iOS"],
  },
  {
    id: "mxplayer",
    icon: "mxplayer",
    name: "MX Player",
    scheme:
      "intent:$edurl#Intent;package=com.mxtech.videoplayer.ad;type=video/*;end",
    platforms: ["Android"],
  },
  {
    id: "mxplayerpro",
    icon: "mxplayer",
    name: "MX Player Pro",
    scheme:
      "intent:$edurl#Intent;package=com.mxtech.videoplayer.pro;type=video/*;end",
    platforms: ["Android"],
  },
  {
    id: "android",
    icon: "android",
    name: "安卓系统播放器",
    scheme:
      "intent:$edurl#Intent;action=android.intent.action.VIEW;type=video/*;end",
    platforms: ["Android"],
  },
  {
    id: "emby",
    icon: "emby",
    name: "Emby",
    scheme: "emby://items?serverId=$serverId&itemId=mv-$itemId",
    platforms: ["Windows", "MacOS", "Linux", "Android", "iOS"],
    requiresItem: true,
  },
]

/**
 * 返回播放器列表：不再按平台隐藏，保证所有客户端都能在菜单里看到；
 * 当前平台可用的排在前面。
 */
export const playersForPlatform = (platform: string) => {
  return [...externalPlayers].sort((a, b) => {
    const aMatch = a.platforms.includes(platform) ? 1 : 0
    const bMatch = b.platforms.includes(platform) ? 1 : 0
    return bMatch - aMatch
  })
}

const toBase64 = (value: string) => {
  try {
    return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
  } catch {
    return btoa(value)
  }
}

/** 渲染播放器 scheme 模板 */
export const renderPlayerScheme = (
  scheme: string,
  vars: {
    durl: string
    name: string
    serverId?: string
    itemId?: string | number
  },
) => {
  const edurl = encodeURIComponent(vars.durl)
  return scheme
    .replace(/\$b64url/g, toBase64(vars.durl))
    .replace(/\$edurl/g, edurl)
    .replace(/\$durl/g, vars.durl)
    .replace(/\$serverId/g, vars.serverId ?? "")
    .replace(/\$itemId/g, String(vars.itemId ?? ""))
    .replace(/\$name/g, encodeURIComponent(vars.name))
}
