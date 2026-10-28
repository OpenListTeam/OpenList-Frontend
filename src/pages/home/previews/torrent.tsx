import {
  VStack,
  HStack,
  Text,
  Button,
  Badge,
  Heading,
  Box,
  Checkbox,
  Divider,
  Alert,
  AlertIcon,
  Textarea,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Tooltip,
  IconButton,
  SimpleGrid,
  createDisclosure,
} from "@hope-ui/solid"
import { createEffect, createSignal, For, JSX, onMount, Show } from "solid-js"
import { getSettingBool, objStore } from "~/store"
import {
  TorrentInfo,
  CASInfo,
  Resp,
  SeedFormat,
  SeedInfo,
  SeedParseResult,
  SeedHashAlgorithm,
  SeedHashMatrix,
  SeedHashSelection,
  SeedSaveCapabilities,
} from "~/types"
import { useLink, usePath, useRouter, useT, useUtil } from "~/hooks"
import {
  formatDate,
  fsGet,
  handleResp,
  notify,
  offlineDownload,
  r,
  seedConvert,
  seedOfflineDownload,
  seedParse,
  seedRapidUpload,
  seedSaveCapabilities,
  seedUpdate,
} from "~/utils"
import { FolderChooseInput, HashMatrixTable, SelectWrapper } from "~/components"
import axios from "axios"
import bencode from "bencode"
import crypto from "crypto-js"
import { TbCopy, TbRefresh, TbTrash } from "solid-icons/tb"
import {
  BsDownload,
  BsExclamationCircleFill,
  BsHash,
  BsHdd,
  BsInfoCircle,
  BsLightningChargeFill,
} from "solid-icons/bs"
import { FiExternalLink } from "solid-icons/fi"

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

function utf8Decode(data: Uint8Array | undefined): string {
  if (!data) return ""
  return crypto.enc.Utf8.stringify(crypto.lib.WordArray.create(data))
}

/** 保存区的小标签：图标 + 文案，统一圆角与底色 */
const SeedInfoTag = (props: {
  icon: JSX.Element
  label: string
  color?: string
  cursor?: string
}) => (
  <HStack
    spacing="$1"
    alignItems="center"
    px="$2"
    py="2px"
    bgColor="$neutral3"
    borderRadius="$full"
    color={props.color || "$neutral11"}
    flexShrink={0}
    cursor={props.cursor}
  >
    {props.icon}
    <Text fontSize="$xs">{props.label}</Text>
  </HStack>
)

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// 本地解析 torrent 文件，避免调用后端API
// 与后端 ParseTorrent 行为对齐：返回 TorrentInfo 结构 + 检测 x-cas 扩展
function parseLocalTorrent(buffer: Uint8Array): TorrentInfo {
  const data = bencode.decode(buffer as any)
  const info = data.info
  if (!info) {
    throw new Error("Invalid torrent: missing info dict")
  }

  // 计算 info_hash（SHA1 of bencoded info dict）
  const infoEncoded = bencode.encode(info) as unknown as Uint8Array
  const infoHash = crypto
    .SHA1(crypto.lib.WordArray.create(infoEncoded))
    .toString()

  // 提取名称
  const name = utf8Decode(info.name)

  // 提取分片信息
  const pieceLength: number = info["piece length"] || 0
  const pieces: Uint8Array = info.pieces || new Uint8Array(0)
  const pieceCount = Math.floor(pieces.byteLength / 20)

  // 提取文件列表
  const files: TorrentInfo["files"] = []
  let totalSize = 0
  if (Array.isArray(info.files) && info.files.length > 0) {
    // 多文件模式
    for (const f of info.files) {
      const pathParts: string[] = (f.path || []).map((p: Uint8Array) =>
        utf8Decode(p),
      )
      const size: number = f.length || 0
      files.push({ path: pathParts.join("/"), size })
      totalSize += size
    }
  } else {
    // 单文件模式
    const size: number = info.length || 0
    files.push({ path: name, size })
    totalSize = size
  }

  // 检测 CAS 扩展（key: "x-cas"）
  let hasCas = false
  let cas: CASInfo | undefined = undefined
  const casDict = data["x-cas"]
  if (casDict && typeof casDict === "object") {
    const fileMd5 = utf8Decode(casDict["file_md5"])
    const sliceMd5 = utf8Decode(casDict["slice_md5"])
    if (fileMd5 && sliceMd5) {
      hasCas = true
      cas = {
        file_md5: fileMd5,
        slice_md5: sliceMd5,
        slice_size: casDict["slice_size"] || 0,
        cloud: utf8Decode(casDict["cloud"]),
      }
    }
  }

  return {
    name,
    total_size: totalSize,
    piece_length: pieceLength,
    piece_count: pieceCount,
    info_hash: infoHash,
    files,
    has_cas: hasCas,
    cas,
  }
}

function toMagnetUrl(torrentBuffer: Uint8Array): string {
  const data = bencode.decode(torrentBuffer as any)
  const infoEncode = bencode.encode(data.info) as unknown as Uint8Array
  const infoHash = crypto
    .SHA1(crypto.lib.WordArray.create(infoEncode))
    .toString()
  const params: Record<string, unknown> = {}
  if (Number.isInteger(data?.info?.length)) params.xl = data.info.length
  if (data.info.name) params.dn = utf8Decode(data.info.name)
  if (data.announce) params.tr = utf8Decode(data.announce)
  return `magnet:?xt=urn:btih:${infoHash}&${new URLSearchParams(
    params as Record<string, string>,
  ).toString()}`
}

const ALGORITHMS: SeedHashAlgorithm[] = ["md5", "sha1", "sha256"]

const DELETE_POLICIES = [
  "upload_download_stream",
  "delete_on_upload_succeed",
  "delete_on_upload_failed",
  "delete_never",
  "delete_always",
] as const

// 格式完整显示名称：OSS 显示格式名，CAS 显示完整名称，BT 显示为种子文件。
const FORMAT_DISPLAY: Record<string, string> = {
  oss: "OpenList Sharing Seed",
  cas: "Content Addressable Storage",
  torrent: "BitTorrent",
}

// 每个文件展示一行，包含哈希复制、分片弹窗、预览、删除、注释、重算等操作
const SeedFileRow = (props: {
  file: SeedInfo["files"][number]
  selected: boolean
  onToggle: () => void
  saveMethod?: string
  pieceSize: number
  onPreview: () => void
  onRemove: () => void
  onRecalc: () => void
  onCommentCopy: () => void
}) => {
  const t = useT()
  const { copy } = useUtil()

  const hashes = () => props.file.hashes || {}
  const pieceHashes = () => hashes().pieces || {}
  const pieceCount = () => {
    const perAlgo = pieceHashes()
    const counts = (["md5", "sha1", "sha256"] as const)
      .map((algo) => perAlgo[algo]?.length ?? 0)
      .filter((n) => n > 0)
    if (counts.length > 0) return Math.max(...counts)
    if (props.file.size && props.pieceSize > 0)
      return Math.ceil(props.file.size / props.pieceSize)
    return 0
  }
  const hasPieces = () => pieceCount() > 0

  const piecesDisclosure = createDisclosure()

  const copyHash = (algo: SeedHashAlgorithm) => {
    const hash = hashes()[algo]
    if (hash) void copy(hash)
  }

  const copyAllPieces = (algo: SeedHashAlgorithm) => {
    const list = pieceHashes()[algo]
    if (list && list.length) void copy(list.join("\n"))
  }

  const hashButton = (algo: SeedHashAlgorithm) => {
    const hash = hashes()[algo]
    return (
      <Tooltip
        label={
          hash ? hash : t("home.transfer_seed.hash_missing", { alg: algo })
        }
      >
        <Button
          size="xs"
          variant="outline"
          colorScheme={hash ? "neutral" : undefined}
          disabled={!hash}
          onClick={() => copyHash(algo)}
        >
          {algo.toUpperCase()}
        </Button>
      </Tooltip>
    )
  }

  return (
    <Box
      border="1px solid $neutral6"
      borderRadius="$md"
      p="$2"
      mb="$2"
      _hover={{ bg: "$neutral2" }}
    >
      <HStack spacing="$2" alignItems="center" flexWrap="wrap">
        <Checkbox
          size="sm"
          checked={props.selected}
          onChange={props.onToggle}
        />
        <Text
          fontSize="$sm"
          flex={1}
          minW="120px"
          css={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={props.file.path}
        >
          {props.file.path}
        </Text>
        <HStack spacing="$1">
          <For each={ALGORITHMS}>{(algo) => hashButton(algo)}</For>
          <Tooltip
            label={
              hasPieces()
                ? t("home.transfer_seed.piece_info", {
                    count: String(pieceCount()),
                    size: formatFileSize(props.pieceSize),
                  })
                : t("home.transfer_seed.piece_hashes")
            }
          >
            <Button
              size="xs"
              variant="outline"
              colorScheme={hasPieces() ? "accent" : undefined}
              disabled={!hasPieces()}
              onClick={piecesDisclosure.onOpen}
            >
              {t("home.transfer_seed.piece_hashes")}
            </Button>
          </Tooltip>
        </HStack>
        <Text fontSize="$xs" color="$neutral10" flexShrink={0}>
          {formatFileSize(props.file.size)}
        </Text>
        <Tooltip label={t("home.transfer_seed.preview_file")}>
          <IconButton
            icon={<FiExternalLink />}
            aria-label={t("home.transfer_seed.preview_file")}
            size="xs"
            variant="ghost"
            onClick={props.onPreview}
          />
        </Tooltip>
        <Tooltip
          label={props.file.comment || t("home.transfer_seed.no_comment")}
        >
          <IconButton
            icon={<BsInfoCircle />}
            aria-label={t("home.transfer_seed.copy_comment")}
            size="xs"
            variant="ghost"
            disabled={!props.file.comment}
            onClick={props.onCommentCopy}
          />
        </Tooltip>
        <Tooltip label={t("home.transfer_seed.recalc_file")}>
          <IconButton
            icon={<TbRefresh />}
            aria-label={t("home.transfer_seed.recalc_file")}
            size="xs"
            variant="ghost"
            onClick={props.onRecalc}
          />
        </Tooltip>
        <Tooltip label={t("home.transfer_seed.remove_file")}>
          <IconButton
            icon={<TbTrash />}
            aria-label={t("home.transfer_seed.remove_file")}
            size="xs"
            variant="ghost"
            colorScheme="danger"
            onClick={props.onRemove}
          />
        </Tooltip>
        <Show when={props.saveMethod}>
          <Badge colorScheme={methodBadgeColor(props.saveMethod!)}>
            {t(`home.transfer_seed.method_${props.saveMethod!}`)}
          </Badge>
        </Show>
      </HStack>

      {/* 分片哈希弹窗 */}
      <Modal
        size="lg"
        opened={piecesDisclosure.isOpen()}
        onClose={piecesDisclosure.onClose}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            {t("home.transfer_seed.piece_hashes")} · {props.file.path}
          </ModalHeader>
          <ModalBody>
            <Text fontSize="$xs" color="$neutral10" mb="$2">
              {t("home.transfer_seed.piece_info", {
                count: String(pieceCount()),
                size: formatFileSize(props.pieceSize),
              })}
            </Text>
            <For each={ALGORITHMS}>
              {(algo) => {
                const list = () => pieceHashes()[algo]
                return (
                  <Show when={list()?.length}>
                    <Box mb="$3">
                      <HStack justifyContent="space-between" mb="$1">
                        <Text fontSize="$sm" fontWeight="$semibold">
                          {t("home.transfer_seed.piece_hash_title", {
                            alg: algo.toUpperCase(),
                          })}
                        </Text>
                        <Button
                          size="xs"
                          leftIcon={<TbCopy />}
                          onClick={() => copyAllPieces(algo)}
                        >
                          {t("home.transfer_seed.copy_all_hashes")}
                        </Button>
                      </HStack>
                      <Box
                        maxH="160px"
                        overflowY="auto"
                        fontFamily="$mono"
                        fontSize="$xs"
                        p="$2"
                        bg="$neutral2"
                        borderRadius="$sm"
                      >
                        <For each={list()}>
                          {(hash, index) => (
                            <Text css={{ wordBreak: "break-all" }}>
                              {index()}: {hash}
                            </Text>
                          )}
                        </For>
                      </Box>
                    </Box>
                  </Show>
                )
              }}
            </For>
          </ModalBody>
          <ModalFooter>
            <Button colorScheme="neutral" onClick={piecesDisclosure.onClose}>
              {t("global.close")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}

function methodBadgeColor(
  method: string,
): "success" | "info" | "warning" | "danger" {
  switch (method) {
    case "189pc_cas":
    case "put_url":
      return "success"
    case "offline_download":
      return "info"
    case "download_required":
      return "warning"
    default:
      return "danger"
  }
}

const TorrentPreview = () => {
  const t = useT()
  const { proxyLink, rawLink } = useLink()
  const { isShare, pathname, to } = useRouter()
  const { refresh } = usePath()
  const { copy } = useUtil()

  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")
  const [torrentInfo, setTorrentInfo] = createSignal<SeedInfo | null>(null)
  const [torrentData, setTorrentData] = createSignal("")
  const [selectedFiles, setSelectedFiles] = createSignal<number[]>([])
  const [destination, setDestination] = createSignal(
    pathname().split("/").slice(0, -1).join("/") || "/",
  )
  const [destinationProvider, setDestinationProvider] = createSignal("")
  // 转换目标支持多选；默认一个都不选（只看不改），选了才开始转换
  const [targetFormats, setTargetFormats] = createSignal<SeedFormat[]>([])
  const [editComment, setEditComment] = createSignal("")
  const [operation, setOperation] = createSignal("")
  const [transitPath, setTransitPath] = createSignal("")
  // 重算源目录：种子文件对应源文件所在目录（默认当前浏览目录）
  const [recalcSourceDir, setRecalcSourceDir] = createSignal("")
  const [recalcMatrix, setRecalcMatrix] = createSignal<SeedHashMatrix>({
    md5: { whole: false, pieces: false },
    sha1: { whole: false, pieces: false },
    sha256: { whole: false, pieces: false },
  })
  // 用户是否手动改过矩阵。只有手动改过才进入「重算并保存」，
  // 否则打开种子时「已带哈希」的默认勾选会被误判成重算任务。
  const [recalcTouched, setRecalcTouched] = createSignal(false)
  const [updateChannel, setUpdateChannel] = createSignal(false)
  const [saveCapabilities, setSaveCapabilities] =
    createSignal<SeedSaveCapabilities | null>(null)

  // 预览文件确认弹窗
  const previewDisclosure = createDisclosure()
  const [previewFileIndex, setPreviewFileIndex] = createSignal<number | null>(
    null,
  )
  // 删除文件确认弹窗
  const removeDisclosure = createDisclosure()
  const [removeFileIndex, setRemoveFileIndex] = createSignal<number | null>(
    null,
  )
  // 单文件重算弹窗
  const recalcDisclosure = createDisclosure()
  const [recalcFileIndex, setRecalcFileIndex] = createSignal<number | null>(
    null,
  )

  // 离线下载弹窗（复用工具选择逻辑）
  const offlineDisclosure = createDisclosure()
  const [offlineTools, setOfflineTools] = createSignal<string[]>([])
  const [offlineTool, setOfflineTool] = createSignal("")
  const [offlineDeletePolicy, setOfflineDeletePolicy] = createSignal(
    "upload_download_stream",
  )
  const [offlineLoading, setOfflineLoading] = createSignal(false)

  const loadOfflineTools = async () => {
    const resp = await r.get<string[]>("/public/offline_download_tools")
    handleResp(resp as unknown as Resp<string[]>, (data) => {
      if (Array.isArray(data)) {
        setOfflineTools(data)
        setOfflineTool(data[0] || "")
      }
    })
  }

  // Keep the delete policy inside the options offered for the selected tool.
  createEffect(() => {
    const tool = offlineTool()
    const available = DELETE_POLICIES.filter((policy) =>
      policy === "upload_download_stream" ? tool === "SimpleHttp" : true,
    )
    if (
      !available.includes(
        offlineDeletePolicy() as (typeof DELETE_POLICIES)[number],
      )
    ) {
      setOfflineDeletePolicy(available[0] || "delete_on_upload_succeed")
    }
  })

  // 打开离线下载弹窗：BT 种子总是可以离线下载（转 magnet）
  const openOfflineDialog = () => {
    if (selectedFiles().length === 0) {
      notify.error(t("home.transfer_seed.select_at_least_one"))
      return
    }
    void loadOfflineTools()
    offlineDisclosure.onOpen()
  }

  // 确认离线下载：BT 用 magnet，其余用 seed 逐文件离线下载
  const confirmOfflineDownload = async () => {
    const info = torrentInfo()
    if (!info || !torrentData()) return
    if (!offlineTool()) {
      notify.error(t("home.transfer_seed.tool_required"))
      return
    }
    setOfflineLoading(true)
    try {
      if (inferFormat() === "torrent") {
        // BT 种子：转 magnet 后整体离线下载
        const buffer = new Uint8Array(
          atob(torrentData())
            .split("")
            .map((c) => c.charCodeAt(0)),
        )
        const magnet = toMagnetUrl(buffer)
        const resp = await offlineDownload(
          destination(),
          [magnet],
          offlineTool(),
          offlineDeletePolicy(),
        )
        handleResp(resp, () => {
          notify.success(t("global.success"))
          offlineDisclosure.onClose()
          refresh(undefined, true)
        })
      } else {
        // 有 source 的种子：逐文件离线下载
        const resp = await seedOfflineDownload({
          ...request(),
          tool: offlineTool(),
          delete_policy: offlineDeletePolicy(),
        })
        handleResp(resp, (data) => {
          applyResult(data)
          const results = Array.isArray(data?.results) ? data.results : []
          const failures = results.filter(
            (result: { method?: string; error?: string }) =>
              result.method === "unavailable" || !!result.error,
          )
          if (failures.length > 0) {
            notify.error(
              failures
                .map(
                  (result: { path?: string; error?: string }) =>
                    `${result.path || "File"}: ${
                      result.error || "Unavailable"
                    }`,
                )
                .join("\n"),
            )
            return
          }
          notify.success(t("global.success"))
          offlineDisclosure.onClose()
          refresh(undefined, true)
        })
      }
    } catch (err) {
      notify.error(String(err))
    } finally {
      setOfflineLoading(false)
    }
  }

  const inferFormat = (): SeedFormat => {
    const extension = objStore.obj.name.toLowerCase().split(".").pop()
    return extension === "cas" || extension === "oss" ? extension : "torrent"
  }

  // 格式徽章：OSS/CAS/BT 显示各自格式名，标题区则显示种子文件名。
  const formatDisplayName = () => {
    const format = torrentInfo()?.format || inferFormat()
    return FORMAT_DISPLAY[format] || format.toUpperCase()
  }

  // CAS 是否携带逐片 MD5 列表：有分片信息时不显示 legacy 警告。
  const hasCasPieces = () =>
    (torrentInfo()?.files || []).some(
      (file) => (file.hashes?.pieces?.md5?.length ?? 0) > 0,
    )

  const normalizeSeedInfo = (parsed: SeedParseResult): SeedInfo => {
    const nested = parsed.info || parsed.seed || parsed.data
    const value = (nested || parsed) as SeedInfo
    return {
      ...parsed,
      ...value,
      // 优先使用后端返回的规范化 format（oss/torrent/cas），seed.format 是
      // "openlist-sharing-seed" 这种完整标识，不能直接作为展示格式。
      format: (parsed.format as SeedFormat) || inferFormat(),
      name: value.name || parsed.name || objStore.obj.name,
      total_size: value.total_size || parsed.total_size || 0,
      files: Array.isArray(value.files)
        ? value.files
        : Array.isArray(parsed.files)
          ? parsed.files
          : [],
      conversions: value.conversions || parsed.conversions,
    }
  }

  // 种子内是否已带某个算法的整文件哈希 / 分片哈希。
  // 兼容两种来源：种子自身 hashes.pieces，以及旧格式顶层的 piece_hashes。
  const hasHashIn = (
    info: SeedInfo | null | undefined,
    algo: SeedHashAlgorithm,
  ) => {
    const files = info?.files || []
    return files.length > 0 && files.every((file) => !!file.hashes?.[algo])
  }
  const hasPiecesIn = (
    info: SeedInfo | null | undefined,
    algo: SeedHashAlgorithm,
  ) => {
    const files = info?.files || []
    return (
      files.length > 0 &&
      files.every((file) => {
        const pieces =
          file.hashes?.pieces?.[algo] || file.piece_hashes?.[algo] || []
        return pieces.length > 0
      })
    )
  }
  const seedHasHash = (algo: SeedHashAlgorithm) =>
    hasHashIn(torrentInfo(), algo)
  const seedHasPieces = (algo: SeedHashAlgorithm) =>
    hasPiecesIn(torrentInfo(), algo)

  // 目标格式是否真的「缺哈希」。矩阵全显示 in seed 时仍可能无法直接转换，
  // 那是结构性原因（如 piece 跨文件），不该再提示「补算缺失哈希」
  const targetMissingHashes = () =>
    targetFormats().some((format) =>
      format === "torrent"
        ? !seedHasPieces("sha1")
        : format === "cas"
          ? !seedHasHash("md5")
          : false,
    )

  // 从种子已有哈希初始化重算矩阵：种子已经提供的哈希默认勾上
  // （转换时原样保留），缺的留空，等用户显式要求再读文件补算。
  const initRecalcMatrix = (info: SeedInfo) => {
    const matrix: SeedHashMatrix = {
      md5: { whole: hasHashIn(info, "md5"), pieces: hasPiecesIn(info, "md5") },
      sha1: {
        whole: hasHashIn(info, "sha1"),
        pieces: hasPiecesIn(info, "sha1"),
      },
      sha256: {
        whole: hasHashIn(info, "sha256"),
        pieces: hasPiecesIn(info, "sha256"),
      },
    }
    setRecalcMatrix(matrix)
    // 初始化不算用户操作：只是把种子现状显示出来，不能因此进入「重算并保存」
    setRecalcTouched(false)
  }

  const setRecalcHash = (
    algo: SeedHashAlgorithm,
    scope: keyof SeedHashSelection,
    checked: boolean,
  ) => {
    setRecalcTouched(true)
    setRecalcMatrix((current) => ({
      ...current,
      [algo]: { ...current[algo], [scope]: checked },
    }))
  }

  // 重算源目录：默认当前浏览目录，可手动改为其它网盘目录
  const effectiveRecalcSourceDir = () =>
    recalcSourceDir().trim() || destination().trim()

  // 源文件路径 = 源目录 + 种子内相对路径
  const buildRecalcSourcePath = (filePath: string) => {
    const base = effectiveRecalcSourceDir().replace(/\/+$/, "")
    const rel = (filePath || "").replace(/^\/+/, "")
    return rel ? `${base}/${rel}` : base
  }

  const autoCASDirectAccess = async (info: SeedInfo) => {
    if (inferFormat() !== "cas" || info.files.length !== 1) return
    if (!getSettingBool("seed_cas_direct_access")) return
    if (!torrentData()) return
    try {
      // CAS 秒传目前仅天翼云(189pc)支持，先探测目标存储能力，
      // 避免在不支持的存储上弹出 "cannot reuse the available hashes" 错误。
      const capResp = await seedSaveCapabilities(
        torrentData(),
        objStore.obj.name,
        destination(),
      )
      if (capResp.code !== 200 || !capResp.data?.driver_supports?.cas_rapid)
        return
      const resp = await seedRapidUpload({
        seed_data: torrentData(),
        file_name: objStore.obj.name,
        path: destination(),
        selected_files: [0],
      })
      if (resp.code === 200) {
        const results = Array.isArray(resp.data?.results)
          ? resp.data.results
          : []
        const failed = results.filter(
          (r: { method?: string; error?: string }) =>
            r.method === "unavailable" || !!r.error,
        )
        if (failed.length > 0) {
          notify.error(
            `${t("home.transfer_seed.cas_direct_access_failed")}: ${
              failed[0]?.error || "Unavailable"
            }`,
          )
        } else {
          notify.success(t("home.transfer_seed.cas_direct_access_success"))
          refresh()
        }
      }
    } catch (err) {
      console.error("CAS direct access failed:", err)
    }
  }

  onMount(async () => {
    try {
      let resp
      try {
        resp = await axios.get(proxyLink(objStore.obj, true), {
          responseType: "arraybuffer",
        })
      } catch (_) {
        resp = await axios.get(rawLink(objStore.obj, true), {
          responseType: "arraybuffer",
        })
      }

      const buffer = resp.data as ArrayBuffer
      const encoded = arrayBufferToBase64(buffer)
      setTorrentData(encoded)
      const parsed = await seedParse(encoded, objStore.obj.name)
      if (parsed.code === 200) {
        const info = normalizeSeedInfo(parsed.data)
        setTorrentInfo(info)
        setEditComment(info.comment || "")
        // 目标格式不预选：一打开就是「不转换」，由用户主动挑目标
        setTargetFormats([])
        setSelectedFiles(info.files.map((_, index) => index))
        initRecalcMatrix(info)
        void autoCASDirectAccess(info)
      } else if (inferFormat() === "torrent") {
        const legacy = parseLocalTorrent(new Uint8Array(buffer))
        const info = { ...legacy, format: "torrent" as SeedFormat }
        setTorrentInfo(info)
        setTargetFormats([])
        setSelectedFiles(legacy.files.map((_, index) => index))
        initRecalcMatrix(info)
      } else {
        throw new Error(parsed.message)
      }
    } catch (err) {
      console.error("Failed to parse transfer seed:", err)
      setError(`${t("home.transfer_seed.parse_failed")}: ${err}`)
    } finally {
      setLoading(false)
    }
  })

  let destinationRequest = 0
  createEffect(() => {
    const path = destination().trim()
    const requestId = ++destinationRequest
    if (!path) {
      setDestinationProvider("")
      setSaveCapabilities(null)
      return
    }
    void fsGet(path).then((resp) => {
      if (requestId === destinationRequest) {
        setDestinationProvider(
          resp.code === 200 ? resp.data.provider || "" : "",
        )
      }
    })
    // 探测每个文件在当前渠道下的秒传方式
    if (torrentData()) {
      void seedSaveCapabilities(torrentData(), objStore.obj.name, path).then(
        (resp) => {
          if (requestId === destinationRequest && resp.code === 200) {
            setSaveCapabilities(resp.data)
          }
        },
      )
    }
  })

  const operationSupported = (
    operationName: keyof NonNullable<SeedInfo["capabilities"]>,
  ) => torrentInfo()?.capabilities?.[operationName] === true

  const conversionSupported = () =>
    operationSupported("convert") &&
    targetFormats().every(
      (format) => torrentInfo()?.conversions?.[format]?.feasible === true,
    )

  // 点击切换目标格式；可以一个都不选（不转换，只改注释或补算哈希）
  const toggleTargetFormat = (format: SeedFormat) => {
    setTargetFormats((current) =>
      current.includes(format)
        ? current.filter((item) => item !== format)
        : [...current, format],
    )
  }

  // 缺哈希时只要有可用的源目录就允许转换（后端读文件补算）。
  // 这里必须用 effectiveRecalcSourceDir：输入框显示的就是它（默认回落到
  // 种子所在目录），用空信号判断会出现「界面上明明有目录，按钮却是灰的」。
  const canConvert = () => conversionSupported() || !!effectiveRecalcSourceDir()

  // 整个编辑区（转换 + 注释 + 保存）默认折叠
  const editDisclosure = createDisclosure()

  // 选了缺哈希的目标格式时自动展开，方便填源目录
  createEffect(() => {
    if (targetDiffers() && !conversionSupported()) {
      editDisclosure.onOpen()
    }
  })

  // 所选目标格式必需的哈希算法：只要格式被选中就强制，
  // 不再要求「与当前格式不同」——否则对已经是 torrent 的种子勾 BT 就失效
  const forcedHashAlgo = (algorithm: SeedHashAlgorithm) =>
    (algorithm === "sha1" && targetFormats().includes("torrent")) ||
    (algorithm === "md5" && targetFormats().includes("cas"))

  // 选中格式后自动勾上必需哈希（torrent → SHA1，CAS → MD5）；
  // 取消该格式时把「自动勾上的」还原成种子自身的状态（而不是一律清空），
  // 否则会连带清掉种子本来就已经提供的哈希
  let autoForcedAlgos: SeedHashAlgorithm[] = []
  createEffect(() => {
    const formats = targetFormats()
    const required: SeedHashAlgorithm[] = []
    if (formats.includes("torrent")) required.push("sha1")
    if (formats.includes("cas")) required.push("md5")
    const dropped = autoForcedAlgos.filter((algo) => !required.includes(algo))
    if (dropped.length > 0) {
      setRecalcMatrix((previous) => {
        const next = { ...previous }
        for (const algo of dropped) {
          next[algo] = {
            whole: hasHashIn(torrentInfo(), algo),
            pieces: hasPiecesIn(torrentInfo(), algo),
          }
        }
        return next
      })
    }
    if (required.length > 0) {
      setRecalcMatrix((previous) => {
        const next = { ...previous }
        for (const algo of required) next[algo] = { whole: true, pieces: true }
        return next
      })
    }
    autoForcedAlgos = required
  })

  // ── 统一「编辑并保存」：注释 / 转换 / 重算哈希 一个按钮完成 ──────────────
  const currentFormat = () => torrentInfo()?.format
  // 没选目标格式 = 不转换，只改注释/补算哈希；选的就是当前格式同样不需要转换
  // （后端对「目标 = 当前格式」直接返回可行，不会再把合法 torrent 判成不可转换）
  const targetDiffers = () => {
    const current = currentFormat()
    const targets = targetFormats()
    if (targets.length === 0) return false
    // 格式未知时按转换处理，否则选了格式却没有任何反应
    if (!current) return true
    return targets.length !== 1 || targets[0] !== current
  }
  const hasRecalcSelection = () =>
    recalcTouched() &&
    ALGORITHMS.some(
      (algo) => recalcMatrix()[algo].whole || recalcMatrix()[algo].pieces,
    )

  // 只有需要读文件时才显示源目录（要转换，或勾了重算矩阵）
  const needSourceDir = () =>
    targetDiffers() ||
    (operationSupported("recalculate") && hasRecalcSelection())

  const applyMode = () =>
    targetDiffers()
      ? "convert"
      : hasRecalcSelection()
        ? "recalculate"
        : "update"

  const applyEnabled = () => {
    if (applyMode() === "convert") {
      return operationSupported("convert") && canConvert()
    }
    if (applyMode() === "recalculate") {
      return operationSupported("recalculate") && selectedFiles().length > 0
    }
    return operationSupported("edit")
  }

  const applyLabel = () => {
    if (applyMode() === "convert") {
      if (conversionSupported()) {
        return t("home.transfer_seed.convert_and_save")
      }
      // 缺哈希才说「补算缺失哈希」，否则是结构问题，如实说「从文件重算」
      return targetMissingHashes()
        ? t("home.transfer_seed.convert_and_rehash")
        : t("home.transfer_seed.convert_rehash_files")
    }
    if (applyMode() === "recalculate") {
      return t("home.transfer_seed.recalculate_and_save")
    }
    return t("global.save")
  }

  const applyChanges = () => runOperation(applyMode())

  // 按钮禁用时的悬浮原因：逐条列出不可转换字段 + 补算所需条件
  const applyBlockedReason = () => {
    if (applyEnabled()) return ""
    if (applyMode() === "convert") {
      const reasons = targetFormats()
        .filter(
          (format) => torrentInfo()?.conversions?.[format]?.feasible !== true,
        )
        .flatMap((format) =>
          (torrentInfo()?.conversions?.[format]?.missing || []).map(
            (reason) => `${format.toUpperCase()}: ${reason}`,
          ),
        )
      // 只有确实没有可用目录时才提示「去选源目录」，否则输入框里已经有值
      if (!effectiveRecalcSourceDir()) {
        reasons.push(t("home.transfer_seed.rehash_need_source_dir"))
      }
      return reasons.join("\n")
    }
    if (applyMode() === "recalculate") {
      return t("home.transfer_seed.select_at_least_one")
    }
    return ""
  }

  const request = () => ({
    seed_data: torrentData(),
    file_name: objStore.obj.name,
    path: destination(),
    selected_files: selectedFiles(),
    update_channel: updateChannel(),
  })

  const applyResult = (
    data: Awaited<ReturnType<typeof seedUpdate>>["data"],
  ) => {
    if (data?.seed_data) setTorrentData(data.seed_data)
    if (data?.seed) {
      setTorrentInfo(data.seed)
      // 保存后矩阵跟着新种子刷新，避免残留已经不成立的勾选
      initRecalcMatrix(data.seed)
    }
    const shareStatus = data?.share_status
    if (shareStatus && typeof shareStatus === "object") {
      const invalid = Object.entries(shareStatus).filter(([, valid]) => !valid)
      if (invalid.length > 0) {
        notify.error(
          `${t("home.transfer_seed.invalid_share")}: ${invalid
            .map(([id]) => id)
            .join(", ")}`,
        )
      }
    }
  }

  const runOperation = async (name: string) => {
    const info = torrentInfo()
    if (!info || !torrentData()) return
    if (name !== "convert" && selectedFiles().length === 0) {
      notify.error(t("home.transfer_seed.select_at_least_one"))
      return
    }
    if (name === "transit" && !transitPath().trim()) {
      notify.error(t("home.transfer_seed.transit_path_required"))
      return
    }
    if (name === "recalculate" && !effectiveRecalcSourceDir().trim()) {
      notify.error(t("home.transfer_seed.source_dir_required"))
      return
    }
    setOperation(name)
    try {
      const resp =
        name === "rapid"
          ? await seedRapidUpload(request())
          : name === "offline" || name === "transit"
            ? await seedOfflineDownload({
                ...request(),
                transit_path: name === "transit" ? transitPath() : undefined,
                options: name === "transit" ? { mode: "transfer" } : undefined,
              })
            : name === "convert"
              ? await seedConvert({
                  ...request(),
                  formats: targetFormats(),
                  // 转换时一并保存注释，避免先保存再转换两次请求
                  comment: editComment(),
                  // 无法直接转换时，用源目录里的文件补算缺失哈希
                  compute_missing: !conversionSupported(),
                  file_base_path: !conversionSupported()
                    ? effectiveRecalcSourceDir()
                    : undefined,
                })
              : await seedUpdate({
                  ...request(),
                  recalc_files:
                    name === "recalculate"
                      ? selectedFiles().map((index) => ({
                          path: info.files[index]?.path,
                          source_path: buildRecalcSourcePath(
                            info.files[index]?.path,
                          ),
                        }))
                      : undefined,
                  hash_matrix:
                    name === "recalculate" ? recalcMatrix() : undefined,
                  options: {
                    comment: editComment(),
                    recalculate: name === "recalculate",
                  },
                })
      handleResp(resp, (data) => {
        // 转换产物是「另一个文件」，不覆盖当前预览的种子内容，只同步注释
        if (name === "convert") {
          setTorrentInfo((current) =>
            current ? { ...current, comment: editComment() } : current,
          )
        } else {
          applyResult(data)
        }
        const results = Array.isArray(data?.results) ? data.results : []
        const failures = results.filter(
          (result: { method?: string; error?: string }) =>
            result.method === "unavailable" || !!result.error,
        )
        if (failures.length > 0) {
          notify.error(
            failures
              .map(
                (result: { path?: string; error?: string }) =>
                  `${result.path || "File"}: ${result.error || "Unavailable"}`,
              )
              .join("\n"),
          )
          return
        }
        notify.success(t("global.success"))
        if (data.channel) {
          setTorrentInfo((current) =>
            current ? { ...current, channel: data.channel } : current,
          )
        }
        refresh(undefined, true)
      })
    } catch (err) {
      notify.error(String(err))
    } finally {
      setOperation("")
    }
  }

  const saveMethodByPath = (path: string): string | undefined => {
    const files = saveCapabilities()?.files
    if (!files) return undefined
    return files.find((f) => f.path === path)?.method
  }

  // 目标驱动支持的秒传方式描述
  const driverSupportsText = () => {
    const supports = saveCapabilities()?.driver_supports
    if (!supports) return ""
    const parts: string[] = []
    if (supports.cas_rapid) {
      const algos = supports.rapid_hash_algos || []
      const algosText = algos.length > 0 ? `(${algos.join("/")})` : ""
      parts.push(`${t("home.transfer_seed.rapid_upload")} ${algosText}`)
    }
    if (supports.put_url) parts.push(t("home.transfer_seed.put_url"))
    if (supports.offline_download) parts.push(t("home.transfer_seed.offline"))
    return parts.join(" / ")
  }

  // 驱动所需的哈希算法
  const requiredHashesText = () => {
    const supports = saveCapabilities()?.driver_supports
    if (!supports?.cas_rapid) return ""
    const algos = supports.rapid_hash_algos || []
    if (algos.length === 0) return ""
    return `${t("home.transfer_seed.requires_hashes")}: ${algos.join(", ")}`
  }

  // 种子中可用的哈希算法
  const availableHashesText = () => {
    const info = torrentInfo()
    if (!info?.files?.[0]?.hashes) return ""
    const hashes = info.files[0].hashes
    const available: string[] = []
    if (hashes.md5) available.push("MD5")
    if (hashes.sha1) available.push("SHA1")
    if (hashes.sha256) available.push("SHA256")
    if ((hashes as any).gcid) available.push("GCID")
    if (available.length === 0) return ""
    return `${t("home.transfer_seed.available_hashes")}: ${available.join(", ")}`
  }

  // 检查种子是否包含目标驱动所需的哈希
  const hasRequiredHashes = () => {
    const supports = saveCapabilities()?.driver_supports
    if (!supports?.cas_rapid) return false
    const required = supports.rapid_hash_algos || []
    if (required.length === 0) return true // 驱动未明确要求，假设可以
    const info = torrentInfo()
    if (!info?.files?.[0]?.hashes) return false
    const hashes = info.files[0].hashes
    // 检查是否至少有一个所需的哈希
    return required.some((algo) => {
      const key = algo.toLowerCase() as keyof typeof hashes
      return !!(hashes[key] || (hashes as any)[algo.toLowerCase()])
    })
  }

  // 无法秒传的原因
  const rapidUnavailableReason = () => {
    const supports = saveCapabilities()?.driver_supports
    if (!supports) return t("home.transfer_seed.loading_capabilities")
    if (!supports.cas_rapid) {
      return t("home.transfer_seed.driver_no_rapid")
    }
    if (!hasRequiredHashes()) {
      const required = supports.rapid_hash_algos || []
      return `${t("home.transfer_seed.missing_hashes")}: ${required.join(", ")}`
    }
    return ""
  }

  // 当前目标下是否有文件可以秒传（非下载类方式）
  const canRapidSave = () => {
    const files = saveCapabilities()?.files
    if (!files?.length) return false
    return files.some(
      (file) =>
        file.method === "rapid_upload" ||
        file.method === "189pc_cas" ||
        file.method === "put_url",
    )
  }

  // 预览单个文件：先秒传保存，再跳转预览
  const confirmPreviewFile = async () => {
    const index = previewFileIndex()
    const info = torrentInfo()
    if (index === null || !info || !torrentData()) return
    const file = info.files[index]
    if (!file) return
    previewDisclosure.onClose()
    setOperation("preview")
    try {
      const resp = await seedRapidUpload({
        seed_data: torrentData(),
        file_name: objStore.obj.name,
        path: destination(),
        selected_files: [index],
      })
      handleResp(resp, (data) => {
        const results = Array.isArray(data?.results) ? data.results : []
        const failed = results.filter(
          (r: { method?: string; error?: string }) =>
            r.method === "unavailable" || !!r.error,
        )
        if (failed.length > 0) {
          notify.error(
            `${t("home.transfer_seed.preview_rapid_failed")}: ${
              failed[0]?.error || "Unavailable"
            }`,
          )
          return
        }
        notify.success(t("home.transfer_seed.preview_rapid_success"))
        const match = results.find(
          (result: { path?: string; target?: string }) =>
            result.path === file.path,
        )
        // Keep the full relative path (nested directories included) and prefer
        // the concrete path reported by the backend when it is available.
        const targetPath =
          match?.target ||
          `${destination().replace(/\/$/, "")}/${file.path.replace(/^\//, "")}`
        refresh(undefined, true)
        to(targetPath)
      })
    } catch (err) {
      notify.error(String(err))
    } finally {
      setOperation("")
      setPreviewFileIndex(null)
    }
  }

  // 删除单个文件
  const confirmRemoveFile = async () => {
    const index = removeFileIndex()
    const info = torrentInfo()
    if (index === null || !info || !torrentData()) return
    const file = info.files[index]
    if (!file) return
    removeDisclosure.onClose()
    setOperation("remove")
    try {
      const resp = await seedUpdate({
        seed_data: torrentData(),
        file_name: objStore.obj.name,
        remove_files: [file.path],
      })
      handleResp(resp, (data) => {
        applyResult(data)
        notify.success(t("global.delete_success"))
        setSelectedFiles((current) => current.filter((i) => i !== index))
        refresh(undefined, true)
      })
    } catch (err) {
      notify.error(String(err))
    } finally {
      setOperation("")
      setRemoveFileIndex(null)
    }
  }

  // 单文件重算
  const confirmRecalcFile = async () => {
    const index = recalcFileIndex()
    const info = torrentInfo()
    if (index === null || !info || !torrentData()) return
    const file = info.files[index]
    if (!file) return
    if (!effectiveRecalcSourceDir().trim()) {
      notify.error(t("home.transfer_seed.source_dir_required"))
      return
    }
    recalcDisclosure.onClose()
    setOperation("recalculate")
    try {
      const resp = await seedUpdate({
        seed_data: torrentData(),
        file_name: objStore.obj.name,
        recalc_files: [
          { path: file.path, source_path: buildRecalcSourcePath(file.path) },
        ],
        hash_matrix: recalcMatrix(),
        options: { comment: editComment(), recalculate: true },
      })
      handleResp(resp, (data) => {
        applyResult(data)
        notify.success(t("global.success"))
        refresh(undefined, true)
      })
    } catch (err) {
      notify.error(String(err))
    } finally {
      setOperation("")
      setRecalcFileIndex(null)
    }
  }

  // ── 保存方式：快速上传 / 离线下载 / 中转保存 合并为「下拉 + 保存」 ──
  type SaveMethod = "rapid" | "offline" | "transfer"
  const [saveMethod, setSaveMethod] = createSignal<SaveMethod>("rapid")
  const availableSaveMethods = (): SaveMethod[] => {
    const list: SaveMethod[] = []
    if (
      operationSupported("rapid_upload") &&
      canRapidSave() &&
      hasRequiredHashes()
    ) {
      list.push("rapid")
    }
    if (operationSupported("offline_download")) list.push("offline")
    if (operationSupported("transfer")) list.push("transfer")
    return list
  }
  createEffect(() => {
    const list = availableSaveMethods()
    if (!list.includes(saveMethod())) setSaveMethod(list[0] || "rapid")
  })
  const canSave = () =>
    availableSaveMethods().length > 0 && selectedFiles().length > 0
  const runSave = () => {
    const method = saveMethod()
    if (method === "rapid") void runOperation("rapid")
    else if (method === "offline") openOfflineDialog()
    else void runOperation("transit")
  }

  // 驱动能力详情：悬浮徽标里一次性展示，避免单独占一行
  const driverDetails = () => {
    const parts: string[] = []
    if (destinationProvider()) {
      parts.push(
        `${t("home.transfer_seed.destination_driver")}: ${destinationProvider()}`,
      )
    }
    if (driverSupportsText()) {
      parts.push(
        `${t("home.transfer_seed.driver_supports")}: ${driverSupportsText()}`,
      )
    }
    if (requiredHashesText()) parts.push(requiredHashesText())
    if (availableHashesText()) parts.push(availableHashesText())
    if (rapidUnavailableReason()) parts.push(rapidUnavailableReason())
    return parts.join(" · ")
  }

  // 秒传是否真的可用（能力 + 所需哈希齐全）
  const rapidReady = () => canRapidSave() && hasRequiredHashes()

  // 种子内可用的整文件哈希（紧凑展示：MD5/SHA1/SHA256）
  const hashSummary = () => {
    const hashes = torrentInfo()?.files?.[0]?.hashes
    const list: string[] = []
    if (hashes?.md5) list.push("MD5")
    if (hashes?.sha1) list.push("SHA1")
    if (hashes?.sha256) list.push("SHA256")
    return list.length > 0 ? list.join("/") : t("home.transfer_seed.no_hashes")
  }

  return (
    <VStack spacing="$4" w="$full" p="$4">
      <Show when={loading()}>
        <Text>{t("home.toolbar.offline_download_enhanced.parsing")}</Text>
      </Show>

      <Show when={error()}>
        <Text color="$danger9">{error()}</Text>
      </Show>

      <Show when={!loading() && !error() && torrentInfo()}>
        <VStack spacing="$3" alignItems="stretch" w="$full">
          {/* 种子信息卡片：标题 / 元信息 / 状态 / 备注 */}
          <Box border="1px solid $neutral5" borderRadius="$lg" p="$3">
            <HStack
              justifyContent="space-between"
              alignItems="flex-start"
              spacing="$3"
            >
              <VStack alignItems="flex-start" spacing="$1" flex="1" minW="0">
                <Heading size="sm" css={{ wordBreak: "break-all" }}>
                  {objStore.obj.name}
                </Heading>
                <Text fontSize="$xs" color="$neutral10">
                  {formatFileSize(torrentInfo()!.total_size)} ·{" "}
                  {torrentInfo()!.files.length}{" "}
                  {t("home.transfer_seed.file_count")}
                  <Show when={torrentInfo()!.created_at}>
                    {" · "}
                    {formatDate(torrentInfo()!.created_at!)}
                  </Show>
                </Text>
              </VStack>
              <VStack alignItems="flex-end" spacing="$1" flexShrink={0}>
                <Badge colorScheme="info">{formatDisplayName()}</Badge>
                <HStack spacing="$1" flexWrap="wrap" justifyContent="flex-end">
                  <Show when={torrentInfo()!.has_cas}>
                    <Badge colorScheme="success">
                      {t(
                        "home.toolbar.offline_download_enhanced.cas_supported",
                      )}
                    </Badge>
                  </Show>
                  <Show when={torrentInfo()!.share}>
                    <Badge
                      colorScheme={
                        torrentInfo()!.share?.valid ? "success" : "danger"
                      }
                    >
                      {torrentInfo()!.share?.valid
                        ? t("home.transfer_seed.share_valid")
                        : t("home.transfer_seed.share_invalid")}
                    </Badge>
                  </Show>
                  <Show when={torrentInfo()!.channel?.status}>
                    <Badge colorScheme="accent">
                      {torrentInfo()!.channel?.name ||
                        t("home.transfer_seed.channel")}
                      : {torrentInfo()!.channel?.status}
                    </Badge>
                  </Show>
                  <For each={torrentInfo()!.channels || []}>
                    {(channel) => (
                      <Badge colorScheme="accent">
                        {channel.driver}
                        {channel.mount_path ? `: ${channel.mount_path}` : ""}
                      </Badge>
                    )}
                  </For>
                </HStack>
              </VStack>
            </HStack>
            <Show when={torrentInfo()?.comment}>
              <Box mt="$2" pl="$2" borderLeft="2px solid $neutral6">
                <Text
                  fontSize="$sm"
                  color="$neutral11"
                  css={{ whiteSpace: "pre-line" }}
                >
                  {torrentInfo()!.comment}
                </Text>
              </Box>
            </Show>
          </Box>

          <Show when={torrentInfo()!.format === "cas" && !hasCasPieces()}>
            <Alert status="warning">
              <AlertIcon />
              {t("home.transfer_seed.cas_legacy_warning")}
            </Alert>
          </Show>
          <Show when={torrentInfo()!.trackers?.length}>
            <Box>
              <Text fontSize="$sm" fontWeight="$semibold">
                {t("home.transfer_seed.trackers")}
              </Text>
              <For each={torrentInfo()!.trackers}>
                {(tracker) => (
                  <Text
                    fontSize="$xs"
                    color="$neutral10"
                    css={{ wordBreak: "break-all" }}
                  >
                    {tracker}
                  </Text>
                )}
              </For>
            </Box>
          </Show>

          {/* 文件列表 */}
          <Box>
            <HStack justifyContent="space-between" alignItems="center" mb="$1">
              <Text fontSize="$sm" fontWeight="$semibold">
                {t("home.transfer_seed.files")}
              </Text>
              <HStack spacing="$2">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    if (
                      selectedFiles().length === torrentInfo()!.files.length
                    ) {
                      setSelectedFiles([])
                    } else {
                      setSelectedFiles(
                        torrentInfo()!.files.map((_, index) => index),
                      )
                    }
                  }}
                >
                  {selectedFiles().length === torrentInfo()!.files.length
                    ? t("home.toolbar.offline_download_enhanced.cancel_select")
                    : t("home.toolbar.offline_download_enhanced.select_all")}
                </Button>
              </HStack>
            </HStack>
            <For each={torrentInfo()!.files}>
              {(file, index) => (
                <SeedFileRow
                  file={file}
                  selected={selectedFiles().includes(index())}
                  onToggle={() => {
                    setSelectedFiles((current) =>
                      current.includes(index())
                        ? current.filter((i) => i !== index())
                        : [...current, index()],
                    )
                  }}
                  saveMethod={saveMethodByPath(file.path)}
                  pieceSize={torrentInfo()!.piece_size || 0}
                  onPreview={() => {
                    setPreviewFileIndex(index())
                    previewDisclosure.onOpen()
                  }}
                  onRemove={() => {
                    setRemoveFileIndex(index())
                    removeDisclosure.onOpen()
                  }}
                  onRecalc={() => {
                    setRecalcFileIndex(index())
                    recalcDisclosure.onOpen()
                  }}
                  onCommentCopy={() => file.comment && void copy(file.comment)}
                />
              )}
            </For>
          </Box>

          {/* 保存卡片：路径一行，驱动信息与操作一行 */}
          <Show when={!isShare()}>
            <Box border="1px solid $neutral5" borderRadius="$lg" p="$3">
              <VStack alignItems="stretch" spacing="$2">
                <HStack spacing="$2" alignItems="center">
                  <Text fontSize="$sm" flexShrink={0}>
                    {t("home.transfer_seed.destination")}
                  </Text>
                  <Box flex="1" minW="0">
                    <FolderChooseInput
                      id="seed-preview-destination"
                      value={destination()}
                      onChange={setDestination}
                    />
                  </Box>
                </HStack>

                {/* 左：驱动状态胶囊；右：保存选项。两组各自不拆散，避免交错换行 */}
                <HStack
                  justifyContent="space-between"
                  alignItems="center"
                  spacing="$3"
                  flexWrap="wrap"
                >
                  <HStack spacing="$2" alignItems="center" flexWrap="wrap">
                    {/* 驱动 */}
                    <Tooltip label={driverDetails()} maxW="420px">
                      <SeedInfoTag
                        icon={<BsHdd size={11} />}
                        label={destinationProvider() || "-"}
                        cursor="help"
                      />
                    </Tooltip>

                    {/* 支持能力：离线下载 / 秒传 / ... */}
                    <Show when={driverSupportsText()}>
                      <SeedInfoTag
                        icon={<BsDownload size={11} />}
                        label={driverSupportsText()}
                        color="$success10"
                      />
                    </Show>

                    {/* 秒传状态 */}
                    <Show when={saveCapabilities()}>
                      <SeedInfoTag
                        icon={
                          rapidReady() ? (
                            <BsLightningChargeFill size={11} />
                          ) : (
                            <BsExclamationCircleFill size={11} />
                          )
                        }
                        label={
                          rapidReady()
                            ? t("home.transfer_seed.rapid_available_short")
                            : t("home.transfer_seed.rapid_unavailable_short")
                        }
                        color={rapidReady() ? "$success10" : "$warning10"}
                      />
                    </Show>

                    {/* 可用哈希 */}
                    <Tooltip label={driverDetails()} maxW="420px">
                      <SeedInfoTag
                        icon={<BsHash size={11} />}
                        label={hashSummary()}
                        color="$neutral10"
                        cursor="help"
                      />
                    </Tooltip>
                  </HStack>

                  <HStack spacing="$2" alignItems="center" flexShrink={0}>
                    <Checkbox
                      size="sm"
                      checked={updateChannel()}
                      onChange={() => setUpdateChannel(!updateChannel())}
                    >
                      {t("home.transfer_seed.update_channel_short")}
                    </Checkbox>
                    <Box w="$28">
                      <SelectWrapper
                        value={saveMethod()}
                        onChange={(value) => setSaveMethod(value as SaveMethod)}
                        options={availableSaveMethods().map((method) => ({
                          value: method,
                          label:
                            method === "rapid"
                              ? t("home.transfer_seed.rapid_save")
                              : method === "offline"
                                ? t("home.toolbar.offline_download")
                                : t("home.transfer_seed.transit_save"),
                        }))}
                      />
                    </Box>
                    <Button
                      loading={
                        operation() === "rapid" || operation() === "transit"
                      }
                      disabled={!canSave()}
                      onClick={runSave}
                    >
                      {t("global.save")}
                    </Button>
                  </HStack>
                </HStack>

                <Show
                  when={
                    operationSupported("transfer") &&
                    saveMethod() === "transfer"
                  }
                >
                  <HStack spacing="$2" alignItems="center" flexWrap="wrap">
                    <Text fontSize="$sm" flexShrink={0}>
                      {t("home.transfer_seed.transit_path")}
                    </Text>
                    <Box flex="1" minW="0">
                      <FolderChooseInput
                        id="seed-preview-transit-path"
                        value={transitPath()}
                        onChange={setTransitPath}
                      />
                    </Box>
                  </HStack>
                </Show>
              </VStack>
            </Box>
          </Show>

          {/* 编辑并保存：注释 / 目标格式 / 重算哈希，一个按钮统一提交 */}
          <Show
            when={
              !isShare() &&
              (operationSupported("edit") || operationSupported("convert"))
            }
          >
            <Divider />
            <Box>
              {/* 整个编辑区（转换 + 注释 + 保存）统一折叠 */}
              <HStack justifyContent="space-between" alignItems="center">
                <Text fontSize="$sm" fontWeight="$semibold">
                  {t("home.transfer_seed.edit_and_save")}
                </Text>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={editDisclosure.onToggle}
                >
                  {editDisclosure.isOpen()
                    ? t("home.transfer_seed.collapse")
                    : t("home.transfer_seed.expand")}
                </Button>
              </HStack>
              <Show when={editDisclosure.isOpen()}>
                <VStack alignItems="stretch" spacing="$3" mt="$2">
                  {/* 宽屏：左「格式选择 + 源目录」，右「哈希矩阵」 */}
                  <SimpleGrid
                    columns={{ "@initial": 1, "@lg": 2 }}
                    gap="$4"
                    alignItems="start"
                  >
                    <VStack alignItems="stretch" spacing="$3">
                      <VStack spacing="$2" alignItems="stretch">
                        <For each={["torrent", "cas", "oss"] as SeedFormat[]}>
                          {(format) => {
                            const state = () =>
                              torrentInfo()!.conversions?.[format]
                            const feasible = () => !!state()?.feasible
                            const reasons = () => state()?.missing || []
                            return (
                              <Tooltip
                                maxW="420px"
                                label={
                                  feasible() ? (
                                    t("home.transfer_seed.feasible")
                                  ) : (
                                    <Text
                                      fontSize="$xs"
                                      css={{ whiteSpace: "pre-line" }}
                                    >
                                      {reasons().join("\n") ||
                                        t("home.transfer_seed.unavailable")}
                                    </Text>
                                  )
                                }
                              >
                                <Button
                                  size="sm"
                                  w="$full"
                                  justifyContent="space-between"
                                  variant={
                                    targetFormats().includes(format)
                                      ? "solid"
                                      : "subtle"
                                  }
                                  colorScheme={
                                    targetFormats().includes(format)
                                      ? "accent"
                                      : "neutral"
                                  }
                                  onClick={() => toggleTargetFormat(format)}
                                >
                                  {FORMAT_DISPLAY[format] ||
                                    format.toUpperCase()}
                                  <Text
                                    as="span"
                                    ml="$1"
                                    color={
                                      feasible() ? "$success9" : "$danger9"
                                    }
                                  >
                                    {feasible() ? "✓" : "✗"}
                                  </Text>
                                </Button>
                              </Tooltip>
                            )
                          }}
                        </For>
                      </VStack>

                      {/* 目标格式无法直接编码时说明「为什么要读文件」，
                        避免矩阵全显示 in seed 却要求补算时的困惑 */}
                      <Show when={targetDiffers() && !conversionSupported()}>
                        <Text
                          fontSize="$xs"
                          color="$warning11"
                          css={{ whiteSpace: "pre-line" }}
                        >
                          {t("home.transfer_seed.convert_rehash_notice")}
                        </Text>
                      </Show>

                      <Show when={needSourceDir()}>
                        <Box>
                          <Text fontSize="$sm" mb="$1">
                            {t("home.transfer_seed.rehash_source_dir")}
                          </Text>
                          <FolderChooseInput
                            id="seed-preview-rehash-source-dir"
                            value={effectiveRecalcSourceDir()}
                            onChange={setRecalcSourceDir}
                          />
                        </Box>
                      </Show>
                    </VStack>

                    <Show when={operationSupported("recalculate")}>
                      <Box>
                        <Text fontSize="$sm" mb="$1">
                          {t("home.transfer_seed.recalc_matrix")}
                        </Text>
                        <HashMatrixTable
                          matrix={recalcMatrix()}
                          onChange={(algo, scope, checked) =>
                            setRecalcHash(algo, scope, checked)
                          }
                          isForced={(algo) => forcedHashAlgo(algo)}
                          requiredBy={(algo) =>
                            forcedHashAlgo(algo)
                              ? [algo === "sha1" ? "BitTorrent" : "CAS"]
                              : []
                          }
                          statusFor={(algo, scope) =>
                            (
                              scope === "whole"
                                ? seedHasHash(algo)
                                : seedHasPieces(algo)
                            )
                              ? {
                                  text: t("home.transfer_seed.hash_exists"),
                                  tone: "success",
                                }
                              : {
                                  text: t("home.transfer_seed.hash_recompute"),
                                  tone: "warning",
                                }
                          }
                        />
                      </Box>
                    </Show>
                  </SimpleGrid>

                  <Box>
                    <Text fontSize="$sm" mb="$1">
                      {t("home.transfer_seed.comment_edit")}
                    </Text>
                    <Textarea
                      rows={3}
                      placeholder={t("home.transfer_seed.comment_placeholder")}
                      value={editComment()}
                      onInput={(event) =>
                        setEditComment(event.currentTarget.value)
                      }
                    />
                  </Box>

                  <HStack justifyContent="flex-end">
                    <Tooltip
                      label={applyBlockedReason()}
                      disabled={!applyBlockedReason()}
                    >
                      <Box display="inline-block">
                        <Button
                          loading={
                            operation() !== "" && operation() === applyMode()
                          }
                          disabled={!applyEnabled()}
                          onClick={applyChanges}
                        >
                          {applyLabel()}
                        </Button>
                      </Box>
                    </Tooltip>
                  </HStack>
                </VStack>
              </Show>
            </Box>
          </Show>
        </VStack>
      </Show>

      {/* 预览文件确认弹窗 */}
      <Modal
        opened={previewDisclosure.isOpen()}
        onClose={previewDisclosure.onClose}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            {t("home.transfer_seed.preview_confirm_title")}
          </ModalHeader>
          <ModalBody>{t("home.transfer_seed.preview_confirm_body")}</ModalBody>
          <ModalFooter display="flex" gap="$2">
            <Button colorScheme="neutral" onClick={previewDisclosure.onClose}>
              {t("global.cancel")}
            </Button>
            <Button
              loading={operation() === "preview"}
              onClick={confirmPreviewFile}
            >
              {t("global.confirm")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 删除文件确认弹窗 */}
      <Modal
        opened={removeDisclosure.isOpen()}
        onClose={removeDisclosure.onClose}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            {t("home.transfer_seed.remove_file_confirm_title")}
          </ModalHeader>
          <ModalBody>
            {t("home.transfer_seed.remove_file_confirm_body")}
          </ModalBody>
          <ModalFooter display="flex" gap="$2">
            <Button colorScheme="neutral" onClick={removeDisclosure.onClose}>
              {t("global.cancel")}
            </Button>
            <Button
              colorScheme="danger"
              loading={operation() === "remove"}
              onClick={confirmRemoveFile}
            >
              {t("global.confirm")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 单文件重算弹窗 */}
      <Modal
        opened={recalcDisclosure.isOpen()}
        onClose={recalcDisclosure.onClose}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{t("home.transfer_seed.recalc_file")}</ModalHeader>
          <ModalBody>
            <Show
              when={recalcFileIndex() !== null && torrentInfo()}
              fallback={null}
            >
              <Text fontSize="$sm" mb="$2">
                {torrentInfo()!.files[recalcFileIndex()!]?.path}
              </Text>
            </Show>
            <Text fontSize="$sm" mb="$1">
              {t("home.transfer_seed.recalc_source_dir")}
            </Text>
            <FolderChooseInput
              id="seed-preview-recalc-file-source-dir"
              value={effectiveRecalcSourceDir()}
              onChange={setRecalcSourceDir}
            />
            <Show when={recalcFileIndex() !== null && torrentInfo()}>
              <Text fontSize="$xs" color="$neutral10" mt="$1">
                {t("home.transfer_seed.recalc_source_hint")}:{" "}
                {buildRecalcSourcePath(
                  torrentInfo()!.files[recalcFileIndex()!]?.path || "",
                )}
              </Text>
            </Show>
          </ModalBody>
          <ModalFooter display="flex" gap="$2">
            <Button colorScheme="neutral" onClick={recalcDisclosure.onClose}>
              {t("global.cancel")}
            </Button>
            <Button
              loading={operation() === "recalculate"}
              onClick={confirmRecalcFile}
            >
              {t("global.confirm")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 离线下载弹窗（选择下载工具） */}
      <Modal
        opened={offlineDisclosure.isOpen()}
        onClose={offlineDisclosure.onClose}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{t("home.toolbar.offline_download")}</ModalHeader>
          <ModalBody>
            <Text fontSize="$sm" mb="$1">
              {t("home.transfer_seed.offline_tool")}
            </Text>
            <SelectWrapper
              value={offlineTool()}
              onChange={(value) => setOfflineTool(value)}
              options={offlineTools().map((tool) => ({
                value: tool,
                label: tool,
              }))}
            />
            <Text fontSize="$sm" mt="$3" mb="$1">
              {t("home.transfer_seed.offline_delete_policy")}
            </Text>
            <SelectWrapper
              value={offlineDeletePolicy()}
              onChange={(value) => setOfflineDeletePolicy(value)}
              options={DELETE_POLICIES.filter((policy) =>
                policy === "upload_download_stream"
                  ? offlineTool() === "SimpleHttp"
                  : true,
              ).map((policy) => ({
                value: policy,
                label: t(`home.toolbar.delete_policy.${policy}`),
              }))}
            />
          </ModalBody>
          <ModalFooter display="flex" gap="$2">
            <Button colorScheme="neutral" onClick={offlineDisclosure.onClose}>
              {t("global.cancel")}
            </Button>
            <Button loading={offlineLoading()} onClick={confirmOfflineDownload}>
              {t("global.confirm")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  )
}

export default TorrentPreview
