import { useColorMode } from "@hope-ui/solid"
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import {
  TbBrandVlc,
  TbBrowser,
  TbCheck,
  TbChevronDown,
  TbDeviceTv,
  TbPlayerPlay,
} from "solid-icons/tb"
import { getPlatform, notify } from "~/utils"
import { getMediaStreamUrl } from "~/utils/media_api"
import { mediaPrimaryBtn } from "~/pages/media/ui"
import { playersForPlatform, renderPlayerScheme } from "~/utils/players"

const TARGET_KEY = "media-play-target"

interface MediaPlayButtonProps {
  itemId?: number
  path?: string
  episode?: number
  name?: string
  /** 选择「浏览器」时执行：通常是打开站内播放器 */
  onBrowserPlay: () => void
}

const iconOf = (id: string) => {
  switch (id) {
    case "browser":
      return TbBrowser
    case "vlc":
      return TbBrandVlc
    case "emby":
      return TbDeviceTv
    default:
      return TbPlayerPlay
  }
}

/**
 * 播放主按钮 + 播放器下拉二合一。
 * 默认「浏览器播放」，切换为 VLC / PotPlayer 等后，主按钮直接唤起对应播放器。
 */
export const MediaPlayButton = (props: MediaPlayButtonProps) => {
  const { colorMode } = useColorMode()
  const isDark = createMemo(() => colorMode() === "dark")
  const players = () => playersForPlatform(getPlatform())

  const stored = (() => {
    try {
      return localStorage.getItem(TARGET_KEY) ?? "browser"
    } catch {
      return "browser"
    }
  })()

  const isAvailable = (id: string) =>
    id === "browser" || players().some((p) => p.id === id)

  const [target, setTarget] = createSignal(
    isAvailable(stored) ? stored : "browser",
  )
  const [open, setOpen] = createSignal(false)
  const [directURL, setDirectURL] = createSignal<string | null>(null)
  let prefetching: Promise<string | null> | null = null
  let rootRef: HTMLDivElement | undefined

  const current = () => players().find((p) => p.id === target())
  const label = () =>
    target() === "browser"
      ? "浏览器播放"
      : `${current()?.name ?? "播放器"} 播放`

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

  const prefetch = () => {
    if (target() === "browser" || directURL() || prefetching) return
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

  const play = async () => {
    if (target() === "browser") {
      props.onBrowserPlay()
      return
    }
    const player = current()
    if (!player) {
      props.onBrowserPlay()
      return
    }
    const cached = directURL()
    if (cached) {
      launch(player.scheme, cached)
      return
    }
    const url = await resolveURL()
    if (!url) return
    setDirectURL(url)
    launch(player.scheme, url)
  }

  const select = (id: string) => {
    setTarget(id)
    setDirectURL(null)
    setOpen(false)
    try {
      localStorage.setItem(TARGET_KEY, id)
    } catch {
      /* ignore */
    }
  }

  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef && !rootRef.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("click", onDocClick)
    onCleanup(() => document.removeEventListener("click", onDocClick))
  })

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={play}
        onMouseEnter={prefetch}
        onFocus={prefetch}
        style={{
          ...mediaPrimaryBtn,
          "border-radius": "10px 0 0 10px",
          "padding-right": "16px",
        }}
      >
        <Dynamic component={iconOf(target())} size={17} />
        {label()}
      </button>
      <button
        aria-label="选择播放器"
        title="选择播放器"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open())
        }}
        style={{
          ...mediaPrimaryBtn,
          "border-radius": "0 10px 10px 0",
          padding: "10px 9px",
          "border-left": "1px solid rgba(255,255,255,0.28)",
        }}
      >
        <TbChevronDown size={16} />
      </button>

      <Show when={open()}>
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: "0",
            "z-index": "1200",
            "min-width": "190px",
            padding: "5px",
            "border-radius": "10px",
            background: isDark() ? "rgba(20,26,40,0.98)" : "#fff",
            border: `1px solid ${isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`,
            "box-shadow": "0 12px 32px rgba(0,0,0,0.35)",
          }}
        >
          <For
            each={[
              { id: "browser", name: "浏览器播放" },
              ...players().map((p) => ({ id: p.id, name: p.name })),
            ]}
          >
            {(item) => (
              <button
                onClick={() => select(item.id)}
                style={{
                  width: "100%",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                  padding: "8px 10px",
                  border: "none",
                  "border-radius": "7px",
                  background:
                    target() === item.id
                      ? isDark()
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(0,0,0,0.05)"
                      : "transparent",
                  color: isDark() ? "#e2e8f0" : "#1e293b",
                  "font-size": "13px",
                  cursor: "pointer",
                  "text-align": "left",
                }}
              >
                <Dynamic component={iconOf(item.id)} size={15} />
                <span style={{ flex: "1" }}>{item.name}</span>
                <Show when={target() === item.id}>
                  <TbCheck size={14} />
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
