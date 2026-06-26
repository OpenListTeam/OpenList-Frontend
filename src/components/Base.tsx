import {
  Box,
  Center,
  Flex,
  Heading,
  useColorModeValue,
  createDisclosure,
  Select,
  SelectContent,
  SelectIcon,
  SelectListbox,
  SelectOption,
  SelectOptionIndicator,
  SelectOptionText,
  SelectTrigger,
  SelectValue,
  IconButton,
  Tooltip,
  VStack,
} from "@hope-ui/solid"
import { SwitchColorMode } from "./SwitchColorMode"
import {
  ComponentProps,
  For,
  mergeProps,
  Show,
  JSXElement,
  createSignal,
  onMount,
  onCleanup,
} from "solid-js"
import { AiOutlineFullscreen, AiOutlineFullscreenExit } from "solid-icons/ai"
import { BsFullscreen, BsFullscreenExit } from "solid-icons/bs"
import { useT } from "~/hooks"
import { notify } from "~/utils"

export const Error = (props: {
  msg: string
  disableColor?: boolean
  h?: string
  actions?: JSXElement
}) => {
  const merged = mergeProps(
    {
      h: "$full",
    },
    props,
  )
  return (
    <Center h={merged.h} p="$2" flexDirection="column">
      <Box
        rounded="$lg"
        px="$4"
        py="$6"
        bgColor={useColorModeValue("white", "$neutral3")()}
      >
        <Heading
          css={{
            wordBreak: "break-all",
          }}
        >
          {props.msg}
        </Heading>
        <Show when={props.actions}>
          <Flex mt="$4" justifyContent="center">
            {props.actions}
          </Flex>
        </Show>
        <Show when={!props.disableColor}>
          <Flex mt="$2" justifyContent="end">
            <SwitchColorMode />
          </Flex>
        </Show>
      </Box>
    </Center>
  )
}

export const BoxWithFullScreen = (props: Parameters<typeof Box>[0]) => {
  const { isOpen, onToggle } = createDisclosure()
  const [isNativeFullscreen, setIsNativeFullscreen] = createSignal(false)
  let containerRef: HTMLDivElement
  const t = useT()

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef!.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  onMount(() => {
    const handler = () => setIsNativeFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handler)
    onCleanup(() => document.removeEventListener("fullscreenchange", handler))
  })

  return (
    <Box
      ref={containerRef!}
      pos={isOpen() ? "fixed" : "relative"}
      w={isOpen() ? "100vw" : props.w}
      h={isOpen() ? "100vh" : props.h}
      top={0}
      left={0}
      zIndex={1}
      transition="all 0.2s ease-in-out"
      css={{
        backdropFilter: isOpen() ? "blur(5px)" : undefined,
      }}
    >
      {props.children}
      <VStack
        pos="absolute"
        right="$2"
        bottom="$2"
        spacing="$2"
        opacity="0.7"
        _hover={{ opacity: "1" }}
      >
        {/* Full view toggle */}
        <Tooltip
          label={
            isOpen()
              ? t("home.preview.exit_fullview")
              : t("home.preview.fullview")
          }
          withArrow
        >
          <IconButton
            aria-label={
              isOpen()
                ? t("home.preview.exit_fullview")
                : t("home.preview.fullview")
            }
            icon={isOpen() ? <BsFullscreenExit /> : <BsFullscreen />}
            onClick={onToggle}
            colorScheme="neutral"
            size="sm"
          />
        </Tooltip>

        {/* Native fullscreen toggle */}
        <Tooltip
          label={
            isNativeFullscreen()
              ? t("home.preview.exit_fullscreen")
              : t("home.preview.fullscreen")
          }
          withArrow
        >
          <IconButton
            aria-label={
              isNativeFullscreen()
                ? t("home.preview.exit_fullscreen")
                : t("home.preview.fullscreen")
            }
            icon={
              isNativeFullscreen() ? (
                <AiOutlineFullscreenExit />
              ) : (
                <AiOutlineFullscreen />
              )
            }
            onClick={toggleFullscreen}
            colorScheme="neutral"
            size="sm"
          />
        </Tooltip>
      </VStack>
    </Box>
  )
}

export function SelectWrapper<T extends string | number>(props: {
  value: T
  onChange: (v: T) => void
  options: {
    value: T
    label?: string
  }[]
  alwaysShowBorder?: boolean
  size?: "xs" | "sm" | "md" | "lg"
  w?: ComponentProps<typeof SelectTrigger>["w"]
}) {
  return (
    <Select size={props.size} value={props.value} onChange={props.onChange}>
      <SelectTrigger
        borderColor={props.alwaysShowBorder ? "$info5" : undefined}
        w={props.w}
      >
        <SelectValue />
        <SelectIcon />
      </SelectTrigger>
      <SelectContent>
        <SelectListbox>
          <For each={props.options}>
            {(item) => (
              <SelectOption value={item.value}>
                <SelectOptionText>{item.label ?? item.value}</SelectOptionText>
                <SelectOptionIndicator />
              </SelectOption>
            )}
          </For>
        </SelectListbox>
      </SelectContent>
    </Select>
  )
}
