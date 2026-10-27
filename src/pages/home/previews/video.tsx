import { Box } from "@hope-ui/solid"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useRouter, useLink } from "~/hooks"
import { getMainColor, getSettingBool, objStore } from "~/store"
import { ObjType } from "~/types"
import { ext, pathDir, pathJoin, safeJsonParse } from "~/utils"
import Artplayer from "artplayer"
import { type Option } from "artplayer/types/option"
import { type Setting } from "artplayer/types/setting"
import { type Events } from "artplayer/types/events"
import artplayerProxyMediabunny from "~/components/artplayer-proxy-mediabunny"
import { attachMediabunnyAudio } from "~/components/artplayer-proxy-mediabunny/AudioPatch"
import { prefetchVideoChunks } from "~/components/artplayer-proxy-mediabunny/Prefetcher"
import artplayerPluginDanmuku from "artplayer-plugin-danmuku"

// MediaBunny 播放器模式：三档选择
//   "disabled"   - 禁用（使用原生 <video>，默认）
//   "audio_only" - 仅解码音频（避免问题视频轨道崩溃，canvas 仅显示 poster）
//   "full"       - 全部解码（音频 + 视频）
const MEDIABUNNY_KEY = "use_mediabunny_player"
type MediaBunnyMode = "disabled" | "audio_only" | "full"
function getMediaBunnyMode(): MediaBunnyMode {
  const v = localStorage.getItem(MEDIABUNNY_KEY)
  if (v === "audio_only") return "audio_only"
  // 向下兼容旧版"true/false"布尔值
  if (v === "true" || v === "full") return "full"
  return "disabled"
}
function setMediaBunnyMode(mode: MediaBunnyMode) {
  localStorage.setItem(MEDIABUNNY_KEY, mode)
}
function isMediaBunnyEnabled(): boolean {
  return getMediaBunnyMode() !== "disabled"
}
import { type Option as DanmukuOption } from "artplayer-plugin-danmuku"
import artplayerPluginAss from "~/components/artplayer-plugin-ass"
import mpegts from "mpegts.js"
import Hls from "hls.js"
import { currentLang } from "~/app/i18n"
import { AutoHeightPlugin, VideoBox } from "./video_box"
import { ArtPlayerIconsSubtitle } from "~/components/icons"
import { useNavigate } from "@solidjs/router"
import "./artplayer.css"
import { registerAc3Decoder } from "@mediabunny/ac3"
import { requestTranscodePlay } from "~/utils/media_api"
import { useT } from "~/hooks"
// AC3 解码器改为按需注册：模块 import 期不产生任何副作用
let ac3Registered = false
function ensureAc3Decoder() {
  if (ac3Registered || !isMediaBunnyEnabled()) return
  ac3Registered = true
  registerAc3Decoder()
}

const Preview = () => {
  const t = useT()
  const { pathname, searchParams } = useRouter()
  const { proxyLink } = useLink()
  const navigate = useNavigate()
  const videos = createMemo(() =>
    objStore.objs.filter((obj) => obj.type === ObjType.VIDEO),
  )
  const next_video = () => {
    const index = videos().findIndex((f) => f.name === objStore.obj.name)
    if (index < videos().length - 1) {
      navigate(
        pathJoin(pathDir(location.pathname), videos()[index + 1].name) +
          "?auto_fullscreen=" +
          player.fullscreen,
      )
    }
  }
  const previous_video = () => {
    const index = videos().findIndex((f) => f.name === objStore.obj.name)
    if (index > 0) {
      navigate(
        pathJoin(pathDir(location.pathname), videos()[index - 1].name) +
          "?auto_fullscreen=" +
          player.fullscreen,
      )
    }
  }
  // 组件卸载标记：onMount 里的异步操作结束后据此决定是否继续初始化播放器
  let disposed = false
  let player: Artplayer
  let flvPlayer: mpegts.Player
  let hlsPlayer: Hls
  let option: Option = {
    id: pathname(),
    container: "#video-player",
    url: objStore.raw_url,
    title: objStore.obj.name,
    volume: 1.0,
    autoplay: getSettingBool("video_autoplay"),
    autoSize: false,
    autoMini: true,
    loop: false,
    flip: true,
    playbackRate: true,
    aspectRatio: true,
    screenshot: true,
    setting: true,
    hotkey: true,
    pip: true,
    mutex: true,
    fullscreen: true,
    fullscreenWeb: true,
    subtitleOffset: true,
    miniProgressBar: false,
    playsInline: true,
    theme: getMainColor(),
    // layers: [],
    // settings: [],
    // contextmenu: [],
    controls: [
      {
        name: "previous-button",
        index: 10,
        position: "left",
        html: '<svg fill="none" stroke-width="2" xmlns="http://www.w3.org/2000/svg" height="22" width="22" class="icon icon-tabler icon-tabler-player-track-prev-filled" width="1em" height="1em" viewBox="0 0 24 24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="overflow: visible; color: currentcolor;"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M20.341 4.247l-8 7a1 1 0 0 0 0 1.506l8 7c.647 .565 1.659 .106 1.659 -.753v-14c0 -.86 -1.012 -1.318 -1.659 -.753z" stroke-width="0" fill="currentColor"></path><path d="M9.341 4.247l-8 7a1 1 0 0 0 0 1.506l8 7c.647 .565 1.659 .106 1.659 -.753v-14c0 -.86 -1.012 -1.318 -1.659 -.753z" stroke-width="0" fill="currentColor"></path></svg>',
        tooltip: "Previous",
        click: function () {
          previous_video()
        },
      },
      {
        name: "next-button",
        index: 11,
        position: "left",
        html: '<svg fill="none" stroke-width="2" xmlns="http://www.w3.org/2000/svg" height="22" width="22" class="icon icon-tabler icon-tabler-player-track-next-filled" width="1em" height="1em" viewBox="0 0 24 24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="overflow: visible; color: currentcolor;"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M2 5v14c0 .86 1.012 1.318 1.659 .753l8 -7a1 1 0 0 0 0 -1.506l-8 -7c-.647 -.565 -1.659 -.106 -1.659 .753z" stroke-width="0" fill="currentColor"></path><path d="M13 5v14c0 .86 1.012 1.318 1.659 .753l8 -7a1 1 0 0 0 0 -1.506l-8 -7c-.647 -.565 -1.659 -.106 -1.659 .753z" stroke-width="0" fill="currentColor"></path></svg>',
        tooltip: "Next",
        click: function () {
          next_video()
        },
      },
    ],
    quality: [],
    // highlight: [],
    plugins: [AutoHeightPlugin],
    ...(getMediaBunnyMode() === "full"
      ? { proxy: artplayerProxyMediabunny() }
      : {}),
    whitelist: [],
    settings: [],
    // subtitle:{}
    moreVideoAttr: {
      // @ts-ignore
      "webkit-playsinline": true,
      playsInline: true,
      crossOrigin: "anonymous",
    },
    type: ext(objStore.obj.name),
    customType: {
      flv: function (video: HTMLMediaElement, url: string) {
        flvPlayer = mpegts.createPlayer(
          {
            type: "flv",
            url: url,
          },
          { referrerPolicy: "same-origin" },
        )
        flvPlayer.attachMediaElement(video)
        flvPlayer.load()
      },
      m2ts: function (video: HTMLMediaElement, url: string) {
        flvPlayer?.destroy()
        flvPlayer = mpegts.createPlayer(
          {
            type: "m2ts",
            url: url,
          },
          { referrerPolicy: "same-origin" },
        )
        flvPlayer.attachMediaElement(video)
        flvPlayer.load()
      },
      m3u8: function (video: HTMLMediaElement, url: string) {
        hlsPlayer = new Hls()
        hlsPlayer.loadSource(url)
        hlsPlayer.attachMedia(video)
        if (!video.src) {
          video.src = url
        }
      },
    },
    lang: ["en", "zh-cn", "zh-tw"].includes(currentLang().toLowerCase())
      ? (currentLang().toLowerCase() as string)
      : "en",
    lock: true,
    fastForward: true,
    autoPlayback: true,
    autoOrientation: true,
    airplay: true,
  }
  const subtitle = objStore.related.filter((obj) => {
    for (const ext of [".srt", ".ass", ".vtt"]) {
      if (obj.name.endsWith(ext)) {
        return true
      }
    }
    return false
  })
  const danmu = objStore.related.find((obj) => {
    for (const ext of [".xml"]) {
      if (obj.name.endsWith(ext)) {
        return true
      }
    }
    return false
  })

  // TODO: add a switch in manage panel to choose whether to enable `libass-wasm`
  const enableEnhanceAss = true

  if (subtitle.length != 0) {
    let isEnhanceAssMode = false

    // set default subtitle
    const defaultSubtitle = subtitle[0]
    if (enableEnhanceAss && ext(defaultSubtitle.name).toLowerCase() === "ass") {
      isEnhanceAssMode = true
      option.plugins?.push(
        artplayerPluginAss({
          // debug: true,
          subUrl: proxyLink(defaultSubtitle, true),
        }),
      )
    } else {
      option.subtitle = {
        url: proxyLink(defaultSubtitle, true),
        type: ext(defaultSubtitle.name),
        escape: false,
      }
    }

    // render subtitle toggle menu
    const innerMenu: Setting[] = [
      {
        id: "setting_subtitle_display",
        html: "Display",
        tooltip: "Show",
        switch: true,
        onSwitch: function (item: Setting) {
          item.tooltip = item.switch ? "Hide" : "Show"
          setSubtitleVisible(!item.switch)

          // sync menu subtitle tooltip
          const menu_sub = option.settings?.find(
            (_) => _.id === "setting_subtitle",
          )
          menu_sub && (menu_sub.tooltip = item.tooltip)

          return !item.switch
        },
      },
    ]
    subtitle.forEach((item, i) => {
      innerMenu.push({
        default: i === 0,
        html: (
          <span
            title={item.name}
            style={{
              "max-width": "200px",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "word-break": "break-all",
              "white-space": "normal",
              display: "-webkit-box",
              "-webkit-line-clamp": "2",
              "-webkit-box-orient": "vertical",
              "font-size": "12px",
            }}
          >
            {item.name}
          </span>
        ) as HTMLElement,
        name: item.name,
        url: proxyLink(item, true),
      })
    })

    option.settings?.push({
      id: "setting_subtitle",
      html: "Subtitle",
      tooltip: "Show",
      icon: ArtPlayerIconsSubtitle({ size: 24 }) as HTMLElement,
      selector: innerMenu,
      onSelect: function (item: Setting) {
        if (enableEnhanceAss && ext(item.name).toLowerCase() === "ass") {
          isEnhanceAssMode = true
          this.emit("artplayer-plugin-ass:switch" as keyof Events, item.url)
          setSubtitleVisible(true)
        } else {
          isEnhanceAssMode = false
          this.subtitle.switch(item.url, { name: item.name })
          this.once("subtitleLoad", setSubtitleVisible.bind(this, true))
        }

        const switcher = innerMenu.find(
          (_) => _.id === "setting_subtitle_display",
        )

        if (switcher && !switcher.switch) switcher.$html?.click?.()

        // sync from display switcher
        return switcher?.tooltip
      },
    })

    function setSubtitleVisible(visible: boolean) {
      const type = isEnhanceAssMode ? "ass" : "webvtt"

      switch (type) {
        case "ass":
          player.subtitle.show = false
          player.emit("artplayer-plugin-ass:visible" as keyof Events, visible)
          break

        case "webvtt":
        default:
          player.subtitle.show = visible
          player.emit("artplayer-plugin-ass:visible" as keyof Events, false)
          break
      }
    }
  }

  if (danmu) {
    option.plugins?.push(
      artplayerPluginDanmuku({
        speed: 5,
        opacity: 1,
        fontSize: 25,
        mode: 0,
        antiOverlap: false,
        synchronousPlayback: false,
        theme: "dark",
        heatmap: true,
        // 配置来自 localStorage，可能被旧版本或用户改坏，解析失败时忽略即可
        ...safeJsonParse<Partial<DanmukuOption>>(
          localStorage.getItem("danmuku_config"),
        ),
        emitter: false,
        danmuku: proxyLink(danmu, true),
      }),
    )
  }
  // 添加 MediaBunny 播放器三档模式选择到设置菜单
  const mediabunnyModeKey = (m: MediaBunnyMode) =>
    m === "disabled"
      ? "media.video.decode_disabled"
      : m === "audio_only"
        ? "media.video.decode_audio_only"
        : "media.video.decode_all"
  option.settings?.push({
    id: "setting_mediabunny",
    html: t("media.video.mediabunny_player"),
    tooltip: t(mediabunnyModeKey(getMediaBunnyMode())),
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    selector: (["disabled", "audio_only", "full"] as MediaBunnyMode[]).map(
      (m) => ({
        html: t(mediabunnyModeKey(m)),
        name: m,
        default: getMediaBunnyMode() === m,
      }),
    ),
    onSelect: function (item: Setting) {
      const newMode = item.name as MediaBunnyMode
      setMediaBunnyMode(newMode)
      setTimeout(() => {
        if (confirm(t("media.video.mode_reload_confirm"))) {
          location.reload()
        }
      }, 100)
      return t(mediabunnyModeKey(newMode))
    },
  })

  onMount(async () => {
    // ---- 云端转码判断 ----
    // 播放前先调用后端转码决策接口，如果需要转码则使用 HLS master_url 播放
    let useTranscode = false
    try {
      const tcResp = await requestTranscodePlay(pathname())
      if (
        tcResp.code === 200 &&
        tcResp.data?.transcode &&
        tcResp.data.master_url
      ) {
        useTranscode = true
        option.url = tcResp.data.master_url
        option.type = "m3u8"
        // MediaBunny full 模式会用 canvas proxy 接管 video 元素，HLS.js 将无法挂载。
        // 转码走 HLS，必须移除该 proxy（与媒体库播放器保持一致）。
        delete (option as { proxy?: unknown }).proxy
        console.log(
          `[transcode] 使用云端转码播放: job=${tcResp.data.job_id}, profile=${tcResp.data.profile}`,
        )
      }
    } catch (e) {
      // 转码接口失败（可能未开启），静默降级到直链播放
      console.debug("[transcode] 转码接口不可用，使用直链播放", e)
    }

    // 等待转码响应期间用户可能已离开页面：onCleanup 早已执行，
    // 此时再创建实例就没有人会销毁它，必须放弃初始化。
    if (disposed) return

    // 预下载视频文件的前几个区块（仅直链模式，转码模式由 HLS.js 管理）
    if (!useTranscode && objStore.raw_url) {
      void prefetchVideoChunks(objStore.raw_url, {
        byteRange: 8 * 1024 * 1024,
        timeoutMs: 3000,
      })
    }
    ensureAc3Decoder()
    player = new Artplayer(option)
    // "仅音频"模式：原生 <video> 解码视频，mediabunny 只提供音轨（仅直链模式）
    if (
      !useTranscode &&
      getMediaBunnyMode() === "audio_only" &&
      objStore.raw_url
    ) {
      attachMediabunnyAudio(player, objStore.raw_url)
    }
    // 注意每个分支都要 break：旧代码缺少 break 导致 true 一路穿透并被重置为 false
    const auto_fullscreen = searchParams["auto_fullscreen"] === "true"
    player.on("ready", () => {
      player.fullscreen = auto_fullscreen
    })
    if (danmu) {
      player.on("artplayerPluginDanmuku:config", (option) => {
        const {
          speed,
          margin,
          opacity,
          mode,
          modes,
          fontSize,
          antiOverlap,
          synchronousPlayback,
          heatmap,
          visible,
        } = option as DanmukuOption
        localStorage.setItem(
          "danmuku_config",
          JSON.stringify({
            speed,
            margin,
            opacity,
            mode,
            modes,
            fontSize,
            antiOverlap,
            synchronousPlayback,
            heatmap,
            visible,
          }),
        )
      })
    }
    player.on("video:ended", () => {
      if (!autoNext()) return
      next_video()
    })
    player.on("error", () => {
      if (player.video.crossOrigin) {
        console.log(
          "Error detected. Trying to remove Cross-Origin attribute. Screenshot may not be available.",
        )
        player.video.crossOrigin = null
      }
    })
  })
  onCleanup(() => {
    disposed = true
    if (player && player.video) player.video.src = ""
    player?.destroy()
    flvPlayer?.destroy()
    hlsPlayer?.destroy()
  })
  const [autoNext, setAutoNext] = createSignal()
  return (
    <VideoBox onAutoNextChange={setAutoNext}>
      <Box w="$full" h="60vh" id="video-player" />
    </VideoBox>
  )
}

export default Preview
