import {
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormHelperText,
  FormLabel,
  Heading,
  HStack,
  Input,
  Select,
  SelectContent,
  SelectIcon,
  SelectListbox,
  SelectOption,
  SelectOptionIndicator,
  SelectOptionText,
  SelectTrigger,
  SelectValue,
  SimpleGrid,
  Switch,
  Text,
  VStack,
} from "@hope-ui/solid"
import { For, JSXElement, Show, createSignal } from "solid-js"
import { MaybeLoading } from "~/components"
import { useFetch, useManageTitle, useT } from "~/hooks"
import { Group, PResp, SettingItem } from "~/types"
import { handleResp, notify, r } from "~/utils"

type SeedAlgorithm = "md5" | "sha1" | "sha256"
type SeedFormat = "oss" | "torrent" | "cas"

type SeedHashScope = { whole: boolean; pieces: boolean }
type SeedHashMatrix = Record<SeedAlgorithm, SeedHashScope>
type SeedFormatPolicies = Record<SeedFormat, "on" | "off">

const ALGORITHMS: SeedAlgorithm[] = ["md5", "sha1", "sha256"]
const FORMATS: SeedFormat[] = ["oss", "torrent", "cas"]

const ALGORITHM_LABELS: Record<SeedAlgorithm, string> = {
  md5: "MD5",
  sha1: "SHA-1",
  sha256: "SHA-256",
}

const defaultMatrix = (): SeedHashMatrix => ({
  md5: { whole: true, pieces: false },
  sha1: { whole: true, pieces: false },
  sha256: { whole: true, pieces: false },
})

const defaultPolicies = (): SeedFormatPolicies => ({
  oss: "off",
  torrent: "off",
  cas: "off",
})

const SEED_KEYS = [
  "seed_site_url",
  "seed_default_matrix",
  "seed_format_policies",
  "seed_default_format",
  "seed_auto_generate_policy",
  "seed_single_direct_preview",
  "seed_cas_direct_access",
]

const Section = (props: {
  title: string
  description?: string
  children: JSXElement
}) => {
  return (
    <Box
      w="$full"
      border="1px solid $neutral6"
      borderRadius="$lg"
      bg="$neutral2"
      p="$4"
    >
      <Heading size="lg" mb="$1">
        {props.title}
      </Heading>
      <Show when={props.description}>
        <Text fontSize="$sm" color="$neutral10" mb="$3">
          {props.description}
        </Text>
      </Show>
      {props.children}
    </Box>
  )
}

const ToggleRow = (props: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) => {
  return (
    <Flex
      w="$full"
      gap="$4"
      py="$2"
      alignItems="center"
      justifyContent="space-between"
    >
      <VStack alignItems="flex-start" spacing="$1">
        <Text fontWeight="$medium">{props.label}</Text>
        <Show when={props.description}>
          <Text fontSize="$xs" color="$neutral10">
            {props.description}
          </Text>
        </Show>
      </VStack>
      <Switch
        css={{ flexShrink: 0 }}
        checked={props.checked}
        onChange={(e: { currentTarget: HTMLInputElement }) =>
          props.onChange(e.currentTarget.checked)
        }
      />
    </Flex>
  )
}

const SeedSettings = () => {
  const t = useT()
  useManageTitle("manage.sidemenu.seed")

  const [items, setItems] = createSignal<SettingItem[]>([])
  const [siteUrl, setSiteUrl] = createSignal("")
  const [matrix, setMatrix] = createSignal<SeedHashMatrix>(defaultMatrix())
  const [policies, setPolicies] =
    createSignal<SeedFormatPolicies>(defaultPolicies())
  const [defaultFormat, setDefaultFormat] = createSignal<SeedFormat>("oss")
  const [autoGenerate, setAutoGenerate] = createSignal(false)
  const [singlePreview, setSinglePreview] = createSignal(false)
  const [casDirect, setCasDirect] = createSignal(false)

  const setHashScope = (
    algorithm: SeedAlgorithm,
    scope: keyof SeedHashScope,
    checked: boolean,
  ) => {
    setMatrix({
      ...matrix(),
      [algorithm]: { ...matrix()[algorithm], [scope]: checked },
    })
  }

  const setPolicy = (format: SeedFormat, enabled: boolean) => {
    setPolicies({ ...policies(), [format]: enabled ? "on" : "off" })
  }

  const [loading, getSettings] = useFetch((): PResp<SettingItem[]> =>
    r.get(`/admin/setting/list?group=${Group.GLOBAL}`),
  )

  const refresh = async () => {
    const resp = await getSettings()
    handleResp(resp, (data) => {
      const seedItems = data.filter((item) => SEED_KEYS.includes(item.key))
      setItems(seedItems)
      const values: Record<string, string> = {}
      seedItems.forEach((item) => (values[item.key] = item.value))

      setSiteUrl(values.seed_site_url ?? "")
      setDefaultFormat((values.seed_default_format as SeedFormat) || "oss")
      setAutoGenerate(values.seed_auto_generate_policy === "on")
      setSinglePreview(values.seed_single_direct_preview === "true")
      setCasDirect(values.seed_cas_direct_access === "true")

      const parsed = defaultMatrix()
      try {
        const raw = JSON.parse(values.seed_default_matrix || "{}")
        ALGORITHMS.forEach((algorithm) => {
          parsed[algorithm] = {
            whole: raw?.[algorithm]?.whole ?? parsed[algorithm].whole,
            pieces: raw?.[algorithm]?.pieces ?? parsed[algorithm].pieces,
          }
        })
      } catch (_) {
        // keep defaults on malformed payloads
      }
      setMatrix(parsed)

      const parsedPolicies = defaultPolicies()
      try {
        const raw = JSON.parse(values.seed_format_policies || "{}")
        FORMATS.forEach((format) => {
          parsedPolicies[format] = raw?.[format] === "on" ? "on" : "off"
        })
      } catch (_) {
        // keep defaults on malformed payloads
      }
      setPolicies(parsedPolicies)
    })
  }
  refresh()

  const [saveLoading, saveSettings] = useFetch((): PResp<string> => {
    const values: Record<string, string> = {
      seed_site_url: siteUrl().trim(),
      seed_default_matrix: JSON.stringify(matrix()),
      seed_format_policies: JSON.stringify(policies()),
      seed_default_format: defaultFormat(),
      seed_auto_generate_policy: autoGenerate() ? "on" : "off",
      seed_single_direct_preview: singlePreview() ? "true" : "false",
      seed_cas_direct_access: casDirect() ? "true" : "false",
    }
    // Reuse the persisted metadata so type/group/flag are never overwritten.
    const payload = items()
      .filter((item) => values[item.key] !== undefined)
      .map((item) => ({ ...item, value: values[item.key] }))
    return r.post("/admin/setting/save", payload)
  })

  return (
    <MaybeLoading loading={loading()}>
      <VStack w="$full" alignItems="stretch" spacing="$4">
        <Section title={t("settings_seed.site_config")}>
          <FormControl w="$full">
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
        </Section>

        <Section
          title={t("settings_seed.default_matrix")}
          description={t("settings_seed.default_matrix_help")}
        >
          <SimpleGrid columns={{ "@initial": 1, "@md": 3 }} gap="$3">
            <For each={ALGORITHMS}>
              {(algorithm) => (
                <VStack
                  alignItems="flex-start"
                  spacing="$1"
                  border="1px solid $neutral7"
                  borderRadius="$md"
                  bg="$background"
                  p="$3"
                >
                  <Text fontWeight="$semibold">
                    {ALGORITHM_LABELS[algorithm]}
                  </Text>
                  <Checkbox
                    checked={matrix()[algorithm].whole}
                    onChange={(e: { currentTarget: HTMLInputElement }) =>
                      setHashScope(algorithm, "whole", e.currentTarget.checked)
                    }
                  >
                    {t("settings_seed.whole")}
                  </Checkbox>
                  <Checkbox
                    checked={matrix()[algorithm].pieces}
                    onChange={(e: { currentTarget: HTMLInputElement }) =>
                      setHashScope(algorithm, "pieces", e.currentTarget.checked)
                    }
                  >
                    {t("settings_seed.pieces")}
                  </Checkbox>
                </VStack>
              )}
            </For>
          </SimpleGrid>
        </Section>

        <Section
          title={t("settings_seed.format_policies")}
          description={t("settings_seed.format_policies_help")}
        >
          <SimpleGrid columns={{ "@initial": 1, "@md": 3 }} gap="$3">
            <For each={FORMATS}>
              {(format) => (
                <Flex
                  border="1px solid $neutral7"
                  borderRadius="$md"
                  bg="$background"
                  p="$3"
                  gap="$2"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Text fontWeight="$medium">
                    {t(`settings_seed.${format}_format`)}
                  </Text>
                  <Switch
                    css={{ flexShrink: 0 }}
                    checked={policies()[format] === "on"}
                    onChange={(e: { currentTarget: HTMLInputElement }) =>
                      setPolicy(format, e.currentTarget.checked)
                    }
                  />
                </Flex>
              )}
            </For>
          </SimpleGrid>
          <FormControl mt="$4" w={{ "@initial": "$full", "@md": "$56" }}>
            <FormLabel for="seed_default_format">
              {t("settings_seed.default_format")}
            </FormLabel>
            <Select
              id="seed_default_format"
              value={defaultFormat()}
              onChange={(value) => setDefaultFormat(value as SeedFormat)}
            >
              <SelectTrigger>
                <SelectValue />
                <SelectIcon />
              </SelectTrigger>
              <SelectContent>
                <SelectListbox>
                  <For each={FORMATS}>
                    {(format) => (
                      <SelectOption value={format}>
                        <SelectOptionText>
                          {t(`settings.seed_default_formats.${format}`)}
                        </SelectOptionText>
                        <SelectOptionIndicator />
                      </SelectOption>
                    )}
                  </For>
                </SelectListbox>
              </SelectContent>
            </Select>
            <FormHelperText>
              {t("settings_seed.default_format_help")}
            </FormHelperText>
          </FormControl>
        </Section>

        <Section title={t("settings_seed.other_options")}>
          <VStack w="$full" alignItems="stretch" spacing="$1">
            <ToggleRow
              label={t("settings_seed.auto_generate")}
              description={t("settings_seed.auto_generate_help")}
              checked={autoGenerate()}
              onChange={setAutoGenerate}
            />
            <ToggleRow
              label={t("settings_seed.single_direct_preview")}
              description={t("settings_seed.single_direct_preview_help")}
              checked={singlePreview()}
              onChange={setSinglePreview}
            />
            <ToggleRow
              label={t("settings_seed.cas_direct_access")}
              description={t("settings_seed.cas_direct_access_help")}
              checked={casDirect()}
              onChange={setCasDirect}
            />
          </VStack>
        </Section>

        <HStack spacing="$2">
          <Button
            loading={saveLoading()}
            onClick={async () => {
              const resp = await saveSettings()
              handleResp(resp, () => {
                notify.success(t("global.save_success"))
                refresh()
              })
            }}
          >
            {t("global.save")}
          </Button>
          <Button
            colorScheme="neutral"
            loading={loading()}
            onClick={() => refresh()}
          >
            {t("global.refresh")}
          </Button>
        </HStack>
      </VStack>
    </MaybeLoading>
  )
}

export default SeedSettings
