import { BoxWithFullScreen } from "~/components"
import { usePDFSlick } from "@pdfslick/solid"
import { objStore } from "~/store"
import "@pdfslick/solid/dist/pdf_viewer.css"
import {
  Button,
  Divider,
  HStack,
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
} from "@hope-ui/solid"
import { createSignal, createEffect, onCleanup } from "solid-js"
import { VsChevronUp, VsChevronDown, VsAdd, VsRemove } from "solid-icons/vs"

const PDFViewerApp = () => {
  const {
    viewerRef,
    pdfSlickStore: store,
    PDFSlickViewer,
  } = usePDFSlick(objStore.raw_url)

  let pageNumberRef!: HTMLInputElement
  const [wantedPageNumber, setWantedPageNumber] = createSignal<number | string>(
    1,
  )

  const presets = new Map([
    ["auto", "Auto"],
    ["page-actual", "Actual Size"],
    ["page-fit", "Page Fit"],
    ["page-width", "Page Width"],
  ])

  const zoomVals = new Map([
    [0.5, "50%"],
    [0.75, "75%"],
    [1, "100%"],
    [1.25, "125%"],
    [1.5, "150%"],
    [2, "200%"],
  ])

  const getCurrentZoomLabel = () => {
    if (store.scaleValue && presets.has(store.scaleValue)) {
      return presets.get(store.scaleValue)
    }
    return `${Math.floor(store.scale * 100)}%`
  }

  const updatePageNumber = ({ pageNumber }: any) =>
    setWantedPageNumber(pageNumber)

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

  const handlePageNumberKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "Down":
      case "ArrowDown":
        store.pdfSlick?.gotoPage(Math.max(1, (store.pageNumber ?? 0) - 1))
        break
      case "Up":
      case "ArrowUp":
        store.pdfSlick?.gotoPage(
          Math.min(store.numPages ?? 0, (store.pageNumber ?? 0) + 1),
        )
        break
      default:
        return
    }
  }

  createEffect(() => {
    store.pdfSlick && store.pdfSlick?.on("pagechanging", updatePageNumber)
  })

  onCleanup(() => {
    store.pdfSlick?.off("pagechanging", updatePageNumber)
  })

  return (
    <BoxWithFullScreen w="$full" h="70vh" pos="relative">
      {/* toolbar */}
      <HStack
        bottom="$2"
        // center
        left="50%"
        transform="translateX(-50%)"
        spacing="$4"
        w="auto"
        pos="absolute"
        bgColor="$neutral1"
        p="$2"
        rounded="$lg"
        // top
        zIndex="999"
      >
        {/* Zoom */}
        <ButtonGroup colorScheme="neutral" attached>
          <IconButton
            size="sm"
            aria-label="Zoom Out"
            disabled={!store.pdfSlick || store.scale <= 0.25}
            onClick={() => store.pdfSlick?.viewer?.decreaseScale()}
            icon={<VsRemove />}
          />

          <Menu>
            <MenuTrigger as={Button} size="sm" minW="60px">
              <Text size="sm">
                {store.pdfSlick ? getCurrentZoomLabel() : "Loading..."}
              </Text>
            </MenuTrigger>
            <MenuContent>
              <MenuGroup>
                <MenuLabel>Zoom Presets</MenuLabel>
                {Array.from(presets.entries()).map(([value, label]) => (
                  <MenuItem
                    onSelect={() => {
                      if (store.pdfSlick) {
                        store.pdfSlick.currentScaleValue = value
                      }
                    }}
                  >
                    {label}
                  </MenuItem>
                ))}
              </MenuGroup>
              <Divider role="presentation" my="$1" />
              <MenuGroup>
                <MenuLabel>Zoom Levels</MenuLabel>
                {Array.from(zoomVals.entries()).map(([value, label]) => (
                  <MenuItem
                    onSelect={() => {
                      if (store.pdfSlick) {
                        store.pdfSlick.currentScale = value
                      }
                    }}
                  >
                    {label}
                  </MenuItem>
                ))}
              </MenuGroup>
            </MenuContent>
          </Menu>

          <IconButton
            size="sm"
            aria-label="Zoom In"
            disabled={!store.pdfSlick || store.scale >= 5}
            onClick={() => store.pdfSlick?.viewer?.increaseScale()}
            icon={<VsAdd />}
          />
        </ButtonGroup>

        <Divider orientation="vertical" h="24px" />

        {/* Page */}
        <HStack spacing="$2" alignItems="center">
          <form onSubmit={handlePageNumberSubmit}>
            <Input
              size="sm"
              ref={pageNumberRef}
              type="text"
              value={wantedPageNumber()}
              width="60px"
              textAlign="center"
              onFocus={() => pageNumberRef!.select()}
              onChange={(e) => setWantedPageNumber(e.currentTarget.value)}
              onKeyDown={handlePageNumberKeyDown}
            />
          </form>
          <Text size="sm">/ {store.numPages}</Text>
        </HStack>

        <IconButton
          size="sm"
          aria-label="Previous Page"
          colorScheme="neutral"
          disabled={store.pageNumber <= 1}
          onClick={() => store.pdfSlick?.viewer?.previousPage()}
          icon={<VsChevronUp />}
        />

        <IconButton
          size="sm"
          aria-label="Next Page"
          colorScheme="neutral"
          disabled={!store.pdfSlick || store.pageNumber >= store.numPages}
          onClick={() => store.pdfSlick?.viewer?.nextPage()}
          icon={<VsChevronDown />}
        />
      </HStack>
      <PDFSlickViewer {...{ store, viewerRef }} />
    </BoxWithFullScreen>
  )
}

export default PDFViewerApp
