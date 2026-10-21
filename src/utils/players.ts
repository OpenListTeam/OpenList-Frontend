/**
 * 本地播放器清单。
 * 模板变量：$durl = 带签名的下载直链；$edurl = URL 编码后的直链；$name = 文件名。
 * scheme 参考各播放器官方/社区协议（PotPlayer、VLC、IINA、Infuse、MX Player 等）。
 */
export interface ExternalPlayer {
  id: string
  icon: string
  name: string
  scheme: string
  platforms: string[]
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
    scheme: "nplayer://$durl",
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
    id: "stellar",
    icon: "stellar",
    name: "恒星播放器",
    scheme: "stellar://play/$edurl",
    platforms: ["Windows", "MacOS", "Android"],
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
