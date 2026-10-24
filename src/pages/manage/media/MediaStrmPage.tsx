import { Box, Button, HStack, Heading, Text, VStack } from "@hope-ui/solid"
import { createSignal, onMount } from "solid-js"
import CommonSettings from "../settings/Common"
import { useT } from "~/hooks"
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
  { type: "video", label: "manage.media_lib.strm_gen_video" },
  { type: "music", label: "manage.media_lib.strm_gen_music" },
  { type: "image", label: "manage.media_lib.strm_gen_image" },
  { type: "book", label: "manage.media_lib.strm_gen_book" },
]

const MediaStrmPage = () => {
  const t = useT()
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
        t("manage.media_lib.strm_generated", {
          count: resp.data.written,
          path: resp.data.path,
        }),
      )
      loadStatus()
    } else {
      notify.error(t("manage.media_lib.strm_gen_failed") + ": " + resp.message)
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
        <Heading size="lg">{t("manage.sidemenu.media_strm")}</Heading>
        <Text fontSize="$sm" color="$neutral11">
          {t("manage.media_lib.strm_desc")}
        </Text>
      </VStack>

      <CommonSettings group={Group.MEDIA} keys={STRM_KEYS} />

      <Box bgColor="$neutral1" rounded="$lg" border="1px solid $neutral4">
        <HStack px="$4" py="$3" borderBottom="1px solid $neutral4">
          <Heading size="sm">{t("manage.media_lib.strm_manual")}</Heading>
        </HStack>
        <VStack spacing="$3" alignItems="stretch" p="$4">
          <Text fontSize="$sm" color="$neutral11">
            {t("manage.media_lib.strm_output")}
            {mediaStatus().strm_same_dir
              ? t("manage.media_lib.strm_output_same_dir")
              : mediaStatus().strm_path ||
                t("manage.media_lib.strm_output_missing")}
          </Text>
          <HStack spacing="$2" flexWrap="wrap">
            {GENERATE_TYPES.map((item) => (
              <Button
                size="sm"
                loading={generating() === item.type}
                onClick={() => generate(item.type)}
              >
                {t(item.label)}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              loading={generating() === "all"}
              onClick={() => generate()}
            >
              {t("manage.media_lib.strm_gen_all")}
            </Button>
          </HStack>
        </VStack>
      </Box>
    </VStack>
  )
}

export default MediaStrmPage
