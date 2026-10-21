import {
  Button,
  Icon,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@hope-ui/solid"
import { For, createSignal } from "solid-js"
import { FaSolidAngleDown } from "solid-icons/fa"
import { getPlatform, notify } from "~/utils"
import { getMediaStreamUrl } from "~/utils/media_api"
import { playersForPlatform, renderPlayerScheme } from "~/utils/players"

interface OpenWithPlayerProps {
  /** 媒体条目 id（与 path 二选一） */
  itemId?: number
  /** 选集序号 */
  episode?: number
  /** 直接指定文件路径（优先于 itemId） */
  path?: string
  /** 文件名，用于部分播放器的标题参数 */
  name?: string
  size?: "xs" | "sm" | "md"
  variant?: "solid" | "subtle" | "outline" | "ghost" | "link"
  /** 深色背景（如底部播放条）下使用浅色描边样式 */
  dark?: boolean
}

/**
 * “在本地播放器打开”下拉菜单。
 * 点击时向后端换取带签名的直链，再交给 potplayer:// / vlc:// 等 scheme。
 */
export const OpenWithPlayer = (props: OpenWithPlayerProps) => {
  const [loading, setLoading] = createSignal(false)
  const players = () => playersForPlatform(getPlatform())

  const resolveURL = async (): Promise<string | null> => {
    if (props.path) {
      const resp = await getMediaStreamUrl({ path: props.path })
      if (resp.code !== 200 || !resp.data) {
        notify.error(resp.message || "获取直链失败")
        return null
      }
      return resp.data.url
    }
    if (!props.itemId) {
      notify.error("缺少媒体信息")
      return null
    }
    const resp = await getMediaStreamUrl({
      id: props.itemId,
      episode: props.episode,
    })
    if (resp.code !== 200 || !resp.data) {
      notify.error(resp.message || "获取直链失败")
      return null
    }
    return resp.data.url
  }

  const open = async (scheme: string) => {
    setLoading(true)
    try {
      const url = await resolveURL()
      if (!url) return
      window.location.href = renderPlayerScheme(scheme, {
        durl: url,
        name: props.name ?? "media",
      })
    } finally {
      setLoading(false)
    }
  }

  const copyLink = async () => {
    setLoading(true)
    try {
      const url = await resolveURL()
      if (!url) return
      await navigator.clipboard.writeText(url)
      notify.success("直链已复制")
    } catch {
      notify.error("复制失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Menu>
      <MenuTrigger
        as={Button}
        size={props.size ?? "sm"}
        variant={props.variant ?? "subtle"}
        colorScheme="neutral"
        loading={loading()}
        rightIcon={<Icon as={FaSolidAngleDown} />}
        style={
          props.dark
            ? {
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.16)",
                color: "#e2e8f0",
              }
            : undefined
        }
      >
        本地播放器
      </MenuTrigger>
      <MenuContent>
        <For each={players()}>
          {(p) => <MenuItem onClick={() => open(p.scheme)}>{p.name}</MenuItem>}
        </For>
        <MenuItem onClick={copyLink}>复制直链</MenuItem>
      </MenuContent>
    </Menu>
  )
}
