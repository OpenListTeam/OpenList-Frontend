import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  Divider,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Input,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
} from "@hope-ui/solid"
import { For, Show, createSignal, onMount } from "solid-js"
import CommonSettings from "../settings/Common"
import { Group } from "~/types"
import { notify } from "~/utils"
import {
  adminCreateAppKey,
  adminDeleteAppKey,
  adminListAppKeys,
  getMediaStatus,
  type MediaAppKey,
} from "~/utils/media_api"
import { mediaStatus, setMediaStatus } from "~/store/media"

/** 基础开关（刮削与 STRM 已拆到独立页面） */
const BASE_KEYS = [
  "media_enabled",
  "media_emby_enabled",
  "media_subsonic_enabled",
  "media_subsonic_proxy_stream",
  "media_proxy_cover",
]

/**
 * 媒体基础设置页：总开关与协议开关，下方附带协议地址与应用密钥。
 */
const MediaSettingsPage = () => {
  const [keys, setKeys] = createSignal<MediaAppKey[]>([])
  const [keyName, setKeyName] = createSignal("")
  const [plainKey, setPlainKey] = createSignal("")

  const loadStatus = async () => {
    const resp = await getMediaStatus()
    if (resp.code === 200) setMediaStatus(resp.data)
  }

  const loadKeys = async () => {
    const resp = await adminListAppKeys()
    if (resp.code === 200) setKeys(resp.data ?? [])
  }

  onMount(() => {
    loadStatus()
    loadKeys()
  })

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      notify.success("已复制")
    } catch {
      notify.error("复制失败")
    }
  }

  const createKey = async () => {
    const resp = await adminCreateAppKey(keyName().trim() || "Media Key")
    if (resp.code === 200) {
      setPlainKey(resp.data.key)
      setKeyName("")
      notify.success("密钥已创建，请立即复制")
      await loadKeys()
    } else {
      notify.error("创建失败: " + resp.message)
    }
  }

  const removeKey = async (key: MediaAppKey) => {
    const resp = await adminDeleteAppKey(key.id)
    if (resp.code === 200) {
      notify.success("已删除")
      setKeys((list) => list.filter((k) => k.id !== key.id))
    } else {
      notify.error("删除失败: " + resp.message)
    }
  }

  return (
    <VStack
      spacing="$5"
      alignItems="stretch"
      p={{ "@initial": "$3", "@md": "$6" }}
      maxW="1300px"
    >
      <VStack alignItems="flex-start" spacing="2px">
        <Heading size="lg">媒体基础设置</Heading>
        <Text fontSize="$sm" color="$neutral11">
          媒体库总开关与 Emby / OpenSubsonic 协议开关
        </Text>
      </VStack>

      {/* 服务端设置项：直接复用后台的 SettingItem 渲染器 */}
      <CommonSettings group={Group.MEDIA} keys={BASE_KEYS} />

      <Divider />

      {/* 协议接入 */}
      <Box bgColor="$neutral1" rounded="$lg" border="1px solid $neutral4">
        <HStack px="$4" py="$3" borderBottom="1px solid $neutral4">
          <Heading size="sm">协议接入</Heading>
        </HStack>
        <VStack spacing="$3" alignItems="stretch" p="$4">
          <HStack justifyContent="space-between" alignItems="center">
            <VStack alignItems="flex-start" spacing="2px">
              <Text fontWeight="$medium">Emby</Text>
              <Text fontSize="$xs" color="$neutral11">
                {mediaStatus().emby_enabled
                  ? mediaStatus().emby_base_url
                  : "未启用（在上方设置中开启 media_emby_enabled）"}
              </Text>
            </VStack>
            <Show when={mediaStatus().emby_enabled}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copy(mediaStatus().emby_base_url)}
              >
                复制地址
              </Button>
            </Show>
          </HStack>
          <Divider />
          <HStack justifyContent="space-between" alignItems="center">
            <VStack alignItems="flex-start" spacing="2px">
              <Text fontWeight="$medium">OpenSubsonic</Text>
              <Text fontSize="$xs" color="$neutral11">
                {mediaStatus().subsonic_enabled
                  ? mediaStatus().subsonic_base_url
                  : "未启用（在上方设置中开启 media_subsonic_enabled）"}
              </Text>
            </VStack>
            <Show when={mediaStatus().subsonic_enabled}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copy(mediaStatus().subsonic_base_url)}
              >
                复制地址
              </Button>
            </Show>
          </HStack>
        </VStack>
      </Box>

      {/* 应用密钥 */}
      <Box bgColor="$neutral1" rounded="$lg" border="1px solid $neutral4">
        <HStack
          px="$4"
          py="$3"
          borderBottom="1px solid $neutral4"
          justifyContent="space-between"
          alignItems="center"
        >
          <VStack alignItems="flex-start" spacing="2px">
            <Heading size="sm">应用密钥</Heading>
            <Text fontSize="$xs" color="$neutral11">
              用于 Subsonic token 认证、Emby api_key 以及 MoviePilot
              等无交互客户端
            </Text>
          </VStack>
          <HStack spacing="$2">
            <FormControl display="flex" alignItems="center" gap="$2" w="auto">
              <FormLabel m="0" fontSize="$sm">
                备注
              </FormLabel>
              <Input
                w="200px"
                placeholder="例如 Symfonium"
                value={keyName()}
                onInput={(e) => setKeyName(e.currentTarget.value)}
              />
            </FormControl>
            <Button size="sm" colorScheme="accent" onClick={createKey}>
              创建
            </Button>
          </HStack>
        </HStack>
        <VStack spacing="$3" alignItems="stretch" p="$4">
          <Show when={plainKey()}>
            <Alert status="warning" variant="subtle">
              <AlertIcon />
              <AlertDescription>
                <VStack alignItems="flex-start" spacing="$1">
                  <Text fontWeight="$medium">密钥只显示一次，请立即复制：</Text>
                  <HStack spacing="$2" alignItems="center">
                    <Text css={{ fontFamily: "$mono", wordBreak: "break-all" }}>
                      {plainKey()}
                    </Text>
                    <Button size="xs" onClick={() => copy(plainKey())}>
                      复制
                    </Button>
                  </HStack>
                </VStack>
              </AlertDescription>
            </Alert>
          </Show>
          <Table>
            <Thead>
              <Tr>
                <Th>备注</Th>
                <Th>前缀</Th>
                <Th>最近使用</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              <For
                each={keys()}
                fallback={
                  <Tr>
                    <Td colSpan={4}>
                      <Text color="$neutral11">还没有应用密钥</Text>
                    </Td>
                  </Tr>
                }
              >
                {(key) => (
                  <Tr>
                    <Td>{key.name}</Td>
                    <Td>
                      <Text css={{ fontFamily: "$mono" }}>{key.prefix}…</Text>
                    </Td>
                    <Td>
                      <Text fontSize="$xs" color="$neutral11">
                        {key.last_used_at || "从未"}
                      </Text>
                    </Td>
                    <Td>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorScheme="danger"
                        onClick={() => removeKey(key)}
                      >
                        删除
                      </Button>
                    </Td>
                  </Tr>
                )}
              </For>
            </Tbody>
          </Table>
        </VStack>
      </Box>
    </VStack>
  )
}

export default MediaSettingsPage
