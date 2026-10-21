import {
  Box,
  HStack,
  useColorModeValue,
  Image,
  Center,
  Icon,
  Kbd,
  CenterProps,
} from "@hope-ui/solid"
import { changeColor } from "seemly"
import { Show, createMemo } from "solid-js"
import { useRouter } from "~/hooks"
import { getMainColor, getSetting, local, objStore, State } from "~/store"
import { mediaEnabled } from "~/store/media"
import { MediaSidebarTrigger } from "~/components/MediaSidebar"
import { BsSearch } from "solid-icons/bs"
import { CenterLoading } from "~/components"
import { Container } from "../Container"
import { bus } from "~/utils"
import { Layout } from "./layout"
import { isMac } from "~/utils/compatibility"

export const Header = (props: { flush?: boolean } = {}) => {
  const { pathname } = useRouter()
  // 媒体库页面有自己的视图切换，文件列表的布局切换对这里无意义
  const isMediaPage = () => pathname().startsWith("/@media")
  const logos = getSetting("logo").split("\n")
  const logo = useColorModeValue(logos[0], logos.pop())

  const stickyProps = createMemo<CenterProps>(() => {
    switch (local["position_of_header_navbar"]) {
      case "sticky":
        return { position: "sticky", zIndex: "$sticky", top: 0 }
      default:
        return { position: undefined, zIndex: undefined, top: undefined }
    }
  })

  const content = () => (
    <HStack
      px="calc(2% + 0.5rem)"
      py="$2"
      w="$full"
      justifyContent="space-between"
    >
      <HStack class="header-left" h="44px" spacing="$2">
        <Show when={mediaEnabled()}>
          <MediaSidebarTrigger />
        </Show>
        <Image src={logo()!} h="$full" w="auto" fallback={<CenterLoading />} />
      </HStack>
      <HStack class="header-right" spacing="$2">
        <Show when={objStore.state === State.Folder}>
          <Show when={getSetting("search_index") !== "none"}>
            <HStack
              bg="$neutral4"
              w="$32"
              p="$1"
              rounded="$md"
              justifyContent="space-between"
              border="2px solid transparent"
              cursor="pointer"
              color={getMainColor()}
              bgColor={changeColor(getMainColor(), { alpha: 0.15 })}
              _hover={{
                bgColor: changeColor(getMainColor(), { alpha: 0.2 }),
              }}
              onClick={() => {
                bus.emit("tool", "search")
              }}
            >
              <Icon as={BsSearch} />
              <HStack>
                {isMac ? <Kbd>Cmd</Kbd> : <Kbd>Ctrl</Kbd>}
                <Kbd>K</Kbd>
              </HStack>
            </HStack>
          </Show>
          <Show when={!isMediaPage()}>
            <Layout />
          </Show>
        </Show>
      </HStack>
    </HStack>
  )

  return (
    <Center
      {...stickyProps}
      bgColor="$background"
      class="header"
      w="$full"
      // shadow="$md"
    >
      <Show when={props.flush} fallback={<Container>{content()}</Container>}>
        <Box w="$full">{content()}</Box>
      </Show>
    </Center>
  )
}
