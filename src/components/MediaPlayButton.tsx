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
import { api, getPlatform, notify } from "~/utils"
import { getMediaStreamUrl, resolveMediaUrl } from "~/utils/media_api"
import { accent } from "~/store/accent"
import { playersForPlatform, renderPlayerScheme } from "~/utils/players"

const TARGET_KEY = "media-play-target"

interface MediaPlayButtonProps {
  itemId?: number
  path?: string
  episode?: number
  name?: string
  /** 选择「浏览器」时执行：通常是打开站内播放器 */
  onBrowserPlay: () => void
  /**
   * 该文件无法在浏览器内播放（如 .iso 光盘镜像）：
   * 下拉里不再出现「浏览器播放」，默认直接走本地播放器。
   */
  browserUnsupported?: boolean
  /** browserUnsupported 时给用户的说明文案 */
  unsupportedHint?: string
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
 * 默认「浏览器播放」；切换为外部播放器后，文本固定为「播放器播放」。
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

  // 可选目标：不支持浏览器播放时保留该项但置灰（禁用），
  // 让用户知道「浏览器播放」存在但当前文件用不了，而不是莫名其妙消失
  const targets = () => [
    {
      id: "browser",
      name: "浏览器播放",
      browser: true,
      disabled: !!props.browserUnsupported,
    },
    ...players().map((p) => ({
      id: p.id,
      name: p.name,
      browser: false,
      disabled: false,
    })),
  ]

  const isAvailable = (id: string) =>
    targets().some((t) => t.id === id && !t.disabled)

  const [target, setTarget] = createSignal(
    // 上次选的是「浏览器」但这个文件不支持时，退到第一个本地播放器
    isAvailable(stored)
      ? stored
      : (targets().find((t) => !t.browser && !t.disabled)?.id ??
          (props.browserUnsupported ? "" : "browser")),
  )
  const [open, setOpen] = createSignal(false)
  const [directURL, setDirectURL] = createSignal<string | null>(null)
  const [embyServerId, setEmbyServerId] = createSignal<string | null>(null)
  let prefetching: Promise<unknown> | null = null
  let rootRef: HTMLDivElement | undefined

  const current = () => players().find((p) => p.id === target())
  const label = () => {
    if (!target()) return "选择播放器"
    if (target() !== "browser") return "播放器播放"
    // 不支持浏览器播放又没有本地播放器时，按钮语义是「去选一个播放器」
    return props.browserUnsupported ? "选择播放器" : "浏览器播放"
  }

  const resolveURL = async (): Promise<string | null> => {
    if (props.path) {
      const resp = await getMediaStreamUrl({ path: props.path })
      if (resp.code !== 200 || !resp.data) {
        notify.error(resp.message || "获取直链失败")
        return null
      }
      // 外部播放器/新窗口需要绝对地址：后端在回环 host 场景会返回 /d/... 相对路径
      return resolveMediaUrl(resp.data.url)
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
    return resolveMediaUrl(resp.data.url)
  }

  const resolveEmbyServer = async (): Promise<string | null> => {
    if (embyServerId()) return embyServerId()
    try {
      const resp = await fetch(`${api}/@emby/System/Info/Public`)
      const data = await resp.json()
      if (data?.Id) {
        setEmbyServerId(String(data.Id))
        return String(data.Id)
      }
    } catch {
      /* ignore */
    }
    return null
  }

  const prefetch = () => {
    if (target() === "browser" || prefetching) return
    prefetching =
      target() === "emby"
        ? resolveEmbyServer().finally(() => {
            prefetching = null
          })
        : resolveURL()
            .then((url) => {
              if (url) setDirectURL(url)
              return url
            })
            .finally(() => {
              prefetching = null
            })
  }

  const launch = (
    scheme: string,
    url: string,
    serverId?: string,
    itemId?: number,
  ) => {
    window.location.href = renderPlayerScheme(scheme, {
      durl: url,
      name: props.name ?? "media",
      serverId,
      itemId,
    })
  }

  const play = async () => {
    if (target() === "browser") {
      // 兜底：即使状态被别处改回 browser，也不让不支持的文件进站内播放器
      if (props.browserUnsupported) {
        notify.error(
          props.unsupportedHint || "该文件无法在浏览器内播放，请选择本地播放器",
        )
        setOpen(true)
        return
      }
      props.onBrowserPlay()
      return
    }
    const player = current()
    if (!player) {
      if (props.browserUnsupported) {
        notify.error(
          props.unsupportedHint || "没有可用的本地播放器，请先下载该文件",
        )
        setOpen(true)
        return
      }
      props.onBrowserPlay()
      return
    }

    // Emby 走自身深链（服务器 ID + 条目 ID），不播放直链
    if (player.id === "emby") {
      if (!props.itemId) {
        notify.error("缺少媒体信息")
        return
      }
      const serverId = embyServerId()
      if (serverId) {
        launch(player.scheme, "", serverId, props.itemId)
        return
      }
      const sid = await resolveEmbyServer()
      if (!sid) {
        notify.error("无法获取 Emby 服务器 ID")
        return
      }
      launch(player.scheme, "", sid, props.itemId)
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
    const item = targets().find((t) => t.id === id)
    if (!item || item.disabled) {
      // 置灰项只解释原因，不改变当前选择
      notify.error(
        props.unsupportedHint || "该文件无法在浏览器内播放，请选择本地播放器",
      )
      return
    }
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
      {/* 主按钮与下拉箭头共用一层纯色背景，无阴影，视觉上是一个胶囊 */}
      <style>{`
        .media-split-btn {
          appearance: none;
          -webkit-appearance: none;
          border: 0;
          margin: 0;
          background: transparent;
          color: #fff;
          font-family: inherit;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.2;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: none;
          outline: none;
        }
        .media-split-btn:hover,
        .media-split-btn:focus,
        .media-split-btn:active {
          background: rgba(255, 255, 255, 0.1);
          box-shadow: none;
          outline: none;
        }
        .media-split-btn--main {
          gap: 8px;
          padding: 10px 18px;
        }
        .media-split-btn--caret {
          width: 26px;
          flex: 0 0 26px;
          padding: 0;
          border-left: 1px solid rgba(255, 255, 255, 0.22);
        }
      `}</style>
      <div
        style={{
          display: "inline-flex",
          "align-items": "stretch",
          "border-radius": "8px",
          overflow: "hidden",
          background: accent(),
          "box-shadow": "none",
        }}
      >
        <button
          class="media-split-btn media-split-btn--main"
          onClick={play}
          onMouseEnter={prefetch}
          onFocus={prefetch}
        >
          <Dynamic component={iconOf(target())} size={17} />
          {label()}
        </button>
        <button
          class="media-split-btn media-split-btn--caret"
          aria-label="选择播放器"
          title="选择播放器"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open())
          }}
        >
          <TbChevronDown size={15} />
        </button>
      </div>

      <Show when={open()}>
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: "0",
            "z-index": "1200",
            "min-width": "200px",
            "max-height": "340px",
            "overflow-y": "auto",
            padding: "5px",
            "border-radius": "10px",
            background: isDark() ? "rgba(20,26,40,0.98)" : "#fff",
            border: `1px solid ${
              isDark() ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"
            }`,
            "box-shadow": "0 12px 32px rgba(0,0,0,0.35)",
          }}
        >
          <For each={targets()}>
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
                  cursor: item.disabled ? "not-allowed" : "pointer",
                  opacity: item.disabled ? 0.45 : 1,
                  "text-align": "left",
                }}
              >
                <Dynamic component={iconOf(item.id)} size={15} />
                <span style={{ flex: "1" }}>{item.name}</span>
                <Show when={item.disabled}>
                  <span style={{ "font-size": "10px", opacity: 0.8 }}>
                    （不支持）
                  </span>
                </Show>
                <Show when={target() === item.id && !item.disabled}>
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
