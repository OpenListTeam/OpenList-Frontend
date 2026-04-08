import {
  createSignal,
  Show,
  createMemo,
  onMount,
  onCleanup,
  For,
} from "solid-js"
import { useLocation } from "@solidjs/router"
import { useColorMode, useColorModeValue, Icon, Image } from "@hope-ui/solid"
import { IconTypes } from "solid-icons"
import {
  TbFolder,
  TbMusic,
  TbChevronLeft,
  TbChevronRight,
  TbMenu2,
  TbLayersIntersect,
  TbSettings,
  TbAdjustments,
} from "solid-icons/tb"
import { BsPlayCircleFill, BsCardImage } from "solid-icons/bs"
import { BiSolidBookContent } from "solid-icons/bi"
import { FiSun, FiMoon } from "solid-icons/fi"
import { joinBase } from "~/utils"
import { getSetting } from "~/store"

// ─── 导航项定义 ───────────────────────────────────────────────
interface NavItem {
  label: string
  path: string
  icon: IconTypes
  desc: string
}

const navItems: NavItem[] = [
  { icon: TbFolder, label: "文件", path: "/", desc: "文件管理" },
  {
    icon: BsPlayCircleFill,
    label: "影视",
    path: "/@media/video",
    desc: "电影剧集",
  },
  { icon: TbMusic, label: "音乐", path: "/@media/music", desc: "专辑歌曲" },
  { icon: BsCardImage, label: "图片", path: "/@media/image", desc: "相册图库" },
  {
    icon: BiSolidBookContent,
    label: "书籍",
    path: "/@media/books",
    desc: "图书文档",
  },
]

// ─── 全局状态（供 RootLayout 读取宽度） ──────────────────────
export const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)
export const [sidebarVisible, setSidebarVisible] = createSignal(false)

// ─── 透明模式持久化 ───────────────────────────────────────────
const TRANSPARENT_KEY = "sidebar_transparent"
const initTransparent = () => {
  try {
    return localStorage.getItem(TRANSPARENT_KEY) === "true"
  } catch {
    return false
  }
}
export const [sidebarTransparent, setSidebarTransparent] =
  createSignal(initTransparent())

// ─── 主组件 ──────────────────────────────────────────────────
export const GlobalSidebar = () => {
  const location = useLocation()
  const { colorMode, toggleColorMode } = useColorMode()

  // 是否暗色模式
  const isDark = createMemo(() => colorMode() === "dark")

  // 移动端检测
  const [isMobile, setIsMobile] = createSignal(
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  )
  onMount(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", handler)
    onCleanup(() => window.removeEventListener("resize", handler))
  })

  const isVisible = createMemo(() => !isMobile() || sidebarVisible())
  const sidebarWidth = createMemo(() => (sidebarCollapsed() ? "48px" : "130px"))

  // Logo：从设置读取，支持亮/暗两套（与 Header.tsx 保持完全一致）
  const logos = getSetting("logo").split("\n")
  const logo = useColorModeValue(logos[0], logos.pop())
  // 站点标题：从数据库设置读取
  const siteTitle = getSetting("site_title")

  // ─── 主题色 token（亮/暗自适应） ─────────────────────────
  const bg = createMemo(() => {
    if (sidebarTransparent()) {
      return isDark() ? "rgba(15,20,35,0.55)" : "rgba(255,255,255,0.55)"
    }
    return isDark() ? "rgba(18,22,36,0.98)" : "rgba(250,251,253,0.98)"
  })

  const borderColor = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)",
  )

  const textPrimary = createMemo(() => (isDark() ? "#e2e8f0" : "#1e293b"))
  const textSecondary = createMemo(() => (isDark() ? "#64748b" : "#94a3b8"))
  const textMuted = createMemo(() =>
    isDark() ? "rgba(100,116,139,0.5)" : "rgba(148,163,184,0.7)",
  )

  // 激活态：使用品牌蓝而非紫色
  const activeBg = createMemo(() =>
    isDark() ? "rgba(59,130,246,0.18)" : "rgba(59,130,246,0.10)",
  )
  const activeBorder = createMemo(() =>
    isDark() ? "rgba(59,130,246,0.35)" : "rgba(59,130,246,0.25)",
  )
  const activeText = createMemo(() => (isDark() ? "#93c5fd" : "#2563eb"))
  const activeBar = createMemo(() => "#3b82f6")

  const hoverBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
  )
  const hoverText = createMemo(() => (isDark() ? "#cbd5e1" : "#475569"))

  const btnBg = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
  )
  const btnBorder = createMemo(() =>
    isDark() ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
  )

  const shadowStyle = createMemo(() =>
    sidebarTransparent()
      ? `4px 0 24px rgba(0,0,0,${isDark() ? "0.4" : "0.08"}), inset -1px 0 0 ${borderColor()}`
      : `2px 0 16px rgba(0,0,0,${isDark() ? "0.3" : "0.06"}), inset -1px 0 0 ${borderColor()}`,
  )

  // ─── 激活判断 ─────────────────────────────────────────────
  const isActive = (path: string) => {
    const cur = location.pathname
    if (path === "/") return !cur.startsWith("/@media")
    return cur.startsWith(path)
  }

  // ─── 导航跳转 ─────────────────────────────────────────────
  const handleNav = (path: string) => {
    window.location.href = joinBase(path)
    if (isMobile()) setSidebarVisible(false)
  }

  // ─── 系统设置跳转 ─────────────────────────────────────────
  const handleSettings = () => {
    window.location.href = joinBase("/@manage/settings/site")
    if (isMobile()) setSidebarVisible(false)
  }

  // ─── 透明模式切换 ─────────────────────────────────────────
  const toggleTransparent = () => {
    const next = !sidebarTransparent()
    setSidebarTransparent(next)
    try {
      localStorage.setItem(TRANSPARENT_KEY, String(next))
    } catch {}
  }

  // ─── 渲染 ─────────────────────────────────────────────────
  return (
    <>
      {/* 移动端遮罩 */}
      <Show when={isMobile() && sidebarVisible()}>
        <div
          onClick={() => setSidebarVisible(false)}
          style={{
            position: "fixed",
            inset: "0",
            background: "rgba(0,0,0,0.5)",
            "z-index": "99",
            "backdrop-filter": "blur(3px)",
          }}
        />
      </Show>

      {/* ══════════════ 侧边栏主体 ══════════════ */}
      <div
        style={{
          position: "fixed",
          top: "0",
          left: "0",
          height: "100vh",
          width: sidebarWidth(),
          "z-index": "100",
          transition:
            "width 0.28s cubic-bezier(0.4,0,0.2,1), transform 0.28s cubic-bezier(0.4,0,0.2,1)",
          transform: isVisible() ? "translateX(0)" : "translateX(-100%)",
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
          background: bg(),
          "backdrop-filter": sidebarTransparent()
            ? "blur(16px) saturate(180%)"
            : "none",
          "-webkit-backdrop-filter": sidebarTransparent()
            ? "blur(16px) saturate(180%)"
            : "none",
          "border-right": `1px solid ${borderColor()}`,
          "box-shadow": shadowStyle(),
        }}
      >
        {/* ── Logo / 标题区 ── */}
        <div
          style={{
            padding: sidebarCollapsed() ? "14px 0" : "14px 12px",
            "border-bottom": `1px solid ${borderColor()}`,
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "min-height": "60px",
            "flex-shrink": "0",
          }}
        >
          <Show when={!sidebarCollapsed()}>
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "8px",
                overflow: "hidden",
              }}
            >
              {/* Logo 图片（从设置读取，与 Header 保持一致） */}
              <Image
                src={logo()!}
                h="28px"
                w="auto"
                maxW="28px"
                objectFit="contain"
                flexShrink={0}
                fallback={
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      background: isDark()
                        ? "linear-gradient(135deg,#3b82f6,#06b6d4)"
                        : "linear-gradient(135deg,#2563eb,#0891b2)",
                      "border-radius": "8px",
                      "flex-shrink": "0",
                    }}
                  />
                }
              />
              {/* 站点标题（从数据库设置读取） */}
              <Show when={siteTitle}>
                <span
                  style={{
                    "font-size": "14px",
                    "font-weight": "700",
                    color: textPrimary(),
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                    "letter-spacing": "0.01em",
                    "line-height": "1.2",
                  }}
                >
                  {siteTitle}
                </span>
              </Show>
            </div>
          </Show>
        </div>

        {/* ── 导航菜单 ── */}
        <nav
          style={{
            flex: "1",
            padding: "8px 6px",
            display: "flex",
            "flex-direction": "column",
            gap: "1px",
            "overflow-y": "auto",
            "overflow-x": "hidden",
          }}
        >
          <Show when={!sidebarCollapsed()}>
            <div
              style={{
                padding: "5px 10px 3px",
                color: textMuted(),
                "font-size": "9.5px",
                "letter-spacing": "0.14em",
                "text-transform": "uppercase",
                "font-weight": "600",
              }}
            >
              导航
            </div>
          </Show>

          <For each={navItems}>
            {(item) => {
              const active = createMemo(() => isActive(item.path))
              return (
                <button
                  onClick={() => handleNav(item.path)}
                  title={
                    sidebarCollapsed()
                      ? `${item.label} · ${item.desc}`
                      : undefined
                  }
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "9px",
                    padding: sidebarCollapsed() ? "9px 0" : "8px 9px",
                    "border-radius": "9px",
                    border: active()
                      ? `1px solid ${activeBorder()}`
                      : "1px solid transparent",
                    cursor: "pointer",
                    background: active() ? activeBg() : "transparent",
                    color: active() ? activeText() : textSecondary(),
                    "font-size": "13px",
                    "font-weight": active() ? "600" : "400",
                    transition: "all 0.18s ease",
                    width: "100%",
                    "justify-content": sidebarCollapsed()
                      ? "center"
                      : "flex-start",
                    "white-space": "nowrap",
                    overflow: "hidden",
                    position: "relative",
                    "text-align": "left",
                  }}
                  onMouseEnter={(e) => {
                    if (!active()) {
                      const el = e.currentTarget as HTMLButtonElement
                      el.style.background = hoverBg()
                      el.style.color = hoverText()
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active()) {
                      const el = e.currentTarget as HTMLButtonElement
                      el.style.background = "transparent"
                      el.style.color = textSecondary()
                    }
                  }}
                >
                  {/* 激活左侧指示条 */}
                  <Show when={active() && !sidebarCollapsed()}>
                    <div
                      style={{
                        position: "absolute",
                        left: "0",
                        top: "22%",
                        height: "56%",
                        width: "3px",
                        background: activeBar(),
                        "border-radius": "0 3px 3px 0",
                      }}
                    />
                  </Show>

                  {/* 图标 */}
                  <Icon
                    as={item.icon}
                    boxSize="17px"
                    style={{
                      "flex-shrink": "0",
                      opacity: active() ? "1" : "0.72",
                      transition: "opacity 0.18s",
                    }}
                  />

                  {/* 文字 */}
                  <Show when={!sidebarCollapsed()}>
                    <div style={{ overflow: "hidden", flex: "1" }}>
                      <div
                        style={{
                          overflow: "hidden",
                          "text-overflow": "ellipsis",
                          "font-size": "13px",
                          "line-height": "1.3",
                        }}
                      >
                        {item.label}
                      </div>
                      <div
                        style={{
                          "font-size": "10px",
                          color: active() ? activeText() : textMuted(),
                          opacity: "0.7",
                          "line-height": "1.2",
                          "margin-top": "1px",
                        }}
                      >
                        {item.desc}
                      </div>
                    </div>
                  </Show>
                </button>
              )
            }}
          </For>
        </nav>

        {/* ── 底部工具栏 ── */}
        <div
          style={{
            padding: sidebarCollapsed() ? "8px 0" : "8px 8px",
            "border-top": `1px solid ${borderColor()}`,
            display: "flex",
            "flex-direction": sidebarCollapsed() ? "column" : "row",
            "align-items": "center",
            "justify-content": sidebarCollapsed() ? "center" : "space-between",
            gap: "6px",
            "flex-shrink": "0",
          }}
        >
          {/* 亮/暗模式切换 */}
          <button
            onClick={toggleColorMode}
            title={isDark() ? "切换到亮色模式" : "切换到暗色模式"}
            style={{
              background: btnBg(),
              border: `1px solid ${btnBorder()}`,
              "border-radius": "7px",
              width: "28px",
              height: "28px",
              cursor: "pointer",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              color: textSecondary(),
              transition: "all 0.18s ease",
              "flex-shrink": "0",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement
              el.style.background = isDark()
                ? "rgba(251,191,36,0.15)"
                : "rgba(99,102,241,0.10)"
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background = btnBg()
            }}
          >
            <Icon as={isDark() ? FiSun : FiMoon} boxSize="15px" />
          </button>

          {/* 系统设置 */}
          <button
            onClick={handleSettings}
            title="系统设置"
            style={{
              background: btnBg(),
              border: `1px solid ${btnBorder()}`,
              "border-radius": "7px",
              width: "28px",
              height: "28px",
              cursor: "pointer",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              color: textSecondary(),
              transition: "all 0.18s ease",
              "flex-shrink": "0",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement
              el.style.background = isDark()
                ? "rgba(59,130,246,0.15)"
                : "rgba(59,130,246,0.08)"
              el.style.color = "#3b82f6"
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement
              el.style.background = btnBg()
              el.style.color = textSecondary()
            }}
          >
            <Icon as={TbAdjustments} boxSize="15px" />
          </button>

          {/* 透明模式切换 */}
          <button
            onClick={toggleTransparent}
            title={sidebarTransparent() ? "关闭透明模式" : "开启透明模式"}
            style={{
              background: sidebarTransparent()
                ? isDark()
                  ? "rgba(6,182,212,0.18)"
                  : "rgba(6,182,212,0.10)"
                : btnBg(),
              border: `1px solid ${sidebarTransparent() ? "rgba(6,182,212,0.35)" : btnBorder()}`,
              "border-radius": "7px",
              width: "28px",
              height: "28px",
              cursor: "pointer",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              color: sidebarTransparent()
                ? isDark()
                  ? "#67e8f9"
                  : "#0891b2"
                : textSecondary(),
              transition: "all 0.18s ease",
              "flex-shrink": "0",
            }}
            onMouseEnter={(e) => {
              if (!sidebarTransparent()) {
                const el = e.currentTarget as HTMLButtonElement
                el.style.background = isDark()
                  ? "rgba(6,182,212,0.10)"
                  : "rgba(6,182,212,0.06)"
              }
            }}
            onMouseLeave={(e) => {
              if (!sidebarTransparent()) {
                ;(e.currentTarget as HTMLButtonElement).style.background =
                  btnBg()
              }
            }}
          >
            <Icon as={TbLayersIntersect} boxSize="15px" />
          </button>
        </div>
      </div>

      {/* ══════════════ 移动端汉堡按钮 ══════════════ */}
      <Show when={isMobile()}>
        <button
          onClick={() => setSidebarVisible(!sidebarVisible())}
          title="打开导航"
          style={{
            position: "fixed",
            top: "12px",
            left: "12px",
            "z-index": "101",
            background: isDark()
              ? "linear-gradient(135deg,#3b82f6,#06b6d4)"
              : "linear-gradient(135deg,#2563eb,#0891b2)",
            border: "none",
            "border-radius": "11px",
            width: "40px",
            height: "40px",
            cursor: "pointer",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            color: "white",
            "box-shadow": "0 4px 14px rgba(59,130,246,0.45)",
            transition: "transform 0.18s ease, box-shadow 0.18s ease",
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.transform =
              "scale(1.06)"
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"
          }}
        >
          <Icon as={TbMenu2} boxSize="20px" />
        </button>
      </Show>
    </>
  )
}
