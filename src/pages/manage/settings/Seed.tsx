import {
  Button,
  Checkbox,
  FormControl,
  FormHelperText,
  FormLabel,
  Heading,
  HStack,
  Input,
  SimpleGrid,
  Switch,
  VStack,
} from "@hope-ui/solid"
import { createSignal, For } from "solid-js"
import { MaybeLoading } from "~/components"
import { useFetch, useManageTitle, useT } from "~/hooks"
import { PResp } from "~/types"
import { handleResp, notify, r } from "~/utils"

interface SeedHashMatrix {
  md5: { whole: boolean; pieces: boolean }
  sha1: { whole: boolean; pieces: boolean }
  sha256: { whole: boolean; pieces: boolean }
}

interface SeedFormatPolicies {
  oss: "off" | "on"
  torrent: "off" | "on"
  cas: "off" | "on"
}

const SeedSettings = () => {
  const t = useT()
  useManageTitle("manage.sidemenu.seed")

  // Site URL
  const [siteUrl, setSiteUrl] = createSignal("")

  // Hash Matrix
  const [md5Whole, setMd5Whole] = createSignal(true)
  const [md5Pieces, setMd5Pieces] = createSignal(false)
  const [sha1Whole, setSha1Whole] = createSignal(true)
  const [sha1Pieces, setSha1Pieces] = createSignal(false)
  const [sha256Whole, setSha256Whole] = createSignal(true)
  const [sha256Pieces, setSha256Pieces] = createSignal(false)

  // Format Policies
  const [ossPolicy, setOssPolicy] = createSignal(false)
  const [torrentPolicy, setTorrentPolicy] = createSignal(false)
  const [casPolicy, setCasPolicy] = createSignal(false)

  // Other Settings
  const [autoGeneratePolicy, setAutoGeneratePolicy] = createSignal(false)
  const [singleDirectPreview, setSingleDirectPreview] = createSignal(false)
  const [casDirectAccess, setCasDirectAccess] = createSignal(false)

  const [loading, getSettings] = useFetch((): PResp<Record<string, string>> =>
    r.get("/api/public/settings"),
  )

  const refresh = async () => {
    const resp = await getSettings()
    handleResp(resp, (data) => {
      // Site URL
      setSiteUrl(data.seed_site_url || "")

      // Parse Hash Matrix
      try {
        const matrix: SeedHashMatrix = JSON.parse(
          data.seed_default_matrix ||
            '{"md5":{"whole":true,"pieces":false},"sha1":{"whole":true,"pieces":false},"sha256":{"whole":true,"pieces":false}}',
        )
        setMd5Whole(matrix.md5?.whole ?? true)
        setMd5Pieces(matrix.md5?.pieces ?? false)
        setSha1Whole(matrix.sha1?.whole ?? true)
        setSha1Pieces(matrix.sha1?.pieces ?? false)
        setSha256Whole(matrix.sha256?.whole ?? true)
        setSha256Pieces(matrix.sha256?.pieces ?? false)
      } catch (e) {
        console.error("Failed to parse seed_default_matrix:", e)
      }

      // Parse Format Policies
      try {
        const policies: SeedFormatPolicies = JSON.parse(
          data.seed_format_policies ||
            '{"oss":"off","torrent":"off","cas":"off"}',
        )
        setOssPolicy(policies.oss === "on")
        setTorrentPolicy(policies.torrent === "on")
        setCasPolicy(policies.cas === "on")
      } catch (e) {
        console.error("Failed to parse seed_format_policies:", e)
      }

      // Other Settings
      setAutoGeneratePolicy(data.seed_auto_generate_policy === "on")
      setSingleDirectPreview(data.seed_single_direct_preview === "true")
      setCasDirectAccess(data.seed_cas_direct_access === "true")
    })
  }

  refresh()

  const [saveLoading, save] = useFetch((): PResp<string> => {
    const matrix: SeedHashMatrix = {
      md5: { whole: md5Whole(), pieces: md5Pieces() },
      sha1: { whole: sha1Whole(), pieces: sha1Pieces() },
      sha256: { whole: sha256Whole(), pieces: sha256Pieces() },
    }

    const policies: SeedFormatPolicies = {
      oss: ossPolicy() ? "on" : "off",
      torrent: torrentPolicy() ? "on" : "off",
      cas: casPolicy() ? "on" : "off",
    }

    return r.post("/admin/setting/save", [
      {
        key: "seed_site_url",
        value: siteUrl(),
        type: 0,
        group: 4,
        flag: 1,
      },
      {
        key: "seed_default_matrix",
        value: JSON.stringify(matrix),
        type: 2,
        group: 4,
        flag: 1,
      },
      {
        key: "seed_format_policies",
        value: JSON.stringify(policies),
        type: 2,
        group: 4,
        flag: 1,
      },
      {
        key: "seed_auto_generate_policy",
        value: autoGeneratePolicy() ? "on" : "off",
        type: 4,
        group: 4,
        flag: 1,
      },
      {
        key: "seed_single_direct_preview",
        value: singleDirectPreview() ? "true" : "false",
        type: 1,
        group: 4,
        flag: 0,
      },
      {
        key: "seed_cas_direct_access",
        value: casDirectAccess() ? "true" : "false",
        type: 1,
        group: 4,
        flag: 0,
      },
    ])
  })

  return (
    <MaybeLoading loading={loading()}>
      <VStack w="$full" alignItems="start" spacing="$4">
        {/* Site URL */}
        <VStack w="$full" alignItems="start" spacing="$2">
          <Heading size="lg">{t("settings_seed.site_url_title")}</Heading>
          <FormControl>
            <FormLabel for="seed_site_url">
              {t("settings_seed.site_url")}
            </FormLabel>
            <Input
              id="seed_site_url"
              placeholder="https://example.com"
              value={siteUrl()}
              onInput={(e) => setSiteUrl(e.currentTarget.value)}
            />
            <FormHelperText>{t("settings_seed.site_url_help")}</FormHelperText>
          </FormControl>
        </VStack>

        {/* Default Hash Matrix */}
        <VStack w="$full" alignItems="start" spacing="$2">
          <Heading size="lg">{t("settings_seed.default_matrix_title")}</Heading>
          <FormHelperText mb="$2">
            {t("settings_seed.default_matrix_help")}
          </FormHelperText>
          <SimpleGrid columns={{ "@initial": 1, "@md": 3 }} gap="$4" w="$full">
            <VStack
              alignItems="start"
              p="$3"
              borderWidth="1px"
              borderRadius="$md"
              spacing="$2"
            >
              <Heading size="lg">MD5</Heading>
              <Checkbox
                checked={md5Whole()}
                onChange={(e: any) => setMd5Whole(e.target.checked)}
              >
                {t("settings_seed.whole_hash")}
              </Checkbox>
              <Checkbox
                checked={md5Pieces()}
                onChange={(e: any) => setMd5Pieces(e.target.checked)}
              >
                {t("settings_seed.piece_hashes")}
              </Checkbox>
            </VStack>

            <VStack
              alignItems="start"
              p="$3"
              borderWidth="1px"
              borderRadius="$md"
              spacing="$2"
            >
              <Heading size="lg">SHA-1</Heading>
              <Checkbox
                checked={sha1Whole()}
                onChange={(e: any) => setSha1Whole(e.target.checked)}
              >
                {t("settings_seed.whole_hash")}
              </Checkbox>
              <Checkbox
                checked={sha1Pieces()}
                onChange={(e: any) => setSha1Pieces(e.target.checked)}
              >
                {t("settings_seed.piece_hashes")}
              </Checkbox>
            </VStack>

            <VStack
              alignItems="start"
              p="$3"
              borderWidth="1px"
              borderRadius="$md"
              spacing="$2"
            >
              <Heading size="lg">SHA-256</Heading>
              <Checkbox
                checked={sha256Whole()}
                onChange={(e: any) => setSha256Whole(e.target.checked)}
              >
                {t("settings_seed.whole_hash")}
              </Checkbox>
              <Checkbox
                checked={sha256Pieces()}
                onChange={(e: any) => setSha256Pieces(e.target.checked)}
              >
                {t("settings_seed.piece_hashes")}
              </Checkbox>
            </VStack>
          </SimpleGrid>
        </VStack>

        {/* Format Policies */}
        <VStack w="$full" alignItems="start" spacing="$2">
          <Heading size="lg">
            {t("settings_seed.format_policies_title")}
          </Heading>
          <FormHelperText mb="$2">
            {t("settings_seed.format_policies_help")}
          </FormHelperText>
          <SimpleGrid columns={{ "@initial": 1, "@md": 3 }} gap="$4" w="$full">
            <HStack
              p="$3"
              borderWidth="1px"
              borderRadius="$md"
              justifyContent="space-between"
            >
              <span>{t("settings_seed.oss_format")}</span>
              <Switch
                checked={ossPolicy()}
                onChange={(e: any) => setOssPolicy(e.target.checked)}
              />
            </HStack>
            <HStack
              p="$3"
              borderWidth="1px"
              borderRadius="$md"
              justifyContent="space-between"
            >
              <span>{t("settings_seed.torrent_format")}</span>
              <Switch
                checked={torrentPolicy()}
                onChange={(e: any) => setTorrentPolicy(e.target.checked)}
              />
            </HStack>
            <HStack
              p="$3"
              borderWidth="1px"
              borderRadius="$md"
              justifyContent="space-between"
            >
              <span>{t("settings_seed.cas_format")}</span>
              <Switch
                checked={casPolicy()}
                onChange={(e: any) => setCasPolicy(e.target.checked)}
              />
            </HStack>
          </SimpleGrid>
        </VStack>

        {/* Other Options */}
        <VStack w="$full" alignItems="start" spacing="$2">
          <Heading size="lg">{t("settings_seed.other_options_title")}</Heading>
          <VStack w="$full" alignItems="start" spacing="$3">
            <FormControl display="flex" alignItems="center">
              <Switch
                id="auto_generate"
                checked={autoGeneratePolicy()}
                onChange={(e: any) => setAutoGeneratePolicy(e.target.checked)}
                mr="$2"
              />
              <FormLabel for="auto_generate" mb="0">
                {t("settings_seed.auto_generate")}
              </FormLabel>
            </FormControl>
            <FormHelperText ml="$8" mt="-$2">
              {t("settings_seed.auto_generate_help")}
            </FormHelperText>

            <FormControl display="flex" alignItems="center">
              <Switch
                id="single_preview"
                checked={singleDirectPreview()}
                onChange={(e: any) => setSingleDirectPreview(e.target.checked)}
                mr="$2"
              />
              <FormLabel for="single_preview" mb="0">
                {t("settings_seed.single_direct_preview")}
              </FormLabel>
            </FormControl>
            <FormHelperText ml="$8" mt="-$2">
              {t("settings_seed.single_direct_preview_help")}
            </FormHelperText>

            <FormControl display="flex" alignItems="center">
              <Switch
                id="cas_direct_access"
                checked={casDirectAccess()}
                onChange={(e: any) => setCasDirectAccess(e.target.checked)}
                mr="$2"
              />
              <FormLabel for="cas_direct_access" mb="0">
                {t("settings_seed.cas_direct_access")}
              </FormLabel>
            </FormControl>
            <FormHelperText ml="$8" mt="-$2">
              {t("settings_seed.cas_direct_access_help")}
            </FormHelperText>
          </VStack>
        </VStack>

        {/* Save Button */}
        <HStack spacing="$2">
          <Button colorScheme="accent" onClick={refresh} loading={loading()}>
            {t("global.refresh")}
          </Button>
          <Button
            loading={saveLoading()}
            onClick={async () => {
              const resp = await save()
              handleResp(resp, () => {
                notify.success(t("global.save_success"))
                refresh()
              })
            }}
          >
            {t("global.save")}
          </Button>
        </HStack>
      </VStack>
    </MaybeLoading>
  )
}

export default SeedSettings
