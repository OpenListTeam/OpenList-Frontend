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

  /**
   * 后端存储未绑定时，对所有依赖持久化的接口返回 503 +
   * data.error = STORAGE_CONFIG_ERROR。
   *
   * 该错误码只有 TS Worker 后端会返回，可据此在拿不到 /public/settings 时
   * 反推后端类型，否则前端会误判为 Go 后端并跳过环境自检。
   */
  const isStorageConfigError = (resp: any, code?: number) =>
    code === 503 && resp?.data?.error === STORAGE_CONFIG_ERROR

  /**
   * 是否需要进入初始化向导。
   *
   * 两个独立触发条件，不能互相依赖：
   *  1. init_status 明确返回 initialized === false —— 正常未初始化；
   *  2. 状态未知（存储未绑定导致 503 / 请求失败）—— 无从判断是否已初始化，
   *     此时也应进向导：那是唯一能修复配置的地方，且比停在主页吃错误页好。
   *
   * 早期实现只在收到 STORAGE_CONFIG_ERROR 时置 false，导致「其他原因的
   * 503 / 请求失败」既不跳转也不报错，用户被卡在主页。
   */
  const [needSetup, setNeedSetup] = createSignal(false)

  const [loading, data] = useLoading(() =>
    Promise.all([
      (async () => {
        const resp = (await r.get("/public/settings")) as Resp<
          Record<string, string>
        >
        handleRespWithoutAuthAndNotify(resp, setSettings, (msg, code) => {
          // 存储未绑定时 settings 也是 503，同样说明需要进向导。
          if (isStorageConfigError(resp, code)) {
            markTsWorker()
            setNeedSetup(true)
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
          (data) => {
            // 明确未初始化 → 进向导；已初始化 → 留在原页面
            setNeedSetup(data.initialized === false)
          },
          (msg, code) => {
            // 状态未知（含存储未绑定）→ 同样进向导，而不是当作已初始化
            if (isStorageConfigError(resp, code)) {
              markTsWorker()
            }
            setNeedSetup(true)
          },
        )
      })(),
    ]),
  )
  data()

  // 系统未初始化、或初始化状态不可知时，自动跳转到安装向导
  createEffect(() => {
    if (needSetup() && !pathname().startsWith("/@init")) {
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
