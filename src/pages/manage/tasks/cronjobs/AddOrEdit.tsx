import {
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  Heading,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SelectContent,
  SelectIcon,
  SelectListbox,
  SelectOption,
  SelectOptionIndicator,
  SelectOptionText,
  SelectPlaceholder,
  SelectTrigger,
  SelectValue,
  Switch as HopeSwitch,
  Text,
  Textarea,
  VStack,
} from "@hope-ui/solid"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { FolderChooseInput, MaybeLoading } from "~/components"
import { ResponsiveGrid } from "~/pages/manage/common/ResponsiveGrid"
import { useFetch, useT, useRouter } from "~/hooks"
import { handleResp, notify, r } from "~/utils"
import {
  SpecRow,
  SpecRowKind,
  cronToRow,
  defaultSpecRow,
  formatRunTime,
  nextRunTimes,
  rowToCron,
} from "~/utils/cron"
import {
  CronJob,
  CronJobArgField,
  CronJobArgType,
  CronJobArgs,
  CronJobReq,
  CronJobTypeInfo,
  PEmptyResp,
  PResp,
} from "~/types"

/** 星期几的 i18n key，按下标 0=周日 … 6=周六。 */
const WEEK_KEYS = [
  "cronjobs.dow_sun",
  "cronjobs.dow_mon",
  "cronjobs.dow_tue",
  "cronjobs.dow_wed",
  "cronjobs.dow_thu",
  "cronjobs.dow_fri",
  "cronjobs.dow_sat",
]

/** 将多行表单值转换为后端的 []string；空白行会被忽略。 */
const splitLines = (value: string): string[] => {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * 把后端默认值转换为表单值。
 * 后端 schema 统一用字符串保存 default；前端按字段类型转换成真正的 JSON 值。
 */
const argDefault = (field: CronJobArgField): string | number | boolean => {
  switch (field.type) {
    case CronJobArgType.Number:
      return Number(field.default || 0)
    case CronJobArgType.Bool:
      return field.default === "true"
    default:
      return field.default
  }
}

/**
 * 编辑时把 API 参数转换为表单值。
 * 目前只有 lines 类型需要转换：后端是 []string，表单使用换行分隔文本。
 */
const argToFormValue = (
  field: CronJobArgField,
  value: CronJobArgs[string] | undefined,
): string | number | boolean | string[] => {
  if (value === undefined) {
    return argDefault(field)
  }
  if (field.type === CronJobArgType.Lines && Array.isArray(value)) {
    return value.join("\n")
  }
  return value
}

/** 动态参数输入控件；字段类型由后端 schema 决定。 */
const ArgInput = (props: {
  field: CronJobArgField
  value: string | number | boolean | string[]
  onChange: (value: string | number | boolean | string[]) => void
}) => {
  const t = useT()
  return (
    <Switch fallback={<Text>{t("settings.unknown_type")}</Text>}>
      <Match when={props.field.type === CronJobArgType.String}>
        <Input
          id={`cronjob-args-${props.field.name}`}
          value={String(props.value ?? "")}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
      </Match>
      <Match when={props.field.type === CronJobArgType.Number}>
        <Input
          id={`cronjob-args-${props.field.name}`}
          type="number"
          value={Number(props.value ?? 0)}
          onInput={(e) => props.onChange(Number(e.currentTarget.value) || 0)}
        />
      </Match>
      <Match when={props.field.type === CronJobArgType.Bool}>
        <HopeSwitch
          id={`cronjob-args-${props.field.name}`}
          checked={Boolean(props.value)}
          onChange={(e: any) =>
            props.onChange(Boolean(e.currentTarget.checked))
          }
        />
      </Match>
      <Match
        when={
          props.field.type === CronJobArgType.Text ||
          props.field.type === CronJobArgType.Lines
        }
      >
        <Textarea
          id={`cronjob-args-${props.field.name}`}
          rows={props.field.type === CronJobArgType.Lines ? 5 : 4}
          value={String(props.value ?? "")}
          onChange={(e) => props.onChange(e.currentTarget.value)}
        />
      </Match>
      <Match when={props.field.type === CronJobArgType.Path}>
        {/* 路径字段支持手动输入，也支持从目录树选择。 */}
        <FolderChooseInput
          id={`cronjob-args-${props.field.name}`}
          value={String(props.value ?? "")}
          onChange={(path) => props.onChange(path)}
        />
      </Match>
    </Switch>
  )
}

const AddOrEdit = () => {
  const t = useT()
  const { params, to } = useRouter()
  const editId = params.id ? Number(params.id) : null

  /** 类型描述列表；CronJobs 页面不硬编码任务类型。 */
  const [types, setTypes] = createSignal<CronJobTypeInfo[]>([])
  const [getTypesLoading, getTypes] = useFetch((): PResp<CronJobTypeInfo[]> =>
    r.get("/admin/cronjobs/types"),
  )
  /** 编辑页需要额外读取原任务。 */
  const [getJobLoading, getJob] = useFetch((): PResp<CronJob> =>
    r.get(`/admin/cronjobs/get?id=${editId}`),
  )

  /** 当前选中的任务类型；编辑时类型不允许切换。 */
  const [selectedType, setSelectedType] = createSignal<string>("")
  /** 任务参数按 schema 保存为响应式对象，不同类型的字段不同。 */
  const [args, setArgs] = createStore<CronJobArgs>({})
  /** 通用基础字段。 */
  const [form, setForm] = createStore({
    name: "",
    enabled: true,
  })

  /** 执行周期行；每条都是一个预设（每月/每周/每N分钟/自定义）。 */
  const [rows, setRows] = createStore<SpecRow[]>([])
  /** 行 → cron 表达式列表，提交和预览共用。 */
  const cronSpecs = createMemo(() => rows.map(rowToCron))

  /** 每行「预览」弹窗。 */
  const [preview, setPreview] = createSignal<{
    spec: string
    runs: Date[]
  } | null>(null)
  /** 「近5次执行」面板。 */
  const [nextRuns, setNextRuns] = createSignal<Date[]>([])
  const [showNext, setShowNext] = createSignal(false)

  const clamp = (value: number, min: number, max: number): number =>
    Math.min(
      max,
      Math.max(min, Number.isFinite(value) ? Math.floor(value) : min),
    )

  /** 追加一条默认执行周期。 */
  const addRow = () => setRows((prev) => [...prev, defaultSpecRow()])

  /** 删除指定执行周期；至少保留一条。 */
  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, idx) => idx !== index))
  }

  /** 展开/收起近5次执行；展开时按当前表达式实时计算未来执行时间。 */
  const toggleNext = () => {
    const open = !showNext()
    if (open) setNextRuns(nextRunTimes(cronSpecs(), new Date(), 5))
    setShowNext(open)
  }

  /** 打开某条执行周期的预览：cron 表达式 + 未来 5 次执行时间。 */
  const openPreview = (index: number) => {
    const spec = rowToCron(rows[index])
    setPreview({ spec, runs: nextRunTimes([spec], new Date(), 5) })
  }

  /** 当前选中类型的 schema。 */
  const typeInfo = createMemo(() => {
    return types().find((item) => item.type === selectedType())
  })
  /** 当前类型的参数字段。 */
  const fields = createMemo(() => typeInfo()?.fields ?? [])

  /** 按 schema 生成默认参数。 */
  const createArgs = (info: CronJobTypeInfo): CronJobArgs => {
    const result: CronJobArgs = {}
    for (const field of info.fields) {
      result[field.name] = argDefault(field)
    }
    return result
  }

  /** 切换类型时重建参数，避免旧类型字段残留在新任务里。 */
  const changeType = (value: string) => {
    const info = types().find((item) => item.type === value)
    if (!info) return
    setSelectedType(value)
    setArgs(createArgs(info))
  }

  /** 初始化：新建时取第一个类型；编辑时取原任务并把数组参数还原为表单文本。 */
  const init = async () => {
    let typeInfos: CronJobTypeInfo[] = []
    const typeResp = await getTypes()
    handleResp(typeResp, (data) => {
      typeInfos = data
      setTypes(data)
    })

    if (editId !== null) {
      const jobResp = await getJob()
      handleResp(jobResp, (job) => {
        setSelectedType(job.type)
        // 后端 Args 以 JSON 字符串返回；先解析成对象，未注册描述的类型也能保留原参数。
        let rawArgs: CronJobArgs = {}
        try {
          rawArgs =
            typeof job.args === "string"
              ? JSON.parse(job.args || "{}")
              : job.args
        } catch {
          rawArgs = {}
        }
        const info = typeInfos.find((item) => item.type === job.type)
        if (!info) {
          // 未注册描述的类型也能保留原参数，但参数区不会渲染。
          setArgs(rawArgs)
          return
        }
        const nextArgs: CronJobArgs = {}
        for (const field of info.fields) {
          nextArgs[field.name] = argToFormValue(field, rawArgs[field.name])
        }
        setArgs(nextArgs)
        setRows(
          job.cron_specs && job.cron_specs.length > 0
            ? job.cron_specs.map(cronToRow)
            : [defaultSpecRow()],
        )
        setForm({
          name: job.name,
          enabled: job.enabled,
        })
      })
    } else if (typeInfos.length > 0) {
      setSelectedType(typeInfos[0].type)
      setArgs(createArgs(typeInfos[0]))
      setRows([defaultSpecRow()])
    }
  }
  init()

  /** 把表单值转换回 API 参数；lines 字段提交为字符串数组。 */
  const buildArgs = (): CronJobArgs => {
    const result: CronJobArgs = {}
    for (const field of fields()) {
      const value = args[field.name]
      if (field.type === CronJobArgType.Lines) {
        result[field.name] = splitLines(String(value ?? ""))
      } else {
        result[field.name] = value
      }
    }
    return result
  }

  /** 简单必填校验；更复杂的格式校验由后端 Handler.ValidateArgs 完成。 */
  const missingRequired = createMemo(() => {
    // 至少保留一条执行周期；自定义表达式不能为空。
    if (
      rows.length === 0 ||
      rows.some((row) => row.kind === "custom" && row.expr.trim() === "")
    ) {
      return true
    }
    return fields().some((field) => {
      if (!field.required) return false
      const value = buildArgs()[field.name]
      if (Array.isArray(value)) return value.length === 0
      if (typeof value === "string") return value.trim() === ""
      return value === undefined || value === null
    })
  })

  /** 根据 route 是否携带 id 决定 create/update。 */
  const [saving, saveJob] = useFetch(async (): Promise<PEmptyResp> => {
    const req: CronJobReq = {
      name: form.name,
      type: selectedType(),
      cron_specs: cronSpecs(),
      enabled: form.enabled,
      args: buildArgs(),
    }
    if (editId === null) {
      return r.post("/admin/cronjobs/create", req)
    }
    return r.post(`/admin/cronjobs/update?id=${editId}`, req)
  })

  return (
    <MaybeLoading
      loading={
        getTypesLoading() || (editId !== null && getJobLoading()) || saving()
      }
    >
      <Heading mb="$2">{t(`global.${editId ? "edit" : "add"}`)}</Heading>

      {/* 和 storages/AddOrEdit 的 driver 选择器一样：任务类型放在表单主体上方。 */}
      <VStack mb="$2" spacing="$2">
        <FormControl w="$full" display="flex" flexDirection="column" required>
          <FormLabel for="cronjob-type">{t("cronjobs.type")}</FormLabel>
          <Select
            id="cronjob-type"
            disabled={editId !== null}
            value={selectedType()}
            onChange={(value: string) => changeType(value)}
          >
            <SelectTrigger>
              <SelectPlaceholder>{t("cronjobs.type")}</SelectPlaceholder>
              <SelectValue />
              <SelectIcon />
            </SelectTrigger>
            <SelectContent>
              <SelectListbox>
                <For each={types()}>
                  {(item) => (
                    <SelectOption value={item.type}>
                      <SelectOptionText>{t(item.label_key)}</SelectOptionText>
                      <SelectOptionIndicator />
                    </SelectOption>
                  )}
                </For>
              </SelectListbox>
            </SelectContent>
          </Select>
        </FormControl>
        <Show when={typeInfo()}>
          {(info) => (
            <Text color="$neutral11">{t(info().description_key)}</Text>
          )}
        </Show>
        <Show when={!typeInfo() && selectedType()}>
          <Text color="$danger10">{t("cronjobs.type_unavailable")}</Text>
        </Show>
      </VStack>

      {/* 名称和开关；执行时间与参数各自独立成区块。 */}
      <ResponsiveGrid>
        <FormControl w="$full" display="flex" flexDirection="column" required>
          <FormLabel for="cronjob-name">{t("cronjobs.name")}</FormLabel>
          <Input
            id="cronjob-name"
            value={form.name}
            onInput={(e) => setForm("name", e.currentTarget.value)}
          />
        </FormControl>

        <FormControl w="$full" display="flex" flexDirection="column">
          <FormLabel for="cronjob-enabled">{t("cronjobs.enabled")}</FormLabel>
          <HopeSwitch
            id="cronjob-enabled"
            checked={form.enabled}
            onChange={(e: any) =>
              setForm("enabled", Boolean(e.currentTarget.checked))
            }
          />
        </FormControl>
      </ResponsiveGrid>

      {/* 执行周期：预设式配置，支持每月/每周/每N分钟/自定义多条。 */}
      <FormControl
        w="$full"
        display="flex"
        flexDirection="column"
        required
        mt="$2"
      >
        <FormLabel>{t("cronjobs.cron_specs")}</FormLabel>
        <VStack w="$full" spacing="$2" alignItems="start">
          <For each={rows}>
            {(row, i) => (
              <HStack w="$full" spacing="$2" wrap="wrap">
                <Select
                  value={row.kind}
                  onChange={(value: string) =>
                    setRows(i(), "kind", value as SpecRowKind)
                  }
                >
                  <SelectTrigger w="$40">
                    <SelectValue />
                    <SelectIcon />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectListbox>
                      <SelectOption value="monthly">
                        <SelectOptionText>
                          {t("cronjobs.preset.monthly")}
                        </SelectOptionText>
                        <SelectOptionIndicator />
                      </SelectOption>
                      <SelectOption value="weekly">
                        <SelectOptionText>
                          {t("cronjobs.preset.weekly")}
                        </SelectOptionText>
                        <SelectOptionIndicator />
                      </SelectOption>
                      <SelectOption value="everyN">
                        <SelectOptionText>
                          {t("cronjobs.preset.everyN")}
                        </SelectOptionText>
                        <SelectOptionIndicator />
                      </SelectOption>
                      <SelectOption value="custom">
                        <SelectOptionText>
                          {t("cronjobs.preset.custom")}
                        </SelectOptionText>
                        <SelectOptionIndicator />
                      </SelectOption>
                    </SelectListbox>
                  </SelectContent>
                </Select>

                <Show when={row.kind === "monthly"}>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={row.day}
                    w="$20"
                    onInput={(e) =>
                      setRows(
                        i(),
                        "day",
                        clamp(Number(e.currentTarget.value), 1, 31),
                      )
                    }
                  />
                  <Text>{t("cronjobs.unit_day")}</Text>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={row.hour}
                    w="$20"
                    onInput={(e) =>
                      setRows(
                        i(),
                        "hour",
                        clamp(Number(e.currentTarget.value), 0, 23),
                      )
                    }
                  />
                  <Text>{t("cronjobs.unit_hour")}</Text>
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    value={row.minute}
                    w="$20"
                    onInput={(e) =>
                      setRows(
                        i(),
                        "minute",
                        clamp(Number(e.currentTarget.value), 0, 59),
                      )
                    }
                  />
                  <Text>{t("cronjobs.unit_minute")}</Text>
                </Show>

                <Show when={row.kind === "weekly"}>
                  <Select
                    value={row.weekday}
                    onChange={(value: string) =>
                      setRows(i(), "weekday", Number(value))
                    }
                  >
                    <SelectTrigger w="$28">
                      <SelectValue />
                      <SelectIcon />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectListbox>
                        <For each={WEEK_KEYS}>
                          {(key, wi) => (
                            <SelectOption value={wi()}>
                              <SelectOptionText>{t(key)}</SelectOptionText>
                              <SelectOptionIndicator />
                            </SelectOption>
                          )}
                        </For>
                      </SelectListbox>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={row.hour}
                    w="$20"
                    onInput={(e) =>
                      setRows(
                        i(),
                        "hour",
                        clamp(Number(e.currentTarget.value), 0, 23),
                      )
                    }
                  />
                  <Text>{t("cronjobs.unit_hour")}</Text>
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    value={row.minute}
                    w="$20"
                    onInput={(e) =>
                      setRows(
                        i(),
                        "minute",
                        clamp(Number(e.currentTarget.value), 0, 59),
                      )
                    }
                  />
                  <Text>{t("cronjobs.unit_minute")}</Text>
                </Show>

                <Show when={row.kind === "everyN"}>
                  <Input
                    type="number"
                    min={1}
                    value={row.n}
                    w="$20"
                    onInput={(e) =>
                      setRows(
                        i(),
                        "n",
                        clamp(Number(e.currentTarget.value), 1, 1440),
                      )
                    }
                  />
                  <Text>{t("cronjobs.unit_minute")}</Text>
                </Show>

                <Show when={row.kind === "custom"}>
                  <Input
                    value={row.expr}
                    placeholder="*/10 * * * *"
                    w="$72"
                    onInput={(e) => setRows(i(), "expr", e.currentTarget.value)}
                  />
                </Show>

                <Button onClick={() => openPreview(i())}>
                  {t("cronjobs.preview")}
                </Button>
                <Button
                  disabled={rows.length <= 1}
                  onClick={() => removeRow(i())}
                >
                  {t("global.delete")}
                </Button>
              </HStack>
            )}
          </For>
          <Button size="sm" variant="ghost" onClick={addRow}>
            {t("cronjobs.add_spec")}
          </Button>
        </VStack>
        <FormHelperText>{t("cronjobs.cron_specs_help")}</FormHelperText>
      </FormControl>

      {/* 近5次执行：按当前配置实时计算未来的执行时间。 */}
      <Box w="$full" mt="$2">
        <Button size="sm" variant="ghost" onClick={toggleNext}>
          {t("cronjobs.next_runs")}
        </Button>
        <Show when={showNext()}>
          <VStack spacing="$1" alignItems="start">
            <For each={nextRuns()}>
              {(time) => <Text>{formatRunTime(time)}</Text>}
            </For>
            <Show when={nextRuns().length === 0}>
              <Text>{t("cronjobs.next_runs_empty")}</Text>
            </Show>
          </VStack>
        </Show>
      </Box>

      <ResponsiveGrid>
        <For each={fields()}>
          {(field) => (
            <FormControl
              w="$full"
              display="flex"
              flexDirection="column"
              required={field.required}
            >
              <FormLabel for={`cronjob-args-${field.name}`}>
                {t(field.label_key)}
              </FormLabel>
              <ArgInput
                field={field}
                value={args[field.name]}
                onChange={(value) => setArgs(field.name, value)}
              />
              <Show when={field.help_key}>
                <FormHelperText>{t(field.help_key)}</FormHelperText>
              </Show>
            </FormControl>
          )}
        </For>
      </ResponsiveGrid>

      {/* 单条执行周期的预览弹窗：cron 表达式 + 未来 5 次执行时间。 */}
      <Modal opened={preview() !== null} onClose={() => setPreview(null)}>
        <ModalOverlay />
        <ModalContent>
          <ModalCloseButton />
          <ModalHeader>{t("cronjobs.preview")}</ModalHeader>
          <ModalBody>
            <VStack spacing="$1" alignItems="start">
              <Text>{preview()?.spec}</Text>
              <For each={preview()?.runs ?? []}>
                {(time) => <Text>{formatRunTime(time)}</Text>}
              </For>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setPreview(null)}>{t("global.ok")}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 底部按钮使用 storages/AddOrEdit 的同一种横向排列。 */}
      <HStack
        mt="$2"
        spacing="$2"
        w="$full"
        wrap={{
          "@initial": "wrap",
          "@md": "unset",
        }}
      >
        {/* 显式跳回列表页，避免 back() 在无历史记录时失效。 */}
        <Button
          colorScheme="neutral"
          onClick={() => to("/@manage/tasks/cronjobs")}
        >
          {t("global.back")}
        </Button>
        <Button
          disabled={selectedType() === "" || missingRequired()}
          onClick={async () => {
            const resp = await saveJob()
            handleResp(resp, () => {
              notify.success(t("global.save_success"))
              to("/@manage/tasks/cronjobs")
            })
          }}
        >
          {t(`global.${editId ? "save" : "add"}`)}
        </Button>
      </HStack>
    </MaybeLoading>
  )
}

export default AddOrEdit
