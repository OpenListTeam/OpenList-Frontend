import { JSX, Show } from "solid-js"
import { Header } from "~/pages/home/header/Header"
import { MediaSidebar } from "~/components/MediaSidebar"
import { mediaEnabled } from "~/store/media"
import { useRouter } from "~/hooks"

interface MediaShellProps {
  children: JSX.Element
}

/**
 * 媒体库页面外壳。
 * 顶栏直接复用 main 的 Header，左侧导航为可收起的抽屉（媒体库关闭时不渲染任何额外 UI）。
 */
export const MediaShell = (props: MediaShellProps) => {
  const { pathname } = useRouter()
  // 媒体库关闭时仍允许进入设置页（总开关入口），其余媒体页面由 App 层重定向
  const visible = () =>
    mediaEnabled() || pathname().startsWith("/@media/settings")
  return (
    <Show when={visible()}>
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          "min-height": "100vh",
          width: "100%",
        }}
      >
        <Header />
        <div style={{ flex: "1", "min-width": "0", display: "flex" }}>
          {props.children}
        </div>
        <MediaSidebar />
      </div>
    </Show>
  )
}
