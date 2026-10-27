import { Heading, Text, VStack } from "@hope-ui/solid"
import CommonSettings from "../settings/Common"
import { useT } from "~/hooks"
import { Group } from "~/types"

/** 刮削相关设置项（TMDB API Key ~ Scrape concurrency） */
const SCRAPE_KEYS = [
  "media_tmdb_key",
  "media_tmdb_api_url",
  "media_discogs_token",
  "media_discogs_api_url",
  "media_scrape_language",
  "media_book_source",
  "media_google_books_key",
  "media_download_cover",
  "media_store_thumbnail",
  "media_thumbnail_mode",
  "media_thumbnail_path",
  "media_scrape_concurrency",
]

const MediaScrapePage = () => {
  const t = useT()
  return (
    <VStack
      w="$full"
      alignItems="stretch"
      spacing="$4"
      p={{ "@initial": "$3", "@md": "$6" }}
      maxW="1300px"
    >
      <VStack alignItems="flex-start" spacing="2px">
        <Heading size="lg">{t("manage.sidemenu.media_scrape")}</Heading>
        <Text fontSize="$sm" color="$neutral11">
          {t("manage.media_lib.scrape_desc")}
        </Text>
      </VStack>
      <CommonSettings
        group={Group.MEDIA}
        keys={SCRAPE_KEYS}
        readOnlyKey={(key, all) => {
          if (key !== "media_thumbnail_path") return false
          const mode = all.find((i) => i.key === "media_thumbnail_mode")?.value
          return mode !== "local"
        }}
      />
    </VStack>
  )
}

export default MediaScrapePage
