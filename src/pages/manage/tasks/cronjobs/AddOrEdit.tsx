import {
  Button,
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
import { CronSpecsEditor, FolderChooseInput, MaybeLoading } from "~/components"
import { ResponsiveGrid } from "~/pages/manage/common/ResponsiveGrid"
import { useFetch, useT, useRouter } from "~/hooks"
import { handleResp, notify, r } from "~/utils"
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
 * 后端 Args 现在统一按 JSON 值返回；未提供的字段使用 schema 默认值。
 */
const argToFormValue = (
  field: CronJobArgField,
  value: CronJobArgs[string] | undefined,
): string | number | boolean => {
  if (value === undefined) {
    return argDefault(field)
  }
  return value
}

/** 动态参数输入控件；字段类型由后端 schema 决定。 */
const ArgInput = (props: {
  field: CronJobArgField
  value: string | number | boolean
  onChange: (value: string | number | boolean) => void
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
      <Match when={props.field.type === CronJobArgType.Text}>
        <Textarea
          id={`cronjob-args-${props.field.name}`}
          rows={4}
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

  /** 编辑时原任务的执行周期；由 CronSpecsEditor 接管并回填。 */
  const [jobSpecs, setJobSpecs] = createSignal<string[]>([])
  /** 当前执行周期（cron 表达式列表），组件变化时同步，提交和校验共用。 */
  const [cronSpecs, setCronSpecs] = createSignal<string[]>([])

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
        setJobSpecs(
          job.cron_specs && job.cron_specs.length > 0 ? job.cron_specs : [],
        )
        setForm({
          name: job.name,
          enabled: job.enabled,
        })
      })
    } else if (typeInfos.length > 0) {
      setSelectedType(typeInfos[0].type)
      setArgs(createArgs(typeInfos[0]))
    }
  }
  init()

  /** 把表单值转换回 API 参数；值按 JSON 原样提交，多行字符串不做拆分。 */
  const buildArgs = (): CronJobArgs => {
    const result: CronJobArgs = {}
    for (const field of fields()) {
      result[field.name] = args[field.name]
    }
    return result
  }

  /** 简单必填校验；更复杂的格式校验由后端 Handler.ValidateArgs 完成。 */
  const missingRequired = createMemo(() => {
    // 至少保留一条执行周期；自定义表达式不能为空。
    if (
      cronSpecs().length === 0 ||
      cronSpecs().some((spec) => spec.trim() === "")
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

      {/* 执行周期：预设式编辑器（每月/每周/每N分钟/自定义 + 预览 + 近5次执行）。 */}
      <CronSpecsEditor
        initialSpecs={editId !== null ? jobSpecs() : []}
        onChange={setCronSpecs}
      />

      {/* 任务参数：字段由后端 schema 决定（如 Source Path、Destination Path 等）。 */}
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
