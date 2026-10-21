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
      notify.error("未读取到该媒体类型的配置，请刷新重试")
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
      notify.success("缩略图设置已保存，重新刮削后生效")
      await load()
    } else {
      notify.error("保存失败: " + resp.message)
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
            {props.mediaType === "image" ? "图片缩略图设置" : "书籍缩略图设置"}
          </Heading>
          <Text fontSize="$xs" color="$neutral11">
            仅对「{props.mediaType === "image" ? "图片壁纸" : "电子书籍"}
            」生效；未设置时使用媒体设置里的全局值。
          </Text>
        </VStack>
        <Button colorScheme="accent" loading={saving()} onClick={save}>
          保存
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
              <FormLabel m="0">存储缩略图</FormLabel>
              <Switch
                checked={storeThumbnail()}
                onChange={(e) => setStoreThumbnail(e.currentTarget.checked)}
              />
              <FormHelperText m="0">
                开启后刮削时生成缩略图；关闭则直接使用原图路径作为封面
              </FormHelperText>
            </FormControl>
          </Show>

          <FormControl>
            <FormLabel>缩略图存储方式</FormLabel>
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
                    <SelectOptionText>Base64（存入数据库）</SelectOptionText>
                    <SelectOptionIndicator />
                  </SelectOption>
                  <SelectOption value="runtime">
                    <SelectOptionText>
                      运行目录（默认，data/imgs）
                    </SelectOptionText>
                    <SelectOptionIndicator />
                  </SelectOption>
                  <SelectOption value="local">
                    <SelectOptionText>
                      本地文件（挂载目录 VFS）
                    </SelectOptionText>
                    <SelectOptionIndicator />
                  </SelectOption>
                </SelectListbox>
              </SelectContent>
            </Select>
            <FormHelperText>
              {mode() === "base64"
                ? "缩略图以 base64 编码存入数据库，无需额外文件存储，但会增大数据库体积"
                : mode() === "runtime"
                  ? "缩略图保存到程序数据目录 data 下，默认 data/imgs，无需挂载存储"
                  : "缩略图写入挂载目录下的 VFS 路径，需该路径可写（如 /imgs）"}
            </FormHelperText>
          </FormControl>

          <Show when={mode() === "local"}>
            <FormControl>
              <FormLabel>本地存储路径</FormLabel>
              <Input
                placeholder="/imgs"
                value={path()}
                onInput={(e) => setPath(e.currentTarget.value)}
              />
              <FormHelperText>
                {mode() === "runtime"
                  ? "相对程序数据目录 data 的路径，默认 imgs，即 data/imgs"
                  : "VFS 路径，相对挂载根 /，例如 /imgs 或 /.thumbnail"}
              </FormHelperText>
            </FormControl>
          </Show>

          <Alert status="info" variant="subtle">
            <AlertIcon />
            <AlertDescription>
              <Text fontSize="$sm">
                修改后需重新刮削（可先在「媒体管理」里清空刮削再执行刮削）才会生效。
              </Text>
            </AlertDescription>
          </Alert>
        </VStack>
      </Show>
    </Box>
  )
}
