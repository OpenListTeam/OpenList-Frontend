/**
 * 本地播放器清单。
 * 模板变量：$durl = 带签名的下载直链，$edurl = URL 编码后的直链，$name = 文件名。
 */
export interface ExternalPlayer {
  icon: string
  name: string
  scheme: string
  platforms: string[]
}

export const externalPlayers: ExternalPlayer[] = [
  {
    icon: "potplayer",
    name: "PotPlayer",
    scheme: "potplayer://$durl",
    platforms: ["Windows"],
  },
  {
    icon: "vlc",
    name: "VLC",
    scheme: "vlc://$durl",
    platforms: ["Windows", "MacOS", "Linux", "Android", "iOS"],
  },
  {
    icon: "iina",
    name: "IINA",
    scheme: "iina://weblink?url=$edurl",
    platforms: ["MacOS"],
  },
  {
    icon: "nplayer",
    name: "nPlayer",
    scheme: "nplayer-$durl",
    platforms: ["Android", "iOS"],
  },
  {
    icon: "infuse",
    name: "Infuse",
    scheme: "infuse://x-callback-url/play?url=$durl",
    platforms: ["MacOS", "iOS"],
  },
  {
    icon: "fileball",
    name: "Fileball",
    scheme: "filebox://play?url=$durl",
    platforms: ["MacOS", "iOS"],
  },
]

/** 按当前平台过滤可用播放器 */
export const playersForPlatform = (platform: string) =>
  externalPlayers.filter((p) => p.platforms.includes(platform))

/** 渲染播放器 scheme 模板 */
export const renderPlayerScheme = (
  scheme: string,
  vars: { durl: string; name: string },
) => {
  const edurl = encodeURIComponent(vars.durl)
  return scheme
    .replace(/\$edurl/g, edurl)
    .replace(/\$durl/g, vars.durl)
    .replace(/\$name/g, encodeURIComponent(vars.name))
}
