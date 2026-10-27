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
import { useT } from "~/hooks"
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
  "media_subsonic_allow_password_auth",
  "media_subsonic_proxy_stream",
  "media_proxy_cover",
]

/**
 * 媒体基础设置页：总开关与协议开关，下方附带协议地址与应用密钥。
 */
const MediaSettingsPage = () => {
  const t = useT()
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
      notify.success(t("manage.media_lib.copied"))
    } catch {
      notify.error(t("manage.media_lib.copy_failed"))
    }
  }

  const createKey = async () => {
    const resp = await adminCreateAppKey(keyName().trim() || "Media Key")
    if (resp.code === 200) {
      setPlainKey(resp.data.key)
      setKeyName("")
      notify.success(t("manage.media_lib.key_created"))
      await loadKeys()
    } else {
      notify.error(t("manage.media_lib.create_failed") + ": " + resp.message)
    }
  }

  const removeKey = async (key: MediaAppKey) => {
    const resp = await adminDeleteAppKey(key.id)
    if (resp.code === 200) {
      notify.success(t("manage.media_lib.deleted"))
      setKeys((list) => list.filter((k) => k.id !== key.id))
    } else {
      notify.error(t("manage.media_lib.delete_failed") + ": " + resp.message)
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
        <Heading size="lg">{t("manage.media_lib.base_title")}</Heading>
        <Text fontSize="$sm" color="$neutral11">
          {t("manage.media_lib.base_desc")}
        </Text>
      </VStack>

      {/* 服务端设置项：直接复用后台的 SettingItem 渲染器 */}
      <CommonSettings group={Group.MEDIA} keys={BASE_KEYS} />

      <Divider />

      {/* 协议接入 */}
      <Box bgColor="$neutral1" rounded="$lg" border="1px solid $neutral4">
        <HStack px="$4" py="$3" borderBottom="1px solid $neutral4">
          <Heading size="sm">{t("manage.media_lib.protocol")}</Heading>
        </HStack>
        <VStack spacing="$3" alignItems="stretch" p="$4">
          <HStack justifyContent="space-between" alignItems="center">
            <VStack alignItems="flex-start" spacing="2px">
              <Text fontWeight="$medium">Emby</Text>
              <Text fontSize="$xs" color="$neutral11">
                {mediaStatus().emby_enabled
                  ? mediaStatus().emby_base_url
                  : t("manage.media_lib.protocol_disabled", {
                      key: "media_emby_enabled",
                    })}
              </Text>
            </VStack>
            <Show when={mediaStatus().emby_enabled}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copy(mediaStatus().emby_base_url)}
              >
                {t("manage.media_lib.copy_url")}
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
                  : t("manage.media_lib.protocol_disabled", {
                      key: "media_subsonic_enabled",
                    })}
              </Text>
            </VStack>
            <Show when={mediaStatus().subsonic_enabled}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copy(mediaStatus().subsonic_base_url)}
              >
                {t("manage.media_lib.copy_url")}
              </Button>
            </Show>
          </HStack>
          <Divider />
          <Text fontSize="$xs" color="$neutral11">
            {t("manage.media_lib.protocol_auth_tip")}
          </Text>
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
            <Heading size="sm">{t("manage.media_lib.app_keys")}</Heading>
            <Text fontSize="$xs" color="$neutral11">
              {t("manage.media_lib.app_keys_desc")}
            </Text>
          </VStack>
          <HStack spacing="$2">
            <FormControl display="flex" alignItems="center" gap="$2" w="auto">
              <FormLabel m="0" fontSize="$sm">
                {t("manage.media_lib.key_note")}
              </FormLabel>
              <Input
                w="200px"
                placeholder={t("manage.media_lib.key_note_placeholder")}
                value={keyName()}
                onInput={(e) => setKeyName(e.currentTarget.value)}
              />
            </FormControl>
            <Button size="sm" colorScheme="accent" onClick={createKey}>
              {t("manage.media_lib.create")}
            </Button>
          </HStack>
        </HStack>
        <VStack spacing="$3" alignItems="stretch" p="$4">
          <Show when={plainKey()}>
            <Alert status="warning" variant="subtle">
              <AlertIcon />
              <AlertDescription>
                <VStack alignItems="flex-start" spacing="$1">
                  <Text fontWeight="$medium">
                    {t("manage.media_lib.key_once")}
                  </Text>
                  <HStack spacing="$2" alignItems="center">
                    <Text css={{ fontFamily: "$mono", wordBreak: "break-all" }}>
                      {plainKey()}
                    </Text>
                    <Button size="xs" onClick={() => copy(plainKey())}>
                      {t("manage.media_lib.copy")}
                    </Button>
                  </HStack>
                </VStack>
              </AlertDescription>
            </Alert>
          </Show>
          <Table>
            <Thead>
              <Tr>
                <Th>{t("manage.media_lib.key_note")}</Th>
                <Th>{t("manage.media_lib.key_prefix")}</Th>
                <Th>{t("manage.media_lib.key_last_used")}</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              <For
                each={keys()}
                fallback={
                  <Tr>
                    <Td colSpan={4}>
                      <Text color="$neutral11">
                        {t("manage.media_lib.no_keys")}
                      </Text>
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
                        {key.last_used_at || t("manage.media_lib.key_never")}
                      </Text>
                    </Td>
                    <Td>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorScheme="danger"
                        onClick={() => removeKey(key)}
                      >
                        {t("manage.media_lib.delete")}
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
