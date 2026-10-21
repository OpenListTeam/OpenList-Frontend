import {
  Alert,
  AlertDescription,
  AlertIcon,
  Button,
  Divider,
  FormControl,
  FormHelperText,
  FormLabel,
  Heading,
  HStack,
  Icon,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SelectContent,
  SelectIcon,
  SelectListbox,
  SelectOption,
  SelectOptionIndicator,
  SelectOptionText,
  SelectTrigger,
  SelectValue,
  SimpleGrid,
  Spinner,
  Switch,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
} from "@hope-ui/solid"
import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Item } from "~/pages/manage/settings/SettingItem"
import type {
  MediaConfig,
  MediaScanPath,
  MediaType,
  SettingItem,
} from "~/types"
import { useTitle } from "~/hooks"
import { notify, r, handleResp, getTarget } from "~/utils"
import {
  adminCreateAppKey,
  adminDeleteAppKey,
  adminDeleteMediaScanPath,
  adminGenerateStrm,
  adminGetMediaConfigs,
  adminListAppKeys,
  adminListMediaScanPaths,
  adminCreateMediaScanPath,
  adminSaveMediaConfig,
  getMediaStatus,
  type MediaAppKey,
} from "~/utils/media_api"
import { mediaStatus, setMediaStatus } from "~/store/media"

const MEDIA_GROUP = 12
const TRANSCODE_GROUP = 13

const mediaTypeOptions: { value: MediaType; label: string }[] = [
  { value: "video", label: "视频" },
  { value: "music", label: "音乐" },
  { value: "image", label: "图片" },
  { value: "book", label: "书籍" },
]

const MediaSettings = () => {
  useTitle("媒体库设置")
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [settings, setSettings] = createStore<SettingItem[]>([])
  const [configs, setConfigs] = createStore<MediaConfig[]>([])
  const [paths, setPaths] = createStore<MediaScanPath[]>([])
  const [appKeys, setAppKeys] = createStore<MediaAppKey[]>([])
  const [newKeyName, setNewKeyName] = createSignal("")
  const [plainKey, setPlainKey] = createSignal("")
  const [strmGenerating, setStrmGenerating] = createSignal(false)

  // 新增扫描路径
  const [pathModalOpen, setPathModalOpen] = createSignal(false)
  const [newPath, setNewPath] = createSignal<{
    name: string
    path: string
    media_type: MediaType
    path_merge: boolean
  }>({ name: "", path: "", media_type: "video", path_merge: false })

  const mediaSettings = createMemo(() =>
    settings.filter((s) => s.group === MEDIA_GROUP),
  )
  const transcodeSettings = createMemo(() =>
    settings.filter((s) => s.group === TRANSCODE_GROUP),
  )

  const refresh = async () => {
    setLoading(true)
    const [settingsResp, configResp, pathResp, keyResp] = await Promise.all([
      r.get(`/admin/setting/list?groups=${MEDIA_GROUP},${TRANSCODE_GROUP}`),
      adminGetMediaConfigs(),
      adminListMediaScanPaths(),
      adminListAppKeys(),
    ])
    handleResp(settingsResp as any, (data: SettingItem[]) => setSettings(data))
    handleResp(configResp, (data: MediaConfig[]) => setConfigs(data))
    handleResp(pathResp, (data: MediaScanPath[]) => setPaths(data))
    handleResp(keyResp, (data: MediaAppKey[]) => setAppKeys(data))
    setLoading(false)
  }
  onMount(refresh)

  const save = async () => {
    setSaving(true)
    const resp = (await r.post(
      "/admin/setting/save",
      getTarget(settings),
    )) as any
    setSaving(false)
    handleResp(resp, async () => {
      notify.success("保存成功")
      const statusResp = await getMediaStatus()
      handleResp(statusResp, setMediaStatus)
    })
  }

  const toggleType = async (cfg: MediaConfig, enabled: boolean) => {
    const resp = await adminSaveMediaConfig({ ...cfg, enabled })
    handleResp(resp, () => {
      const idx = configs.findIndex((c) => c.media_type === cfg.media_type)
      if (idx >= 0) setConfigs(idx, "enabled", enabled)
      notify.success(`${cfg.media_type} 已${enabled ? "启用" : "关闭"}`)
      getMediaStatus().then((res) => handleResp(res, setMediaStatus))
    })
  }

  const generateStrm = async (mediaType?: MediaType) => {
    setStrmGenerating(true)
    const resp = await adminGenerateStrm(mediaType)
    setStrmGenerating(false)
    handleResp(resp, (data) => {
      notify.success(`已生成 ${data.written} 个 .strm 文件到 ${data.path}`)
    })
  }

  const createPath = async () => {
    const p = newPath()
    if (!p.name || !p.path) {
      notify.warning("名称和路径不能为空")
      return
    }
    const resp = await adminCreateMediaScanPath(p)
    handleResp(resp, () => {
      notify.success("已添加扫描路径")
      setPathModalOpen(false)
      setNewPath({ name: "", path: "", media_type: "video", path_merge: false })
      adminListMediaScanPaths().then((res) =>
        handleResp(res, (data: MediaScanPath[]) => setPaths(data)),
      )
    })
  }

  const removePath = async (sp: MediaScanPath) => {
    const resp = await adminDeleteMediaScanPath(sp.id!)
    handleResp(resp, () => {
      notify.success("已删除")
      setPaths((list) => list.filter((p) => p.id !== sp.id))
    })
  }

  const createKey = async () => {
    const name = newKeyName().trim() || "Media Key"
    const resp = await adminCreateAppKey(name)
    handleResp(resp, (data) => {
      setPlainKey(data.key)
      setNewKeyName("")
      notify.success("密钥已创建，请立即复制")
      adminListAppKeys().then((res) =>
        handleResp(res, (list: MediaAppKey[]) => setAppKeys(list)),
      )
    })
  }

  const removeKey = async (key: MediaAppKey) => {
    const resp = await adminDeleteAppKey(key.id)
    handleResp(resp, () => {
      notify.success("已删除")
      setAppKeys((list) => list.filter((k) => k.id !== key.id))
    })
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      notify.success("已复制")
    } catch {
      notify.error("复制失败")
    }
  }

  const status = createMemo(() => mediaStatus())

  return (
    <VStack
      w="$full"
      alignItems="stretch"
      spacing="$5"
      p={{ "@initial": "$3", "@md": "$6" }}
    >
      <HStack
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap="$2"
      >
        <VStack alignItems="flex-start" spacing="$1">
          <Heading size="lg">媒体库设置</Heading>
          <Text color="$neutral11" fontSize="$sm">
            媒体库关闭时，相关页面、接口与协议端点均不可用。
          </Text>
        </VStack>
        <HStack spacing="$2">
          <Button variant="ghost" onClick={refresh} loading={loading()}>
            刷新
          </Button>
          <Button colorScheme="accent" onClick={save} loading={saving()}>
            保存设置
          </Button>
        </HStack>
      </HStack>

      <Show when={loading()} fallback={null}>
        <HStack justifyContent="center" py="$6">
          <Spinner />
        </HStack>
      </Show>

      {/* 通用设置：直接复用后台的 SettingItem 渲染器 */}
      <VStack
        alignItems="stretch"
        spacing="$3"
        p="$4"
        bgColor="$neutral1"
        rounded="$lg"
      >
        <Heading size="sm">通用</Heading>
        <Text fontSize="$sm" color="$neutral11">
          总开关、抓取源、缩略图与刷新策略均来自服务端设置项。
        </Text>
        <SimpleGrid columns={{ "@initial": 1, "@md": 2 }} gap="$4">
          <For each={mediaSettings()}>
            {(item) => (
              <Item
                {...item}
                onChange={(val) =>
                  setSettings((s) => s.key === item.key, "value", val)
                }
              />
            )}
          </For>
        </SimpleGrid>
      </VStack>

      {/* 媒体类型 */}
      <VStack
        alignItems="stretch"
        spacing="$3"
        p="$4"
        bgColor="$neutral1"
        rounded="$lg"
      >
        <Heading size="sm">媒体类型</Heading>
        <Text fontSize="$sm" color="$neutral11">
          只有启用的类型会出现在前端导航与 Emby / Subsonic 视图中。
        </Text>
        <For each={configs}>
          {(cfg) => (
            <HStack justifyContent="space-between" alignItems="center" py="$2">
              <VStack alignItems="flex-start" spacing="2px">
                <Text fontWeight="$medium">
                  {mediaTypeOptions.find((o) => o.value === cfg.media_type)
                    ?.label ?? cfg.media_type}
                </Text>
                <Text fontSize="$xs" color="$neutral11">
                  {cfg.enabled ? "已启用" : "未启用"}
                  {cfg.last_scan_at ? ` · 上次扫描 ${cfg.last_scan_at}` : ""}
                </Text>
              </VStack>
              <Switch
                checked={cfg.enabled}
                onChange={(e) => toggleType(cfg, e.currentTarget.checked)}
              />
            </HStack>
          )}
        </For>
      </VStack>

      {/* 扫描路径 */}
      <VStack
        alignItems="stretch"
        spacing="$3"
        p="$4"
        bgColor="$neutral1"
        rounded="$lg"
      >
        <HStack justifyContent="space-between" alignItems="center">
          <Heading size="sm">扫描路径</Heading>
          <Button
            size="sm"
            colorScheme="accent"
            onClick={() => setPathModalOpen(true)}
          >
            添加路径
          </Button>
        </HStack>
        <Table>
          <Thead>
            <Tr>
              <Th>名称</Th>
              <Th>路径</Th>
              <Th>类型</Th>
              <Th>合并</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            <For
              each={paths}
              fallback={
                <Tr>
                  <Td colSpan={5}>
                    <Text color="$neutral11">尚未配置扫描路径</Text>
                  </Td>
                </Tr>
              }
            >
              {(sp) => (
                <Tr>
                  <Td>{sp.name}</Td>
                  <Td>
                    <Text fontSize="$sm" css={{ wordBreak: "break-all" }}>
                      {sp.path}
                    </Text>
                  </Td>
                  <Td>{sp.media_type}</Td>
                  <Td>{sp.path_merge ? "是" : "否"}</Td>
                  <Td>
                    <Button
                      size="xs"
                      variant="ghost"
                      colorScheme="danger"
                      onClick={() => removePath(sp)}
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

      {/* STRM */}
      <VStack
        alignItems="stretch"
        spacing="$3"
        p="$4"
        bgColor="$neutral1"
        rounded="$lg"
      >
        <Heading size="sm">STRM</Heading>
        <Text fontSize="$sm" color="$neutral11">
          扫描时可自动写入 STRM（见上方
          media_strm_on_scan），也可以在这里手动生成。STRM 内容使用
          当前站点地址与签名直链。
        </Text>
        <HStack spacing="$2" flexWrap="wrap">
          <Button
            size="sm"
            onClick={() => generateStrm("video")}
            loading={strmGenerating()}
          >
            生成视频 STRM
          </Button>
          <Button
            size="sm"
            onClick={() => generateStrm("music")}
            loading={strmGenerating()}
          >
            生成音乐 STRM
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => generateStrm()}
            loading={strmGenerating()}
          >
            生成全部
          </Button>
        </HStack>
        <Text fontSize="$xs" color="$neutral11">
          输出目录：{status().strm_path || "未配置"}
        </Text>
      </VStack>

      {/* 协议 */}
      <VStack
        alignItems="stretch"
        spacing="$3"
        p="$4"
        bgColor="$neutral1"
        rounded="$lg"
      >
        <Heading size="sm">协议接入</Heading>
        <Text fontSize="$sm" color="$neutral11">
          使用下方“应用密钥”作为客户端凭据；开启对应开关后即可在第三方客户端中填写地址。
        </Text>
        <VStack alignItems="stretch" spacing="$2">
          <HStack justifyContent="space-between" alignItems="center">
            <VStack alignItems="flex-start" spacing="2px">
              <Text fontWeight="$medium">Emby</Text>
              <Text fontSize="$xs" color="$neutral11">
                {status().emby_enabled ? status().emby_base_url : "未启用"}
              </Text>
            </VStack>
            <Show when={status().emby_enabled}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copy(status().emby_base_url)}
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
                {status().subsonic_enabled
                  ? status().subsonic_base_url
                  : "未启用"}
              </Text>
            </VStack>
            <Show when={status().subsonic_enabled}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copy(status().subsonic_base_url)}
              >
                复制地址
              </Button>
            </Show>
          </HStack>
        </VStack>
      </VStack>

      {/* 应用密钥 */}
      <VStack
        alignItems="stretch"
        spacing="$3"
        p="$4"
        bgColor="$neutral1"
        rounded="$lg"
      >
        <Heading size="sm">应用密钥</Heading>
        <Text fontSize="$sm" color="$neutral11">
          用于 Subsonic 的 token 认证、Emby 的 api_key 以及 MoviePilot
          等无交互客户端。密钥只显示一次。
        </Text>
        <HStack spacing="$2">
          <Input
            placeholder="密钥备注，例如 Symfonium"
            value={newKeyName()}
            onInput={(e) => setNewKeyName(e.currentTarget.value)}
            w={{ "@initial": "$full", "@md": "320px" }}
          />
          <Button colorScheme="accent" onClick={createKey}>
            创建
          </Button>
        </HStack>
        <Show when={plainKey()}>
          <Alert status="warning" variant="subtle">
            <AlertIcon />
            <AlertDescription>
              <VStack alignItems="flex-start" spacing="$1">
                <Text fontWeight="$medium">
                  请立即复制，关闭后无法再次查看：
                </Text>
                <Text
                  fontFamily="$mono"
                  fontSize="$sm"
                  css={{ wordBreak: "break-all" }}
                >
                  {plainKey()}
                </Text>
                <Button size="xs" onClick={() => copy(plainKey())}>
                  复制密钥
                </Button>
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
              each={appKeys}
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
                  <Td>{key.last_used_at || "从未"}</Td>
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

      {/* 转码 */}
      <VStack
        alignItems="stretch"
        spacing="$3"
        p="$4"
        bgColor="$neutral1"
        rounded="$lg"
      >
        <Heading size="sm">转码</Heading>
        <Text fontSize="$sm" color="$neutral11">
          转码默认关闭；开启后按阈值决定是否转为 HLS 再播放。
        </Text>
        <SimpleGrid columns={{ "@initial": 1, "@md": 2 }} gap="$4">
          <For each={transcodeSettings()}>
            {(item) => (
              <Item
                {...item}
                onChange={(val) =>
                  setSettings((s) => s.key === item.key, "value", val)
                }
              />
            )}
          </For>
        </SimpleGrid>
      </VStack>

      <Modal opened={pathModalOpen()} onClose={() => setPathModalOpen(false)}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>添加扫描路径</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing="$4" alignItems="stretch">
              <FormControl>
                <FormLabel>名称</FormLabel>
                <Input
                  value={newPath().name}
                  onInput={(e) =>
                    setNewPath((p) => ({ ...p, name: e.currentTarget.value }))
                  }
                />
              </FormControl>
              <FormControl>
                <FormLabel>路径</FormLabel>
                <Input
                  placeholder="/movies"
                  value={newPath().path}
                  onInput={(e) =>
                    setNewPath((p) => ({ ...p, path: e.currentTarget.value }))
                  }
                />
                <FormHelperText>OpenList 中的虚拟路径</FormHelperText>
              </FormControl>
              <FormControl>
                <FormLabel>媒体类型</FormLabel>
                <Select
                  value={newPath().media_type}
                  onChange={(v) =>
                    setNewPath((p) => ({ ...p, media_type: v as MediaType }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                    <SelectIcon />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectListbox>
                      <For each={mediaTypeOptions}>
                        {(opt) => (
                          <SelectOption value={opt.value}>
                            <SelectOptionText>{opt.label}</SelectOptionText>
                            <SelectOptionIndicator />
                          </SelectOption>
                        )}
                      </For>
                    </SelectListbox>
                  </SelectContent>
                </Select>
              </FormControl>
              <FormControl>
                <HStack justifyContent="space-between">
                  <FormLabel>子文件夹合并为一个条目</FormLabel>
                  <Switch
                    checked={newPath().path_merge}
                    onChange={(e) =>
                      setNewPath((p) => ({
                        ...p,
                        path_merge: e.currentTarget.checked,
                      }))
                    }
                  />
                </HStack>
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing="$2">
              <Button variant="ghost" onClick={() => setPathModalOpen(false)}>
                取消
              </Button>
              <Button colorScheme="accent" onClick={createPath}>
                添加
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  )
}

export default MediaSettings
