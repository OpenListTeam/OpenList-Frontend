import {
  VStack,
  Input,
  Heading,
  HStack,
  IconButton,
  Checkbox,
  Text,
  Badge,
  Progress,
  ProgressIndicator,
  Button,
  Box,
  Stack,
  SimpleGrid,
  Divider,
} from "@hope-ui/solid"
import { createSignal, For, Show } from "solid-js"
import { usePath, useRouter, useT } from "~/hooks"
import { getMainColor, uploadConfig, setUploadConfig } from "~/store"
import {
  RiDocumentFolderUploadFill,
  RiDocumentFileUploadFill,
} from "solid-icons/ri"
import { getFileSize, notify, pathJoin } from "~/utils"
import { asyncPool } from "~/utils/async_pool"
import { createStore } from "solid-js/store"
import { UploadFileProps, StatusBadge } from "./types"
import { File2Upload, traverseFileTree } from "./util"
import { SelectWrapper } from "~/components"
import { getUploads } from "./uploads"
import { SeedFormat, SeedHashAlgorithm, SeedHashMatrix } from "~/types"

const UploadFile = (props: UploadFileProps & { onRetry?: () => void }) => {
  const t = useT()
  return (
    <VStack
      w="$full"
      spacing="$1"
      rounded="$lg"
      border="1px solid $neutral7"
      alignItems="start"
      p="$2"
      _hover={{
        border: `1px solid ${getMainColor()}`,
      }}
    >
      <Text
        css={{
          wordBreak: "break-all",
        }}
      >
        {props.path}
      </Text>
      <HStack spacing="$2" w="$full" justifyContent="space-between">
        <HStack spacing="$2">
          <Badge colorScheme={StatusBadge[props.status]}>
            {t(`home.upload.${props.status}`)}
          </Badge>
          <Text>{getFileSize(props.speed)}/s</Text>
        </HStack>
        <HStack spacing="$2">
          <Show when={props.status === "error" && props.onRetry}>
            <Button
              compact
              size="xs"
              colorScheme="accent"
              onClick={() => props.onRetry?.()}
            >
              {t("home.upload.retry")}
            </Button>
          </Show>
          <Text color="$neutral11">{getFileSize(props.size)}</Text>
        </HStack>
      </HStack>
      <Progress
        w="$full"
        trackColor="$info3"
        rounded="$full"
        value={props.progress}
        size="sm"
      >
        <ProgressIndicator color={getMainColor()} rounded="$md" />
        {/* <ProgressLabel /> */}
      </Progress>
      <Text color="$danger10">{props.msg}</Text>
    </VStack>
  )
}

const Upload = () => {
  const t = useT()
  const { pathname } = useRouter()
  const { refresh } = usePath()
  const [drag, setDrag] = createSignal(false)
  const [uploading, setUploading] = createSignal(false)
  const [sidecars, setSidecars] = createSignal<SeedFormat[]>([])
  const [seedPieceSize, setSeedPieceSize] = createSignal(10 * 1024 * 1024)
  const [seedMatrix, setSeedMatrix] = createSignal<SeedHashMatrix>({
    md5: { whole: false, pieces: false },
    sha1: { whole: false, pieces: false },
    sha256: { whole: false, pieces: false },
  })
  const [uploadFiles, setUploadFiles] = createStore<{
    uploads: UploadFileProps[]
  }>({
    uploads: [],
  })
  const allDone = () => {
    return uploadFiles.uploads.every(({ status }) =>
      ["success", "error"].includes(status),
    )
  }
  let fileInput!: HTMLInputElement
  let folderInput!: HTMLInputElement
  // keep the File handles around so a failed row can be retried in place
  const fileMap = new Map<string, File>()
  const handleAddFiles = async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    for (const file of files) {
      const upload = File2Upload(file)
      fileMap.set(upload.path, file)
      setUploadFiles("uploads", (uploads) => [...uploads, upload])
    }
    for await (const ms of asyncPool(3, files, handleFile)) {
      console.log(ms)
    }
    refresh()
    // 再次延迟刷新一次，以便能看到后端异步生成的 BT 文件（如 189/189pc 驱动的 .cas.torrent）
    setTimeout(() => refresh(undefined, true), 5000)
  }
  const setUpload = (path: string, key: keyof UploadFileProps, value: any) => {
    setUploadFiles("uploads", (upload) => upload.path === path, key, value)
  }

  // All upload methods are available by default
  const uploaders = getUploads()
  const [curUploader, setCurUploader] = createSignal(uploaders[0])
  // multipart sessions are synchronous pipelines with their own progress and
  // retry semantics; "add as task" does not apply to them
  const effectiveUploader = () =>
    sidecars().length
      ? uploaders.find((uploader) => uploader.name === "Stream")!
      : curUploader()
  const asTaskUnsupported = () =>
    sidecars().length > 0 || effectiveUploader()?.name === "Multipart"
  const retryFile = (path: string) => {
    const file = fileMap.get(path)
    if (!file) return
    setUpload(path, "msg", "")
    setUpload(path, "progress", 0)
    setUpload(path, "speed", 0)
    handleFile(file)
  }
  const effectiveSeedMatrix = (): SeedHashMatrix => ({
    md5: sidecars().includes("cas")
      ? { whole: true, pieces: true }
      : seedMatrix().md5,
    sha1: sidecars().includes("torrent")
      ? { whole: true, pieces: true }
      : seedMatrix().sha1,
    sha256: seedMatrix().sha256,
  })
  const toggleSidecar = (format: SeedFormat, checked: boolean) => {
    setSidecars((current) =>
      checked
        ? Array.from(new Set([...current, format]))
        : current.filter((item) => item !== format),
    )
    if (format === "cas" && checked) setSeedPieceSize(10 * 1024 * 1024)
  }
  const setSeedHash = (
    algorithm: SeedHashAlgorithm,
    scope: "whole" | "pieces",
    checked: boolean,
  ) => {
    setSeedMatrix((current) => ({
      ...current,
      [algorithm]: { ...current[algorithm], [scope]: checked },
    }))
  }
  const handleFile = async (file: File) => {
    const path = file.webkitRelativePath ? file.webkitRelativePath : file.name
    setUpload(path, "status", "uploading")
    const uploadPath = pathJoin(pathname(), path)
    try {
      const err = await effectiveUploader()
        .upload(
          uploadPath,
          file,
          (key, value) => {
            setUpload(path, key, value)
          },
          asTaskUnsupported() ? false : uploadConfig.asTask,
          uploadConfig.overwrite,
          uploadConfig.rapid,
          {
            formats: sidecars(),
            hash_matrix: effectiveSeedMatrix(),
            piece_size: seedPieceSize(),
          },
        )
        .catch((err) => err)
      if (!err) {
        setUpload(path, "status", "success")
        setUpload(path, "progress", 100)
      } else {
        setUpload(path, "status", "error")
        setUpload(path, "msg", err.message)
      }
    } catch (e: any) {
      console.error(e)
      setUpload(path, "status", "error")
      setUpload(path, "msg", e.message)
    }
  }
  return (
    <VStack w="$full" pb="$2" spacing="$2">
      <Show
        when={!uploading()}
        fallback={
          <>
            <HStack spacing="$2">
              <Button
                colorScheme="accent"
                onClick={() => {
                  setUploadFiles("uploads", (_uploads) =>
                    _uploads.filter(
                      ({ status }) => !["success", "error"].includes(status),
                    ),
                  )
                  console.log(uploadFiles.uploads)
                }}
              >
                {t("home.upload.clear_done")}
              </Button>
              <Show when={allDone()}>
                <Button
                  onClick={() => {
                    setUploading(false)
                  }}
                >
                  {t("home.upload.back")}
                </Button>
              </Show>
            </HStack>
            <For each={uploadFiles.uploads}>
              {(upload) => (
                <UploadFile
                  {...upload}
                  onRetry={() => retryFile(upload.path)}
                />
              )}
            </For>
          </>
        }
      >
        <Input
          type="file"
          multiple
          ref={fileInput}
          display="none"
          onChange={(e) => {
            // @ts-ignore
            handleAddFiles(Array.from(e.target.files ?? []))
          }}
        />
        <Input
          type="file"
          multiple
          // @ts-ignore
          webkitdirectory
          ref={folderInput}
          display="none"
          onChange={(e) => {
            // @ts-ignore
            handleAddFiles(Array.from(e.target.files ?? []))
          }}
        />
        <VStack
          w="$full"
          justifyContent="center"
          border={`2px dashed ${drag() ? getMainColor() : "$neutral8"}`}
          rounded="$lg"
          spacing="$4"
          p="$6"
          minH="$56"
          onDragOver={(e: DragEvent) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => {
            setDrag(false)
          }}
          onDrop={async (e: DragEvent) => {
            e.preventDefault()
            e.stopPropagation()
            setDrag(false)
            const res: File[] = []
            const items = Array.from(e.dataTransfer?.items ?? [])
            const files = Array.from(e.dataTransfer?.files ?? [])
            let itemLength = items.length
            const folderEntries = []
            for (let i = 0; i < itemLength; i++) {
              const item = items[i]
              const entry = item.webkitGetAsEntry()
              if (entry?.isFile) {
                res.push(files[i])
              } else if (entry?.isDirectory) {
                folderEntries.push(entry)
              }
            }
            for (const entry of folderEntries) {
              const innerFiles = await traverseFileTree(entry)
              res.push(...innerFiles)
            }
            if (res.length === 0) {
              notify.warning(t("home.upload.no_files_drag"))
            }
            handleAddFiles(res)
          }}
        >
          <Show
            when={!drag()}
            fallback={<Heading>{t("home.upload.release")}</Heading>}
          >
            <Heading size="lg" textAlign="center">
              {t("home.upload.upload-tips")}
            </Heading>
            <Box w={{ "@initial": "80%", "@md": "30%" }}>
              <SelectWrapper
                value={curUploader()?.name}
                onChange={(name) => {
                  setCurUploader(
                    uploaders.find((uploader) => uploader.name === name)!,
                  )
                }}
                options={uploaders.map((uploader) => {
                  return {
                    label: uploader.name,
                    value: uploader.name,
                  }
                })}
              />
            </Box>
            <HStack spacing="$4">
              <VStack spacing="$2" alignItems="center">
                <IconButton
                  compact
                  size="xl"
                  aria-label={t("home.upload.upload_folder")}
                  colorScheme="accent"
                  icon={<RiDocumentFolderUploadFill size="1.2em" />}
                  onClick={() => {
                    folderInput.click()
                  }}
                />
                <Text fontSize="$sm" color="$neutral11" textAlign="center">
                  {t("home.upload.upload_folder")}
                </Text>
              </VStack>

              <VStack spacing="$2" alignItems="center">
                <IconButton
                  compact
                  size="xl"
                  aria-label={t("home.upload.upload_files")}
                  icon={<RiDocumentFileUploadFill size="1.2em" />}
                  onClick={() => {
                    fileInput.click()
                  }}
                />
                <Text fontSize="$sm" color="$neutral11" textAlign="center">
                  {t("home.upload.upload_files")}
                </Text>
              </VStack>
            </HStack>
            <Stack
              spacing={{ "@initial": "$2", "@md": "$4" }}
              direction={{ "@initial": "column", "@md": "row" }}
            >
              <Checkbox
                checked={!asTaskUnsupported() && uploadConfig.asTask}
                disabled={asTaskUnsupported()}
                onChange={() => {
                  setUploadConfig({ asTask: !uploadConfig.asTask })
                }}
              >
                {t("home.upload.add_as_task")}
              </Checkbox>
              <Checkbox
                checked={uploadConfig.overwrite}
                onChange={() => {
                  setUploadConfig({ overwrite: !uploadConfig.overwrite })
                }}
              >
                {t("home.conflict_policy.overwrite_existing")}
              </Checkbox>
              <Checkbox
                checked={uploadConfig.rapid}
                onChange={() => {
                  setUploadConfig({ rapid: !uploadConfig.rapid })
                }}
              >
                {t("home.upload.try_rapid")}
              </Checkbox>
            </Stack>
            <Divider w="$full" />
            <VStack w="$full" alignItems="stretch" spacing="$2">
              <Text fontSize="$sm" fontWeight="$semibold">
                {t("home.upload.sidecars")}
              </Text>
              <HStack spacing="$4" flexWrap="wrap">
                <For each={["torrent", "cas", "oss"] as SeedFormat[]}>
                  {(format) => (
                    <Checkbox
                      checked={sidecars().includes(format)}
                      onChange={(event) =>
                        toggleSidecar(format, event.currentTarget.checked)
                      }
                    >
                      {format.toUpperCase()}
                    </Checkbox>
                  )}
                </For>
              </HStack>
              <Text fontSize="$xs" color="$neutral10">
                {t("home.upload.sidecars_hint")}
              </Text>
              <Show when={sidecars().length > 0}>
                <SimpleGrid columns={{ "@initial": 1, "@md": 3 }} gap="$2">
                  <For each={["md5", "sha1", "sha256"] as SeedHashAlgorithm[]}>
                    {(algorithm) => {
                      const forced = () =>
                        (algorithm === "sha1" &&
                          sidecars().includes("torrent")) ||
                        (algorithm === "md5" && sidecars().includes("cas"))
                      return (
                        <VStack
                          alignItems="flex-start"
                          spacing="$1"
                          border="1px solid $neutral7"
                          borderRadius="$md"
                          p="$2"
                        >
                          <Text fontSize="$sm" fontWeight="$semibold">
                            {algorithm.toUpperCase()}
                          </Text>
                          <Checkbox
                            checked={effectiveSeedMatrix()[algorithm].whole}
                            disabled={forced()}
                            onChange={(event) =>
                              setSeedHash(
                                algorithm,
                                "whole",
                                event.currentTarget.checked,
                              )
                            }
                          >
                            {t("home.transfer_seed.whole")}
                          </Checkbox>
                          <Checkbox
                            checked={effectiveSeedMatrix()[algorithm].pieces}
                            disabled={forced()}
                            onChange={(event) =>
                              setSeedHash(
                                algorithm,
                                "pieces",
                                event.currentTarget.checked,
                              )
                            }
                          >
                            {t("home.transfer_seed.pieces")}
                          </Checkbox>
                        </VStack>
                      )
                    }}
                  </For>
                </SimpleGrid>
                <Box maxW="$48">
                  <Text fontSize="$sm" mb="$1">
                    {t("home.transfer_seed.piece_size")}
                  </Text>
                  <SelectWrapper
                    value={seedPieceSize().toString()}
                    onChange={(value) => setSeedPieceSize(Number(value))}
                    options={(sidecars().includes("cas")
                      ? [10]
                      : [1, 2, 4, 8, 10, 16]
                    ).map((size) => ({
                      value: String(size * 1024 * 1024),
                      label: `${size} MiB`,
                    }))}
                  />
                </Box>
              </Show>
            </VStack>
          </Show>
        </VStack>
      </Show>
    </VStack>
  )
}

export default Upload
