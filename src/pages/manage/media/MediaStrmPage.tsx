import { Box, Button, HStack, Heading, Text, VStack } from "@hope-ui/solid"
import { createSignal, onMount } from "solid-js"
import CommonSettings from "../settings/Common"
import { Group, type MediaType } from "~/types"
import { notify } from "~/utils"
import { adminGenerateStrm, getMediaStatus } from "~/utils/media_api"
import { mediaStatus, setMediaStatus } from "~/store/media"

/** STRM 相关设置项 */
const STRM_KEYS = [
  "media_strm_on_scan",
  "media_strm_overwrite",
  "media_strm_same_dir",
  "media_strm_path",
  "media_strm_template",
]

const GENERATE_TYPES: { type: MediaType; label: string }[] = [
  { type: "video", label: "电影视频" },
  { type: "music", label: "音乐歌曲" },
  { type: "image", label: "图片壁纸" },
  { type: "book", label: "电子书籍" },
]

const MediaStrmPage = () => {
  const [generating, setGenerating] = createSignal<string | null>(null)

  const loadStatus = async () => {
    const resp = await getMediaStatus()
    if (resp.code === 200) setMediaStatus(resp.data)
  }
  onMount(loadStatus)

  const generate = async (mediaType?: MediaType) => {
    setGenerating(mediaType ?? "all")
    const resp = await adminGenerateStrm(mediaType)
    setGenerating(null)
    if (resp.code === 200) {
      notify.success(
        `已生成 ${resp.data.written} 个 .strm 文件到 ${resp.data.path}`,
      )
      loadStatus()
    } else {
      notify.error("生成失败: " + resp.message)
    }
  }

  return (
    <VStack
      w="$full"
      alignItems="stretch"
      spacing="$4"
      p={{ "@initial": "$3", "@md": "$6" }}
      maxW="1300px"
    >
      <VStack alignItems="flex-start" spacing="2px">
        <Heading size="lg">STRM设置</Heading>
        <Text fontSize="$sm" color="$neutral11">
          扫描时自动生成 STRM，或在此手动批量生成
        </Text>
      </VStack>

      <CommonSettings group={Group.MEDIA} keys={STRM_KEYS} />

      <Box bgColor="$neutral1" rounded="$lg" border="1px solid $neutral4">
        <HStack px="$4" py="$3" borderBottom="1px solid $neutral4">
          <Heading size="sm">手动生成</Heading>
        </HStack>
        <VStack spacing="$3" alignItems="stretch" p="$4">
          <Text fontSize="$sm" color="$neutral11">
            输出位置：
            {mediaStatus().strm_same_dir
              ? "与媒体文件同目录（同名 .strm）"
              : mediaStatus().strm_path || "未配置（请先在上方保存 STRM 目录）"}
          </Text>
          <HStack spacing="$2" flexWrap="wrap">
            {GENERATE_TYPES.map((item) => (
              <Button
                size="sm"
                loading={generating() === item.type}
                onClick={() => generate(item.type)}
              >
                生成{item.label} STRM
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              loading={generating() === "all"}
              onClick={() => generate()}
            >
              生成全部
            </Button>
          </HStack>
        </VStack>
      </Box>
    </VStack>
  )
}

export default MediaStrmPage
