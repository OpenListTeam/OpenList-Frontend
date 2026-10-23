import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Heading,
  Icon,
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
  Spinner,
  Switch,
  Table,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
} from "@hope-ui/solid"
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js"
import type {
  MediaConfig,
  MediaItem,
  MediaScanPath,
  MediaType,
  Storage,
} from "~/types"
import { notify, r } from "~/utils"
import { TbAlertTriangle } from "solid-icons/tb"
import {
  adminClearMediaDB,
  adminClearMediaScanPathDB,
  adminClearMediaScrape,
  adminCreateMediaScanPath,
  adminDeleteInvalidMedia,
  adminDeleteMediaItem,
  adminDeleteMediaScanPath,
  adminExportMediaDB,
  adminGenerateStrm,
  adminGetMediaConfigs,
  adminGetMediaItems,
  adminGetMediaScanProgress,
  adminImportMediaDB,
  adminListMediaScanPaths,
  adminSaveMediaConfig,
  adminStartMediaScan,
  adminStartMediaScrape,
  adminUpdateMediaItem,
  adminUpdateMediaScanPath,
} from "~/utils/media_api"
import { ThumbnailSettings } from "./ThumbnailSettings"
import { resolveMediaCover } from "~/utils/media_cover"

interface MediaManagePageProps {
  mediaType: MediaType
  title: string
  icon: string
}

interface ConfirmState {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
}

type TabKey = "paths" | "items" | "settings"

/**
 * 每种媒体类型一个页面：基础配置 / 扫描路径 / 媒体管理（/ 设置）四个 Tab。
 * 扫描路径严格按 props.mediaType 隔离，接口调用与字段与改造前完全一致。
 */
export const MediaManagePage = (props: MediaManagePageProps) => {
  const [tab, setTab] = createSignal<TabKey>("paths")

  // 确认弹窗（替代自写 ConfirmDialog）
  const [confirmState, setConfirmState] = createSignal<ConfirmState | null>(
    null,
  )
  const [confirming, setConfirming] = createSignal(false)
  const showConfirm = (opts: ConfirmState) => setConfirmState(opts)
  const runConfirm = async () => {
    const opts = confirmState()
    if (!opts) return
    setConfirming(true)
    try {
      await opts.onConfirm()
    } finally {
      setConfirming(false)
      setConfirmState(null)
    }
  }

  // 配置
  const [config, setConfig] = createSignal<MediaConfig>({
    media_type: props.mediaType,
    enabled: false,
    last_scan_at: null,
    last_scrape_at: null,
  })
  const [configSaving, setConfigSaving] = createSignal(false)

  // 扫描路径
  const [scanPaths, setScanPaths] = createSignal<MediaScanPath[]>([])
  const [showScanPathModal, setShowScanPathModal] = createSignal(false)
  const [editingScanPath, setEditingScanPath] =
    createSignal<Partial<MediaScanPath> | null>(null)
  const [scanPathSaving, setScanPathSaving] = createSignal(false)

  // 扫描 / 刮削
  const [scanning, setScanning] = createSignal(false)
  const [scraping, setScraping] = createSignal(false)
  const [progress, setProgress] = createSignal<{
    status: string
    current: number
    total: number
  } | null>(null)

  // 条目管理
  const [page, setPage] = createSignal(1)
  const [pageSize, setPageSize] = createSignal(
    props.mediaType === "image" ? 25 : 10,
  )
  const [filterScanPathId, setFilterScanPathId] = createSignal<number>(0)
  const [filterKeyword, setFilterKeyword] = createSignal("")
  const [searchInput, setSearchInput] = createSignal("")
  const [editingItem, setEditingItem] = createSignal<MediaItem | null>(null)
  const [showEditModal, setShowEditModal] = createSignal(false)

  // 搜索防抖
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  // 扫描进度轮询定时器：必须在组件 Owner 作用域内创建，否则 onCleanup 不会生效
  let scanTimer: ReturnType<typeof setInterval> | undefined
  const stopScanPolling = () => {
    if (scanTimer) {
      clearInterval(scanTimer)
      scanTimer = undefined
    }
  }
  const handleSearchInput = (value: string) => {
    setSearchInput(value)
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      setFilterKeyword(value)
      setPage(1)
    }, 500)
  }
  onCleanup(() => {
    if (searchTimer) clearTimeout(searchTimer)
    stopScanPolling()
  })

  // 加载配置
  const [configData] = createResource(
    () => props.mediaType,
    async (mt) => {
      const resp = await adminGetMediaConfigs()
      if (resp.code === 200) {
        const found = (resp.data as MediaConfig[]).find(
          (c) => c.media_type === mt,
        )
        if (found) setConfig(found)
      }
      return null
    },
  )

  // 加载扫描路径（仅当前媒体类型）
  const loadScanPaths = async () => {
    const resp = await adminListMediaScanPaths(props.mediaType)
    if (resp.code === 200) setScanPaths(resp.data as MediaScanPath[])
  }
  createEffect(() => {
    if (props.mediaType) loadScanPaths()
  })

  // 加载媒体条目
  const [itemsData, { refetch: refetchItems }] = createResource(
    () => ({
      media_type: props.mediaType,
      page: page(),
      page_size: pageSize(),
      scan_path_id: filterScanPathId() || undefined,
      keyword: filterKeyword() || undefined,
    }),
    async (params) => {
      const resp = await adminGetMediaItems(params)
      if (resp.code === 200) return resp.data
      return { content: [], total: 0 }
    },
  )

  const items = () => (itemsData()?.content as MediaItem[]) ?? []
  const total = () => itemsData()?.total ?? 0
  const totalPages = () => Math.max(1, Math.ceil(total() / pageSize()))

  // 检查签名相关配置：媒体播放依赖直链，开启签名会导致无法播放
  const checkSigningConflict = async (): Promise<string[]> => {
    const conflicts: string[] = []
    try {
      const resp: any = await r.get("/admin/setting/list?group=4")
      const items: { key: string; value: string }[] = resp?.data ?? []
      if (items.find((i) => i.key === "sign_all")?.value === "true") {
        conflicts.push("「全局设置 → 签名所有」已开启")
      }
    } catch {
      // 检测失败不影响保存流程
    }
    try {
      const resp: any = await r.get("/admin/storage/list")
      const list = (resp?.data?.content ?? []) as (Storage & {
        enable_sign?: boolean
      })[]
      if (list.some((s) => s.enable_sign && !s.disabled)) {
        conflicts.push("「存储驱动 → 启用签名」已开启")
      }
    } catch {
      // 检测失败不影响保存流程
    }
    return conflicts
  }

  // 保存配置
  const handleSaveConfig = async () => {
    setConfigSaving(true)
    const resp = await adminSaveMediaConfig(config())
    setConfigSaving(false)
    if (resp.code !== 200) {
      notify.error("保存失败: " + resp.message)
      return
    }
    notify.success("配置保存成功")
    if (config().enabled) {
      const conflicts = await checkSigningConflict()
      if (conflicts.length > 0) {
        notify.warning(
          `已启用${props.title}，但检测到 ${conflicts.join("、")}，可能导致媒体无法正常播放，建议关闭后使用`,
        )
      }
    }
  }

  // ============== 扫描路径操作 ==============
  const handleOpenCreateScanPath = () => {
    setEditingScanPath({
      media_type: props.mediaType,
      name: "",
      path: "/",
      path_merge: false,
      type_tag: "",
      content_tags: "",
      enable_scrape: true,
    })
    setShowScanPathModal(true)
  }

  const handleOpenEditScanPath = (sp: MediaScanPath) => {
    setEditingScanPath({ ...sp })
    setShowScanPathModal(true)
  }

  const handleSaveScanPath = async () => {
    const sp = editingScanPath()
    if (!sp) return
    setScanPathSaving(true)
    const resp = sp.id
      ? await adminUpdateMediaScanPath(sp as MediaScanPath & { id: number })
      : await adminCreateMediaScanPath(sp)
    setScanPathSaving(false)
    if (resp.code === 200) {
      notify.success(sp.id ? "扫描路径已更新" : "扫描路径已创建")
      setShowScanPathModal(false)
      setEditingScanPath(null)
      await loadScanPaths()
    } else {
      notify.error("操作失败: " + resp.message)
    }
  }

  const handleDeleteScanPath = (sp: MediaScanPath) => {
    showConfirm({
      title: "删除扫描路径",
      message: `确定要删除扫描路径「${sp.name || sp.path}」吗？此操作不会删除已扫描的媒体数据。`,
      confirmText: "删除",
      danger: true,
      onConfirm: async () => {
        const resp = await adminDeleteMediaScanPath(sp.id!)
        if (resp.code === 200) {
          notify.success("扫描路径已删除")
          await loadScanPaths()
        } else {
          notify.error("删除失败: " + resp.message)
        }
      },
    })
  }

  const handleClearScanPathDB = (sp: MediaScanPath) => {
    showConfirm({
      title: "清空路径数据",
      message: `确定要清空「${sp.name || sp.path}」下的所有媒体数据吗？此操作不可恢复！`,
      confirmText: "清空",
      danger: true,
      onConfirm: async () => {
        const resp = await adminClearMediaScanPathDB(sp.id!)
        if (resp.code === 200) {
          notify.success("路径数据已清空")
          refetchItems()
        } else {
          notify.error("清空失败: " + resp.message)
        }
      },
    })
  }

  // ============== 扫描 ==============
  const pollScanProgress = () => {
    // 先停掉旧的轮询，避免重复点击叠出多个定时器
    stopScanPolling()
    // 登录过期/网络中断时接口会持续抛错，不处理的话每秒产生一个未捕获 rejection
    let failures = 0
    scanTimer = setInterval(async () => {
      try {
        const resp = await adminGetMediaScanProgress(props.mediaType)
        failures = 0
        if (resp.code === 200 && resp.data) {
          const d = resp.data
          setProgress({
            status: d.message || (d.running ? "扫描中..." : "完成"),
            current: d.done,
            total: d.total,
          })
          if (!d.running) {
            stopScanPolling()
            setScanning(false)
            refetchItems()
            notify.success("扫描完成")
          }
        }
      } catch (e: any) {
        failures += 1
        if (failures >= 5) {
          stopScanPolling()
          setScanning(false)
          notify.error("扫描进度查询失败: " + (e?.message ?? String(e)))
        }
      }
    }, 1000)
  }

  /** 启动扫描：失败（如 403 未授权/未启用）时必须复位 scanning，否则按钮永久转圈 */
  const startScan = async (scanPathId?: number) => {
    if (!config().enabled) {
      notify.warning("请先启用该媒体库")
      return
    }
    setScanning(true)
    setProgress({ status: "扫描中...", current: 0, total: 0 })
    try {
      const resp = await adminStartMediaScan(props.mediaType, scanPathId)
      if (resp.code !== 200) {
        setScanning(false)
        setProgress(null)
        notify.error("启动扫描失败: " + (resp.message || `HTTP ${resp.code}`))
        return
      }
      pollScanProgress()
    } catch (e: any) {
      setScanning(false)
      setProgress(null)
      notify.error("启动扫描失败: " + (e?.message ?? String(e)))
    }
  }

  const handleScanPath = (sp: MediaScanPath) => startScan(sp.id)

  const handleScanAll = () => startScan()

  const handleScrape = async () => {
    setScraping(true)
    const resp = await adminStartMediaScrape(props.mediaType)
    setScraping(false)
    if (resp.code === 200) {
      notify.info("刮削任务已启动，请稍后刷新查看结果")
      refetchItems()
    } else {
      notify.error("刮削失败: " + resp.message)
    }
  }

  const handleClearAll = () => {
    showConfirm({
      title: `清空 ${props.title} 数据库`,
      message: `确定要清空 ${props.title} 的所有媒体数据吗？此操作不可恢复！`,
      confirmText: "清空全部",
      danger: true,
      onConfirm: async () => {
        const resp = await adminClearMediaDB(props.mediaType)
        if (resp.code === 200) {
          notify.success("数据库已清空")
          refetchItems()
        } else {
          notify.error("清空失败: " + resp.message)
        }
      },
    })
  }

  const handleClearScrape = () => {
    showConfirm({
      title: `清空 ${props.title} 刮削数据`,
      message: `确定要清空 ${props.title} 的所有刮削结果吗？（扫描得到的文件记录会保留，仅清空封面、简介、评分、刮削时间等字段，便于重新刮削。）`,
      confirmText: "清空刮削",
      onConfirm: async () => {
        const resp = await adminClearMediaScrape(props.mediaType)
        if (resp.code === 200) {
          const affected = resp.data?.affected ?? 0
          notify.success(`已清空刮削数据，共影响 ${affected} 条`)
          refetchItems()
        } else {
          notify.error("清空刮削失败: " + resp.message)
        }
      },
    })
  }

  const handleDeleteInvalid = () => {
    showConfirm({
      title: `删除 ${props.title} 失效条目`,
      message: `将检测 ${props.title} 中所有条目对应的文件 / 文件夹是否仍存在，已失效的条目会被删除。此过程可能耗时较久，是否继续？`,
      confirmText: "删除已失效",
      danger: true,
      onConfirm: async () => {
        notify.info("正在检测失效条目...")
        const resp = await adminDeleteInvalidMedia(props.mediaType)
        if (resp.code === 200) {
          const checked = resp.data?.checked ?? 0
          const deleted = resp.data?.deleted ?? 0
          const skipped = resp.data?.skipped ?? 0
          notify.success(
            `检测 ${checked} 条，删除 ${deleted} 条已失效条目` +
              (skipped > 0 ? `，${skipped} 条状态未知已跳过` : ""),
          )
          refetchItems()
        } else {
          notify.error("删除失败: " + resp.message)
        }
      },
    })
  }

  // ============== 导入 / 导出 ==============
  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleBlobExport = async (blob: Blob, filename: string) => {
    if (!blob || !(blob instanceof Blob)) {
      notify.error("导出失败：未收到文件流")
      return
    }
    if (blob.size < 1024) {
      try {
        const txt = await blob.text()
        const obj = JSON.parse(txt)
        if (obj && typeof obj.code === "number" && obj.code !== 200) {
          notify.error("导出失败: " + (obj.message || "未知错误"))
          return
        }
      } catch {
        // 不是 JSON 错误体，按文件下载继续
      }
    }
    triggerDownload(blob, filename)
    notify.success("导出成功")
  }

  const handleExportAll = async () => {
    try {
      const blob = await adminExportMediaDB(props.mediaType)
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
      await handleBlobExport(blob, `media_export_${props.mediaType}_${ts}.json`)
    } catch (e: any) {
      notify.error("导出失败: " + (e?.message || e))
    }
  }

  const handleExportScanPath = async (sp: MediaScanPath) => {
    try {
      const blob = await adminExportMediaDB(props.mediaType, sp.id!)
      const safeName = (sp.name || sp.path || `path_${sp.id}`).replace(
        /[\\/:*?"<>|]/g,
        "_",
      )
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
      await handleBlobExport(
        blob,
        `media_export_${props.mediaType}_${safeName}_${ts}.json`,
      )
    } catch (e: any) {
      notify.error("导出失败: " + (e?.message || e))
    }
  }

  const pickJsonFile = (): Promise<File | null> =>
    new Promise((resolve) => {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = "application/json,.json"
      input.onchange = () => {
        resolve(input.files && input.files[0] ? input.files[0] : null)
      }
      input.click()
    })

  const handleImportAll = async () => {
    const file = await pickJsonFile()
    if (!file) return
    showConfirm({
      title: `导入 ${props.title} 数据`,
      message: `即将导入文件「${file.name}」，已存在的条目会按唯一键被覆盖更新。是否继续？`,
      confirmText: "导入",
      onConfirm: async () => {
        const resp = await adminImportMediaDB(file)
        if (resp.code === 200) {
          const d = resp.data
          notify.success(
            `导入完成：路径 +${d.scan_paths_created}/~${d.scan_paths_updated}，条目 +${d.items_created}/~${d.items_updated}`,
          )
          await loadScanPaths()
          refetchItems()
        } else {
          notify.error("导入失败: " + resp.message)
        }
      },
    })
  }

  const handleImportScanPath = async (sp: MediaScanPath) => {
    const file = await pickJsonFile()
    if (!file) return
    showConfirm({
      title: `导入到「${sp.name || sp.path}」`,
      message: `即将把文件「${file.name}」中的条目全部归入此扫描路径，是否继续？`,
      confirmText: "导入",
      onConfirm: async () => {
        const resp = await adminImportMediaDB(file, sp.id!)
        if (resp.code === 200) {
          const d = resp.data
          notify.success(
            `导入完成：条目 +${d.items_created}/~${d.items_updated}`,
          )
          refetchItems()
        } else {
          notify.error("导入失败: " + resp.message)
        }
      },
    })
  }

  const handleGenerateStrm = async () => {
    const resp = await adminGenerateStrm(props.mediaType)
    if (resp.code === 200) {
      notify.success(
        `已生成 ${resp.data.written} 个 STRM 文件到 ${resp.data.path}`,
      )
    } else {
      notify.error("生成 STRM 失败: " + resp.message)
    }
  }

  // ============== 条目操作 ==============
  const handleSaveItem = async () => {
    if (!editingItem()) return
    const resp = await adminUpdateMediaItem(editingItem()!)
    if (resp.code === 200) {
      notify.success("保存成功")
      setShowEditModal(false)
      setEditingItem(null)
      refetchItems()
    } else {
      notify.error("保存失败: " + resp.message)
    }
  }

  const handleDeleteItem = (id: number, name: string) => {
    showConfirm({
      title: "删除媒体条目",
      message: `确定删除「${name}」吗？`,
      confirmText: "删除",
      danger: true,
      onConfirm: async () => {
        const resp = await adminDeleteMediaItem(id)
        if (resp.code === 200) {
          notify.success("已删除")
          refetchItems()
        } else {
          notify.error("删除失败: " + resp.message)
        }
      },
    })
  }

  const getScanPathName = (id: number) =>
    scanPaths().find((p) => p.id === id)?.name ||
    scanPaths().find((p) => p.id === id)?.path ||
    "-"

  const supportsThumbnailSettings = () =>
    props.mediaType === "image" || props.mediaType === "book"

  // 页签列表（图片 / 书籍额外提供缩略图设置）
  const tabItems = createMemo(() => {
    const list: { key: TabKey; label: string }[] = [
      { key: "paths", label: "扫描路径" },
      { key: "items", label: "媒体管理" },
    ]
    if (supportsThumbnailSettings()) {
      list.push({ key: "settings", label: "设置" })
    }
    return list
  })

  return (
    <VStack
      p={{ "@initial": "$3", "@md": "$6" }}
      spacing="$4"
      alignItems="stretch"
      maxW="1300px"
    >
      {/* 标题 */}
      <HStack spacing="$3" alignItems="center">
        <Text fontSize="$2xl">{props.icon}</Text>
        <VStack alignItems="flex-start" spacing="2px">
          <Heading size="lg">{props.title}</Heading>
          <Text fontSize="$sm" color="$neutral11">
            管理该媒体类型的配置、扫描路径和媒体数据
          </Text>
        </VStack>
      </HStack>

      {/* 工具栏：页签 + 操作按钮 + 当前类型开关（原「基础配置」合并到这里） */}
      <Box bgColor="$neutral1" rounded="$lg" border="1px solid $neutral4">
        <VStack px="$4" py="$3" spacing="$2" alignItems="stretch">
          <HStack
            justifyContent="space-between"
            alignItems="center"
            flexWrap="wrap"
            gap="$2"
          >
            <HStack spacing="$1" flexWrap="wrap">
              <For each={tabItems()}>
                {(item) => (
                  <Button
                    size="sm"
                    variant={tab() === item.key ? "subtle" : "ghost"}
                    colorScheme={tab() === item.key ? "accent" : "neutral"}
                    onClick={() => setTab(item.key)}
                  >
                    {item.label}
                  </Button>
                )}
              </For>
            </HStack>
            <HStack
              spacing="$1"
              alignItems="center"
              justifyContent="flex-end"
              flexWrap="wrap"
            >
              <Button
                size="xs"
                colorScheme="success"
                loading={scanning()}
                onClick={handleScanAll}
              >
                扫描全部
              </Button>
              <Button
                size="xs"
                colorScheme="warning"
                loading={scraping()}
                onClick={handleScrape}
              >
                立即刮削
              </Button>
              <Button size="xs" variant="outline" onClick={handleExportAll}>
                导出全部
              </Button>
              <Button size="xs" variant="outline" onClick={handleImportAll}>
                导入数据
              </Button>
              <Button size="xs" variant="ghost" onClick={handleDeleteInvalid}>
                删除已失效
              </Button>
              <Button size="xs" variant="ghost" onClick={handleClearScrape}>
                清空刮削
              </Button>
              <Button
                size="xs"
                variant="ghost"
                colorScheme="danger"
                onClick={handleClearAll}
              >
                清空全部
              </Button>
              <Button size="xs" variant="ghost" onClick={handleGenerateStrm}>
                生成 STRM
              </Button>
              <FormControl
                display="flex"
                alignItems="center"
                gap="$2"
                w="auto"
                ml="$2"
              >
                <FormLabel m="0" fontSize="$sm">
                  启用{props.title}
                </FormLabel>
                <Switch
                  checked={config().enabled}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      enabled: e.currentTarget.checked,
                    }))
                  }
                />
              </FormControl>
              <Button
                size="xs"
                colorScheme="accent"
                loading={configSaving()}
                onClick={handleSaveConfig}
              >
                保存配置
              </Button>
              <Tooltip
                label="请关闭「全局设置」→「签名所有」和「存储驱动」→「启用签名」，并且不要对扫描路径及其父路径设置「元信息」→「密码」，否则将无法正常播放媒体内容。"
                placement="top"
              >
                <Box
                  as="span"
                  display="inline-flex"
                  alignItems="center"
                  color="$warning9"
                  cursor="help"
                  ml="$1"
                >
                  <Icon as={TbAlertTriangle} boxSize="$5" />
                </Box>
              </Tooltip>
            </HStack>
          </HStack>
          <Show when={progress()}>
            <Alert status="success" variant="subtle">
              <AlertIcon />
              <AlertDescription>
                {progress()!.status}
                <Show when={(progress()?.total ?? 0) > 0}>
                  {" "}
                  ({progress()!.current} / {progress()!.total})
                </Show>
              </AlertDescription>
            </Alert>
          </Show>
        </VStack>
      </Box>

      {/* 扫描路径 */}
      <Show when={tab() === "paths"}>
        <Box bgColor="$neutral1" rounded="$lg" border="1px solid $neutral4">
          <HStack
            px="$4"
            py="$3"
            borderBottom="1px solid $neutral4"
            justifyContent="space-between"
            alignItems="center"
          >
            <Text fontWeight="$semibold">
              扫描路径（{scanPaths().length} 个）
            </Text>
            <Button
              size="sm"
              colorScheme="accent"
              onClick={handleOpenCreateScanPath}
            >
              + 添加路径
            </Button>
          </HStack>
          <Table>
            <Thead>
              <Tr>
                <Th>路径名称</Th>
                <Th>扫描路径</Th>
                <Th>类型标签</Th>
                <Th>内容标签</Th>
                <Th>路径合并</Th>
                <Th>刮削</Th>
                <Th>最后扫描</Th>
                <Th>操作</Th>
              </Tr>
            </Thead>
            <Tbody>
              <Show
                when={scanPaths().length > 0}
                fallback={
                  <Tr>
                    <Td colSpan={8}>
                      <Text textAlign="center" color="$neutral11" py="$6">
                        暂无扫描路径，点击「添加路径」开始配置
                      </Text>
                    </Td>
                  </Tr>
                }
              >
                <For each={scanPaths()}>
                  {(sp) => (
                    <Tr>
                      <Td>{sp.name || "-"}</Td>
                      <Td>
                        <Text fontFamily="$mono" fontSize="$xs">
                          {sp.path}
                        </Text>
                      </Td>
                      <Td>
                        <Show when={sp.type_tag}>
                          <Badge colorScheme="info">{sp.type_tag}</Badge>
                        </Show>
                      </Td>
                      <Td>
                        <HStack spacing="$1" flexWrap="wrap">
                          <For
                            each={(sp.content_tags || "")
                              .split(",")
                              .filter(Boolean)}
                          >
                            {(tag) => (
                              <Badge colorScheme="accent">{tag.trim()}</Badge>
                            )}
                          </For>
                        </HStack>
                      </Td>
                      <Td>
                        <Text
                          fontSize="$xs"
                          color={sp.path_merge ? "$success11" : "$neutral11"}
                        >
                          {sp.path_merge ? "是" : "否"}
                        </Text>
                      </Td>
                      <Td>
                        <Text
                          fontSize="$xs"
                          color={sp.enable_scrape ? "$success11" : "$neutral11"}
                        >
                          {sp.enable_scrape ? "是" : "否"}
                        </Text>
                      </Td>
                      <Td>
                        <Text fontSize="$xs" color="$neutral11">
                          {sp.last_scan_at
                            ? new Date(sp.last_scan_at).toLocaleString(
                                "zh-CN",
                                {
                                  month: "2-digit",
                                  day: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )
                            : "从未"}
                        </Text>
                      </Td>
                      <Td>
                        <HStack spacing="$1" flexWrap="nowrap">
                          <Button
                            size="xs"
                            variant="ghost"
                            loading={scanning()}
                            onClick={() => handleScanPath(sp)}
                          >
                            扫描
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            colorScheme="success"
                            onClick={() => handleOpenEditScanPath(sp)}
                          >
                            编辑
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => handleExportScanPath(sp)}
                          >
                            导出
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => handleImportScanPath(sp)}
                          >
                            导入
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            colorScheme="warning"
                            onClick={() => handleClearScanPathDB(sp)}
                          >
                            清空
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            colorScheme="danger"
                            onClick={() => handleDeleteScanPath(sp)}
                          >
                            删除
                          </Button>
                        </HStack>
                      </Td>
                    </Tr>
                  )}
                </For>
              </Show>
            </Tbody>
          </Table>
        </Box>
      </Show>

      {/* 媒体管理 */}
      <Show when={tab() === "items"}>
        <Box bgColor="$neutral1" rounded="$lg" border="1px solid $neutral4">
          <VStack
            px="$4"
            py="$3"
            spacing="$2"
            borderBottom="1px solid $neutral4"
            alignItems="stretch"
          >
            <Text fontWeight="$semibold">媒体管理（共 {total()} 条）</Text>
            <HStack spacing="$2" flexWrap="wrap" alignItems="center">
              <Box w="200px">
                <Select
                  value={String(filterScanPathId())}
                  onChange={(v) => {
                    setFilterScanPathId(Number(v))
                    setPage(1)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                    <SelectIcon />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectListbox>
                      <SelectOption value="0">
                        <SelectOptionText>全部路径</SelectOptionText>
                        <SelectOptionIndicator />
                      </SelectOption>
                      <For each={scanPaths()}>
                        {(sp) => (
                          <SelectOption value={String(sp.id)}>
                            <SelectOptionText>
                              {sp.name || sp.path}
                            </SelectOptionText>
                            <SelectOptionIndicator />
                          </SelectOption>
                        )}
                      </For>
                    </SelectListbox>
                  </SelectContent>
                </Select>
              </Box>
              <Input
                placeholder="搜索名称..."
                w="200px"
                value={searchInput()}
                onInput={(e) => handleSearchInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (searchTimer) clearTimeout(searchTimer)
                    setFilterKeyword(searchInput())
                    setPage(1)
                  }
                }}
              />
              <HStack spacing="$1" alignItems="center">
                <Text fontSize="$sm" color="$neutral11">
                  每页
                </Text>
                <Box w="90px">
                  <Select
                    value={String(pageSize())}
                    onChange={(v) => {
                      setPageSize(Number(v))
                      setPage(1)
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                      <SelectIcon />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectListbox>
                        <For
                          each={
                            props.mediaType === "image"
                              ? [15, 25, 50, 75, 100]
                              : [5, 10, 20]
                          }
                        >
                          {(n) => (
                            <SelectOption value={String(n)}>
                              <SelectOptionText>{String(n)}</SelectOptionText>
                              <SelectOptionIndicator />
                            </SelectOption>
                          )}
                        </For>
                      </SelectListbox>
                    </SelectContent>
                  </Select>
                </Box>
                <Text fontSize="$sm" color="$neutral11">
                  {props.mediaType === "image" ? "张" : "条"}
                </Text>
              </HStack>
            </HStack>
          </VStack>

          <Table>
            <Thead>
              <Tr>
                <Th>文件名</Th>
                <Th>名称</Th>
                <Th>封面</Th>
                <Th>扫描路径</Th>
                <Th>发布时间</Th>
                <Th>评分</Th>
                <Th>隐藏</Th>
                <Th>操作</Th>
              </Tr>
            </Thead>
            <Tbody>
              <Show
                when={!itemsData.loading}
                fallback={
                  <Tr>
                    <Td colSpan={8}>
                      <HStack justifyContent="center" py="$8">
                        <Spinner />
                      </HStack>
                    </Td>
                  </Tr>
                }
              >
                <Show
                  when={items().length > 0}
                  fallback={
                    <Tr>
                      <Td colSpan={8}>
                        <Text textAlign="center" color="$neutral11" py="$8">
                          暂无媒体数据
                        </Text>
                      </Td>
                    </Tr>
                  }
                >
                  <For each={items()}>
                    {(item) => (
                      <Tr>
                        <Td maxW="200px">
                          <span
                            title={item.file_name}
                            style={{
                              display: "block",
                              "font-size": "12px",
                              overflow: "hidden",
                              "text-overflow": "ellipsis",
                              "white-space": "nowrap",
                            }}
                          >
                            {item.file_name}
                          </span>
                        </Td>
                        <Td maxW="180px">
                          <span
                            style={{
                              display: "block",
                              "font-size": "14px",
                              "font-weight": "500",
                              overflow: "hidden",
                              "text-overflow": "ellipsis",
                              "white-space": "nowrap",
                            }}
                          >
                            {item.scraped_name || item.file_name}
                          </span>
                        </Td>
                        <Td>
                          <Show
                            when={item.cover}
                            fallback={
                              <Box
                                w="48px"
                                h="64px"
                                rounded="$md"
                                bgColor="$neutral3"
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                              >
                                <Text fontSize="$xl">{props.icon}</Text>
                              </Box>
                            }
                          >
                            <img
                              src={resolveMediaCover(item.cover)}
                              loading="lazy"
                              alt={item.scraped_name || item.file_name}
                              style={{
                                width: "48px",
                                height: "64px",
                                "object-fit": "cover",
                                "border-radius": "6px",
                                border: "1px solid rgba(128,128,128,0.25)",
                                "background-color": "rgba(128,128,128,0.08)",
                              }}
                            />
                          </Show>
                        </Td>
                        <Td>
                          <Text fontSize="$xs" color="$neutral11">
                            {getScanPathName(item.scan_path_id)}
                          </Text>
                        </Td>
                        <Td>
                          <Text fontSize="$xs" color="$neutral11">
                            {item.release_date?.slice(0, 10) || "-"}
                          </Text>
                        </Td>
                        <Td>
                          <Text fontSize="$xs" color="$neutral11">
                            {item.rating > 0 ? item.rating.toFixed(1) : "-"}
                          </Text>
                        </Td>
                        <Td>
                          <Switch
                            checked={item.hidden}
                            onChange={async (e) => {
                              await adminUpdateMediaItem({
                                ...item,
                                hidden: e.currentTarget.checked,
                              })
                              refetchItems()
                            }}
                          />
                        </Td>
                        <Td>
                          <HStack spacing="$1">
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => {
                                setEditingItem({ ...item })
                                setShowEditModal(true)
                              }}
                            >
                              编辑
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              colorScheme="danger"
                              onClick={() =>
                                handleDeleteItem(
                                  item.id,
                                  item.scraped_name || item.file_name,
                                )
                              }
                            >
                              删除
                            </Button>
                          </HStack>
                        </Td>
                      </Tr>
                    )}
                  </For>
                </Show>
              </Show>
            </Tbody>
          </Table>

          {/* 分页 */}
          <Show when={total() > 0}>
            <HStack
              justifyContent="center"
              alignItems="center"
              spacing="$2"
              py="$3"
              borderTop="1px solid $neutral4"
            >
              <Button
                size="xs"
                variant="ghost"
                disabled={page() <= 1}
                onClick={() => setPage(1)}
              >
                «
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={page() <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Text fontSize="$sm" color="$neutral11">
                第 {page()} / {totalPages()} 页，共 {total()} 条
              </Text>
              <Button
                size="xs"
                variant="ghost"
                disabled={page() >= totalPages()}
                onClick={() => setPage((p) => Math.min(totalPages(), p + 1))}
              >
                下一页
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={page() >= totalPages()}
                onClick={() => setPage(totalPages())}
              >
                »
              </Button>
            </HStack>
          </Show>
        </Box>
      </Show>

      {/* 缩略图设置（图片 / 书籍） */}
      <Show when={tab() === "settings" && supportsThumbnailSettings()}>
        <ThumbnailSettings mediaType={props.mediaType as "image" | "book"} />
      </Show>

      {/* 扫描路径弹窗 */}
      <Modal
        opened={showScanPathModal()}
        onClose={() => setShowScanPathModal(false)}
        size="lg"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            {editingScanPath()?.id ? "编辑扫描路径" : "添加扫描路径"}
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing="$4" alignItems="stretch">
              <FormControl>
                <FormLabel>路径名称</FormLabel>
                <Input
                  placeholder="如：电影库、音乐收藏"
                  value={editingScanPath()?.name ?? ""}
                  onInput={(e) =>
                    setEditingScanPath((sp) => ({
                      ...sp!,
                      name: e.currentTarget.value,
                    }))
                  }
                />
                <FormHelperText>用于前端筛选显示</FormHelperText>
              </FormControl>
              <FormControl>
                <FormLabel>扫描路径</FormLabel>
                <Input
                  placeholder="/movies"
                  value={editingScanPath()?.path ?? "/"}
                  onInput={(e) =>
                    setEditingScanPath((sp) => ({
                      ...sp!,
                      path: e.currentTarget.value,
                    }))
                  }
                />
                <FormHelperText>VFS 虚拟路径，如 /movies</FormHelperText>
              </FormControl>
              <FormControl>
                <FormLabel>类型标签</FormLabel>
                <Input
                  placeholder="电影"
                  value={editingScanPath()?.type_tag ?? ""}
                  onInput={(e) =>
                    setEditingScanPath((sp) => ({
                      ...sp!,
                      type_tag: e.currentTarget.value,
                    }))
                  }
                />
                <FormHelperText>
                  如：电影、电视剧（用于前端筛选）
                </FormHelperText>
              </FormControl>
              <FormControl>
                <FormLabel>内容标签</FormLabel>
                <Input
                  placeholder="喜剧,惊悚,动作"
                  value={editingScanPath()?.content_tags ?? ""}
                  onInput={(e) =>
                    setEditingScanPath((sp) => ({
                      ...sp!,
                      content_tags: e.currentTarget.value,
                    }))
                  }
                />
                <FormHelperText>多个标签用英文逗号分隔</FormHelperText>
              </FormControl>
              <HStack spacing="$6" flexWrap="wrap">
                <FormControl
                  display="flex"
                  alignItems="center"
                  gap="$2"
                  w="auto"
                >
                  <FormLabel m="0">路径合并模式</FormLabel>
                  <Switch
                    checked={editingScanPath()?.path_merge ?? false}
                    onChange={(e) =>
                      setEditingScanPath((sp) => ({
                        ...sp!,
                        path_merge: e.currentTarget.checked,
                      }))
                    }
                  />
                </FormControl>
                <FormControl
                  display="flex"
                  alignItems="center"
                  gap="$2"
                  w="auto"
                >
                  <FormLabel m="0">启用刮削</FormLabel>
                  <Switch
                    checked={editingScanPath()?.enable_scrape ?? true}
                    onChange={(e) =>
                      setEditingScanPath((sp) => ({
                        ...sp!,
                        enable_scrape: e.currentTarget.checked,
                      }))
                    }
                  />
                </FormControl>
              </HStack>
              <Text fontSize="$xs" color="$neutral11">
                媒体类型固定为「{props.title}」，不可更改。
              </Text>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing="$2">
              <Button
                variant="ghost"
                onClick={() => setShowScanPathModal(false)}
              >
                取消
              </Button>
              <Button
                colorScheme="accent"
                loading={scanPathSaving()}
                onClick={handleSaveScanPath}
              >
                保存
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 条目编辑弹窗 */}
      <Modal
        opened={showEditModal()}
        onClose={() => setShowEditModal(false)}
        size="lg"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>编辑媒体信息</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing="$3" alignItems="stretch">
              <For
                each={[
                  { key: "scraped_name", label: "名称" },
                  { key: "cover", label: "封面URL" },
                  { key: "release_date", label: "发布时间 (YYYY-MM-DD)" },
                  { key: "genre", label: "类型（逗号分隔）" },
                  { key: "authors", label: "作者/演员（JSON数组）" },
                ]}
              >
                {(field) => (
                  <FormControl>
                    <FormLabel>{field.label}</FormLabel>
                    <Input
                      value={
                        ((editingItem() as any)?.[field.key] as string) ?? ""
                      }
                      onInput={(e) =>
                        setEditingItem((item) => ({
                          ...item!,
                          [field.key]: e.currentTarget.value,
                        }))
                      }
                    />
                  </FormControl>
                )}
              </For>
              <FormControl>
                <FormLabel>评分 (0-10)</FormLabel>
                <Input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={editingItem()?.rating ?? 0}
                  onInput={(e) =>
                    setEditingItem((item) => ({
                      ...item!,
                      rating: parseFloat(e.currentTarget.value),
                    }))
                  }
                />
              </FormControl>
              <FormControl>
                <FormLabel>简介</FormLabel>
                <Textarea
                  rows={3}
                  value={editingItem()?.description ?? ""}
                  onInput={(e) =>
                    setEditingItem((item) => ({
                      ...item!,
                      description: e.currentTarget.value,
                    }))
                  }
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing="$2">
              <Button variant="ghost" onClick={() => setShowEditModal(false)}>
                取消
              </Button>
              <Button colorScheme="accent" onClick={handleSaveItem}>
                保存
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 确认弹窗 */}
      <Modal
        opened={!!confirmState()}
        onClose={() => setConfirmState(null)}
        size="md"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{confirmState()?.title}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text fontSize="$sm" css={{ whiteSpace: "pre-line" }}>
              {confirmState()?.message}
            </Text>
          </ModalBody>
          <ModalFooter>
            <HStack spacing="$2">
              <Button variant="ghost" onClick={() => setConfirmState(null)}>
                取消
              </Button>
              <Button
                colorScheme={confirmState()?.danger ? "danger" : "accent"}
                loading={confirming()}
                onClick={runConfirm}
              >
                {confirmState()?.confirmText || "确定"}
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  )
}

// ==================== 4个具体管理页 ====================

export const VideoManage = () => (
  <MediaManagePage mediaType="video" title="电影视频" icon="🎬" />
)

export const MusicManage = () => (
  <MediaManagePage mediaType="music" title="音乐歌曲" icon="🎵" />
)

export const ImageManage = () => (
  <MediaManagePage mediaType="image" title="图片壁纸" icon="🖼️" />
)

export const BookManage = () => (
  <MediaManagePage mediaType="book" title="电子书籍" icon="📚" />
)
