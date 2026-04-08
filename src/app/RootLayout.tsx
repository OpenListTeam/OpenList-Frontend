import {
  JSX,
  createSignal,
  onMount,
  onCleanup,
  createMemo,
  Show,
} from "solid-js"
import {
  GlobalSidebar,
  sidebarCollapsed,
  setSidebarCollapsed,
} from "~/components/GlobalSidebar"
import { useColorMode, Icon } from "@hope-ui/solid"
import { TbChevronLeft, TbChevronRight } from "solid-icons/tb"
import { Nav } from "~/pages/home/Nav"
import { Layout } from "~/pages/home/header/layout"
import { TopBarActions } from "~/pages/home/toolbar/Right"
import { useRouter } from "~/hooks"
import { getSetting, objStore, State } from "~/store"
import { BsSearch } from "solid-icons/bs"
import { bus } from "~/utils"

interface RootLayoutProps {
  children: JSX.Element
}

// ─── 顶栏组件 ────────────────────────────────────────────────
const TopBar = () => {
  const { colorMode } = useColorMode()
  const isDark = createMemo(() => colorMode() === "dark")
  const { pathname } = useRouter()

  // 只在文件浏览路由下显示面包屑和文件操作
  const isFileBrowser = createMemo(() => !pathname().startsWith("/@media"))
  const isFolder = createMemo(() => objStore.state === State.Folder)

  const bg = createMemo(() =>
    isDark() ? "rgba(15,20,35,0.95)" : "rgba(250,251,253,0.97)",
  )
  const borderColor = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)",
  )
  const textColor = createMemo(() => (isDark() ? "#e2e8f0" : "#1e293b"))
  const mutedColor = createMemo(() => (isDark() ? "#64748b" : "#94a3b8"))

  return (
    <div
      style={{
        position: "sticky",
        top: "0",
        "z-index": "50",
        height: "60px",
        display: "flex",
        "align-items": "center",
        padding: "0 16px",
        background: bg(),
        "border-bottom": `1px solid ${borderColor()}`,
        "backdrop-filter": "blur(12px) saturate(160%)",
        "-webkit-backdrop-filter": "blur(12px) saturate(160%)",
        "flex-shrink": "0",
        gap: "8px",
      }}
    >
      {/* 面包屑导航 / 页面标题 */}
      <div style={{ flex: "1", "min-width": "0", overflow: "hidden" }}>
        <Show
          when={isFileBrowser()}
          fallback={
            <span
              style={{
                color: textColor(),
                "font-size": "14px",
                "font-weight": "600",
              }}
            >
              📺 媒体库
            </span>
          }
        >
          <Nav />
        </Show>
      </div>

      {/* 右侧工具区 */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          "flex-shrink": "0",
        }}
      >
        {/* 侧边栏收起/展开按钮 */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed())}
          title={sidebarCollapsed() ? "展开侧边栏" : "收起侧边栏"}
          style={{
            background: isDark()
              ? "rgba(255,255,255,0.06)"
              : "rgba(0,0,0,0.05)",
            border: `1px solid ${isDark() ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
            "border-radius": "7px",
            width: "28px",
            height: "28px",
            cursor: "pointer",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            color: mutedColor(),
            transition: "all 0.18s ease",
            "flex-shrink": "0",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLButtonElement
            el.style.background = isDark()
              ? "rgba(59,130,246,0.15)"
              : "rgba(59,130,246,0.08)"
            el.style.color = "#3b82f6"
            el.style.borderColor = "rgba(59,130,246,0.3)"
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLButtonElement
            el.style.background = isDark()
              ? "rgba(255,255,255,0.06)"
              : "rgba(0,0,0,0.05)"
            el.style.color = mutedColor()
            el.style.borderColor = isDark()
              ? "rgba(255,255,255,0.08)"
              : "rgba(0,0,0,0.08)"
          }}
        >
          <Icon
            as={sidebarCollapsed() ? TbChevronRight : TbChevronLeft}
            boxSize="14px"
          />
        </button>

        {/* 搜索按钮和布局切换（仅文件浏览时显示） */}
        <Show when={isFileBrowser()}>
          {/* 搜索按钮 */}
          <Show when={isFolder() && getSetting("search_index") !== "none"}>
            <button
              title="搜索 (Ctrl+K)"
              onClick={() => bus.emit("tool", "search")}
              style={{
                background: isDark()
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(0,0,0,0.05)",
                border: `1px solid ${isDark() ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
                "border-radius": "7px",
                height: "30px",
                padding: "0 10px",
                cursor: "pointer",
                display: "flex",
                "align-items": "center",
                gap: "6px",
                color: mutedColor(),
                "font-size": "12px",
                transition: "all 0.18s ease",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLButtonElement
                el.style.background = isDark()
                  ? "rgba(59,130,246,0.15)"
                  : "rgba(59,130,246,0.08)"
                el.style.color = "#3b82f6"
                el.style.borderColor = "rgba(59,130,246,0.3)"
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLButtonElement
                el.style.background = isDark()
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(0,0,0,0.05)"
                el.style.color = mutedColor()
                el.style.borderColor = isDark()
                  ? "rgba(255,255,255,0.08)"
                  : "rgba(0,0,0,0.08)"
              }}
            >
              <Icon as={BsSearch} boxSize="13px" />
              <span>搜索</span>
            </button>
          </Show>

          {/* 工具操作按钮 */}
          <TopBarActions />

          {/* 布局切换 */}
          <Show when={isFolder()}>
            <Layout />
          </Show>
        </Show>
      </div>
    </div>
  )
}

// ─── 根布局 ──────────────────────────────────────────────────
export const RootLayout = (props: RootLayoutProps) => {
  const [isMobile, setIsMobile] = createSignal(
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  )

  onMount(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", handler)
    onCleanup(() => window.removeEventListener("resize", handler))
  })

  // 与 GlobalSidebar 中的 sidebarWidth 保持一致：180px / 56px
  const marginLeft = createMemo(() => {
    if (isMobile()) return "0px"
    return sidebarCollapsed() ? "48px" : "120px"
  })

  return (
    <div style={{ display: "flex", "min-height": "100vh", width: "100%" }}>
      <GlobalSidebar />
      {/* 右侧内容区：自动填充剩余空间 */}
      <div
        style={{
          "margin-left": marginLeft(),
          transition: "margin-left 0.28s cubic-bezier(0.4,0,0.2,1)",
          flex: "1",
          "min-width": "0",
          "min-height": "100vh",
          display: "flex",
          "flex-direction": "column",
        }}
      >
        {/* 顶栏 */}
        <TopBar />
        {/* 页面内容 */}
        <div
          style={{
            flex: "1",
            "min-height": "0",
            display: "flex",
            "flex-direction": "column",
          }}
        >
          {props.children}
        </div>
      </div>
    </div>
  )
}
