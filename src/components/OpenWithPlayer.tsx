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
  // 提前换取直链：外部协议必须在用户手势内同步触发，
  // 否则 Chrome 会拦截「用户手势已丢失」的自定义 scheme 跳转。
  const [directURL, setDirectURL] = createSignal<string | null>(null)
  let prefetching: Promise<string | null> | null = null
  // Emby 深链需要服务器 ID，只在主播放按钮里处理
  const players = () =>
    playersForPlatform(getPlatform()).filter((p) => !p.requiresItem)

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

  // 悬浮 / 点击触发器时预取直链，保证真正选择播放器时能同步跳转
  const prefetch = () => {
    if (directURL() || prefetching) return
    prefetching = resolveURL()
      .then((url) => {
        if (url) setDirectURL(url)
        return url
      })
      .finally(() => {
        prefetching = null
      })
  }

  const launch = (scheme: string, url: string) => {
    window.location.href = renderPlayerScheme(scheme, {
      durl: url,
      name: props.name ?? "media",
    })
  }

  const open = async (scheme: string) => {
    const cached = directURL()
    if (cached) {
      // 手势仍在：同步触发外部协议
      launch(scheme, cached)
      return
    }
    setLoading(true)
    try {
      // 预取还在进行时直接复用同一个请求：既避免重复签名请求，
      // 也少一次 await 往返，更容易保住用户手势
      const url = await (prefetching ?? resolveURL())
      if (!url) return
      setDirectURL(url)
      launch(scheme, url)
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
        onMouseEnter={prefetch}
        onFocus={prefetch}
        onClick={prefetch}
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
