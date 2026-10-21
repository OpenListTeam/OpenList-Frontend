import {
  Box,
  Button,
  Divider,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
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
  TbFolder,
  TbMovie,
  TbMusic,
  TbPhoto,
  TbSettings,
} from "solid-icons/tb"
import { AiOutlineCloudServer } from "solid-icons/ai"
import { Component } from "solid-js"

interface NavEntry {
  label: string
  path: string
  icon: Component<{ size?: number | string }>
  match: (p: string) => boolean
}

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
    list.push({
      label: t("home.media.nav_settings"),
      path: "/@media/settings",
      icon: TbSettings,
      match: (p) => p.startsWith("/@media/settings"),
    })
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
    <Show when={mediaEnabled()}>
      <Drawer
        opened={mediaSidebarOpen()}
        onClose={() => setMediaSidebarOpen(false)}
        placement="left"
        size="xs"
      >
        <DrawerOverlay />
        <DrawerContent>
          <DrawerHeader>
            <HStack justifyContent="space-between" alignItems="center">
              <Text fontWeight="$semibold">{t("home.media.title")}</Text>
              <DrawerCloseButton />
            </HStack>
          </DrawerHeader>
          <Divider />
          <DrawerBody py="$4">
            <VStack spacing="$1" alignItems="stretch">
              <For each={items()}>
                {(item) => {
                  const active = createMemo(() => item.match(pathname()))
                  return (
                    <Button
                      variant={active() ? "subtle" : "ghost"}
                      colorScheme={active() ? "accent" : "neutral"}
                      justifyContent="flex-start"
                      leftIcon={<Icon as={item.icon} boxSize="$5" />}
                      onClick={() => {
                        to(item.path)
                        setMediaSidebarOpen(false)
                      }}
                    >
                      {item.label}
                    </Button>
                  )
                }}
              </For>
            </VStack>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
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
