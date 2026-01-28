import {
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Input,
  VStack,
  HStack,
  Text,
  Icon,
  Checkbox,
  Box,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  Spinner,
} from "@hope-ui/solid"
import { createStore } from "solid-js/store"
import { For, Show, createSignal } from "solid-js"
import { useT, usePath, useRouter } from "~/hooks"
import { handleResp, notify, hoverColor, getFileSize } from "~/utils"
import { flashList, flashImport } from "~/utils/api"
import { getIconByObj } from "~/utils/icon"
import { getMainColor } from "~/store"
import { AiOutlineThunderbolt } from "solid-icons/ai"

const QQ_FLASH_LINK =
  'tencent://ntqq-open/?subCmd=flashTransfer&action=openTransPage&actionParams={"fileSetId":"","allChecked":"","selectedItems":"","sourceType":"share"}'

type FlashFile = {
  name: string
  is_dir: boolean
  size: number
  file_id: string
  parent_id: string
  fileset_id: string
  physical_id: string
  file_sha1: string
  path: string
  status: number
}

type FolderData = {
  fileset_id: string
  fileset_name: string
  list: {
    Error: {
      code: number
      message: string
    }
    cost: number
    message: string
    retcode: number
    data: {
      file_lists: {
        pagination_info: string
        parent_id: string
        is_end: boolean
        depth: number
        file_list: {
          file_count: number
          thumbnail: {
            sha1: string
            urls: {
              url: string
              spec: number
            }[]
            id: string
            md5: string
            size: string
          }
          physical: {
            download_limit_status: number
            url: string
            id: string
            processing: string
            status: number
            is_unzipped: boolean
          }
          path: string
          srv_fileid: string
          srv_parent_fileid: string
          safe_status: number
          parent_id: string
          file_sha1: string
          file_physical_size: string
          file_md5: string
          name: string
          is_dir: boolean
          cli_file_index: number
          file_type: number
          fileset_id: string
          file_size: string
          cli_fileid: string
        }[]
      }[]
    }
  }
}
const isZip = (name: string) => {
  return /\.(zip|rar|7z)$/i.test(name)
}

const isFileReady = (status: number) => status === 2

export const FlashTransferModal = (props: {
  opened: boolean
  onClose: () => void
}) => {
  const t = useT()
  const { refresh } = usePath()
  const { pathname } = useRouter()

  const [shareKey, setShareKey] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [importing, setImporting] = createSignal(false)
  const [hasSearch, setHasSearch] = createSignal(false)

  const [selectedMap, setSelectedMap] = createSignal<Map<string, FlashFile>>(
    new Map(),
  )

  const [pathStack, setPathStack] = createStore<
    { name: string; id: string; zipFileId?: string }[]
  >([{ name: "Root", id: "", zipFileId: "" }])

  const [files, setFiles] = createSignal<FlashFile[]>([])
  const [currentFilesetId, setCurrentFilesetId] = createSignal("")

  const getCurrentFullPath = () => {
    return pathStack
      .slice(1)
      .map((item) => item.name)
      .join("/")
  }

  const fetchList = async (parentId: string = "", zipFileId: string = "") => {
    if (!shareKey()) return
    setHasSearch(true)
    setLoading(true)

    const isZipMode = !!zipFileId
    const resp = await flashList(
      currentFilesetId() || shareKey(),
      parentId,
      isZipMode,
      zipFileId,
    )

    setLoading(false)

    handleResp(resp as any, (data: FolderData) => {
      const listData = data.list?.data?.file_lists?.[0]?.file_list || []
      if (data.fileset_id) {
        setCurrentFilesetId(data.fileset_id)
      }

      if (data.fileset_name && data.fileset_name.length > 0) {
        if (pathStack.length > 0 && pathStack[0].id === "") {
          setPathStack(0, "name", data.fileset_name)
        }
      }

      const currentPathPrefix = getCurrentFullPath()

      const formattedFiles: FlashFile[] = listData.map((item: any) => {
        const name = item.physical?.name || item.name || "Unknown"
        const manualPath = currentPathPrefix
          ? `${currentPathPrefix}/${name}`
          : name

        const rawStatus = item.physical?.status
        const effectiveStatus =
          rawStatus !== undefined ? rawStatus : zipFileId ? 2 : 0

        return {
          name: name,
          is_dir: item.is_dir === true,
          size: parseInt(item.file_physical_size || item.size || "0"),
          file_id: item.srv_fileid || item.id || item.cli_fileid,
          parent_id: item.parent_id,
          fileset_id: data.fileset_id,
          physical_id: item.physical?.id || item.id,
          file_sha1: item.file_sha1 || item.thumbnail?.sha1,
          path: manualPath,
          status: effectiveStatus,
        }
      })

      setFiles(formattedFiles)
    })
  }

  const handleNav = (index: number) => {
    const target = pathStack[index]
    setPathStack((prev) => prev.slice(0, index + 1))
    fetchList(target.id, target.zipFileId)
  }

  const enterItem = (file: FlashFile) => {
    const currentContext = pathStack[pathStack.length - 1]

    if (file.is_dir) {
      const nextZipId = currentContext.zipFileId || ""
      setPathStack((prev) => [
        ...prev,
        { name: file.name, id: file.file_id, zipFileId: nextZipId },
      ])
      fetchList(file.file_id, nextZipId)
    } else if (isZip(file.name)) {
      if (currentContext.zipFileId) {
        notify.info("Viewing nested compressed files is not supported.")
        return
      }
      setPathStack((prev) => [
        ...prev,
        { name: file.name, id: "", zipFileId: file.file_id },
      ])
      fetchList("", file.file_id)
    }
  }

  const isAncestorSelected = (currentPath: string) => {
    for (const selected of selectedMap().values()) {
      if (selected.is_dir && currentPath.startsWith(selected.path + "/")) {
        return true
      }
    }
    return false
  }

  const toggleSelect = (file: FlashFile) => {
    if (!isFileReady(file.status)) {
      return
    }
    if (isAncestorSelected(file.path)) {
      return
    }

    const map = new Map(selectedMap())

    if (map.has(file.file_id)) {
      map.delete(file.file_id)
    } else {
      map.set(file.file_id, file)

      if (file.is_dir) {
        for (const [id, selectedItem] of map.entries()) {
          if (
            id !== file.file_id &&
            selectedItem.path.startsWith(file.path + "/")
          ) {
            map.delete(id)
          }
        }
      }
    }
    setSelectedMap(map)
  }

  const toggleSelectAll = (val: boolean) => {
    const map = new Map(selectedMap())
    files().forEach((file) => {
      if (!isFileReady(file.status)) return

      if (isAncestorSelected(file.path)) return

      if (val) {
        map.set(file.file_id, file)
      } else {
        map.delete(file.file_id)
      }
    })
    setSelectedMap(map)
  }

  const optimizeSelections = (items: FlashFile[]): FlashFile[] => {
    const sorted = items.sort((a, b) => a.path.length - b.path.length)
    const result: FlashFile[] = []

    for (const item of sorted) {
      const isCovered = result.some(
        (existing) =>
          existing.is_dir && item.path.startsWith(existing.path + "/"),
      )

      if (!isCovered) {
        result.push(item)
      }
    }
    return result
  }

  const handleImport = async () => {
    const rawSelection = Array.from(selectedMap().values())
    if (rawSelection.length === 0) return

    const finalSelection = optimizeSelections(rawSelection)

    setImporting(true)

    const resp = await flashImport(pathname(), finalSelection)
    setImporting(false)

    handleResp(resp as any, () => {
      notify.success(t("global.success"))
      props.onClose()
      refresh()
    })
  }

  const handleRowClick = (file: FlashFile) => {
    const currentContext = pathStack[pathStack.length - 1]

    if (
      isZip(file.name) &&
      !currentContext.zipFileId &&
      !isFileReady(file.status)
    ) {
      return
    }

    if (file.is_dir) {
      enterItem(file)
      return
    }

    if (
      isZip(file.name) &&
      !currentContext.zipFileId &&
      isFileReady(file.status)
    ) {
      enterItem(file)
      return
    }

    toggleSelect(file)
  }

  const getIconObj = (file: FlashFile) => ({
    name: file.name,
    is_dir: file.is_dir,
    type: file.is_dir ? 1 : 0,
    size: file.size,
    modified: "",
    sign: "",
    thumb: "",
    id: 0,
    path: "",
    is_symlink: false,
  })
  const validFilesCount = () =>
    files().filter((f) => isFileReady(f.status)).length
  return (
    <Modal opened={props.opened} onClose={props.onClose} size="xl">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Upload QQ Flash Transfer</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing="$4" alignItems="stretch">
            <HStack spacing="$2">
              <Input
                placeholder="Input QQ Flash Transfer Share Code"
                value={shareKey()}
                onInput={(e) => {
                  setShareKey(e.currentTarget.value)
                  setCurrentFilesetId("")
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") fetchList("")
                }}
              />
              <Button onClick={() => fetchList("")} loading={loading()}>
                Search
              </Button>
            </HStack>

            <Breadcrumb>
              <For each={pathStack}>
                {(item, i) => (
                  <BreadcrumbItem>
                    <BreadcrumbLink onClick={() => handleNav(i())}>
                      {item.name}
                    </BreadcrumbLink>
                    <Show when={i() < pathStack.length - 1}>
                      <BreadcrumbSeparator />
                    </Show>
                  </BreadcrumbItem>
                )}
              </For>
            </Breadcrumb>

            <Box
              borderWidth="1px"
              borderColor="$neutral6"
              rounded="$md"
              h="400px"
              overflowY="auto"
              p="$2"
              pos="relative"
            >
              <Show when={loading()}>
                <VStack h="100%" justifyContent="center">
                  <Spinner />
                </VStack>
              </Show>

              <Show when={!loading() && files().length > 0}>
                <VStack spacing="$1" alignItems="stretch">
                  <HStack p="$2" borderBottom="1px solid $neutral4">
                    <Checkbox
                      checked={
                        validFilesCount() > 0 &&
                        files()
                          .filter((f) => isFileReady(f.status))
                          .every(
                            (f) =>
                              selectedMap().has(f.file_id) ||
                              isAncestorSelected(f.path),
                          )
                      }
                      disabled={validFilesCount() === 0}
                      onChange={(e: any) => toggleSelectAll(e.target.checked)}
                    />
                    <Text fontWeight="bold">Select All</Text>
                  </HStack>
                  <For each={files()}>
                    {(file) => {
                      const isReady = isFileReady(file.status)

                      return (
                        <HStack
                          p="$2"
                          spacing="$2"
                          rounded="$md"
                          _hover={{ bgColor: hoverColor() as any }}
                          cursor={
                            !isReady && !file.is_dir ? "not-allowed" : "pointer"
                          }
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRowClick(file)
                          }}
                        >
                          <Box onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={
                                selectedMap().has(file.file_id) ||
                                isAncestorSelected(file.path)
                              }
                              disabled={
                                isAncestorSelected(file.path) || !isReady
                              }
                              onChange={() => toggleSelect(file)}
                            />
                          </Box>

                          <HStack
                            flex={1}
                            spacing="$2"
                            onClick={(e) => {
                              if (!isReady && !file.is_dir) {
                                e.stopPropagation()
                                return
                              }
                            }}
                          >
                            <Icon
                              as={getIconByObj(getIconObj(file))}
                              color={getMainColor()}
                              boxSize="$6"
                            />

                            <VStack
                              flex={1}
                              alignItems="flex-start"
                              spacing="0"
                            >
                              <HStack>
                                <Text
                                  noOfLines={1}
                                  color={isReady ? "$neutral12" : "$danger10"}
                                >
                                  {file.name}
                                </Text>

                                <Show when={!isReady}>
                                  <Text fontSize="xs" color="$danger10" ml="$2">
                                    {file.is_dir
                                      ? "(Files inside waiting for upload)"
                                      : "(Waiting for upload)"}
                                  </Text>
                                </Show>
                              </HStack>
                            </VStack>

                            <Text color="$neutral10" fontSize="sm">
                              {getFileSize(file.size)}
                            </Text>
                          </HStack>
                        </HStack>
                      )
                    }}
                  </For>
                </VStack>
              </Show>
              <Show when={!loading() && files().length === 0 && hasSearch()}>
                <VStack h="100%" justifyContent="center">
                  <Text color="$neutral10">No file here</Text>
                </VStack>
              </Show>

              <Show when={!loading() && files().length === 0 && !hasSearch()}>
                <VStack
                  h="100%"
                  justifyContent="center"
                  spacing="$4"
                  cursor="pointer"
                  onClick={() => (window.location.href = QQ_FLASH_LINK)}
                  _hover={{
                    "& > .icon-box": {
                      color: "$info10",
                      transform: "scale(1.1)",
                    },
                    "& > p": { color: "$info10" },
                  }}
                  transition="all 0.2s"
                >
                  <Box class="icon-box" transition="all 0.2s" color="$neutral8">
                    <Icon as={AiOutlineThunderbolt} boxSize="80px" />
                  </Box>
                  <Text
                    fontWeight="bold"
                    fontSize="lg"
                    color="$neutral9"
                    transition="all 0.2s"
                  >
                    Click to Start QQ Flash Transfer
                  </Text>
                </VStack>
              </Show>
            </Box>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button onClick={props.onClose} colorScheme="neutral" mr="$2">
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            loading={importing()}
            disabled={selectedMap().size === 0}
          >
            Upload Selected QQ Flash Transfer Files
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
