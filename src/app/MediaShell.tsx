import { JSX, Show } from "solid-js"
import { Header } from "~/pages/home/header/Header"
import { mediaEnabled } from "~/store/media"

interface MediaShellProps {
  children: JSX.Element
}

/**
 * 媒体库页面外壳。
 * 顶栏直接复用 main 的 Header；左侧导航由 App 统一渲染，避免每个页面各自挂载。
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
        <Header flush />
        <div style={{ flex: "1", "min-width": "0", display: "flex" }}>
          {props.children}
        </div>
      </div>
    </Show>
  )
}
