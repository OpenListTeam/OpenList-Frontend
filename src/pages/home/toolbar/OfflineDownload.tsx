import {
  Box,
  createDisclosure,
  Heading,
  HStack,
  Text,
  VStack,
} from "@hope-ui/solid"
import bencode from "bencode"
import crypto from "crypto-js"
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import { FullLoading, ModalInput, SelectWrapper } from "~/components"
import { useFetch, useRouter, useT } from "~/hooks"
import { useTasks } from "~/store/task"
import { PResp } from "~/types"
import {
  bus,
  handleResp,
  handleRespWithNotifySuccess,
  offlineDownload,
  r,
} from "~/utils"
import OfflineDownloadTaskItem from "./TaskProgress"

const deletePolicies = [
  "upload_download_stream",
  "delete_on_upload_succeed",
  "delete_on_upload_failed",
  "delete_never",
  "delete_always",
] as const

type DeletePolicy = (typeof deletePolicies)[number]

function utf8Decode(data: Uint8Array): string {
  return crypto.enc.Utf8.stringify(crypto.lib.WordArray.create(data))
}

function toMagnetUrl(torrentBuffer: Uint8Array) {
  const data = bencode.decode(torrentBuffer as any)
  const infoEncode = bencode.encode(data.info) as unknown as Uint8Array

  const infoHash = crypto
    .SHA1(crypto.lib.WordArray.create(infoEncode))
    .toString()
  let params = {} as any

  if (Number.isInteger(data?.info?.length)) {
    params.xl = data.info.length
  }
  if (data.info.name) {
    params.dn = utf8Decode(data.info.name)
  }
  if (data.announce) {
    params.tr = utf8Decode(data.announce)
  }

  return `magnet:?xt=urn:btih:${infoHash}&${new URLSearchParams(
    params,
  ).toString()}`
}

export const OfflineDownload = () => {
  const t = useT()
  const [tools, setTools] = createSignal([] as string[])
  const [toolsLoading, reqTool] = useFetch((): PResp<string[]> => {
    return r.get("/public/offline_download_tools")
  })
  const [tool, setTool] = createSignal("")
  const [deletePolicy, setDeletePolicy] = createSignal<DeletePolicy>(
    "upload_download_stream",
  )
  onMount(async () => {
    const resp = await reqTool()
    handleResp(resp, (data) => {
      setTools(data)
      setTool(data[0])
    })
  })

  const { isOpen, onOpen, onClose } = createDisclosure()
  const [loading, ok] = useFetch(offlineDownload)
  const { pathname } = useRouter()

  // 监听工具栏事件
  const handler = (name: string) => {
    if (name === "offline_download") {
      onOpen()
      setShowTasks(true)
      fetchOfflineDownloadTasks(true)
    }
  }
  bus.on("tool", handler)
  onCleanup(() => {
    bus.off("tool", handler)
  })

  const { tasks, loading: tasksLoading, fetchOfflineDownloadTasks } = useTasks()
  const [showTasks, setShowTasks] = createSignal(false)

  const handleSubmit = async (
    urls: string,
    setValue: (value: string) => void,
  ) => {
    const resp = await ok(pathname(), urls.split("\n"), tool(), deletePolicy())
    handleRespWithNotifySuccess(resp, () => {
      fetchOfflineDownloadTasks(true) // 显示 loading
      setValue("")
    })
  }

  // 定时刷新任务进度（仅当显示任务列表时）
  let timer: number | undefined
  let isFetching = false
  createEffect(() => {
    if (showTasks()) {
      const poll = async () => {
        if (!showTasks()) return
        if (isFetching) {
          timer = window.setTimeout(poll, 3000)
          return
        }
        isFetching = true
        try {
          await fetchOfflineDownloadTasks(false)
        } finally {
          isFetching = false
        }
        if (showTasks()) {
          timer = window.setTimeout(poll, 3000)
        }
      }
      void poll()
    } else {
      clearTimeout(timer)
      timer = undefined
    }
  })

  onCleanup(() => {
    clearTimeout(timer)
  })

  // 拖拽种子文件转换为磁力链接
  const handleTorrentFileDrop = async (
    e: DragEvent,
    setValue: (value: string) => void,
  ) => {
    e.preventDefault()
    if (e.dataTransfer?.files.length) {
      const values = []
      for (const file of e.dataTransfer.files) {
        if (file.name.toLowerCase().endsWith(".torrent")) {
          try {
            const buffer = await file.arrayBuffer()
            values.push(toMagnetUrl(new Uint8Array(buffer)))
          } catch (err) {
            console.error("Failed to convert torrent file to magnet link:", err)
          }
        }
      }
      if (values.length) {
        setValue(values.join("\n"))
      }
    }
  }

  return (
    <ModalInput
      title="home.toolbar.offline_download"
      type="text"
      opened={isOpen()}
      onClose={() => {
        onClose()
        setShowTasks(false)
      }}
      loading={toolsLoading() || loading()}
      tips={t("home.toolbar.offline_download-tips")}
      onDrop={handleTorrentFileDrop}
      topSlot={
        <Box mb="$2">
          <SelectWrapper
            value={tool()}
            onChange={(v) => {
              if (
                v !== "SimpleHttp" &&
                deletePolicy() === "upload_download_stream"
              ) {
                setDeletePolicy("delete_on_upload_succeed")
              }
              setTool(v)
            }}
            options={tools().map((tool) => {
              return { value: tool, label: tool }
            })}
          />
        </Box>
      }
      bottomSlot={
        <VStack spacing="$4" w="$full">
          <Box>
            <SelectWrapper
              value={deletePolicy()}
              onChange={(v) => setDeletePolicy(v as DeletePolicy)}
              options={deletePolicies
                .filter((policy) =>
                  policy === "upload_download_stream"
                    ? tool() === "SimpleHttp"
                    : true,
                )
                .map((policy) => ({
                  value: policy,
                  label: t(`home.toolbar.delete_policy.${policy}`),
                }))}
            />
          </Box>

          {/* 任务列表 */}
          <Show when={showTasks()}>
            <Box
              w="$full"
              maxHeight="300px"
              overflowY="auto"
              pr="$1" // 避免滚动条遮挡内容
              minHeight="0"
            >
              <HStack justifyContent="space-between" mb="$2">
                <Heading size="sm" mb="$2" textAlign="center" w="$full">
                  {t("tasks.attr.offline_download.list_title")}
                </Heading>
              </HStack>
              <Show when={!tasksLoading()} fallback={<FullLoading />}>
                <VStack spacing="$2">
                  <For each={tasks}>{(task) => <OfflineDownloadTaskItem {...task} />}</For>
                  <Show when={tasks.length === 0}>
                    <Text color="$neutral11" textAlign="center" w="$full">
                      {t("tasks.attr.offline_download.no_tasks")}
                    </Text>
                  </Show>
                </VStack>
              </Show>
            </Box>
          </Show>
        </VStack>
      }
      onSubmitWithValue={handleSubmit}
    />
  )
}
