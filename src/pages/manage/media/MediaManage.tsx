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
  MediaScanProgress,
  MediaType,
  Storage,
} from "~/types"
import { notify, r } from "~/utils"
import { useT } from "~/hooks"
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
  const t = useT()
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
        conflicts.push(t("media.admin.conflict_sign_all"))
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
        conflicts.push(t("media.admin.conflict_storage_sign"))
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
      notify.error(t("media.admin.save_failed") + ": " + resp.message)
      return
    }
    notify.success(t("media.admin.config_saved"))
    if (config().enabled) {
      const conflicts = await checkSigningConflict()
      if (conflicts.length > 0) {
        notify.warning(
          t("media.admin.signing_conflict", {
            title: props.title,
            conflicts: conflicts.join(", "),
          }),
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
      notify.success(
        sp.id
          ? t("media.admin.scan_path_updated")
          : t("media.admin.scan_path_created"),
      )
      setShowScanPathModal(false)
      setEditingScanPath(null)
      await loadScanPaths()
    } else {
      notify.error(t("media.admin.op_failed") + ": " + resp.message)
    }
  }

  const handleDeleteScanPath = (sp: MediaScanPath) => {
    showConfirm({
      title: t("media.admin.delete_scan_path"),
      message: t("media.admin.delete_scan_path_msg", {
        name: sp.name || sp.path,
      }),
      confirmText: t("global.delete"),
      danger: true,
      onConfirm: async () => {
        const resp = await adminDeleteMediaScanPath(sp.id!)
        if (resp.code === 200) {
          notify.success(t("media.admin.scan_path_deleted"))
          await loadScanPaths()
        } else {
          notify.error(t("media.admin.delete_failed") + ": " + resp.message)
        }
      },
    })
  }

  const handleClearScanPathDB = (sp: MediaScanPath) => {
    showConfirm({
      title: t("media.admin.clear_path_title"),
      message: t("media.admin.clear_path_msg", { name: sp.name || sp.path }),
      confirmText: t("media.admin.clear"),
      danger: true,
      onConfirm: async () => {
        const resp = await adminClearMediaScanPathDB(sp.id!)
        if (resp.code === 200) {
          notify.success(t("media.admin.path_cleared"))
          refetchItems()
        } else {
          notify.error(t("media.admin.clear_failed") + ": " + resp.message)
        }
      },
    })
  }

  // ============== 扫描 ==============
  const pollScanProgress = () => {
    // 先停掉旧的轮询，避免重复点击叠出多个定时器
    stopScanPolling()
    // 注意：项目的 axios 拦截器对网络错误 / 非 2xx 不会 reject，而是返回 { code, message }，
    // 所以失败计数必须按 code 判断（只看 catch 会永远为 0）：
    // 登录过期后 code 为 401，否则会每秒静默空转直到离开页面。
    let failures = 0
    scanTimer = setInterval(async () => {
      let code = -1
      let message = ""
      let data: MediaScanProgress | null = null
      try {
        const resp = await adminGetMediaScanProgress(props.mediaType)
        code = resp.code
        message = resp.message
        data = resp.data
      } catch (e: any) {
        message = e?.message ?? String(e)
      }
      if (code !== 200 || !data) {
        failures += 1
        if (failures >= 5 || code === 401 || code === 403) {
          stopScanPolling()
          setScanning(false)
          notify.error(
            t("media.admin.progress_failed") +
              ": " +
              (message || `HTTP ${code}`),
          )
        }
        return
      }
      failures = 0
      setProgress({
        status:
          data.message ||
          (data.running ? t("media.admin.scanning") : t("media.admin.done")),
        current: data.done,
        total: data.total,
      })
      if (!data.running) {
        stopScanPolling()
        setScanning(false)
        refetchItems()
        notify.success(t("media.admin.scan_done"))
      }
    }, 1000)
  }

  /** 启动扫描：失败（如 403 未授权/未启用）时必须复位 scanning，否则按钮永久转圈 */
  const startScan = async (scanPathId?: number) => {
    if (!config().enabled) {
      notify.warning(t("media.admin.enable_first"))
      return
    }
    setScanning(true)
    setProgress({ status: t("media.admin.scanning"), current: 0, total: 0 })
    try {
      const resp = await adminStartMediaScan(props.mediaType, scanPathId)
      if (resp.code !== 200) {
        setScanning(false)
        setProgress(null)
        notify.error(
          t("media.admin.scan_start_failed") +
            ": " +
            (resp.message || `HTTP ${resp.code}`),
        )
        return
      }
      pollScanProgress()
    } catch (e: any) {
      setScanning(false)
      setProgress(null)
      notify.error(
        t("media.admin.scan_start_failed") + ": " + (e?.message ?? String(e)),
      )
    }
  }

  const handleScanPath = (sp: MediaScanPath) => startScan(sp.id)

  const handleScanAll = () => startScan()

  const handleScrape = async () => {
    setScraping(true)
    const resp = await adminStartMediaScrape(props.mediaType)
    setScraping(false)
    if (resp.code === 200) {
      notify.info(t("media.admin.scrape_started"))
      refetchItems()
    } else {
      notify.error(t("media.admin.scrape_failed") + ": " + resp.message)
    }
  }

  const handleClearAll = () => {
    showConfirm({
      title: t("media.admin.clear_all_title", { title: props.title }),
      message: t("media.admin.clear_all_msg", { title: props.title }),
      confirmText: t("media.admin.clear_all"),
      danger: true,
      onConfirm: async () => {
        const resp = await adminClearMediaDB(props.mediaType)
        if (resp.code === 200) {
          notify.success(t("media.admin.db_cleared"))
          refetchItems()
        } else {
          notify.error(t("media.admin.clear_failed") + ": " + resp.message)
        }
      },
    })
  }

  const handleClearScrape = () => {
    showConfirm({
      title: t("media.admin.clear_scrape_title", { title: props.title }),
      message: t("media.admin.clear_scrape_msg", { title: props.title }),
      confirmText: t("media.admin.clear_scrape"),
      onConfirm: async () => {
        const resp = await adminClearMediaScrape(props.mediaType)
        if (resp.code === 200) {
          const affected = resp.data?.affected ?? 0
          notify.success(t("media.admin.clear_scrape_ok", { count: affected }))
          refetchItems()
        } else {
          notify.error(
            t("media.admin.clear_scrape_failed") + ": " + resp.message,
          )
        }
      },
    })
  }

  const handleDeleteInvalid = () => {
    showConfirm({
      title: t("media.admin.delete_invalid_title", { title: props.title }),
      message: t("media.admin.delete_invalid_msg", { title: props.title }),
      confirmText: t("media.admin.delete_invalid"),
      danger: true,
      onConfirm: async () => {
        notify.info(t("media.admin.checking_invalid"))
        const resp = await adminDeleteInvalidMedia(props.mediaType)
        if (resp.code === 200) {
          const checked = resp.data?.checked ?? 0
          const deleted = resp.data?.deleted ?? 0
          const skipped = resp.data?.skipped ?? 0
          notify.success(
            t("media.admin.delete_invalid_ok", { checked, deleted }) +
              (skipped > 0
                ? t("media.admin.delete_invalid_skipped", { count: skipped })
                : ""),
          )
          refetchItems()
        } else {
          notify.error(t("media.admin.delete_failed") + ": " + resp.message)
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
      notify.error(t("media.admin.export_no_stream"))
      return
    }
    if (blob.size < 1024) {
      try {
        const txt = await blob.text()
        const obj = JSON.parse(txt)
        if (obj && typeof obj.code === "number" && obj.code !== 200) {
          notify.error(
            t("media.admin.export_failed") +
              ": " +
              (obj.message || t("media.admin.unknown_error")),
          )
          return
        }
      } catch {
        // 不是 JSON 错误体，按文件下载继续
      }
    }
    triggerDownload(blob, filename)
    notify.success(t("media.admin.export_ok"))
  }

  const handleExportAll = async () => {
    try {
      const blob = await adminExportMediaDB(props.mediaType)
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
      await handleBlobExport(blob, `media_export_${props.mediaType}_${ts}.json`)
    } catch (e: any) {
      notify.error(t("media.admin.export_failed") + ": " + (e?.message || e))
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
      notify.error(t("media.admin.export_failed") + ": " + (e?.message || e))
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
      title: t("media.admin.import_title", { title: props.title }),
      message: t("media.admin.import_msg", { file: file.name }),
      confirmText: t("media.admin.import"),
      onConfirm: async () => {
        const resp = await adminImportMediaDB(file)
        if (resp.code === 200) {
          const d = resp.data
          notify.success(
            t("media.admin.import_ok", {
              created: d.scan_paths_created,
              updated: d.scan_paths_updated,
              items_created: d.items_created,
              items_updated: d.items_updated,
            }),
          )
          await loadScanPaths()
          refetchItems()
        } else {
          notify.error(t("media.admin.import_failed") + ": " + resp.message)
        }
      },
    })
  }

  const handleImportScanPath = async (sp: MediaScanPath) => {
    const file = await pickJsonFile()
    if (!file) return
    showConfirm({
      title: t("media.admin.import_path_title", {
        name: sp.name || sp.path,
      }),
      message: t("media.admin.import_path_msg", { file: file.name }),
      confirmText: t("media.admin.import"),
      onConfirm: async () => {
        const resp = await adminImportMediaDB(file, sp.id!)
        if (resp.code === 200) {
          const d = resp.data
          notify.success(
            t("media.admin.import_path_ok", {
              created: d.items_created,
              updated: d.items_updated,
            }),
          )
          refetchItems()
        } else {
          notify.error(t("media.admin.import_failed") + ": " + resp.message)
        }
      },
    })
  }

  const handleGenerateStrm = async () => {
    const resp = await adminGenerateStrm(props.mediaType)
    if (resp.code === 200) {
      notify.success(
        t("media.admin.strm_ok", {
          count: resp.data.written,
          path: resp.data.path,
        }),
      )
    } else {
      notify.error(t("media.admin.strm_failed") + ": " + resp.message)
    }
  }

  // ============== 条目操作 ==============
  const handleSaveItem = async () => {
    if (!editingItem()) return
    const resp = await adminUpdateMediaItem(editingItem()!)
    if (resp.code === 200) {
      notify.success(t("media.admin.save_ok"))
      setShowEditModal(false)
      setEditingItem(null)
      refetchItems()
    } else {
      notify.error(t("media.admin.save_failed") + ": " + resp.message)
    }
  }

  const handleDeleteItem = (id: number, name: string) => {
    showConfirm({
      title: t("media.admin.delete_item_title"),
      message: t("media.admin.delete_item_msg", { name }),
      confirmText: t("global.delete"),
      danger: true,
      onConfirm: async () => {
        const resp = await adminDeleteMediaItem(id)
        if (resp.code === 200) {
          notify.success(t("media.admin.deleted"))
          refetchItems()
        } else {
          notify.error(t("media.admin.delete_failed") + ": " + resp.message)
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
      { key: "paths", label: t("media.admin.tab_paths") },
      { key: "items", label: t("media.admin.tab_items") },
    ]
    if (supportsThumbnailSettings()) {
      list.push({ key: "settings", label: t("media.admin.tab_settings") })
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
            {t("media.admin.desc")}
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
                {t("media.admin.scan_all")}
              </Button>
              <Button
                size="xs"
                colorScheme="warning"
                loading={scraping()}
                onClick={handleScrape}
              >
                {t("media.admin.scrape_now")}
              </Button>
              <Button size="xs" variant="outline" onClick={handleExportAll}>
                {t("media.admin.export_all")}
              </Button>
              <Button size="xs" variant="outline" onClick={handleImportAll}>
                {t("media.admin.import_data")}
              </Button>
              <Button size="xs" variant="ghost" onClick={handleDeleteInvalid}>
                {t("media.admin.delete_invalid")}
              </Button>
              <Button size="xs" variant="ghost" onClick={handleClearScrape}>
                {t("media.admin.clear_scrape")}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                colorScheme="danger"
                onClick={handleClearAll}
              >
                {t("media.admin.clear_all")}
              </Button>
              <Button size="xs" variant="ghost" onClick={handleGenerateStrm}>
                {t("media.admin.generate_strm")}
              </Button>
              <FormControl
                display="flex"
                alignItems="center"
                gap="$2"
                w="auto"
                ml="$2"
              >
                <FormLabel m="0" fontSize="$sm">
                  {t("media.admin.enable_library", { title: props.title })}
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
                {t("media.admin.save_config")}
              </Button>
              <Tooltip label={t("media.admin.signing_warning")} placement="top">
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
              {t("media.admin.scan_paths_count", { count: scanPaths().length })}
            </Text>
            <Button
              size="sm"
              colorScheme="accent"
              onClick={handleOpenCreateScanPath}
            >
              {t("media.admin.add_path")}
            </Button>
          </HStack>
          <Table>
            <Thead>
              <Tr>
                <Th>{t("media.admin.col_path_name")}</Th>
                <Th>{t("media.admin.col_scan_path")}</Th>
                <Th>{t("media.admin.col_type_tags")}</Th>
                <Th>{t("media.admin.col_content_tags")}</Th>
                <Th>{t("media.admin.col_path_merge")}</Th>
                <Th>{t("media.admin.col_scrape")}</Th>
                <Th>{t("media.admin.col_last_scan")}</Th>
                <Th>{t("media.admin.col_actions")}</Th>
              </Tr>
            </Thead>
            <Tbody>
              <Show
                when={scanPaths().length > 0}
                fallback={
                  <Tr>
                    <Td colSpan={8}>
                      <Text textAlign="center" color="$neutral11" py="$6">
                        {t("media.admin.no_scan_paths")}
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
                          {sp.path_merge
                            ? t("media.admin.yes")
                            : t("media.admin.no")}
                        </Text>
                      </Td>
                      <Td>
                        <Text
                          fontSize="$xs"
                          color={sp.enable_scrape ? "$success11" : "$neutral11"}
                        >
                          {sp.enable_scrape
                            ? t("media.admin.yes")
                            : t("media.admin.no")}
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
                            : t("media.admin.never")}
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
                            {t("media.admin.scan")}
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            colorScheme="success"
                            onClick={() => handleOpenEditScanPath(sp)}
                          >
                            {t("media.admin.edit")}
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => handleExportScanPath(sp)}
                          >
                            {t("media.admin.export")}
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => handleImportScanPath(sp)}
                          >
                            {t("media.admin.import")}
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            colorScheme="warning"
                            onClick={() => handleClearScanPathDB(sp)}
                          >
                            {t("media.admin.clear")}
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            colorScheme="danger"
                            onClick={() => handleDeleteScanPath(sp)}
                          >
                            {t("global.delete")}
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
            <Text fontWeight="$semibold">
              {t("media.admin.items_total", { total: total() })}
            </Text>
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
                        <SelectOptionText>
                          {t("media.admin.all_paths")}
                        </SelectOptionText>
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
                placeholder={t("media.admin.search_placeholder")}
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
                  {t("media.admin.per_page")}
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
                  {props.mediaType === "image"
                    ? t("media.admin.unit_image")
                    : t("media.admin.unit_item")}
                </Text>
              </HStack>
            </HStack>
          </VStack>

          <Table>
            <Thead>
              <Tr>
                <Th>{t("media.admin.col_file_name")}</Th>
                <Th>{t("media.admin.col_name")}</Th>
                <Th>{t("media.admin.col_cover")}</Th>
                <Th>{t("media.admin.col_scan_path")}</Th>
                <Th>{t("media.admin.col_release_date")}</Th>
                <Th>{t("media.admin.col_rating")}</Th>
                <Th>{t("media.admin.col_hidden")}</Th>
                <Th>{t("media.admin.col_actions")}</Th>
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
                          {t("media.admin.no_items")}
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
                              {t("media.admin.edit")}
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
                              {t("global.delete")}
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
                {t("media.admin.prev_page")}
              </Button>
              <Text fontSize="$sm" color="$neutral11">
                {t("media.admin.page_info", {
                  page: page(),
                  totalPages: totalPages(),
                  total: total(),
                })}
              </Text>
              <Button
                size="xs"
                variant="ghost"
                disabled={page() >= totalPages()}
                onClick={() => setPage((p) => Math.min(totalPages(), p + 1))}
              >
                {t("media.admin.next_page")}
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
            {editingScanPath()?.id
              ? t("media.admin.edit_scan_path")
              : t("media.admin.add_scan_path")}
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing="$4" alignItems="stretch">
              <FormControl>
                <FormLabel>{t("media.admin.col_path_name")}</FormLabel>
                <Input
                  placeholder={t("media.admin.name_placeholder")}
                  value={editingScanPath()?.name ?? ""}
                  onInput={(e) =>
                    setEditingScanPath((sp) => ({
                      ...sp!,
                      name: e.currentTarget.value,
                    }))
                  }
                />
                <FormHelperText>{t("media.admin.name_helper")}</FormHelperText>
              </FormControl>
              <FormControl>
                <FormLabel>{t("media.admin.col_scan_path")}</FormLabel>
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
                <FormHelperText>
                  {t("media.admin.scan_path_helper")}
                </FormHelperText>
              </FormControl>
              <FormControl>
                <FormLabel>{t("media.admin.col_type_tags")}</FormLabel>
                <Input
                  placeholder={t("media.admin.type_tag_placeholder")}
                  value={editingScanPath()?.type_tag ?? ""}
                  onInput={(e) =>
                    setEditingScanPath((sp) => ({
                      ...sp!,
                      type_tag: e.currentTarget.value,
                    }))
                  }
                />
                <FormHelperText>
                  {t("media.admin.type_tag_helper")}
                </FormHelperText>
              </FormControl>
              <FormControl>
                <FormLabel>{t("media.admin.col_content_tags")}</FormLabel>
                <Input
                  placeholder={t("media.admin.content_tags_placeholder")}
                  value={editingScanPath()?.content_tags ?? ""}
                  onInput={(e) =>
                    setEditingScanPath((sp) => ({
                      ...sp!,
                      content_tags: e.currentTarget.value,
                    }))
                  }
                />
                <FormHelperText>
                  {t("media.admin.content_tags_helper")}
                </FormHelperText>
              </FormControl>
              <HStack spacing="$6" flexWrap="wrap">
                <FormControl
                  display="flex"
                  alignItems="center"
                  gap="$2"
                  w="auto"
                >
                  <FormLabel m="0">
                    {t("media.admin.path_merge_mode")}
                  </FormLabel>
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
                  <FormLabel m="0">{t("media.admin.enable_scrape")}</FormLabel>
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
                {t("media.admin.media_type_fixed", { type: props.title })}
              </Text>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing="$2">
              <Button
                variant="ghost"
                onClick={() => setShowScanPathModal(false)}
              >
                {t("global.cancel")}
              </Button>
              <Button
                colorScheme="accent"
                loading={scanPathSaving()}
                onClick={handleSaveScanPath}
              >
                {t("global.save")}
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
          <ModalHeader>{t("media.admin.edit_item_title")}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing="$3" alignItems="stretch">
              <For
                each={[
                  { key: "scraped_name", label: t("media.admin.item_name") },
                  { key: "cover", label: t("media.admin.item_cover_url") },
                  {
                    key: "release_date",
                    label: t("media.admin.item_release_date"),
                  },
                  { key: "genre", label: t("media.admin.item_genre") },
                  { key: "authors", label: t("media.admin.item_authors") },
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
                <FormLabel>{t("media.admin.rating_label")}</FormLabel>
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
                <FormLabel>{t("media.admin.summary")}</FormLabel>
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
                {t("global.cancel")}
              </Button>
              <Button colorScheme="accent" onClick={handleSaveItem}>
                {t("global.save")}
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
                {t("global.cancel")}
              </Button>
              <Button
                colorScheme={confirmState()?.danger ? "danger" : "accent"}
                loading={confirming()}
                onClick={runConfirm}
              >
                {confirmState()?.confirmText || t("global.confirm")}
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  )
}

// ==================== 4个具体管理页 ====================

export const VideoManage = () => {
  const t = useT()
  return (
    <MediaManagePage
      mediaType="video"
      title={t("media.admin.title_video")}
      icon="🎬"
    />
  )
}

export const MusicManage = () => {
  const t = useT()
  return (
    <MediaManagePage
      mediaType="music"
      title={t("media.admin.title_music")}
      icon="🎵"
    />
  )
}

export const ImageManage = () => {
  const t = useT()
  return (
    <MediaManagePage
      mediaType="image"
      title={t("media.admin.title_image")}
      icon="🖼️"
    />
  )
}

export const BookManage = () => {
  const t = useT()
  return (
    <MediaManagePage
      mediaType="book"
      title={t("media.admin.title_book")}
      icon="📚"
    />
  )
}
