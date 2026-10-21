import { Heading, Text, VStack } from "@hope-ui/solid"
import CommonSettings from "../settings/Common"
import { Group } from "~/types"

/** 刮削相关设置项（TMDB API Key ~ Scrape concurrency） */
const SCRAPE_KEYS = [
  "media_tmdb_key",
  "media_tmdb_api_url",
  "media_discogs_token",
  "media_discogs_api_url",
  "media_store_thumbnail",
  "media_thumbnail_mode",
  "media_thumbnail_path",
  "media_scrape_concurrency",
]

const MediaScrapePage = () => {
  return (
    <VStack
      w="$full"
      alignItems="stretch"
      spacing="$4"
      p={{ "@initial": "$3", "@md": "$6" }}
      maxW="1300px"
    >
      <VStack alignItems="flex-start" spacing="2px">
        <Heading size="lg">刮削设置</Heading>
        <Text fontSize="$sm" color="$neutral11">
          TMDB / Discogs 数据源、缩略图存储方式与刮削并发数
        </Text>
      </VStack>
      <CommonSettings group={Group.MEDIA} keys={SCRAPE_KEYS} />
    </VStack>
  )
}

export default MediaScrapePage
