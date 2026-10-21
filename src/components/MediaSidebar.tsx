import {
  Box,
  Button,
  Divider,
  HStack,
  Icon,
  Text,
  VStack,
} from "@hope-ui/solid"
import { For, Show, createMemo } from "solid-js"
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
  TbChevronLeft,
  TbFolder,
  TbMovie,
  TbMusic,
  TbPhoto,
} from "solid-icons/tb"
import { AiOutlineCloudServer } from "solid-icons/ai"
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
  const { pathname, to } = useRouter()
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
    if (UserMethods.is_admin(me())) {
      list.push({
        label: t("home.media.nav_manage"),
        path: "/@manage/media",
        icon: AiOutlineCloudServer,
        match: (p) => p.startsWith("/@manage/media"),
      })
    }
    return list
  })

  return (
    <Box
      as="aside"
      w="216px"
      flexShrink={0}
      h="100vh"
      position="sticky"
      top="0"
      overflowY="auto"
      bgColor="$neutral1"
      borderRight="1px solid $neutral4"
      display={{ "@initial": "none", "@md": "block" }}
      py="$3"
      px="$2"
    >
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
      <Divider mb="$2" />
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
                onClick={() => to(item.path)}
              >
                {item.label}
              </Button>
            )
          }}
        </For>
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
