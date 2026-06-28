import { useFetch, useT, useManageTitle } from "~/hooks"
import { Group, SettingItem, PResp } from "~/types"
import { r, notify, getTarget, handleResp } from "~/utils"
import { createStore } from "solid-js/store"
import {
  Button,
  HStack,
  VStack,
  Box,
  Text,
  Heading,
  Badge,
  Input,
  IconButton,
  Textarea,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverBody,
} from "@hope-ui/solid"
import { createSignal, For, Show } from "solid-js"
import { Item } from "./SettingItem"
import { ResponsiveGrid } from "../common/ResponsiveGrid"
import { setSettings as renewSettings } from "~/store"
import {
  HiOutlinePlus,
  HiOutlineTrash,
  HiOutlineChevronUp,
  HiOutlineChevronDown,
} from "solid-icons/hi"

interface WopiViewerInfo {
  service_name: string
  display_name: string
  icon: string
  actions: Record<string, string>
}

interface WopiService {
  name: string
  endpoint: string
  external_url?: string
  viewers?: Record<string, WopiViewerInfo>
}

function parseDiscoveryXml(xmlStr: string): Record<string, WopiViewerInfo> {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlStr, "text/xml")
  if (doc.querySelector("parsererror")) throw new Error("Invalid XML")
  const result: Record<string, WopiViewerInfo> = {}
  for (const app of doc.querySelectorAll("app")) {
    const appName = app.getAttribute("name") || ""
    const favIcon = app.getAttribute("favIconUrl") || ""
    const extActions: Record<string, Record<string, string>> = {}
    for (const action of app.querySelectorAll("action")) {
      const name = action.getAttribute("name") || ""
      const ext = action.getAttribute("ext") || ""
      const urlsrc = action.getAttribute("urlsrc") || ""
      if (!ext || !urlsrc) continue
      // Store only base URL (before ?), frontend builds final URL with params
      const baseUrl = urlsrc.split("?")[0]
      if (!extActions[ext]) extActions[ext] = {}
      if (name === "embedview") extActions[ext]["view"] = baseUrl
      else if (name === "view" && !extActions[ext]["view"])
        extActions[ext]["view"] = baseUrl
      else if (name === "edit") extActions[ext]["edit"] = baseUrl
    }
    for (const ext of Object.keys(extActions)) {
      if (!result[ext])
        result[ext] = {
          service_name: "",
          display_name: appName,
          icon: favIcon,
          actions: extActions[ext],
        }
    }
  }
  return result
}

function applyViewers(svc: WopiService, xml: string): WopiService {
  const viewers = parseDiscoveryXml(xml)
  for (const ext of Object.keys(viewers)) viewers[ext].service_name = svc.name
  return { ...svc, viewers }
}

const MAX_INLINE_EXTS = 10

const ExtBadges = (props: { viewers: Record<string, WopiViewerInfo> }) => {
  const exts = () => Object.keys(props.viewers)
  const shown = () => exts().slice(0, MAX_INLINE_EXTS)
  const remaining = () => exts().length - MAX_INLINE_EXTS

  return (
    <HStack mt="$2" spacing="$1" flexWrap="wrap" alignItems="center">
      <Badge colorScheme="success">{exts().length} exts</Badge>
      <For each={shown()}>
        {(ext) => <Badge colorScheme="neutral">.{ext}</Badge>}
      </For>
      <Show when={remaining() > 0}>
        <Popover placement="bottom-start">
          <PopoverTrigger
            as={Badge}
            colorScheme="info"
            cursor="pointer"
            _hover={{ opacity: 0.8 }}
          >
            +{remaining()} more
          </PopoverTrigger>
          <PopoverContent w="auto" maxW="400px">
            <PopoverArrow />
            <PopoverBody>
              <HStack spacing="$1" flexWrap="wrap" p="$1">
                <For each={exts()}>
                  {(ext) => (
                    <Badge colorScheme="neutral" fontSize="$xs">
                      .{ext}
                    </Badge>
                  )}
                </For>
              </HStack>
            </PopoverBody>
          </PopoverContent>
        </Popover>
      </Show>
    </HStack>
  )
}

const WopiSettings = () => {
  const t = useT()
  useManageTitle("manage.sidemenu.wopi")

  const [settingsLoading, getSettings] = useFetch(
    (): PResp<SettingItem[]> =>
      r.get(`/admin/setting/list?group=${Group.PREVIEW}`),
  )
  const [settings, setSettings] = createStore<SettingItem[]>([])
  const [services, setServices] = createStore<WopiService[]>([])
  const [saveLoading, setSaveLoading] = createSignal(false)
  // Per-service state
  const [importingIdx, setImportingIdx] = createSignal<number>(-1)
  const [manualXml, setManualXml] = createSignal<Record<number, string>>({})
  const [showManual, setShowManual] = createSignal<Record<number, boolean>>({})

  const refresh = async () => {
    const resp = await getSettings()
    handleResp<SettingItem[]>(resp, (items) => {
      setSettings(items)
      const svc = items.find((i) => i.key === "wopi_services")
      if (svc?.value) {
        try {
          setServices(JSON.parse(svc.value))
        } catch {
          setServices([])
        }
      }
    })
  }
  refresh()

  const getWopiSetting = (key: string) => settings.find((i) => i.key === key)
  const updateWopiSetting = (key: string, value: string) =>
    setSettings((i) => i.key === key, "value", value)
  const addService = () =>
    setServices(services.length, { name: "", endpoint: "" })
  const removeService = (i: number) =>
    setServices((prev) => prev.filter((_, idx) => idx !== i))
  const updateService = (
    i: number,
    field: "name" | "endpoint" | "external_url",
    val: string,
  ) => setServices(i, field, val)

  const moveService = (i: number, direction: -1 | 1) => {
    const target = i + direction
    if (target < 0 || target >= services.length) return
    const arr = [...services]
    ;[arr[i], arr[target]] = [arr[target], arr[i]]
    setServices(arr)
  }

  const saveSettings = async () => {
    updateWopiSetting("wopi_services", JSON.stringify(services))
    const keys = ["wopi_enabled", "wopi_services", "wopi_max_file_size"]
    return r.post(
      "/admin/setting/save",
      getTarget(settings.filter((i) => keys.includes(i.key))),
    ) as any
  }

  const handleSave = async () => {
    setSaveLoading(true)
    const resp = await saveSettings()
    setSaveLoading(false)
    handleResp(resp, () => {
      notify.success(t("global.save_success"))
      renewSettings(getTarget(settings))
    })
  }

  // Import discovery for a single service by index
  const handleImportOne = async (idx: number) => {
    const svc = services[idx]
    if (!svc.name.trim()) {
      notify.error("Service name cannot be empty")
      return
    }
    if (!svc.endpoint.trim()) {
      notify.error("Endpoint URL cannot be empty")
      return
    }

    setImportingIdx(idx)
    try {
      const resp = await fetch(svc.endpoint)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const xml = await resp.text()
      setServices(idx, applyViewers(svc, xml))
      setShowManual((prev) => ({ ...prev, [idx]: false }))
      // Auto-save
      const saveResp = await saveSettings()
      handleResp(saveResp, () => renewSettings(getTarget(settings)))
      notify.success(
        `Imported ${Object.keys(services[idx].viewers || {}).length} extensions`,
      )
    } catch {
      // CORS blocked — show manual paste
      setShowManual((prev) => ({ ...prev, [idx]: true }))
      notify.warning("CORS blocked. Paste the discovery XML manually below.")
    } finally {
      setImportingIdx(-1)
    }
  }

  // Parse manually pasted XML for a single service
  const handleParseManual = async (idx: number) => {
    const xml = manualXml()[idx]
    if (!xml?.trim()) {
      notify.error("Please paste the discovery XML first")
      return
    }
    try {
      setServices(idx, applyViewers(services[idx], xml))
      setManualXml((prev) => ({ ...prev, [idx]: "" }))
      setShowManual((prev) => ({ ...prev, [idx]: false }))
      const saveResp = await saveSettings()
      handleResp(saveResp, () => renewSettings(getTarget(settings)))
      notify.success(
        `Parsed ${Object.keys(services[idx].viewers || {}).length} extensions`,
      )
    } catch (e: any) {
      notify.error(`Failed to parse XML: ${e.message}`)
    }
  }

  return (
    <VStack w="$full" alignItems="start" spacing="$4">
      <ResponsiveGrid>
        <Show when={getWopiSetting("wopi_enabled")}>
          <Item
            {...getWopiSetting("wopi_enabled")!}
            onChange={(val) => updateWopiSetting("wopi_enabled", val)}
          />
        </Show>
        <Show when={getWopiSetting("wopi_max_file_size")}>
          <Item
            {...getWopiSetting("wopi_max_file_size")!}
            onChange={(val) => updateWopiSetting("wopi_max_file_size", val)}
          />
        </Show>
      </ResponsiveGrid>

      <Box w="$full">
        <HStack mb="$2" justifyContent="space-between">
          <Heading size="sm">WOPI Services</Heading>
          <Button size="sm" leftIcon={<HiOutlinePlus />} onClick={addService}>
            Add Service
          </Button>
        </HStack>

        <VStack w="$full" spacing="$3">
          <For each={services}>
            {(svc, index) => (
              <Box
                w="$full"
                p="$3"
                border="1px solid"
                borderColor="$neutral6"
                rounded="$md"
              >
                {/* Row 1: Name + Reorder + Delete */}
                <HStack spacing="$2" mb="$2">
                  <Input
                    placeholder="Service name (e.g. Collabora Online)"
                    value={svc.name}
                    onInput={(e) =>
                      updateService(index(), "name", e.currentTarget.value)
                    }
                    flex={1}
                  />
                  <IconButton
                    aria-label="Move up"
                    icon={<HiOutlineChevronUp />}
                    size="sm"
                    variant="ghost"
                    onClick={() => moveService(index(), -1)}
                    disabled={index() === 0}
                  />
                  <IconButton
                    aria-label="Move down"
                    icon={<HiOutlineChevronDown />}
                    size="sm"
                    variant="ghost"
                    onClick={() => moveService(index(), 1)}
                    disabled={index() === services.length - 1}
                  />
                  <IconButton
                    aria-label="Remove"
                    icon={<HiOutlineTrash />}
                    size="sm"
                    colorScheme="danger"
                    variant="ghost"
                    onClick={() => removeService(index())}
                  />
                </HStack>

                {/* Row 2: Discovery URL + Import */}
                <HStack spacing="$2" mb="$2">
                  <Input
                    placeholder="Discovery URL (e.g. https://collabora.example.com/hosting/discovery)"
                    value={svc.endpoint}
                    onInput={(e) =>
                      updateService(index(), "endpoint", e.currentTarget.value)
                    }
                    size="sm"
                    flex={1}
                  />
                  <Button
                    size="sm"
                    colorScheme="accent"
                    loading={importingIdx() === index()}
                    onClick={() => handleImportOne(index())}
                    minW="80px"
                  >
                    Import
                  </Button>
                </HStack>

                {/* Row 3: External URL */}
                <Input
                  placeholder="External URL (optional, e.g. http://192.168.1.100:8080)"
                  value={svc.external_url || ""}
                  onInput={(e) =>
                    updateService(
                      index(),
                      "external_url",
                      e.currentTarget.value,
                    )
                  }
                  size="sm"
                />

                {/* Supported extensions (Popover for overflow) */}
                <Show
                  when={svc.viewers && Object.keys(svc.viewers!).length > 0}
                >
                  <ExtBadges viewers={svc.viewers!} />
                </Show>

                {/* Manual XML paste (CORS fallback) */}
                <Show when={showManual()[index()]}>
                  <Box mt="$3" p="$3" bg="$warning3" rounded="$md">
                    <Text fontSize="$sm" mb="$2">
                      CORS blocked. Open "view-source:{svc.endpoint}" in a new
                      tab, copy all, paste below:
                    </Text>
                    <Textarea
                      placeholder="Paste discovery XML here..."
                      value={manualXml()[index()] || ""}
                      onChange={(e) =>
                        setManualXml((prev) => ({
                          ...prev,
                          [index()]: e.currentTarget.value,
                        }))
                      }
                      minH="100px"
                      fontFamily="monospace"
                      fontSize="$xs"
                      mb="$2"
                    />
                    <Button
                      size="sm"
                      colorScheme="warning"
                      onClick={() => handleParseManual(index())}
                    >
                      Parse XML
                    </Button>
                  </Box>
                </Show>
              </Box>
            )}
          </For>

          <Show when={services.length === 0}>
            <Box
              w="$full"
              p="$6"
              border="1px dashed"
              borderColor="$neutral6"
              rounded="$md"
              textAlign="center"
            >
              <Text color="$neutral11">
                No WOPI services configured. Click "Add Service" to add one.
              </Text>
            </Box>
          </Show>
        </VStack>
      </Box>

      <HStack spacing="$2">
        <Button
          colorScheme="accent"
          onClick={refresh}
          loading={settingsLoading()}
        >
          {t("global.refresh")}
        </Button>
        <Button loading={saveLoading()} onClick={handleSave}>
          {t("global.save")}
        </Button>
      </HStack>
    </VStack>
  )
}

export default WopiSettings
