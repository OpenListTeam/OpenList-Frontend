import {
  Box,
  Center,
  Flex,
  HStack,
  IconButton,
  Spacer,
  Text,
  Tooltip,
  VStack,
} from "@hope-ui/solid"
import {
  BsArrowClockwise,
  BsArrowCounterclockwise,
  BsInfoCircle,
  BsZoomIn,
  BsZoomOut,
} from "solid-icons/bs"
import { FaSolidAngleLeft, FaSolidAngleRight } from "solid-icons/fa"
import {
  TbArrowAutofitHeight,
  TbArrowAutofitWidth,
  TbArrowAutofitContent,
} from "solid-icons/tb"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import {
  BoxWithFullScreen,
  ImageWithError,
  FullLoading,
  Error,
} from "~/components"
import { useRouter, useT } from "~/hooks"
import { objStore } from "~/store"
import { Obj, ObjType } from "~/types"
import { ext, formatDate, getFileSize } from "~/utils"

const HEIF_EXTS = new Set(["heic", "heif", "avif", "vvc", "avc"])
const isHeif = (name: string) => HEIF_EXTS.has(ext(name).toLowerCase())
const ZOOM_MIN = 0.1
const ZOOM_MAX = 10
const ZOOM_WHEEL_FACTOR = 1.08
const ZOOM_BTN_STEP = 0.25

const addSizeParam = (url: string, size: number) => {
  if (!url) return url
  return url + (url.includes("?") ? "&" : "?") + `size=${size}`
}

interface PreviewProps {
  images?: Obj[]
  navigate?: (name: string) => void
}

// ── Preview ─────────────────────────────────────────────────────────
const Preview = (props: PreviewProps) => {
  const t = useT()
  const { replace } = useRouter()

  const [scale, setScale] = createSignal(1)
  const [rotation, setRotation] = createSignal(0)
  const [fitMode, setFitMode] = createSignal<"contain" | "height" | "width">(
    "contain",
  )
  const [tx, setTx] = createSignal(0)
  const [ty, setTy] = createSignal(0)
  const [dragging, setDragging] = createSignal(false)
  const [showInfo, setShowInfo] = createSignal(false)
  const [imgSize, setImgSize] = createSignal({ w: 0, h: 0 })
  const [isFullscreen, setIsFullscreen] = createSignal(false)

  let containerRef!: HTMLDivElement
  let areaRef!: HTMLDivElement
  let dragOX = 0
  let dragOY = 0
  let startTx = 0
  let startTy = 0

  let images =
    props.images ||
    objStore.objs.filter((o) => o.type === ObjType.IMAGE || isHeif(o.name))
  if (images.length === 0) images = [objStore.obj]

  const curIdx = () => images.findIndex((f) => f.name === objStore.obj.name)

  // ── reset on image change ──
  createEffect(() => {
    objStore.obj.name
    setScale(1)
    setRotation(0)
    setTx(0)
    setTy(0)
    setImgSize({ w: 0, h: 0 })
  })

  // ── navigation ──
  const goTo = (obj: Obj) => {
    if (props.navigate) props.navigate(obj.name)
    else replace(obj.name)
  }
  const prev = () => {
    const i = curIdx()
    if (i > 0) goTo(images[i - 1])
  }
  const next = () => {
    const i = curIdx()
    if (i < images.length - 1) goTo(images[i + 1])
  }

  // ── transforms ──
  const resetTransform = () => {
    setScale(1)
    setRotation(0)
    setTx(0)
    setTy(0)
  }
  const zoomIn = () => setScale((s) => Math.min(s + ZOOM_BTN_STEP, ZOOM_MAX))
  const zoomOut = () => setScale((s) => Math.max(s - ZOOM_BTN_STEP, ZOOM_MIN))
  const rotL = () => setRotation((r) => r - 90)
  const rotR = () => setRotation((r) => r + 90)
  const fitPage = () => {
    setFitMode("contain")
    setScale(1)
    setTx(0)
    setTy(0)
  }
  const fitHeight = () => {
    setFitMode("height")
    setScale(1)
    setTx(0)
    setTy(0)
  }
  const fitWidth = () => {
    setFitMode("width")
    setScale(1)
    setTx(0)
    setTy(0)
  }

  // ── wheel zoom (towards cursor) ──
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const rect = areaRef.getBoundingClientRect()
    const cx = e.clientX - rect.left - rect.width / 2
    const cy = e.clientY - rect.top - rect.height / 2
    const oldS = scale()
    const factor = e.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR
    const newS = Math.min(Math.max(oldS * factor, ZOOM_MIN), ZOOM_MAX)
    const r = newS / oldS
    setTx(cx - r * (cx - tx()))
    setTy(cy - r * (cy - ty()))
    setScale(newS)
  }

  // ── drag ──
  const onMouseDown = (e: MouseEvent) => {
    if (scale() <= 1 || e.button !== 0) return
    e.preventDefault()
    setDragging(true)
    dragOX = e.clientX
    dragOY = e.clientY
    startTx = tx()
    startTy = ty()
  }
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging()) return
    setTx(startTx + (e.clientX - dragOX))
    setTy(startTy + (e.clientY - dragOY))
  }
  const onMouseUp = () => setDragging(false)
  const onDblClick = () => (scale() === 1 ? setScale(2) : resetTransform())

  // ── image load ──
  const onImgLoad = (e: Event) => {
    const img = e.target as HTMLImageElement
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
  }
  const imgSrc = () =>
    isHeif(objStore.obj.name) && objStore.obj.thumb
      ? addSizeParam(objStore.obj.thumb, 1024)
      : objStore.raw_url

  // ── keyboard ──
  const onKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowLeft":
        return prev()
      case "ArrowRight":
        return next()
      case "+":
      case "=":
        return zoomIn()
      case "-":
        return zoomOut()
      case "r":
        return rotL()
      case "R":
        return rotR()
      case "0":
        return resetTransform()
      case "i":
        return setShowInfo((v) => !v)
      case "c":
        return fitPage()
      case "h":
        return fitHeight()
      case "w":
        return fitWidth()
      case "f":
      // TODO toggleFs()
    }
  }

  // ── fullscreen detection ──
  const updateFullscreen = () => {
    const native = !!document.fullscreenElement
    setIsFullscreen(native)
  }

  onMount(() => {
    window.addEventListener("keydown", onKey)
    areaRef?.addEventListener("wheel", onWheel, { passive: false })
    document.addEventListener("fullscreenchange", updateFullscreen)
    updateFullscreen()
  })
  onCleanup(() => {
    window.removeEventListener("keydown", onKey)
    areaRef?.removeEventListener("wheel", onWheel)
    document.removeEventListener("fullscreenchange", updateFullscreen)
  })

  const imgTransform = () =>
    `translate(${tx()}px,${ty()}px) scale(${scale()}) rotate(${rotation()}deg)`
  const cursor = () =>
    scale() > 1 ? (dragging() ? "grabbing" : "grab") : "default"

  // ── render ──────────────────────────────────────────────────────
  return (
    <BoxWithFullScreen w="$full" h="70vh">
      <VStack ref={containerRef} w="$full" h="$full">
        {/* ── Toolbar ── */}
        <Flex
          w="$full"
          bg="$neutral1"
          p="$2"
          position={isFullscreen() ? "absolute" : "relative"}
          top={isFullscreen() ? "0" : undefined}
          left={isFullscreen() ? "0" : undefined}
          zIndex="$docked"
          transition="opacity 0.3s ease"
          opacity={isFullscreen() ? "0.7" : undefined}
          _hover={{ opacity: isFullscreen() ? "1" : undefined }}
        >
          <HStack spacing="$1">
            <Show when={curIdx() > 0}>
              <Tooltip label="Previous (←)">
                <IconButton
                  icon={<FaSolidAngleLeft />}
                  aria-label="Previous"
                  variant="ghost"
                  size="sm"
                  onClick={prev}
                />
              </Tooltip>
            </Show>
            <Show when={curIdx() < images.length - 1}>
              <Tooltip label="Next (→)">
                <IconButton
                  icon={<FaSolidAngleRight />}
                  aria-label="Next"
                  variant="ghost"
                  size="sm"
                  onClick={next}
                />
              </Tooltip>
            </Show>
            <Text
              size="sm"
              maxW="280px"
              overflow="hidden"
              ml="$1"
              css={{
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
              }}
              display={{ "@initial": "none", "@sm": "block" }}
            >
              {objStore.obj.name}
            </Text>
            <Show when={images.length > 1}>
              <Text color="$neutral11" size="xs">
                {curIdx() + 1}/{images.length}
              </Text>
            </Show>
          </HStack>
          <Spacer />
          <HStack spacing="$1">
            <Tooltip label="Info (I)">
              <IconButton
                icon={<BsInfoCircle />}
                aria-label="Info"
                variant={showInfo() ? "subtle" : "ghost"}
                size="sm"
                onClick={() => setShowInfo((v) => !v)}
              />
            </Tooltip>

            <Tooltip label="Zoom out (−)">
              <IconButton
                icon={<BsZoomOut />}
                aria-label="Zoom out"
                variant="ghost"
                size="sm"
                onClick={zoomOut}
              />
            </Tooltip>
            <Tooltip label="Zoom in (+)">
              <IconButton
                icon={<BsZoomIn />}
                aria-label="Zoom in"
                variant="ghost"
                size="sm"
                onClick={zoomIn}
              />
            </Tooltip>
            <Tooltip label="Fit page (C)">
              <IconButton
                icon={<TbArrowAutofitContent />}
                aria-label="Fit page"
                variant="ghost"
                size="sm"
                onClick={fitPage}
              />
            </Tooltip>
            <Tooltip label="Fit height (H)">
              <IconButton
                icon={<TbArrowAutofitHeight />}
                aria-label="Fit height"
                variant="ghost"
                size="sm"
                onClick={fitHeight}
              />
            </Tooltip>
            <Tooltip label="Fit width (W)">
              <IconButton
                icon={<TbArrowAutofitWidth />}
                aria-label="Fit width"
                variant="ghost"
                size="sm"
                onClick={fitWidth}
              />
            </Tooltip>
            <Tooltip label="Rotate left (R)">
              <IconButton
                icon={<BsArrowCounterclockwise />}
                aria-label="Rotate left"
                variant="ghost"
                size="sm"
                onClick={rotL}
              />
            </Tooltip>
            <Tooltip label="Rotate right (Shift+R)">
              <IconButton
                icon={<BsArrowClockwise />}
                aria-label="Rotate right"
                variant="ghost"
                size="sm"
                onClick={rotR}
              />
            </Tooltip>
          </HStack>
        </Flex>

        {/* ── Image area ── */}
        <Center
          ref={areaRef}
          w="$full"
          h={isFullscreen() ? "$full" : undefined}
          flex="1"
          backgroundColor="$neutral2"
          overflow="hidden"
          cursor={cursor()}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onDblClick={onDblClick}
        >
          <Center
            {...(fitMode() === "contain"
              ? { w: "$full", h: "$full" }
              : {
                  css:
                    fitMode() === "height"
                      ? { height: "100%", width: "fit-content" }
                      : { width: "100%", height: "fit-content" },
                })}
            transform={imgTransform()}
            transition={dragging() ? "none" : "transform 0.15s ease"}
            transform-origin="center center"
          >
            <ImageWithError
              src={imgSrc()}
              fallback={<FullLoading />}
              fallbackErr={<Error msg={t("home.preview.failed_load_img")} />}
              onLoad={onImgLoad}
              {...(fitMode() === "contain"
                ? { w: "$full", h: "$full", objectFit: "contain" }
                : {
                    css:
                      fitMode() === "height"
                        ? {
                            height: "100%",
                            width: "auto",
                            "max-width": "none",
                          }
                        : {
                            width: "100%",
                            height: "auto",
                            "max-height": "none",
                          },
                  })}
            />
          </Center>

          {/* ── Info overlay ── */}
          <Show when={showInfo()}>
            <Box
              position="absolute"
              bottom="$2"
              left="$2"
              p="$2"
              bg="$blackAlpha9"
              borderRadius="$md"
              zIndex="$docked"
              fontSize="$sm"
              css={{
                "backdrop-filter": "blur(8px)",
              }}
            >
              <Text color="$whiteAlpha12" fontWeight="$semibold">
                {objStore.obj.name}
              </Text>
              <Text color="$whiteAlpha11">
                {getFileSize(objStore.obj.size)}
              </Text>
              <Show when={imgSize().w > 0}>
                <Text color="$whiteAlpha11">
                  {imgSize().w} × {imgSize().h}px
                </Text>
              </Show>
              <Text color="$whiteAlpha11">
                {formatDate(objStore.obj.modified)}
              </Text>
            </Box>
          </Show>
        </Center>
      </VStack>
    </BoxWithFullScreen>
  )
}

export default Preview
