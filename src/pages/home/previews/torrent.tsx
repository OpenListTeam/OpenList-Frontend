import {
  VStack,
  HStack,
  Text,
  Button,
  Badge,
  Heading,
  Box,
  Input,
  Divider,
  Alert,
  AlertIcon,
} from "@hope-ui/solid"
import { createEffect, createSignal, For, onMount, Show } from "solid-js"
import { objStore } from "~/store"
import {
  TorrentInfo,
  CASInfo,
  TorrentFile,
  SeedFormat,
  SeedInfo,
  SeedParseResult,
} from "~/types"
import { useLink, usePath, useRouter, useT } from "~/hooks"
import {
  fsGet,
  handleResp,
  notify,
  seedConvert,
  seedOfflineDownload,
  seedParse,
  seedRapidUpload,
  seedUpdate,
} from "~/utils"
import { FolderChooseInput, SelectWrapper } from "~/components"
import { TorrentFileList } from "../toolbar/TorrentFileList"
import axios from "axios"
import bencode from "bencode"
import crypto from "crypto-js"

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
  const files: TorrentFile[] = []
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

const TorrentPreview = () => {
  const t = useT()
  const { proxyLink, rawLink } = useLink()
  const { isShare, pathname } = useRouter()
  const { refresh } = usePath()

  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")
  const [torrentInfo, setTorrentInfo] = createSignal<SeedInfo | null>(null)
  const [torrentData, setTorrentData] = createSignal("")
  const [selectedFiles, setSelectedFiles] = createSignal<number[]>([])
  const [destination, setDestination] = createSignal(pathname())
  const [destinationProvider, setDestinationProvider] = createSignal("")
  const [targetFormat, setTargetFormat] = createSignal<SeedFormat>("oss")
  const [editComment, setEditComment] = createSignal("")
  const [operation, setOperation] = createSignal("")

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
      return
    }
    void fsGet(path).then((resp) => {
      if (requestId === destinationRequest) {
        setDestinationProvider(
          resp.code === 200 ? resp.data.provider || "" : "",
        )
      }
    })
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
  })

  const runOperation = async (name: string) => {
    const info = torrentInfo()
    if (!info || !torrentData()) return
    if (name !== "convert" && selectedFiles().length === 0) {
      notify.error("Select at least one file")
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
                options: name === "transit" ? { mode: "transfer" } : undefined,
              })
            : name === "convert"
              ? await seedConvert({ ...request(), format: targetFormat() })
              : await seedUpdate({
                  ...request(),
                  options: {
                    comment: editComment(),
                    recalculate: name === "recalculate",
                  },
                })
      handleResp(resp, (data) => {
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
                  {t("home.toolbar.offline_download_enhanced.files_count")}
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
          <Show when={torrentInfo()!.comment}>
            <Text fontSize="$sm">{torrentInfo()!.comment}</Text>
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

          <TorrentFileList
            files={torrentInfo()!.files}
            selectedFiles={selectedFiles()}
            onSelectionChange={setSelectedFiles}
          />
          <For each={torrentInfo()!.files}>
            {(file) => (
              <Show
                when={file.comment || Object.keys(file.hashes || {}).length}
              >
                <HStack spacing="$2" flexWrap="wrap" pl="$2">
                  <Text fontSize="$xs" css={{ wordBreak: "break-all" }}>
                    {file.path}
                  </Text>
                  <For
                    each={
                      Object.entries(file.hashes || {}).filter(
                        ([, hash]) =>
                          typeof hash === "string" && hash.length > 0,
                      ) as Array<[string, string]>
                    }
                  >
                    {([algorithm, hash]) => (
                      <Badge colorScheme="neutral">
                        {algorithm.toUpperCase()}: {hash}
                      </Badge>
                    )}
                  </For>
                  <Show when={file.comment}>
                    <Text fontSize="$xs" color="$neutral10">
                      {file.comment}
                    </Text>
                  </Show>
                </HStack>
              </Show>
            )}
          </For>

          <Show when={torrentInfo()!.conversions}>
            <Box>
              <Text fontSize="$sm" fontWeight="$semibold" mb="$1">
                {t("home.transfer_seed.conversion_feasibility")}
              </Text>
              <HStack spacing="$2" flexWrap="wrap">
                <For each={["torrent", "cas", "oss"] as SeedFormat[]}>
                  {(format) => {
                    const state = () => torrentInfo()!.conversions?.[format]
                    return (
                      <Badge
                        colorScheme={state()?.feasible ? "success" : "warning"}
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
            </Box>
          </Show>

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
              <Show when={destinationProvider()}>
                <Badge mt="$1" colorScheme="info">
                  {t("home.transfer_seed.destination_driver")}:{" "}
                  {destinationProvider()}
                </Badge>
              </Show>
            </Box>
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
            <HStack spacing="$2" alignItems="flex-end">
              <Box flex="1">
                <Text fontSize="$sm" mb="$1">
                  {t("home.transfer_seed.convert_to")}
                </Text>
                <SelectWrapper
                  value={targetFormat()}
                  onChange={(value) => setTargetFormat(value as SeedFormat)}
                  options={(["torrent", "cas", "oss"] as SeedFormat[]).map(
                    (format) => ({
                      value: format,
                      label: format.toUpperCase(),
                    }),
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
            <HStack spacing="$2" alignItems="flex-end">
              <Box flex="1">
                <Text fontSize="$sm" mb="$1">
                  {t("home.transfer_seed.comment")}
                </Text>
                <Input
                  value={editComment()}
                  onInput={(event) => setEditComment(event.currentTarget.value)}
                />
              </Box>
              <Button
                variant="outline"
                loading={operation() === "update"}
                disabled={!operationSupported("edit")}
                onClick={() => runOperation("update")}
              >
                {t("global.save")}
              </Button>
              <Button
                colorScheme="warning"
                loading={operation() === "recalculate"}
                disabled={!operationSupported("recalculate")}
                onClick={() => runOperation("recalculate")}
              >
                {t("home.transfer_seed.recalculate")}
              </Button>
            </HStack>
          </Show>
        </VStack>
      </Show>
    </VStack>
  )
}

export default TorrentPreview
