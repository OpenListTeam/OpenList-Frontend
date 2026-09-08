import {
  VStack,
  HStack,
  Text,
  Button,
  Badge,
  Heading,
  Box,
  Input,
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
  createDisclosure,
  SimpleGrid,
} from "@hope-ui/solid"
import { createEffect, createSignal, For, onMount, Show } from "solid-js"
import { getSettingBool, objStore } from "~/store"
import {
  TorrentInfo,
  CASInfo,
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
  fsGet,
  handleResp,
  notify,
  seedConvert,
  seedOfflineDownload,
  seedParse,
  seedRapidUpload,
  seedSaveCapabilities,
  seedUpdate,
} from "~/utils"
import { FolderChooseInput, SelectWrapper } from "~/components"
import axios from "axios"
import bencode from "bencode"
import crypto from "crypto-js"
import { TbCopy, TbRefresh, TbTrash } from "solid-icons/tb"
import { BsInfoCircle } from "solid-icons/bs"
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

const ALGORITHMS: SeedHashAlgorithm[] = ["md5", "sha1", "sha256"]

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
  const [targetFormat, setTargetFormat] = createSignal<SeedFormat>("oss")
  const [editComment, setEditComment] = createSignal("")
  const [operation, setOperation] = createSignal("")
  const [transitPath, setTransitPath] = createSignal("")
  const [recalcPaths, setRecalcPaths] = createSignal<Record<string, string>>({})
  const [recalcMatrix, setRecalcMatrix] = createSignal<SeedHashMatrix>({
    md5: { whole: false, pieces: false },
    sha1: { whole: false, pieces: false },
    sha256: { whole: false, pieces: false },
  })
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
  const [recalcSource, setRecalcSource] = createSignal("")

  const inferFormat = (): SeedFormat => {
    const extension = objStore.obj.name.toLowerCase().split(".").pop()
    return extension === "cas" || extension === "oss" ? extension : "torrent"
  }

  const normalizeSeedInfo = (parsed: SeedParseResult): SeedInfo => {
    const nested = parsed.info || parsed.seed || parsed.data
    const value = (nested || parsed) as SeedInfo
    return {
      ...parsed,
      ...value,
      format: value.format || parsed.format || inferFormat(),
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

  // 从种子已有哈希初始化重算矩阵：默认勾选当前种子已包含的哈希类型
  const initRecalcMatrix = (info: SeedInfo) => {
    const matrix: SeedHashMatrix = {
      md5: { whole: false, pieces: false },
      sha1: { whole: false, pieces: false },
      sha256: { whole: false, pieces: false },
    }
    for (const file of info.files) {
      const hashes = file.hashes
      if (!hashes) continue
      for (const algo of ALGORITHMS) {
        if (hashes[algo]) matrix[algo].whole = true
        if (hashes.pieces?.[algo]?.length) matrix[algo].pieces = true
      }
    }
    setRecalcMatrix(matrix)
  }

  const setRecalcHash = (
    algo: SeedHashAlgorithm,
    scope: keyof SeedHashSelection,
    checked: boolean,
  ) => {
    setRecalcMatrix((current) => ({
      ...current,
      [algo]: { ...current[algo], [scope]: checked },
    }))
  }

  const autoCASDirectAccess = async (info: SeedInfo) => {
    if (inferFormat() !== "cas" || info.files.length !== 1) return
    if (!getSettingBool("seed_cas_direct_access")) return
    if (!torrentData()) return
    try {
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
        setSelectedFiles(info.files.map((_, index) => index))
        initRecalcMatrix(info)
        void autoCASDirectAccess(info)
      } else if (inferFormat() === "torrent") {
        const legacy = parseLocalTorrent(new Uint8Array(buffer))
        setTorrentInfo({ ...legacy, format: "torrent" })
        setSelectedFiles(legacy.files.map((_, index) => index))
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

  const conversionSupported = () => {
    const conversion = torrentInfo()?.conversions?.[targetFormat()]
    return operationSupported("convert") && conversion?.feasible === true
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
    if (data?.seed) setTorrentInfo(data.seed)
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
    if (
      name === "recalculate" &&
      selectedFiles().some(
        (index) => !recalcPaths()[info.files[index]?.path]?.trim(),
      )
    ) {
      notify.error(t("home.transfer_seed.source_path_required"))
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
              ? await seedConvert({ ...request(), format: targetFormat() })
              : await seedUpdate({
                  ...request(),
                  recalc_files:
                    name === "recalculate"
                      ? selectedFiles().map((index) => ({
                          path: info.files[index]?.path,
                          source_path:
                            recalcPaths()[info.files[index]?.path] || "",
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
        const baseName = file.path.split("/").pop() || file.path
        const targetPath = `${destination().replace(/\/$/, "")}/${baseName}`
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
    if (!recalcSource().trim()) {
      notify.error(t("home.transfer_seed.source_path_required"))
      return
    }
    recalcDisclosure.onClose()
    setOperation("recalculate")
    try {
      const resp = await seedUpdate({
        seed_data: torrentData(),
        file_name: objStore.obj.name,
        recalc_files: [{ path: file.path, source_path: recalcSource().trim() }],
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
      setRecalcSource("")
    }
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
          <HStack
            justifyContent="space-between"
            alignItems="center"
            flexWrap="wrap"
            gap="$2"
          >
            <VStack alignItems="flex-start" spacing="$1">
              <Heading size="sm" css={{ wordBreak: "break-all" }}>
                {torrentInfo()!.name}
              </Heading>
              <HStack spacing="$2" flexWrap="wrap">
                <Badge colorScheme="info">
                  {torrentInfo()!.format.toUpperCase()}
                </Badge>
                <Text fontSize="$xs" color="$neutral10">
                  {formatFileSize(torrentInfo()!.total_size)}
                </Text>
                <Text fontSize="$xs" color="$neutral10">
                  {torrentInfo()!.files.length}{" "}
                  {t("home.transfer_seed.file_count")}
                </Text>
                <Show when={torrentInfo()!.created_at}>
                  <Text fontSize="$xs" color="$neutral10">
                    {torrentInfo()!.created_at}
                  </Text>
                </Show>
              </HStack>
            </VStack>
            <HStack spacing="$2">
              <Show when={torrentInfo()!.has_cas}>
                <Badge colorScheme="success">
                  {t("home.toolbar.offline_download_enhanced.cas_supported")}
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
          </HStack>

          <Show when={torrentInfo()!.format === "cas"}>
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
                    setRecalcSource(recalcPaths()[file.path] || "")
                    recalcDisclosure.onOpen()
                  }}
                  onCommentCopy={() => file.comment && void copy(file.comment)}
                />
              )}
            </For>
          </Box>

          {/* 整体注释（多行） */}
          <Show when={!isShare() && operationSupported("edit")}>
            <Box>
              <Text fontSize="$sm" fontWeight="$semibold" mb="$1">
                {t("home.transfer_seed.overall_comment")}
              </Text>
              <Textarea
                rows={3}
                placeholder={t("home.transfer_seed.comment_placeholder")}
                value={editComment()}
                onInput={(event) => setEditComment(event.currentTarget.value)}
              />
            </Box>
          </Show>

          {/* 下载 / 秒传区 */}
          <Show when={!isShare()}>
            <Divider />
            <Box>
              <Text fontSize="$sm" mb="$1">
                {t("home.transfer_seed.destination")}
              </Text>
              <FolderChooseInput
                id="seed-preview-destination"
                value={destination()}
                onChange={setDestination}
              />
              <Text fontSize="$xs" color="$neutral10" mt="$1">
                {t("home.transfer_seed.destination_hint")}
              </Text>
              <Show when={destinationProvider()}>
                <Badge mt="$1" colorScheme="info">
                  {t("home.transfer_seed.destination_driver")}:{" "}
                  {destinationProvider()}
                </Badge>
              </Show>
              <Checkbox
                mt="$2"
                checked={updateChannel()}
                onChange={() => setUpdateChannel(!updateChannel())}
              >
                {t("home.transfer_seed.update_channel")}
              </Checkbox>
            </Box>
            <Show when={operationSupported("transfer")}>
              <Box>
                <Text fontSize="$sm" mb="$1">
                  {t("home.transfer_seed.transit_path")}
                </Text>
                <FolderChooseInput
                  id="seed-preview-transit-path"
                  value={transitPath()}
                  onChange={setTransitPath}
                />
              </Box>
            </Show>
            <HStack spacing="$2" flexWrap="wrap">
              <Button
                loading={operation() === "rapid"}
                disabled={
                  !operationSupported("rapid_upload") ||
                  selectedFiles().length === 0
                }
                onClick={() => runOperation("rapid")}
              >
                {t("home.transfer_seed.rapid_save")}
              </Button>
              <Button
                variant="outline"
                loading={operation() === "offline"}
                disabled={
                  !operationSupported("offline_download") ||
                  selectedFiles().length === 0
                }
                onClick={() => runOperation("offline")}
              >
                {t("home.toolbar.offline_download")}
              </Button>
              <Button
                variant="outline"
                loading={operation() === "transit"}
                disabled={
                  !operationSupported("transfer") ||
                  selectedFiles().length === 0
                }
                onClick={() => runOperation("transit")}
              >
                {t("home.transfer_seed.transit_save")}
              </Button>
            </HStack>
          </Show>

          {/* 转换区：合并 feasibility 与 convert */}
          <Show when={!isShare() && operationSupported("convert")}>
            <Divider />
            <Box>
              <Text fontSize="$sm" fontWeight="$semibold" mb="$1">
                {t("home.transfer_seed.convert_to")}
              </Text>
              <HStack spacing="$2" alignItems="flex-end">
                <Box flex="1">
                  <SelectWrapper
                    value={targetFormat()}
                    onChange={(value) => setTargetFormat(value as SeedFormat)}
                    options={(["torrent", "cas", "oss"] as SeedFormat[]).map(
                      (format) => {
                        const state = () => torrentInfo()!.conversions?.[format]
                        return {
                          value: format,
                          label: `${format.toUpperCase()}${
                            state()?.feasible
                              ? " ✓"
                              : state()?.missing?.length
                                ? ` (${state()!.missing!.join(", ")})`
                                : ""
                          }`,
                        }
                      },
                    )}
                  />
                </Box>
                <Button
                  loading={operation() === "convert"}
                  disabled={!conversionSupported()}
                  onClick={() => runOperation("convert")}
                >
                  {t("home.transfer_seed.convert")}
                </Button>
              </HStack>
              <Show when={torrentInfo()!.conversions}>
                <HStack spacing="$2" flexWrap="wrap" mt="$2">
                  <For each={["torrent", "cas", "oss"] as SeedFormat[]}>
                    {(format) => {
                      const state = () => torrentInfo()!.conversions?.[format]
                      return (
                        <Badge
                          colorScheme={
                            state()?.feasible ? "success" : "warning"
                          }
                        >
                          {format.toUpperCase()}:{" "}
                          {state()?.feasible
                            ? t("home.transfer_seed.feasible")
                            : state()?.missing?.join(", ") ||
                              t("home.transfer_seed.unavailable")}
                        </Badge>
                      )
                    }}
                  </For>
                </HStack>
              </Show>
            </Box>
          </Show>

          {/* 整体保存 */}
          <Show when={!isShare() && operationSupported("edit")}>
            <Divider />
            <HStack spacing="$2">
              <Button
                variant="outline"
                loading={operation() === "update"}
                disabled={!operationSupported("edit")}
                onClick={() => runOperation("update")}
              >
                {t("global.save")}
              </Button>
              <Button
                variant="outline"
                loading={operation() === "recalculate"}
                disabled={
                  !operationSupported("recalculate") ||
                  selectedFiles().length === 0
                }
                onClick={() => runOperation("recalculate")}
              >
                {t("home.transfer_seed.recalculate")}
              </Button>
            </HStack>
            <Show when={operationSupported("recalculate")}>
              <Text fontSize="$xs" fontWeight="$semibold" mt="$2">
                {t("home.transfer_seed.recalc_matrix")}
              </Text>
              <SimpleGrid
                columns={{ "@initial": 1, "@md": 3 }}
                gap="$2"
                mb="$2"
              >
                <For each={ALGORITHMS}>
                  {(algo) => (
                    <VStack
                      alignItems="flex-start"
                      spacing="$1"
                      border="1px solid $neutral7"
                      borderRadius="$md"
                      bg="$background"
                      p="$2"
                    >
                      <Text fontSize="$xs" fontWeight="$semibold">
                        {algo.toUpperCase()}
                      </Text>
                      <Checkbox
                        size="sm"
                        checked={recalcMatrix()[algo].whole}
                        onChange={(event: {
                          currentTarget: HTMLInputElement
                        }) =>
                          setRecalcHash(
                            algo,
                            "whole",
                            event.currentTarget.checked,
                          )
                        }
                      >
                        {t("home.transfer_seed.whole")}
                      </Checkbox>
                      <Checkbox
                        size="sm"
                        checked={recalcMatrix()[algo].pieces}
                        onChange={(event: {
                          currentTarget: HTMLInputElement
                        }) =>
                          setRecalcHash(
                            algo,
                            "pieces",
                            event.currentTarget.checked,
                          )
                        }
                      >
                        {t("home.transfer_seed.pieces")}
                      </Checkbox>
                    </VStack>
                  )}
                </For>
              </SimpleGrid>
              <Text fontSize="$xs" color="$neutral10">
                {t("home.transfer_seed.recalc_source_path")}
              </Text>
              <For each={selectedFiles()}>
                {(index) => {
                  const path = () => torrentInfo()!.files[index]?.path || ""
                  return (
                    <Box mb="$2">
                      <Text fontSize="$xs" mb="$1">
                        {path()}
                      </Text>
                      <Input
                        value={recalcPaths()[path()] || ""}
                        placeholder="/path/to/file"
                        onInput={(event) =>
                          setRecalcPaths((current) => ({
                            ...current,
                            [path()]: event.currentTarget.value,
                          }))
                        }
                      />
                    </Box>
                  )
                }}
              </For>
            </Show>
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
            <Input
              placeholder="/path/to/file"
              value={recalcSource()}
              onInput={(event) => setRecalcSource(event.currentTarget.value)}
            />
            <Text fontSize="$xs" color="$neutral10" mt="$1">
              {t("home.transfer_seed.recalc_source")}
            </Text>
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
    </VStack>
  )
}

export default TorrentPreview
