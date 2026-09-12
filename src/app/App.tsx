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
import { InitStatus, Resp, STORAGE_CONFIG_ERROR } from "~/types"
import { markTsWorker } from "~/utils/backend"
import {
  base_path,
  bus,
  handleRespWithoutAuthAndNotify,
  initPluginEngine,
  r,
} from "~/utils"
import { MustUser, UserOrGuest } from "./MustUser"
import "./index.css"
import { globalStyles } from "./theme"

const Home = lazy(() => import("~/pages/home/Layout"))
const Manage = lazy(() => import("~/pages/manage"))
const Login = lazy(() => import("~/pages/login"))
const Init = lazy(() => import("~/pages/init"))
const Test = lazy(() => import("~/pages/test"))

const App: Component = () => {
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

  /**
   * 后端存储未绑定时，对所有依赖持久化的接口返回 503 +
   * data.error = STORAGE_CONFIG_ERROR。
   *
   * 此时不能走通用错误页，而应把用户送进初始化向导 —— 那是唯一能修复配置的
   * 地方。同时该错误码只有 TS Worker 后端会返回，可据此反推后端类型，
   * 否则 /public/settings 同样失败会让前端误判为 Go 后端并跳过环境自检。
   */
  const isStorageConfigError = (resp: any, code?: number) =>
    code === 503 && resp?.data?.error === STORAGE_CONFIG_ERROR

  const [loading, data] = useLoading(() =>
    Promise.all([
      (async () => {
        const resp = (await r.get("/public/settings")) as Resp<
          Record<string, string>
        >
        handleRespWithoutAuthAndNotify(resp, setSettings, (msg, code) => {
          if (isStorageConfigError(resp, code)) {
            markTsWorker()
            setInitialized(false)
            return
          }
          setErr(err().concat(msg))
        })
      })(),
      (async () => {
        handleRespWithoutAuthAndNotify(
          (await r.get("/public/archive_extensions")) as Resp<string[]>,
          setArchiveExtensions,
          // (e) => setErr(err().concat(e)),
        )
      })(),
      (async () => {
        const resp = (await r.get("/public/init_status")) as Resp<InitStatus>
        handleRespWithoutAuthAndNotify(
          resp,
          (data) => setInitialized(data.initialized),
          (msg, code) => {
            if (isStorageConfigError(resp, code)) {
              markTsWorker()
              setInitialized(false)
              return
            }
            setErr(err().concat(msg))
          },
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
            <Route path="/@init" component={Init} />
            <Route
              path="/@manage/*"
              element={
                <MustUser>
                  <Manage />
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
    </>
  )
}

export default App
