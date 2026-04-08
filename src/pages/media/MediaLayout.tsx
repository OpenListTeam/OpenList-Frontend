import { JSX } from "solid-js"
import { useColorMode } from "@hope-ui/solid"
import { createMemo } from "solid-js"
import { playerState } from "./music/MusicLibrary"
import { useTitle } from "~/hooks"
import { getSetting } from "~/store"

interface MediaLayoutProps {
  children: JSX.Element
  title: string
  headerRight?: JSX.Element
}

export const MediaLayout = (props: MediaLayoutProps) => {
  // 设置浏览器标签页 title，复用 OpenList 原有的 title 逻辑
  useTitle(() => `${props.title} | ${getSetting("site_title")}`)

  const { colorMode } = useColorMode()
  const isDark = createMemo(() => colorMode() === "dark")

  // 跟随主题的颜色 token
  const bg = createMemo(() =>
    isDark() ? "rgba(15,20,35,1)" : "rgba(248,250,252,1)",
  )
  const titleColor = createMemo(() => (isDark() ? "#f1f5f9" : "#0f172a"))

  return (
    <div
      style={{
        flex: "1",
        "min-height": "100vh",
        background: bg(),
        color: isDark() ? "#e2e8f0" : "#334155",
        "font-family": "'Inter', 'DM Sans', system-ui, sans-serif",
        display: "flex",
        "flex-direction": "column",
        transition: "background 0.2s ease, color 0.2s ease",
      }}
    >
      {/* 主内容 */}
      <div
        style={{
          padding: "20px 28px",
          flex: "1",
          "padding-bottom": playerState().playlist.length > 0 ? "91px" : "20px",
          transition: "padding-bottom 0.3s ease",
        }}
      >
        {props.children}
      </div>
    </div>
  )
}
