import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Heading,
  Input,
  Select,
  SelectContent,
  SelectIcon,
  SelectListbox,
  SelectOption,
  SelectOptionIndicator,
  SelectOptionText,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
  Text,
  VStack,
} from "@hope-ui/solid"
import { Show, createSignal, onMount } from "solid-js"
import { useT } from "~/hooks"
import type { MediaConfig } from "~/types"
import { notify } from "~/utils"
import { adminGetMediaConfigs, adminSaveMediaConfig } from "~/utils/media_api"

interface ThumbnailSettingsProps {
  mediaType: "image" | "book"
}

interface ScraperConfig {
  store_thumbnail?: string
  thumbnail_mode?: string
  thumbnail_path?: string
  [key: string]: string | undefined
}

/**
 * 图片 / 书籍类型独立的缩略图设置。
 * 配置写入 MediaConfig.scraper_config，后端刮削时优先读取；
 * 未配置时回落到「媒体设置」里的全局缩略图设置。
 */
export const ThumbnailSettings = (props: ThumbnailSettingsProps) => {
  const t = useT()
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [cfg, setCfg] = createSignal<MediaConfig | null>(null)
  const [storeThumbnail, setStoreThumbnail] = createSignal(false)
  const [mode, setMode] = createSignal<"base64" | "runtime" | "local">(
    "runtime",
  )
  const [path, setPath] = createSignal("/imgs")

  const parse = (raw?: string): ScraperConfig => {
    if (!raw) return {}
    try {
      const obj = JSON.parse(raw)
      return obj && typeof obj === "object" ? obj : {}
    } catch {
      return {}
    }
  }

  const load = async () => {
    setLoading(true)
    const resp = await adminGetMediaConfigs()
    if (resp.code === 200) {
      const found = (resp.data as MediaConfig[]).find(
        (c) => c.media_type === props.mediaType,
      )
      if (found) {
        setCfg(found)
        const sc = parse(found.scraper_config)
        setStoreThumbnail(sc.store_thumbnail === "true")
        setMode(
          sc.thumbnail_mode === "local" || sc.thumbnail_mode === "base64"
            ? sc.thumbnail_mode
            : "runtime",
        )
        setPath(sc.thumbnail_path || "/imgs")
      }
    }
    setLoading(false)
  }
  onMount(load)

  const save = async () => {
    const current = cfg()
    if (!current) {
      notify.error(t("manage.media_lib.thumb_config_missing"))
      return
    }
    setSaving(true)
    const sc = parse(current.scraper_config)
    if (props.mediaType === "image") {
      sc.store_thumbnail = storeThumbnail() ? "true" : "false"
    }
    sc.thumbnail_mode = mode()
    sc.thumbnail_path = path()
    const resp = await adminSaveMediaConfig({
      ...current,
      scraper_config: JSON.stringify(sc),
    })
    setSaving(false)
    if (resp.code === 200) {
      notify.success(t("manage.media_lib.thumb_saved"))
      await load()
    } else {
      notify.error(
        t("manage.media_lib.thumb_save_failed") + ": " + resp.message,
      )
    }
  }

  return (
    <Box bgColor="$neutral1" rounded="$lg" border="1px solid $neutral4">
      <HStack
        px="$4"
        py="$3"
        borderBottom="1px solid $neutral4"
        justifyContent="space-between"
        alignItems="center"
      >
        <VStack alignItems="flex-start" spacing="2px">
          <Heading size="sm">
            {props.mediaType === "image"
              ? t("manage.media_lib.thumb_image_title")
              : t("manage.media_lib.thumb_book_title")}
          </Heading>
          <Text fontSize="$xs" color="$neutral11">
            {t("manage.media_lib.thumb_scope", {
              type:
                props.mediaType === "image"
                  ? t("manage.media_lib.type_image")
                  : t("manage.media_lib.type_book"),
            })}
          </Text>
        </VStack>
        <Button colorScheme="accent" loading={saving()} onClick={save}>
          {t("manage.media_lib.save")}
        </Button>
      </HStack>

      <Show
        when={!loading()}
        fallback={
          <HStack justifyContent="center" py="$8">
            <Spinner />
          </HStack>
        }
      >
        <VStack spacing="$4" alignItems="stretch" p="$4">
          <Show when={props.mediaType === "image"}>
            <FormControl display="flex" alignItems="center" gap="$2" w="auto">
              <FormLabel m="0">{t("manage.media_lib.thumb_store")}</FormLabel>
              <Switch
                checked={storeThumbnail()}
                onChange={(e) => setStoreThumbnail(e.currentTarget.checked)}
              />
              <FormHelperText m="0">
                {t("manage.media_lib.thumb_store_tips")}
              </FormHelperText>
            </FormControl>
          </Show>

          <FormControl>
            <FormLabel>{t("manage.media_lib.thumb_mode")}</FormLabel>
            <Select
              value={mode()}
              onChange={(v) => setMode(v as "base64" | "local")}
            >
              <SelectTrigger>
                <SelectValue />
                <SelectIcon />
              </SelectTrigger>
              <SelectContent>
                <SelectListbox>
                  <SelectOption value="base64">
                    <SelectOptionText>
                      {t("manage.media_lib.mode_base64")}
                    </SelectOptionText>
                    <SelectOptionIndicator />
                  </SelectOption>
                  <SelectOption value="runtime">
                    <SelectOptionText>
                      {t("manage.media_lib.mode_runtime")}
                    </SelectOptionText>
                    <SelectOptionIndicator />
                  </SelectOption>
                  <SelectOption value="local">
                    <SelectOptionText>
                      {t("manage.media_lib.mode_local")}
                    </SelectOptionText>
                    <SelectOptionIndicator />
                  </SelectOption>
                </SelectListbox>
              </SelectContent>
            </Select>
            <FormHelperText>
              {mode() === "base64"
                ? t("manage.media_lib.mode_base64_tips")
                : mode() === "runtime"
                  ? t("manage.media_lib.mode_runtime_tips")
                  : t("manage.media_lib.mode_local_tips")}
            </FormHelperText>
          </FormControl>

          <Show when={mode() === "local"}>
            <FormControl>
              <FormLabel>{t("manage.media_lib.thumb_path")}</FormLabel>
              <Input
                placeholder="/imgs"
                value={path()}
                onInput={(e) => setPath(e.currentTarget.value)}
              />
              <FormHelperText>
                {mode() === "runtime"
                  ? t("manage.media_lib.thumb_path_tips_runtime")
                  : t("manage.media_lib.thumb_path_tips_local")}
              </FormHelperText>
            </FormControl>
          </Show>

          <Alert status="info" variant="subtle">
            <AlertIcon />
            <AlertDescription>
              <Text fontSize="$sm">{t("manage.media_lib.thumb_rerun")}</Text>
            </AlertDescription>
          </Alert>
        </VStack>
      </Show>
    </Box>
  )
}
