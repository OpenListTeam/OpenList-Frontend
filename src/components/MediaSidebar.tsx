import {
  Anchor,
  Box,
  Button,
  Divider,
  HStack,
  Icon,
  Text,
  Tooltip,
  useColorMode,
  VStack,
} from "@hope-ui/solid"
import { For, Show, createMemo, createSignal } from "solid-js"
import { useRouter, useT } from "~/hooks"
import {
  mediaEnabled,
  mediaSidebarOpen,
  mediaStatus,
  setMediaSidebarOpen,
} from "~/store/media"
import { me } from "~/store"
import { UserMethods } from "~/types"
import {
  TbBook,
  TbBook2,
  TbBrandGithub,
  TbCheck,
  TbChevronLeft,
  TbFolder,
  TbLogin,
  TbLogout,
  TbMoon,
  TbSettings,
  TbMovie,
  TbMusic,
  TbPalette,
  TbPhoto,
  TbSun,
} from "solid-icons/tb"
import { changeToken, handleResp, notify, r } from "~/utils"
import {
  ACCENT_PRESETS,
  accent,
  accentColor,
  accentPaletteStyleVars,
  mediaAccentEnabled,
  resetAccentColor,
  setAccentColor,
  setMediaAccentEnabled,
} from "~/store/accent"
import { Component } from "solid-js"

interface NavEntry {
  label: string
  path: string
  icon: Component<{ size?: number | string }>
  match: (p: string) => boolean
}

/**
 * 全站统一的媒体库侧边栏（桌面端常驻、可收起）。
 * 媒体库关闭时由 App 直接不渲染，页面与未安装媒体库时一致。
 */
export const MediaSidebar = () => {
  const t = useT()
  const { colorMode, toggleColorMode } = useColorMode()
  const { pathname, to } = useRouter()
  const [showPalette, setShowPalette] = createSignal(false)
  const [loggingOut, setLoggingOut] = createSignal(false)

  const logout = async () => {
    setLoggingOut(true)
    try {
      const resp: any = await r.get("/auth/logout")
      setLoggingOut(false)
      handleResp(resp, () => {
        changeToken()
        notify.success(t("manage.logout_success"))
        to(`/@login?redirect=${encodeURIComponent(location.pathname)}`)
      })
    } catch {
      setLoggingOut(false)
      notify.error("Sign out failed")
    }
  }
  const items = createMemo<NavEntry[]>(() => {
    const list: NavEntry[] = [
      {
        label: t("home.media.nav_files"),
        path: "/",
        icon: TbFolder,
        match: (p) => !p.startsWith("/@media") && !p.startsWith("/@manage"),
      },
    ]
    const types = mediaStatus().types
    if (types.includes("video")) {
      list.push({
        label: t("home.media.nav_video"),
        path: "/@media/video",
        icon: TbMovie,
        match: (p) => p.startsWith("/@media/video"),
      })
    }
    if (types.includes("music")) {
      list.push({
        label: t("home.media.nav_music"),
        path: "/@media/music",
        icon: TbMusic,
        match: (p) => p.startsWith("/@media/music"),
      })
    }
    if (types.includes("image")) {
      list.push({
        label: t("home.media.nav_image"),
        path: "/@media/image",
        icon: TbPhoto,
        match: (p) => p.startsWith("/@media/image"),
      })
    }
    if (types.includes("book")) {
      list.push({
        label: t("home.media.nav_book"),
        path: "/@media/books",
        icon: TbBook,
        match: (p) => p.startsWith("/@media/books"),
      })
    }
    return list
  })
  // 管理入口固定在侧栏底部（仅管理员可见）
  const manageActive = createMemo(() => pathname().startsWith("/@manage/media"))

  // 主题色只作用在侧栏自身：其它页面复用站点默认色板，避免全局 CSS 变量污染
  const paletteVars = createMemo<Record<string, string>>(() =>
    mediaAccentEnabled()
      ? accentPaletteStyleVars(accent(), colorMode() === "dark")
      : {},
  )

  // 移动端侧栏是覆盖式抽屉：选完导航要收起；桌面端常驻，不受影响
  const closeOnMobile = () => {
    if (window.matchMedia("(max-width: 767px)").matches) {
      setMediaSidebarOpen(false)
    }
  }

  return (
    <Box
      as="aside"
      style={paletteVars()}
      w="216px"
      flexShrink={0}
      h="100vh"
      // 移动端浮在内容之上作为抽屉（App 只在展开时渲染本组件），桌面端为常驻 sticky 侧栏
      position={{ "@initial": "fixed", "@md": "sticky" }}
      top="0"
      left="0"
      zIndex={{ "@initial": "$docked", "@md": "auto" }}
      overflowY="auto"
      bgColor="$neutral1"
      borderRight="1px solid $neutral4"
      display="block"
      py="$3"
      px="$2"
    >
      {/* 移动端遮罩：铺满视口，点击空白处收起抽屉；桌面端不渲染 */}
      <Box
        display={{ "@initial": "block", "@md": "none" }}
        position="fixed"
        top="0"
        right="0"
        bottom="0"
        left="0"
        zIndex="0"
        bgColor="rgba(0,0,0,0.45)"
        onClick={() => setMediaSidebarOpen(false)}
      />
      <VStack h="$full" spacing="$2" alignItems="stretch" position="relative">
        <HStack
          px="$2"
          pb="$2"
          justifyContent="space-between"
          alignItems="center"
        >
          <Text fontWeight="$semibold" fontSize="$sm" color="$neutral11">
            {t("home.media.title")}
          </Text>
          <Button
            size="xs"
            variant="ghost"
            colorScheme="neutral"
            px="$1"
            minW="0"
            aria-label="collapse media sidebar"
            onClick={() => setMediaSidebarOpen(false)}
          >
            <Icon as={TbChevronLeft} boxSize="$4" />
          </Button>
        </HStack>
        <Divider />
        <VStack spacing="$1" alignItems="stretch">
          <For each={items()}>
            {(item) => {
              const active = createMemo(() => item.match(pathname()))
              return (
                <Button
                  variant={active() ? "subtle" : "ghost"}
                  colorScheme={active() ? "accent" : "neutral"}
                  justifyContent="flex-start"
                  size="sm"
                  leftIcon={<Icon as={item.icon} boxSize="$5" />}
                  onClick={() => {
                    to(item.path)
                    closeOnMobile()
                  }}
                >
                  {item.label}
                </Button>
              )
            }}
          </For>
        </VStack>
        <Box flex="1" />
        <Divider />
        <VStack px="$2" py="$1" spacing="$1" alignItems="stretch">
          <HStack justifyContent="space-between" alignItems="center" h="$7">
            <Text fontSize="$xs" fontWeight="$semibold" color="$neutral11">
              OpenList
            </Text>
            <HStack spacing="$1" alignItems="center" justifyContent="flex-end">
              <Tooltip label="GitHub Repository">
                <Anchor
                  href="https://github.com/OpenListTeam/OpenList"
                  external
                  w="$6"
                  h="$6"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  color="$neutral11"
                  _hover={{ color: "$accent9" }}
                >
                  <Icon as={TbBrandGithub} boxSize="$4" />
                </Anchor>
              </Tooltip>
              <Tooltip label="Documentation">
                <Anchor
                  href="https://doc.oplist.org"
                  external
                  w="$6"
                  h="$6"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  color="$neutral11"
                  _hover={{ color: "$accent9" }}
                >
                  <Icon as={TbBook2} boxSize="$4" />
                </Anchor>
              </Tooltip>
              <Tooltip label="Theme color">
                <Button
                  size="xs"
                  variant="ghost"
                  colorScheme="neutral"
                  w="$6"
                  h="$6"
                  minW="$6"
                  p="0"
                  aria-label="theme color"
                  onClick={() => setShowPalette(!showPalette())}
                >
                  <Icon as={TbPalette} boxSize="$4" />
                </Button>
              </Tooltip>
            </HStack>
          </HStack>
          <HStack justifyContent="space-between" alignItems="center" h="$7">
            <Text fontSize="$xs" color="$neutral11">
              v{mediaStatus().version || "dev"}
            </Text>
            <HStack spacing="$1" alignItems="center" justifyContent="flex-end">
              <Tooltip
                label={colorMode() === "dark" ? "Light mode" : "Dark mode"}
              >
                <Button
                  size="xs"
                  variant="ghost"
                  colorScheme="neutral"
                  w="$6"
                  h="$6"
                  minW="$6"
                  p="0"
                  aria-label="toggle color mode"
                  onClick={toggleColorMode}
                >
                  <Icon
                    as={colorMode() === "dark" ? TbSun : TbMoon}
                    boxSize="$4"
                  />
                </Button>
              </Tooltip>
              <Show
                when={UserMethods.is_guest(me())}
                fallback={
                  <>
                    <Tooltip label="设置">
                      <Button
                        variant={manageActive() ? "subtle" : "ghost"}
                        colorScheme={manageActive() ? "accent" : "neutral"}
                        size="xs"
                        w="$6"
                        h="$6"
                        minW="$6"
                        p="0"
                        aria-label="设置"
                        onClick={() => to("/@manage/media/settings")}
                      >
                        <Icon as={TbSettings} boxSize="$4" />
                      </Button>
                    </Tooltip>
                    <Tooltip label="退出登录">
                      <Button
                        size="xs"
                        variant="ghost"
                        colorScheme="neutral"
                        w="$6"
                        h="$6"
                        minW="$6"
                        p="0"
                        loading={loggingOut()}
                        aria-label="退出登录"
                        onClick={logout}
                      >
                        <Icon as={TbLogout} boxSize="$4" />
                      </Button>
                    </Tooltip>
                  </>
                }
              >
                <Tooltip label="登录">
                  <Button
                    size="xs"
                    variant="ghost"
                    colorScheme="neutral"
                    minW="0"
                    px="$1"
                    aria-label="登录"
                    onClick={() =>
                      to(
                        `/@login?redirect=${encodeURIComponent(location.pathname)}`,
                      )
                    }
                  >
                    <Icon as={TbLogin} boxSize="$4" />
                  </Button>
                </Tooltip>
                <Tooltip label="设置">
                  <Button
                    size="xs"
                    variant="ghost"
                    colorScheme="neutral"
                    minW="0"
                    px="$1"
                    aria-label="设置"
                    onClick={() => to("/@manage/media/settings")}
                  >
                    <Icon as={TbSettings} boxSize="$4" />
                  </Button>
                </Tooltip>
              </Show>
            </HStack>
          </HStack>
        </VStack>

        <Show when={showPalette()}>
          <Box
            position="fixed"
            left="12px"
            bottom="64px"
            zIndex="$popover"
            w="200px"
            p="$3"
            bgColor="$neutral1"
            rounded="$lg"
            border="1px solid $neutral4"
            shadow="$lg"
          >
            <VStack spacing="$2" alignItems="stretch">
              <Text fontSize="$xs" color="$neutral11">
                Theme color
              </Text>
              <HStack spacing="$2" flexWrap="wrap">
                <For each={ACCENT_PRESETS}>
                  {(preset) => (
                    <Tooltip label={preset.name}>
                      <Box
                        as="button"
                        w="$6"
                        h="$6"
                        rounded="$full"
                        border={
                          accentColor() === preset.color
                            ? "2px solid $accent9"
                            : "2px solid transparent"
                        }
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        style={{ background: preset.color }}
                        aria-label={preset.name}
                        onClick={() => {
                          setAccentColor(preset.color)
                          setShowPalette(false)
                        }}
                      >
                        <Show when={accentColor() === preset.color}>
                          <Icon as={TbCheck} boxSize="$3" color="white" />
                        </Show>
                      </Box>
                    </Tooltip>
                  )}
                </For>
              </HStack>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  resetAccentColor()
                  setShowPalette(false)
                }}
              >
                Follow site default
              </Button>
              <Button
                size="xs"
                variant="ghost"
                colorScheme={mediaAccentEnabled() ? "accent" : "neutral"}
                onClick={() => setMediaAccentEnabled(!mediaAccentEnabled())}
              >
                {mediaAccentEnabled()
                  ? "Theme color: media only (on)"
                  : "Theme color: off"}
              </Button>
            </VStack>
          </Box>
        </Show>
      </VStack>
    </Box>
  )
}

/**
 * 侧边栏收起后的浮动开关。
 * 管理后台等页面没有 Home 的顶栏，需要这个入口才能重新展开。
 */
export const MediaSidebarFloatingTrigger = () => {
  return (
    <Show when={mediaEnabled() && !mediaSidebarOpen()}>
      <Button
        position="fixed"
        left="$3"
        bottom="$4"
        zIndex="$docked"
        size="sm"
        variant="solid"
        colorScheme="accent"
        rounded="$full"
        shadow="$md"
        px="$3"
        onClick={() => setMediaSidebarOpen(true)}
        aria-label="expand media sidebar"
      >
        <Text fontSize="$md">»</Text>
      </Button>
    </Show>
  )
}

/** 顶栏中的侧边栏开关（媒体库启用时才渲染） */
export const MediaSidebarTrigger = () => {
  return (
    <Show when={mediaEnabled()}>
      <Button
        variant="ghost"
        colorScheme="neutral"
        size="sm"
        px="$2"
        onClick={() => setMediaSidebarOpen(!mediaSidebarOpen())}
        aria-label="media sidebar"
      >
        <Icon
          as={() => (
            <Box
              as="span"
              display="inline-flex"
              flexDirection="column"
              justifyContent="center"
              gap="3px"
              w="$4"
            >
              <Box
                as="span"
                h="2px"
                w="$4"
                bgColor="currentColor"
                rounded="$full"
              />
              <Box
                as="span"
                h="2px"
                w="$4"
                bgColor="currentColor"
                rounded="$full"
              />
              <Box
                as="span"
                h="2px"
                w="$4"
                bgColor="currentColor"
                rounded="$full"
              />
            </Box>
          )}
          boxSize="$5"
        />
      </Button>
    </Show>
  )
}
