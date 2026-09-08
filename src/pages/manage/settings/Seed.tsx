import {
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  Heading,
  Input,
  SimpleGrid,
} from "@hope-ui/solid"
import { createSignal } from "solid-js"
import { MaybeLoading } from "~/components"
import { useFetch, useManageTitle, useT } from "~/hooks"
import { PResp, SettingItem } from "~/types"
import { handleResp, notify, r } from "~/utils"
import { Item } from "./SettingItem"

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

  const [settings, setSettings] = createSignal<SettingItem[]>([])

  const [loading, getSettings] = useFetch((): PResp<SettingItem[]> =>
    r.get("/admin/setting/list?group=4"),
  )

  const refresh = async () => {
    const resp = await getSettings()
    handleResp(resp, (data) => {
      setSettings(data)
      const map: Record<string, string> = {}
      data.forEach((item) => {
        map[item.key] = item.value
      })

      // Site URL
      setSiteUrl(map.seed_site_url || "")

      // Parse Hash Matrix
      try {
        const matrix: SeedHashMatrix = JSON.parse(
          map.seed_default_matrix ||
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
          map.seed_format_policies ||
            '{"oss":"off","torrent":"off","cas":"off"}',
        )
        setOssPolicy(policies.oss === "on")
        setTorrentPolicy(policies.torrent === "on")
        setCasPolicy(policies.cas === "on")
      } catch (e) {
        console.error("Failed to parse seed_format_policies:", e)
      }

      // Other Settings
      setAutoGeneratePolicy(map.seed_auto_generate_policy === "on")
      setSingleDirectPreview(map.seed_single_direct_preview === "true")
      setCasDirectAccess(map.seed_cas_direct_access === "true")
    })
  }

  refresh()

  const [saveSiteLoading, saveSite] = useFetch((): PResp<string> =>
    r.post("/admin/setting/save", [
      {
        key: "seed_site_url",
        value: siteUrl(),
        type: 0,
        group: 4,
        flag: 1,
      },
    ]),
  )

  const [saveMatrixLoading, saveMatrix] = useFetch((): PResp<string> => {
    const matrix: SeedHashMatrix = {
      md5: { whole: md5Whole(), pieces: md5Pieces() },
      sha1: { whole: sha1Whole(), pieces: sha1Pieces() },
      sha256: { whole: sha256Whole(), pieces: sha256Pieces() },
    }
    return r.post("/admin/setting/save", [
      {
        key: "seed_default_matrix",
        value: JSON.stringify(matrix),
        type: 2,
        group: 4,
        flag: 1,
      },
    ])
  })

  const [savePoliciesLoading, savePolicies] = useFetch((): PResp<string> => {
    const policies: SeedFormatPolicies = {
      oss: ossPolicy() ? "on" : "off",
      torrent: torrentPolicy() ? "on" : "off",
      cas: casPolicy() ? "on" : "off",
    }
    return r.post("/admin/setting/save", [
      {
        key: "seed_format_policies",
        value: JSON.stringify(policies),
        type: 2,
        group: 4,
        flag: 1,
      },
    ])
  })

  const [saveOthersLoading, saveOthers] = useFetch((): PResp<string> =>
    r.post("/admin/setting/save", [
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
    ]),
  )

  return (
    <MaybeLoading loading={loading()}>
      <Heading mb="$2">{t("settings_seed.site_url_title")}</Heading>
      <FormControl w="$full" display="flex" flexDirection="column">
        <FormLabel for="seed_site_url">{t("settings_seed.site_url")}</FormLabel>
        <Input
          id="seed_site_url"
          placeholder="https://example.com"
          value={siteUrl()}
          onInput={(e) => setSiteUrl(e.currentTarget.value)}
        />
        <FormHelperText>{t("settings_seed.site_url_help")}</FormHelperText>
      </FormControl>
      <Button
        my="$2"
        loading={saveSiteLoading()}
        onClick={async () => {
          const resp = await saveSite()
          handleResp(resp, () => {
            notify.success(t("global.save_success"))
          })
        }}
      >
        {t("global.save")}
      </Button>

      <Heading my="$2">{t("settings_seed.default_matrix_title")}</Heading>
      <FormHelperText mb="$2">
        {t("settings_seed.default_matrix_help")}
      </FormHelperText>
      <SimpleGrid gap="$2" columns={{ "@initial": 1, "@md": 3 }}>
        <FormControl display="flex" flexDirection="column">
          <FormLabel>MD5</FormLabel>
          <Item
            key="md5_whole"
            type={4}
            value={md5Whole() ? "true" : "false"}
            onChange={(val) => setMd5Whole(val === "true")}
            help=""
            flag={0}
            group={4}
          />
          <Item
            key="md5_pieces"
            type={4}
            value={md5Pieces() ? "true" : "false"}
            onChange={(val) => setMd5Pieces(val === "true")}
            help=""
            flag={0}
            group={4}
          />
        </FormControl>
        <FormControl display="flex" flexDirection="column">
          <FormLabel>SHA-1</FormLabel>
          <Item
            key="sha1_whole"
            type={4}
            value={sha1Whole() ? "true" : "false"}
            onChange={(val) => setSha1Whole(val === "true")}
            help=""
            flag={0}
            group={4}
          />
          <Item
            key="sha1_pieces"
            type={4}
            value={sha1Pieces() ? "true" : "false"}
            onChange={(val) => setSha1Pieces(val === "true")}
            help=""
            flag={0}
            group={4}
          />
        </FormControl>
        <FormControl display="flex" flexDirection="column">
          <FormLabel>SHA-256</FormLabel>
          <Item
            key="sha256_whole"
            type={4}
            value={sha256Whole() ? "true" : "false"}
            onChange={(val) => setSha256Whole(val === "true")}
            help=""
            flag={0}
            group={4}
          />
          <Item
            key="sha256_pieces"
            type={4}
            value={sha256Pieces() ? "true" : "false"}
            onChange={(val) => setSha256Pieces(val === "true")}
            help=""
            flag={0}
            group={4}
          />
        </FormControl>
      </SimpleGrid>
      <Button
        my="$2"
        loading={saveMatrixLoading()}
        onClick={async () => {
          const resp = await saveMatrix()
          handleResp(resp, () => {
            notify.success(t("global.save_success"))
          })
        }}
      >
        {t("global.save")}
      </Button>

      <Heading my="$2">{t("settings_seed.format_policies_title")}</Heading>
      <FormHelperText mb="$2">
        {t("settings_seed.format_policies_help")}
      </FormHelperText>
      <SimpleGrid gap="$2" columns={{ "@initial": 1, "@md": 3 }}>
        <Item
          key="oss_policy"
          type={4}
          value={ossPolicy() ? "true" : "false"}
          onChange={(val) => setOssPolicy(val === "true")}
          help=""
          flag={0}
          group={4}
        />
        <Item
          key="torrent_policy"
          type={4}
          value={torrentPolicy() ? "true" : "false"}
          onChange={(val) => setTorrentPolicy(val === "true")}
          help=""
          flag={0}
          group={4}
        />
        <Item
          key="cas_policy"
          type={4}
          value={casPolicy() ? "true" : "false"}
          onChange={(val) => setCasPolicy(val === "true")}
          help=""
          flag={0}
          group={4}
        />
      </SimpleGrid>
      <Button
        my="$2"
        loading={savePoliciesLoading()}
        onClick={async () => {
          const resp = await savePolicies()
          handleResp(resp, () => {
            notify.success(t("global.save_success"))
          })
        }}
      >
        {t("global.save")}
      </Button>

      <Heading my="$2">{t("settings_seed.other_options_title")}</Heading>
      <SimpleGrid gap="$2" columns={{ "@initial": 1, "@md": 2 }}>
        <Item
          {...settings().find((i) => i.key === "seed_auto_generate_policy")!}
          value={autoGeneratePolicy() ? "on" : "off"}
          onChange={(val) => setAutoGeneratePolicy(val === "on")}
        />
        <Item
          {...settings().find((i) => i.key === "seed_single_direct_preview")!}
          value={singleDirectPreview() ? "true" : "false"}
          onChange={(val) => setSingleDirectPreview(val === "true")}
        />
        <Item
          {...settings().find((i) => i.key === "seed_cas_direct_access")!}
          value={casDirectAccess() ? "true" : "false"}
          onChange={(val) => setCasDirectAccess(val === "true")}
        />
      </SimpleGrid>
      <Button
        my="$2"
        loading={saveOthersLoading()}
        onClick={async () => {
          const resp = await saveOthers()
          handleResp(resp, () => {
            notify.success(t("global.save_success"))
          })
        }}
      >
        {t("global.save")}
      </Button>
    </MaybeLoading>
  )
}

export default SeedSettings
