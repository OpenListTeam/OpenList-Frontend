import { BoxWithFullScreen } from "~/components"
import { AnnotationEditorType, AnnotationEditorParamsType } from "pdfjs-dist"
import {
  PDFSlickState,
  TPDFDocumentOutline,
  usePDFSlick,
} from "@pdfslick/solid"
import { objStore } from "~/store"
import "@pdfslick/solid/dist/pdf_viewer.css"
import {
  Button,
  Divider,
  HStack,
  VStack,
  IconButton,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuTrigger,
  Text,
  Input,
  ButtonGroup,
  Box,
  createDisclosure,
  Tooltip,
} from "@hope-ui/solid"
import {
  createSignal,
  createEffect,
  onCleanup,
  For,
  Show,
  createMemo,
} from "solid-js"
import {
  VsChevronUp,
  VsChevronDown,
  VsLayoutSidebarLeft,
  VsLayoutSidebarLeftOff,
  VsTriangleRight,
  VsClose,
  VsTriangleDown,
  VsZoomIn,
  VsZoomOut,
} from "solid-icons/vs"
import { useT } from "~/hooks"
import { BsEraser, BsPen, BsPenFill } from "solid-icons/bs"

const PDFViewerApp = () => {
  const t = useT()
  const {
    viewerRef,
    pdfSlickStore: store,
    PDFSlickViewer,
  } = usePDFSlick(objStore.raw_url)
  const [wantedPageNumber, setWantedPageNumber] = createSignal<number | string>(
    1,
  )
  const { isOpen, onToggle, onClose } = createDisclosure()

  const handlePageNumberSubmit = (e: Event) => {
    e.preventDefault()
    const newPageNumber = parseInt(wantedPageNumber() + "")
    if (
      Number.isInteger(newPageNumber) &&
      newPageNumber > 0 &&
      newPageNumber <= store.numPages
    ) {
      store.pdfSlick?.linkService.goToPage(newPageNumber)
    } else {
      setWantedPageNumber(store.pageNumber)
    }
  }

  const updatePageNumber = ({ pageNumber }: any) =>
    setWantedPageNumber(pageNumber)

  createEffect(() => {
    if (store.pdfSlick) {
      store.pdfSlick.on("pagechanging", updatePageNumber)
    }
  })

  onCleanup(() => {
    if (store.pdfSlick) {
      store.pdfSlick.off("pagechanging", updatePageNumber)
    }
  })

  return (
    <Box w="$full" h="70vh" pos="relative" display="flex">
      <Sidebar store={store} isOpen={isOpen()} onClose={onClose} />

      <BoxWithFullScreen w="$full" h="$full" pos="relative" flex={1}>
        <Toolbar
          store={store}
          isOpen={isOpen()}
          onToggle={onToggle}
          wantedPageNumber={wantedPageNumber}
          onPageNumberChange={setWantedPageNumber}
          onPageNumberSubmit={handlePageNumberSubmit}
        />

        <PDFSlickViewer {...{ store, viewerRef }} />
      </BoxWithFullScreen>
    </Box>
  )
}

const OutlineItem = (props: {
  item: TPDFDocumentOutline[number]
  level: number
  store: PDFSlickState
}) => {
  const [isOpen, setIsOpen] = createSignal(true)
  const hasChildren = () => props.item.items && props.item.items.length > 0

  const handleClick = () => {
    if (props.item.dest && props.store.pdfSlick?.linkService) {
      props.store.pdfSlick.linkService.goToDestination(props.item.dest)
    }
  }

  return (
    <Box mb="$1">
      <HStack spacing="$1" alignItems="center">
        <Show when={hasChildren()} fallback={<Box w="16px" />}>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label="Toggle"
            icon={isOpen() ? <VsTriangleDown /> : <VsTriangleRight />}
            minW="16px"
            h="16px"
            onClick={() => setIsOpen(!isOpen())}
          />
        </Show>
        <Button
          variant="ghost"
          size="sm"
          justifyContent="flex-start"
          flex={1}
          fontSize="$sm"
          fontWeight="$normal"
          py="$1"
          px="$2"
          h="auto"
          minH="$6"
          textAlign="left"
          overflow="hidden"
          onClick={handleClick}
          _hover={{ backgroundColor: "$neutral3" }}
          title={props.item.title}
          color="$neutral12"
        >
          {props.item.title}
        </Button>
      </HStack>
      <Show when={hasChildren() && isOpen()}>
        <Box pl={`${(props.level + 1) * 16}px`}>
          <OutlineItems
            items={props.item.items}
            level={props.level + 1}
            store={props.store}
          />
        </Box>
      </Show>
    </Box>
  )
}

const OutlineItems = (props: {
  items: TPDFDocumentOutline | null
  level?: number
  store: PDFSlickState
}) => {
  if (!props.items || props.items.length === 0) return null

  return (
    <For each={props.items}>
      {(item) => (
        <OutlineItem item={item} level={props.level || 0} store={props.store} />
      )}
    </For>
  )
}

const Sidebar = (props: {
  store: PDFSlickState
  isOpen: boolean
  onClose: () => void
}) => {
  const t = useT()
  return (
    <Show when={props.isOpen}>
      <Box
        w="280px"
        h="$full"
        bgColor="$neutral1"
        borderRight="1px solid $neutral6"
        display="flex"
        flexDirection="column"
        transition="all 0.3s ease"
        zIndex="10"
      >
        <HStack
          spacing="$2"
          p="$3"
          borderBottom="1px solid $neutral6"
          bgColor="$neutral2"
        >
          <Text fontWeight="$semibold" color="$neutral12">
            {t("home.preview.pdf.document_outline")}
          </Text>
          <Box flex={1} />
          <Tooltip withArrow label={t("home.preview.pdf.close_sidebar")}>
            <IconButton
              size="sm"
              aria-label={t("home.preview.pdf.close_sidebar")}
              icon={<VsClose />}
              onClick={props.onClose}
            />
          </Tooltip>
        </HStack>
        <Box flex={1} overflow="auto" p="$3">
          <VStack spacing="$2" alignItems="stretch">
            <Show
              when={
                props.store.documentOutline &&
                props.store.documentOutline.length > 0
              }
              fallback={
                <Text size="sm" color="$neutral11" textAlign="center" mt="$4">
                  {t("home.preview.pdf.no_outline")}
                </Text>
              }
            >
              <OutlineItems
                items={props.store.documentOutline}
                store={props.store}
              />
            </Show>
          </VStack>
        </Box>
      </Box>
    </Show>
  )
}

const Toolbar = (props: {
  store: PDFSlickState
  isOpen: boolean
  onToggle: () => void
  wantedPageNumber: () => number | string
  onPageNumberChange: (value: string) => void
  onPageNumberSubmit: (e: Event) => void
}) => {
  const t = useT()
  let pageNumberRef!: HTMLInputElement

  const zoomPresets = [
    ["auto", t("home.preview.pdf.zoom_auto")],
    ["page-actual", t("home.preview.pdf.zoom_actual")],
    ["page-fit", t("home.preview.pdf.zoom_fit")],
    ["page-width", t("home.preview.pdf.zoom_width")],
  ] as const
  const zoomLevels = [
    [0.5, t("home.preview.pdf.zoom_50")],
    [0.75, t("home.preview.pdf.zoom_75")],
    [1, t("home.preview.pdf.zoom_100")],
    [1.25, t("home.preview.pdf.zoom_125")],
    [1.5, t("home.preview.pdf.zoom_150")],
    [2, t("home.preview.pdf.zoom_200")],
  ] as const

  const getCurrentZoomLabel = createMemo(() => {
    if (props.store.scaleValue) {
      const preset = zoomPresets.find(
        ([value]) => value === props.store.scaleValue,
      )
      if (preset) return preset[1]
    }
    return `${Math.floor(props.store.scale * 100)}%`
  })

  const handleZoomPreset = (value: string) => {
    if (props.store.pdfSlick) {
      props.store.pdfSlick.currentScaleValue = value
    }
  }

  const handleZoomLevel = (value: number) => {
    if (props.store.pdfSlick) {
      props.store.pdfSlick.currentScale = value
    }
  }

  const isInkMode = () =>
    props.store.annotationEditorMode === AnnotationEditorType.INK

  return (
    <Box
      pos="absolute"
      left="50%"
      transform="translateX(-50%)"
      display="flex"
      zIndex="1"
      css={{
        top: "$2",
        bottom: "auto",
        "@sm": {
          top: "auto",
          bottom: "$2",
        },
      }}
    >
      <HStack
        spacing="$4"
        w="auto"
        p="$2"
        rounded="$lg"
        shadow="$lg"
        bgColor="$neutral1"
        opacity="0.7"
        transition="all 0.2s ease-in-out"
        _hover={{
          opacity: "1",
        }}
        css={{
          scale: "0.7",
          "@sm": {
            scale: "1",
          },
        }}
      >
        <Show
          when={
            props.store.documentOutline &&
            props.store.documentOutline.length > 0
          }
        >
          <Tooltip withArrow label={t("home.preview.pdf.toggle_sidebar")}>
            <IconButton
              size="sm"
              colorScheme="neutral"
              aria-label={t("home.preview.pdf.toggle_sidebar")}
              icon={
                props.isOpen ? (
                  <VsLayoutSidebarLeftOff />
                ) : (
                  <VsLayoutSidebarLeft />
                )
              }
              onClick={props.onToggle}
            />
          </Tooltip>
        </Show>
        <Tooltip withArrow label={t("home.preview.pdf.toggle_pen")}>
          <IconButton
            size="sm"
            aria-label={t("home.preview.pdf.toggle_pen")}
            colorScheme={(isInkMode() && "primary") || "neutral"}
            onClick={() => {
              const mode = isInkMode()
                ? AnnotationEditorType.NONE
                : AnnotationEditorType.INK
              props.store.pdfSlick?.setAnnotationEditorMode(mode)
              props.store.pdfSlick?.setAnnotationEditorParams({
                type: AnnotationEditorParamsType.INK_COLOR,
                value: "#ff0000",
              })
            }}
            icon={(isInkMode() && <BsPenFill />) || <BsPen />}
          />
        </Tooltip>
        <Divider orientation="vertical" h="24px" />

        <ButtonGroup colorScheme="neutral" attached>
          <Tooltip withArrow label={t("home.preview.pdf.zoom_out")}>
            <IconButton
              size="sm"
              aria-label={t("home.preview.pdf.zoom_out")}
              disabled={!props.store.pdfSlick || props.store.scale <= 0.25}
              onClick={() => props.store.pdfSlick?.viewer?.decreaseScale()}
              icon={<VsZoomOut />}
            />
          </Tooltip>
          <Menu motionPreset="scale-bottom-left">
            <MenuTrigger as={Button} size="sm" minW="60px">
              <Text size="sm">
                {props.store.pdfSlick
                  ? getCurrentZoomLabel()
                  : t("home.preview.pdf.loading")}
              </Text>
            </MenuTrigger>
            <MenuContent>
              <MenuGroup>
                <MenuLabel>{t("home.preview.pdf.zoom_presets")}</MenuLabel>
                <For each={zoomPresets}>
                  {(item) => (
                    <MenuItem onSelect={() => handleZoomPreset(item[0])}>
                      {item[1]}
                    </MenuItem>
                  )}
                </For>
              </MenuGroup>
              <Divider role="presentation" my="$1" />
              <MenuGroup>
                <MenuLabel>{t("home.preview.pdf.zoom_levels")}</MenuLabel>
                <For each={zoomLevels}>
                  {(item) => (
                    <MenuItem onSelect={() => handleZoomLevel(item[0])}>
                      {item[1]}
                    </MenuItem>
                  )}
                </For>
              </MenuGroup>
            </MenuContent>
          </Menu>
          <Tooltip withArrow label={t("home.preview.pdf.zoom_in")}>
            <IconButton
              size="sm"
              aria-label={t("home.preview.pdf.zoom_in")}
              disabled={!props.store.pdfSlick || props.store.scale >= 5}
              onClick={() => props.store.pdfSlick?.viewer?.increaseScale()}
              icon={<VsZoomIn />}
            />
          </Tooltip>
        </ButtonGroup>
        <Divider orientation="vertical" h="24px" />
        <HStack spacing="$2" alignItems="center">
          <form onSubmit={props.onPageNumberSubmit}>
            <Input
              size="sm"
              ref={pageNumberRef}
              type="text"
              value={props.wantedPageNumber()}
              w="50px"
              textAlign="center"
              onFocus={() => pageNumberRef!.select()}
              onChange={(e) => props.onPageNumberChange(e.currentTarget.value)}
            />
          </form>
          <Text size="sm" minW="$full">
            / {props.store.numPages}
          </Text>
        </HStack>
        <Tooltip withArrow label={t("home.preview.pdf.prev_page")}>
          <IconButton
            size="sm"
            aria-label={t("home.preview.pdf.prev_page")}
            colorScheme="neutral"
            disabled={props.store.pageNumber <= 1}
            onClick={() => props.store.pdfSlick?.viewer?.previousPage()}
            icon={<VsChevronUp />}
          />
        </Tooltip>
        <Tooltip withArrow label={t("home.preview.pdf.next_page")}>
          <IconButton
            size="sm"
            aria-label={t("home.preview.pdf.next_page")}
            colorScheme="neutral"
            disabled={
              !props.store.pdfSlick ||
              props.store.pageNumber >= props.store.numPages
            }
            onClick={() => props.store.pdfSlick?.viewer?.nextPage()}
            icon={<VsChevronDown />}
          />
        </Tooltip>
      </HStack>
    </Box>
  )
}

export default PDFViewerApp
