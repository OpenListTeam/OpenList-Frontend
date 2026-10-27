import {
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Table,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
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
} from "solid-js"
import type { AlbumInfo, MediaItem } from "~/types"
import { useT } from "~/hooks"
import { notify } from "~/utils"
import { resolveMediaCover } from "~/utils/media_cover"
import {
  adminGetAlbumItems,
  adminGetMediaAlbums,
  adminUpdateMediaAlbum,
  adminUpdateMediaItem,
  adminUploadMediaCover,
} from "~/utils/media_api"

interface MediaAlbumTableProps {
  scanPathId: number
  keyword: string
  pageSize: number
  getScanPathName: (id: number) => string
  /** 打开单曲编辑弹窗（复用媒体条目的编辑表单） */
  onEditTrack: (item: MediaItem) => void
  /** 外部刷新令牌：父组件保存条目后自增，触发专辑列表重新拉取 */
  refreshToken?: number
}

/**
 * 后台「按专辑」视图：音乐条目先按 album_name + album_artist 聚合，
 * 展开某张专辑时再拉真实曲目（有 id，可直接编辑）。
 *
 * 之所以单独成组件：专辑是聚合出来的虚拟分组，没有独立表；
 * 专辑级修改要批量写到该专辑下所有曲目，逻辑与单条编辑差别较大。
 */
export const MediaAlbumTable = (props: MediaAlbumTableProps) => {
  const t = useT()
  const [page, setPage] = createSignal(1)
  const [expandedKey, setExpandedKey] = createSignal<string | null>(null)
  const [tracks, setTracks] = createSignal<MediaItem[]>([])
  const [tracksLoading, setTracksLoading] = createSignal(false)

  const [editing, setEditing] = createSignal<AlbumInfo | null>(null)
  const [showModal, setShowModal] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [uploading, setUploading] = createSignal(false)
  const [firstTrackId, setFirstTrackId] = createSignal(0)
  // 上传封面会立刻写进首曲（接口按单条生效）；用户取消弹窗时要改回去，
  // 否则这张专辑会变成「只有一首有封面」的不一致状态
  const [originalCover, setOriginalCover] = createSignal("")
  const [uploadedCover, setUploadedCover] = createSignal(false)
  const [draft, setDraft] = createSignal({
    name: "",
    artist: "",
    cover: "",
    release_date: "",
    genre: "",
    plot: "",
  })

  const albumKey = (al: AlbumInfo) => `${al.album_name}\u0000${al.album_artist}`

  // 筛选条件或每页数量变化时回到第一页（否则可能停在不存在的页上显示空白）
  createEffect(() => {
    props.scanPathId
    props.keyword
    props.pageSize
    setPage(1)
    setExpandedKey(null)
  })

  const [data, { refetch }] = createResource(
    () => ({
      page: page(),
      pageSize: props.pageSize,
      scanPathId: props.scanPathId,
      keyword: props.keyword,
      // 父组件保存单曲后自增，用于刷新专辑聚合（封面 / 曲目数）
      token: props.refreshToken ?? 0,
    }),
    async (q) => {
      const resp = await adminGetMediaAlbums({
        page: q.page,
        page_size: q.pageSize,
        scan_path_id: q.scanPathId || undefined,
        keyword: q.keyword || undefined,
      })
      if (resp.code === 200) return resp.data
      return { content: [] as AlbumInfo[], total: 0 }
    },
  )
  const albums = () => data()?.content ?? []
  const total = () => data()?.total ?? 0
  const totalPages = createMemo(() =>
    Math.max(1, Math.ceil(total() / props.pageSize)),
  )

  const toggleAlbum = async (al: AlbumInfo) => {
    const key = albumKey(al)
    if (expandedKey() === key) {
      setExpandedKey(null)
      setTracks([])
      return
    }
    setExpandedKey(key)
    setTracks([])
    setTracksLoading(true)
    try {
      const resp = await adminGetAlbumItems({
        album_name: al.album_name,
        album_artist: al.album_artist,
        scan_path_id: al.scan_path_id || undefined,
      })
      if (resp.code === 200) setTracks(resp.data)
      else notify.error(resp.message)
    } finally {
      setTracksLoading(false)
    }
  }

  const openAlbumEditor = async (al: AlbumInfo) => {
    setEditing(al)
    setDraft({
      name: al.album_name,
      artist: al.album_artist,
      cover: al.cover,
      release_date: al.release_date,
      genre: "",
      plot: "",
    })
    setFirstTrackId(0)
    setOriginalCover(al.cover)
    setUploadedCover(false)
    setShowModal(true)
    // 取首曲作为「曲目号/类型/简介」的默认值，同时拿到上传封面时要用的 item id
    const resp = await adminGetAlbumItems({
      album_name: al.album_name,
      album_artist: al.album_artist,
      scan_path_id: al.scan_path_id || undefined,
    })
    if (resp.code !== 200 || resp.data.length === 0) return
    const first = resp.data[0]
    setFirstTrackId(first.id)
    setDraft((d) => ({
      ...d,
      cover: d.cover || first.cover,
      genre: first.genre || "",
      plot: first.plot || first.description || "",
      release_date: d.release_date || first.release_date || "",
    }))
  }

  const pickAndUploadCover = async () => {
    const id = firstTrackId()
    if (!id) {
      notify.error(t("media.admin.album_no_tracks"))
      return
    }
    const file = await new Promise<File | null>((resolve) => {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = "image/jpeg,image/png,image/gif,image/webp"
      input.onchange = () => resolve(input.files?.[0] ?? null)
      input.click()
    })
    if (!file) return
    setUploading(true)
    try {
      const resp = await adminUploadMediaCover(id, file)
      if (resp.code === 200 && resp.data?.cover) {
        setDraft((d) => ({ ...d, cover: resp.data.cover }))
        setUploadedCover(true)
        notify.success(t("media.admin.cover_uploaded"))
      } else {
        notify.error(t("media.admin.cover_upload_failed") + ": " + resp.message)
      }
    } finally {
      setUploading(false)
    }
  }

  // 关闭弹窗：如果本次已经上传过封面但没保存，把首曲的封面改回去
  const closeModal = async () => {
    setShowModal(false)
    if (!uploadedCover()) return
    setUploadedCover(false)
    const id = firstTrackId()
    if (!id) return
    try {
      // 更新接口是 PATCH 语义，只传 cover 不会动其它字段
      await adminUpdateMediaItem({ id, cover: originalCover() })
    } catch {
      /* 回滚失败不阻塞关闭，用户可再上传一次覆盖 */
    }
  }

  const handleSave = async () => {
    const al = editing()
    if (!al) return
    setSaving(true)
    try {
      const resp = await adminUpdateMediaAlbum({
        album_name: al.album_name,
        album_artist: al.album_artist,
        scan_path_id: al.scan_path_id || undefined,
        new_album_name: draft().name,
        new_album_artist: draft().artist,
        cover: draft().cover,
        release_date: draft().release_date,
        genre: draft().genre,
        plot: draft().plot,
      })
      if (resp.code === 200) {
        notify.success(
          t("media.admin.album_saved", { count: resp.data.affected }),
        )
        setUploadedCover(false)
        setShowModal(false)
        setEditing(null)
        setExpandedKey(null)
        setTracks([])
        refetch()
      } else {
        notify.error(t("media.admin.save_failed") + ": " + resp.message)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box>
      <Table>
        <Thead>
          <Tr>
            <Th>{t("media.admin.col_cover")}</Th>
            <Th>{t("media.admin.col_album")}</Th>
            <Th>{t("media.admin.col_album_artist")}</Th>
            <Th>{t("media.admin.col_track_count")}</Th>
            <Th>{t("media.admin.col_scan_path")}</Th>
            <Th>{t("media.admin.col_actions")}</Th>
          </Tr>
        </Thead>
        <Tbody>
          <Show
            when={!data.loading}
            fallback={
              <Tr>
                <Td colSpan={6}>
                  <HStack justifyContent="center" py="$8">
                    <Spinner />
                  </HStack>
                </Td>
              </Tr>
            }
          >
            <Show
              when={albums().length > 0}
              fallback={
                <Tr>
                  <Td colSpan={6}>
                    <Text textAlign="center" color="$neutral11" py="$8">
                      {t("media.admin.no_items")}
                    </Text>
                  </Td>
                </Tr>
              }
            >
              <For each={albums()}>
                {(al) => (
                  <>
                    <Tr>
                      <Td w="64px">
                        <Show
                          when={al.cover}
                          fallback={
                            <Box
                              w="40px"
                              h="40px"
                              rounded="$sm"
                              bgColor="$neutral3"
                            />
                          }
                        >
                          <img
                            src={resolveMediaCover(al.cover)}
                            style={{
                              width: "40px",
                              height: "40px",
                              "object-fit": "cover",
                              "border-radius": "4px",
                            }}
                          />
                        </Show>
                      </Td>
                      <Td maxW="240px">
                        <span
                          title={al.album_name}
                          style={{
                            display: "block",
                            "font-size": "14px",
                            "font-weight": "500",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                        >
                          {al.album_name || t("media.admin.album_unknown_name")}
                        </span>
                      </Td>
                      <Td maxW="180px">
                        <span
                          style={{
                            display: "block",
                            "font-size": "13px",
                            color: "var(--hope-colors-neutral11)",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                        >
                          {al.album_artist || t("media.music.unknown_artist")}
                        </span>
                      </Td>
                      <Td>
                        <Text fontSize="$sm">
                          {t("media.admin.track_count_value", {
                            count: al.track_count,
                          })}
                        </Text>
                      </Td>
                      <Td>
                        <Text fontSize="$sm" color="$neutral11">
                          {props.getScanPathName(al.scan_path_id)}
                        </Text>
                      </Td>
                      <Td>
                        <HStack spacing="$1">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => toggleAlbum(al)}
                          >
                            {expandedKey() === albumKey(al)
                              ? t("media.admin.collapse_tracks")
                              : t("media.admin.expand_tracks")}
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => openAlbumEditor(al)}
                          >
                            {t("media.admin.edit_album")}
                          </Button>
                        </HStack>
                      </Td>
                    </Tr>
                    <Show when={expandedKey() === albumKey(al)}>
                      <Tr>
                        <Td colSpan={6} bgColor="$neutral2">
                          <Show
                            when={!tracksLoading()}
                            fallback={
                              <HStack justifyContent="center" py="$4">
                                <Spinner />
                              </HStack>
                            }
                          >
                            <Table>
                              <Thead>
                                <Tr>
                                  <Th w="60px">
                                    {t("media.admin.track_number")}
                                  </Th>
                                  <Th>{t("media.admin.col_file_name")}</Th>
                                  <Th>{t("media.admin.col_name")}</Th>
                                  <Th w="100px">
                                    {t("media.admin.col_actions")}
                                  </Th>
                                </Tr>
                              </Thead>
                              <Tbody>
                                <For each={tracks()}>
                                  {(track) => (
                                    <Tr>
                                      <Td>
                                        <Text fontSize="$sm">
                                          {track.track_number || "-"}
                                        </Text>
                                      </Td>
                                      <Td maxW="260px">
                                        <span
                                          title={track.file_name}
                                          style={{
                                            display: "block",
                                            "font-size": "12px",
                                            overflow: "hidden",
                                            "text-overflow": "ellipsis",
                                            "white-space": "nowrap",
                                          }}
                                        >
                                          {track.file_name}
                                        </span>
                                      </Td>
                                      <Td>
                                        <Text fontSize="$sm">
                                          {track.scraped_name ||
                                            track.file_name}
                                        </Text>
                                      </Td>
                                      <Td>
                                        <Button
                                          size="xs"
                                          variant="ghost"
                                          onClick={() =>
                                            props.onEditTrack(track)
                                          }
                                        >
                                          {t("media.admin.edit")}
                                        </Button>
                                      </Td>
                                    </Tr>
                                  )}
                                </For>
                              </Tbody>
                            </Table>
                          </Show>
                        </Td>
                      </Tr>
                    </Show>
                  </>
                )}
              </For>
            </Show>
          </Show>
        </Tbody>
      </Table>

      {/* 分页 */}
      <Show when={totalPages() > 1}>
        <HStack justifyContent="center" spacing="$2" mt="$4">
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
        </HStack>
      </Show>

      {/* 专辑编辑弹窗 */}
      <Modal opened={showModal()} onClose={closeModal} size="xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{t("media.admin.edit_album")}</ModalHeader>
          <ModalCloseButton />
          <ModalBody maxH="70vh" overflowY="auto">
            <VStack spacing="$4" alignItems="stretch">
              <FormControl>
                <FormLabel>{t("media.admin.item_cover_url")}</FormLabel>
                <HStack spacing="$3" alignItems="flex-start">
                  <Box
                    w="72px"
                    h="72px"
                    flexShrink={0}
                    rounded="$md"
                    overflow="hidden"
                    border="1px solid $neutral4"
                    bgColor="$neutral2"
                  >
                    <Show when={draft().cover}>
                      <img
                        src={resolveMediaCover(draft().cover)}
                        style={{
                          width: "100%",
                          height: "100%",
                          "object-fit": "cover",
                        }}
                      />
                    </Show>
                  </Box>
                  <VStack spacing="$2" alignItems="stretch" flex="1" minW="0">
                    <Input
                      placeholder="https://… 或 thumb:/imgs/…"
                      value={draft().cover}
                      onInput={(e) =>
                        setDraft((d) => ({
                          ...d,
                          cover: e.currentTarget.value,
                        }))
                      }
                    />
                    <HStack spacing="$2">
                      <Button
                        size="xs"
                        variant="outline"
                        colorScheme="accent"
                        loading={uploading()}
                        onClick={pickAndUploadCover}
                      >
                        {t("media.admin.cover_upload")}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorScheme="neutral"
                        onClick={() => setDraft((d) => ({ ...d, cover: "" }))}
                      >
                        {t("media.admin.cover_clear")}
                      </Button>
                    </HStack>
                  </VStack>
                </HStack>
                <FormHelperText>
                  {t("media.admin.album_cover_helper")}
                </FormHelperText>
              </FormControl>

              <HStack spacing="$3" alignItems="flex-end" flexWrap="wrap">
                <FormControl flex="1" minW="200px">
                  <FormLabel>{t("media.admin.album_name")}</FormLabel>
                  <Input
                    value={draft().name}
                    onInput={(e) =>
                      setDraft((d) => ({ ...d, name: e.currentTarget.value }))
                    }
                  />
                </FormControl>
                <FormControl flex="1" minW="160px">
                  <FormLabel>{t("media.admin.album_artist")}</FormLabel>
                  <Input
                    value={draft().artist}
                    onInput={(e) =>
                      setDraft((d) => ({ ...d, artist: e.currentTarget.value }))
                    }
                  />
                </FormControl>
              </HStack>

              <HStack spacing="$3" alignItems="flex-end" flexWrap="wrap">
                <FormControl flex="1" minW="160px">
                  <FormLabel>{t("media.admin.item_genre")}</FormLabel>
                  <Input
                    value={draft().genre}
                    onInput={(e) =>
                      setDraft((d) => ({ ...d, genre: e.currentTarget.value }))
                    }
                  />
                </FormControl>
                <FormControl w="160px">
                  <FormLabel>{t("media.admin.item_release_date")}</FormLabel>
                  <Input
                    placeholder="YYYY-MM-DD"
                    value={draft().release_date}
                    onInput={(e) =>
                      setDraft((d) => ({
                        ...d,
                        release_date: e.currentTarget.value,
                      }))
                    }
                  />
                </FormControl>
              </HStack>

              <FormControl>
                <FormLabel>{t("media.admin.summary")}</FormLabel>
                <Textarea
                  rows={4}
                  value={draft().plot}
                  onInput={(e) =>
                    setDraft((d) => ({ ...d, plot: e.currentTarget.value }))
                  }
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing="$2">
              <Button variant="ghost" onClick={closeModal}>
                {t("global.cancel")}
              </Button>
              <Button
                colorScheme="accent"
                loading={saving()}
                onClick={handleSave}
              >
                {t("global.save")}
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}
