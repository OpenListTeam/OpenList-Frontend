import { Progress, ProgressIndicator } from "@hope-ui/solid"
import { Route, Routes, useIsRouting } from "@solidjs/router"
import {
  Component,
  createEffect,
  createSignal,
  lazy,
  Match,
  onCleanup,
  Switch,
} from "solid-js"
import { Portal } from "solid-js/web"
import { Error, FullScreenLoading } from "~/components"
import { useLoading, useRouter, useT } from "~/hooks"
import { setSettings } from "~/store"
import { setArchiveExtensions } from "~/store/archive"
import { Resp } from "~/types"
import { base_path, bus, handleRespWithoutAuthAndNotify, r } from "~/utils"
import { MustUser, UserOrGuest } from "./MustUser"
import "./index.css"
import { globalStyles } from "./theme"
import { MusicPlayer } from "~/pages/media/music/MusicLibrary"
import { RootLayout } from "./RootLayout"

const Home = lazy(() => import("~/pages/home/Layout"))
const Manage = lazy(() => import("~/pages/manage"))
const Login = lazy(() => import("~/pages/login"))
const Test = lazy(() => import("~/pages/test"))
const VideoLibrary = lazy(() => import("~/pages/media/video/VideoLibrary"))
const MusicLibrary = lazy(() => import("~/pages/media/music/MusicLibrary"))
const ImageLibrary = lazy(() => import("~/pages/media/image/ImageLibrary"))
const BookLibrary = lazy(() => import("~/pages/media/book/BookLibrary"))

const App: Component = () => {
  const t = useT()
  globalStyles()
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
  const [loading, data] = useLoading(() =>
    Promise.all([
      (async () => {
        handleRespWithoutAuthAndNotify(
          (await r.get("/public/settings")) as Resp<Record<string, string>>,
          setSettings,
          (e) => setErr(err().concat(e)),
        )
      })(),
      (async () => {
        handleRespWithoutAuthAndNotify(
          (await r.get("/public/archive_extensions")) as Resp<string[]>,
          setArchiveExtensions,
          (e) => setErr(err().concat(e)),
        )
      })(),
    ]),
  )
  data()
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
      <Switch
        fallback={
          <Routes base={base_path}>
            <Route path="/@test" component={Test} />
            <Route path="/@login" component={Login} />
            <Route
              path="/@manage/*"
              element={
                <MustUser>
                  <Manage />
                </MustUser>
              }
            />
            {/* 带侧边栏的路由：媒体库各页面 */}
            <Route
              path="/@media/video/*"
              element={
                <MustUser>
                  <RootLayout>
                    <MusicPlayer />
                    <VideoLibrary />
                  </RootLayout>
                </MustUser>
              }
            />
            <Route
              path="/@media/music/*"
              element={
                <MustUser>
                  <RootLayout>
                    <MusicPlayer />
                    <MusicLibrary />
                  </RootLayout>
                </MustUser>
              }
            />
            <Route
              path="/@media/image/*"
              element={
                <MustUser>
                  <RootLayout>
                    <MusicPlayer />
                    <ImageLibrary />
                  </RootLayout>
                </MustUser>
              }
            />
            <Route
              path="/@media/books/*"
              element={
                <MustUser>
                  <RootLayout>
                    <MusicPlayer />
                    <BookLibrary />
                  </RootLayout>
                </MustUser>
              }
            />
            <Route
              path={["/@s/*", "/%40s/*"]}
              element={
                <UserOrGuest>
                  <RootLayout>
                    <Home />
                  </RootLayout>
                </UserOrGuest>
              }
            />
            <Route
              path="*"
              element={
                <MustUser>
                  <RootLayout>
                    <Home />
                  </RootLayout>
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
    </>
  )
}

export default App
