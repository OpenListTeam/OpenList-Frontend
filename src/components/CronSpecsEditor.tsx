import {
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
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
  Text,
  Tooltip,
  VStack,
} from "@hope-ui/solid"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useT } from "~/hooks"
import {
  SpecRow,
  SpecRowKind,
  cronToRow,
  defaultSpecRow,
  formatRunTime,
  nextRunTimes,
  rowToCron,
} from "~/utils/cron"

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

export interface CronSpecsEditorProps {
  /** 初始 cron 表达式列表（编辑时回填用）；为空时给一条默认周期。 */
  initialSpecs?: string[]
  /** 执行周期变化时回调，父组件用它做校验和提交。 */
  onChange: (specs: string[]) => void
}

/**
 * 执行周期编辑器：预设式配置（每月/每周/每N分钟/自定义）多条执行时间。
 * 自带单行预览（cron + 未来 5 次执行时间）和「近5次执行」面板，
 * 通过 onChange 以 cron 表达式数组的形式向父组件同步结果。
 */
export const CronSpecsEditor = (props: CronSpecsEditorProps) => {
  const t = useT()

  /** 执行周期行；每条都是一个预设（每月/每周/每N分钟/自定义）。 */
  const [rows, setRows] = createStore<SpecRow[]>(
    props.initialSpecs && props.initialSpecs.length > 0
      ? props.initialSpecs.map(cronToRow)
      : [defaultSpecRow()],
  )
  /** 行 → cron 表达式列表，提交和预览共用。 */
  const cronSpecs = createMemo(() => rows.map(rowToCron))
  /** 变化时同步给父组件。 */
  createEffect(() => props.onChange(cronSpecs()))

  /** 当前 hover 预览的行号；Tooltip 打开时按行计算未来执行时间。 */
  const [previewIndex, setPreviewIndex] = createSignal<number | null>(null)
  /** hover 行的预览数据：cron 表达式 + 未来 5 次执行时间。 */
  const previewData = createMemo(() => {
    const i = previewIndex()
    if (i === null || !rows[i]) return null
    const spec = rowToCron(rows[i])
    return { spec, runs: nextRunTimes([spec], new Date(), 5) }
  })
  /** 「近5次执行」：hover 时按当前全部表达式实时计算未来执行时间。 */
  const [nextRuns, setNextRuns] = createSignal<Date[]>([])

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

  return (
    <>
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
                      <SelectOption value="daily">
                        <SelectOptionText>
                          {t("cronjobs.preset.daily")}
                        </SelectOptionText>
                        <SelectOptionIndicator />
                      </SelectOption>
                      <SelectOption value="everyNHours">
                        <SelectOptionText>
                          {t("cronjobs.preset.everyNHours")}
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

                <Show when={row.kind === "daily"}>
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

                <Show when={row.kind === "everyNHours"}>
                  <Input
                    type="number"
                    min={1}
                    value={row.n}
                    w="$20"
                    onInput={(e) =>
                      setRows(
                        i(),
                        "n",
                        clamp(Number(e.currentTarget.value), 1, 24),
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

                <Tooltip
                  withArrow
                  onOpen={() => setPreviewIndex(i())}
                  label={
                    <Show
                      when={previewData()}
                      fallback={<Text>{t("cronjobs.preview")}</Text>}
                    >
                      {(data) => (
                        <VStack spacing="$1" alignItems="start">
                          <Text>{data().spec}</Text>
                          <For each={data().runs}>
                            {(time) => <Text>{formatRunTime(time)}</Text>}
                          </For>
                        </VStack>
                      )}
                    </Show>
                  }
                >
                  <Button size="sm" variant="ghost" colorScheme="neutral">
                    {t("cronjobs.preview")}
                  </Button>
                </Tooltip>
                <Button
                  size="sm"
                  variant="ghost"
                  colorScheme="danger"
                  disabled={rows.length <= 1}
                  onClick={() => removeRow(i())}
                >
                  {t("global.delete")}
                </Button>
              </HStack>
            )}
          </For>
          <HStack spacing="$2">
            <Button onClick={addRow}>{t("cronjobs.add_spec")}</Button>
            {/* 近5次执行：hover 时按当前配置实时计算未来的执行时间。 */}
            <Tooltip
              withArrow
              onOpen={() =>
                setNextRuns(nextRunTimes(cronSpecs(), new Date(), 5))
              }
              label={
                <VStack spacing="$1" alignItems="start">
                  <For each={nextRuns()}>
                    {(time) => <Text>{formatRunTime(time)}</Text>}
                  </For>
                  <Show when={nextRuns().length === 0}>
                    <Text>{t("cronjobs.next_runs_empty")}</Text>
                  </Show>
                </VStack>
              }
            >
              <Button variant="ghost" colorScheme="neutral">
                {t("cronjobs.next_runs")}
              </Button>
            </Tooltip>
          </HStack>
        </VStack>
        <FormHelperText>{t("cronjobs.cron_specs_help")}</FormHelperText>
      </FormControl>
    </>
  )
}
