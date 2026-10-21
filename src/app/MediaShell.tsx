import { JSX, Show } from "solid-js"
import { Header } from "~/pages/home/header/Header"
import { MediaSidebar } from "~/components/MediaSidebar"
import { mediaEnabled } from "~/store/media"

interface MediaShellProps {
  children: JSX.Element
}

/**
 * 媒体库页面外壳。
 * 顶栏直接复用 main 的 Header，左侧导航为可收起的抽屉（媒体库关闭时不渲染任何额外 UI）。
 */
export const MediaShell = (props: MediaShellProps) => {
  return (
    <Show when={mediaEnabled()}>
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
