import {
  Box,
  HStack,
  Progress,
  ProgressIndicator,
  useColorMode,
} from "@hope-ui/solid"
import { Route, Routes, useIsRouting } from "@solidjs/router"
import {
  Component,
  createEffect,
  createSignal,
  lazy,
  Match,
  onCleanup,
  Show,
  Suspense,
  Switch,
} from "solid-js"
import { Portal } from "solid-js/web"
import { Error, FullScreenLoading } from "~/components"
import { useLoading, useRouter, useT } from "~/hooks"
import { setSettings } from "~/store"
import { setArchiveExtensions } from "~/store/archive"
import { InitStatus, Resp } from "~/types"
import {
  base_path,
  bus,
  handleRespWithoutAuthAndNotify,
  initPluginEngine,
  r,
} from "~/utils"
import { applyCustomize } from "~/utils/customize"
import { MustUser, UserOrGuest } from "./MustUser"
import "./index.css"
import { globalStyles } from "./theme"
import { MediaShell } from "./MediaShell"
import {
  MediaSidebar,
  MediaSidebarFloatingTrigger,
} from "~/components/MediaSidebar"
import { mediaEnabled, mediaSidebarOpen, setMediaStatus } from "~/store/media"
import type { MediaStatus } from "~/store/media"
import {
  accent,
  applyAccentPalette,
  clearAccentPalette,
  mediaAccentEnabled,
} from "~/store/accent"

const Home = lazy(() => import("~/pages/home/Layout"))
const Manage = lazy(() => import("~/pages/manage"))
const Login = lazy(() => import("~/pages/login"))
const Init = lazy(() => import("~/pages/init"))
const Test = lazy(() => import("~/pages/test"))
const VideoLibrary = lazy(() => import("~/pages/media/video/VideoLibrary"))
const MusicLibrary = lazy(() => import("~/pages/media/music/MusicLibrary"))
const ImageLibrary = lazy(() => import("~/pages/media/image/ImageLibrary"))
const BookLibrary = lazy(() => import("~/pages/media/book/BookLibrary"))
// 播放器常驻在各个媒体页之上，但只有进入媒体库才需要：
// 改为懒加载，避免把播放器模块塞进入口 chunk（媒体库关闭时白付流量）
const MusicPlayer = lazy(() =>
  import("~/pages/media/music/player").then((m) => ({
    default: m.MusicPlayer,
  })),
)

const App: Component = () => {
  const { colorMode } = useColorMode()
  const t = useT()
  globalStyles()
  initPluginEngine()
  const isRouting = useIsRouting()
  const { to, pathname } = useRouter()
  const onTo = (path: string) => {
    to(path)
  }
  bus.on("to", onTo)
  onCleanup(() => {
    bus.off("to", onTo)
  })

  createEffect(() => {
    bus.emit("pathname", pathname())
  })

  const [err, setErr] = createSignal<string[]>([])
  const [initialized, setInitialized] = createSignal(true)
  const [loading, data] = useLoading(() =>
    Promise.all([
      (async () => {
        const resp = (await r.get("/public/settings")) as Resp<
          Record<string, string>
        >
        handleRespWithoutAuthAndNotify(
          resp,
          (data) => {
            setSettings(data)
            // 注入自定义 CSS/JS（customize_head/body）与站点图标。
            //
            // 这里不判断后端类型：是否注入由 applyCustomize() 内部按「HTML 里的
            // customize 占位符是否还在」决定 —— Go 后端在服务端 UpdateIndex() 里
            // 已经把占位符替换掉（含空值），因此天然跳过，不会重复注入。
            applyCustomize()
          },
          (e, code) => {
            // 存储未绑定时 settings 被后端中间件以 503 拦截。此时不能把错误
            // 塞进 err()：下面 Switch 的错误分支排在路由之前，会抢占渲染并
            // 把初始化向导挡住，用户既看不到原因也无法配置存储。
            // 交给路由渲染即可 —— init_status 在诊断豁免名单中，会正常返回
            // initialized: false，守卫随即跳转到 /@init。
            if (code === 503) return
            setErr(err().concat(e))
          },
        )
      })(),
      (async () => {
        handleRespWithoutAuthAndNotify(
          (await r.get("/public/archive_extensions")) as Resp<string[]>,
          setArchiveExtensions,
          // (e) => setErr(err().concat(e)),
        )
      })(),
      (async () => {
        handleRespWithoutAuthAndNotify(
          (await r.get("/public/init_status")) as Resp<InitStatus>,
          (data) => setInitialized(data.initialized),
          // (e) => setErr(err().concat(e)),
        )
      })(),
      (async () => {
        handleRespWithoutAuthAndNotify(
          (await r.get("/public/media_status")) as Resp<MediaStatus>,
          setMediaStatus,
          // 媒体库未启用时该接口也返回 200，不会走到这里
        )
      })(),
    ]),
  )
  data()

  // 系统未初始化时，自动跳转到安装向导
  createEffect(() => {
    if (initialized() === false && !pathname().startsWith("/@init")) {
      to("/@init", true)
    }
  })

  // 媒体库关闭时，/@media/* 等同于不存在（设置入口在后台管理内）
  createEffect(() => {
    if (!loading() && !mediaEnabled() && pathname().startsWith("/@media")) {
      to("/", true)
    }
  })

  // 媒体主题色只在媒体库页面生效：文件页 / 管理页 / 设置页一律使用站点默认色板，
  // 避免 --hope-colors-* 的全局覆盖污染整站配色（登录、初始化页同理）。
  // 明暗模式各有一套色阶，切换配色模式时重新写入。
  createEffect(() => {
    const dark = colorMode() === "dark"
    const onMediaPage = pathname().startsWith("/@media")
    if (!mediaEnabled() || !mediaAccentEnabled() || !onMediaPage) {
      clearAccentPalette()
    } else {
      applyAccentPalette(accent(), dark)
    }
  })

  // 后台管理、登录与初始化页面不显示媒体库侧栏
  const hideMediaSidebarPath = () =>
    ["/@manage", "/@login", "/@init"].some((p) => pathname().startsWith(p))
  const mediaSidebarVisible = () =>
    mediaEnabled() && mediaSidebarOpen() && !hideMediaSidebarPath()
  return (
    <>
      <Portal>
        <Progress
          indeterminate
          size="xs"
          position="fixed"
          top="0"
          left="0"
          right="0"
          zIndex="$banner"
          d={isRouting() ? "block" : "none"}
        >
          <ProgressIndicator />
        </Progress>
      </Portal>
      <HStack alignItems="stretch" spacing="$0" w="$full" minH="100vh">
        <Show when={mediaSidebarVisible()}>
          <MediaSidebar />
        </Show>
        <Show when={!hideMediaSidebarPath()}>
          <MediaSidebarFloatingTrigger />
        </Show>
        <Box flex="1" minW="0">
          <Switch
            fallback={
              <Routes base={base_path}>
                <Route path="/@test" component={Test} />
                <Route path="/@login" component={Login} />
                <Route path="/@init" component={Init} />
                <Route
                  path="/@manage/*"
                  element={
                    <MustUser>
                      <Manage />
                    </MustUser>
                  }
                />
                {/* 媒体库页面：顶栏复用 main 的 Header，侧栏为可收起抽屉。
                    鉴权必须和文件浏览一致（MustUser）：未登录且访客被禁用时 /me 返回 401，
                    要跳到登录页。早前用 UserOrGuest 会静默降级成访客身份继续渲染，
                    结果接口全 401、页面只显示「暂无内容」。 */}
                <Route
                  path="/@media/video/*"
                  element={
                    <MustUser>
                      <MediaShell>
                        <VideoLibrary />
                      </MediaShell>
                    </MustUser>
                  }
                />
                <Route
                  path="/@media/music/*"
                  element={
                    <MustUser>
                      <MediaShell>
                        <MusicLibrary />
                      </MediaShell>
                    </MustUser>
                  }
                />
                <Route
                  path="/@media/image/*"
                  element={
                    <MustUser>
                      <MediaShell>
                        <ImageLibrary />
                      </MediaShell>
                    </MustUser>
                  }
                />
                <Route
                  path="/@media/books/*"
                  element={
                    <MustUser>
                      <MediaShell>
                        <BookLibrary />
                      </MediaShell>
                    </MustUser>
                  }
                />
                <Route
                  path={["/@s/*", "/%40s/*"]}
                  element={
                    <UserOrGuest>
                      <Home />
                    </UserOrGuest>
                  }
                />
                <Route
                  path="*"
                  element={
                    <MustUser>
                      <Home />
                    </MustUser>
                  }
                />
              </Routes>
            }
          >
            <Match when={err().length > 0}>
              <Error
                h="100vh"
                msg={
                  t("home.fetching_settings_failed") +
                  err()
                    .map((e) => t("home." + e))
                    .join(", ")
                }
              />
            </Match>
            <Match when={loading()}>
              <FullScreenLoading />
            </Match>
          </Switch>
        </Box>
      </HStack>
      {/* 全局音乐播放器：必须挂在路由之外。挂在路由里时切换页面（例如从音乐库回到
          文件列表）组件会被卸载，底部播放条随之消失；而 Audio 元素是模块级的，
          声音还在放 —— 表现就是「歌在响、播放条没了」。 */}
      <Show when={mediaEnabled()}>
        <Suspense fallback={null}>
          <MusicPlayer />
        </Suspense>
      </Show>
    </>
  )
}

export default App
