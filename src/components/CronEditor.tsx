import {
  Box,
  Button,
  Checkbox,
  Grid,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
  VStack,
} from "@hope-ui/solid"
import { createEffect, createSignal, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useT } from "~/hooks"

/**
 * Cron 表达式可视化编辑器。
 * 把 5 字段 cron（分 时 日 月 周）拆成五个字段构建区：每个字段支持
 * 全部（*）、每 N（步进）、指定值（逗号列表）三种模式，
 * 构建结果实时显示在预览里，确认后写回当前行。
 */

type FieldMode = "every" | "everyN" | "specific"

interface FieldState {
  mode: FieldMode
  step: number
  values: number[]
}

interface FieldDef {
  key: string
  min: number
  max: number
  labelKey: string
  stepUnitKey: string
  defaultStep: number
}

const FIELD_DEFS: FieldDef[] = [
  {
    key: "minute",
    min: 0,
    max: 59,
    labelKey: "cronjobs.editor.minute",
    stepUnitKey: "cronjobs.editor.minutes",
    defaultStep: 5,
  },
  {
    key: "hour",
    min: 0,
    max: 23,
    labelKey: "cronjobs.editor.hour",
    stepUnitKey: "cronjobs.editor.hours",
    defaultStep: 1,
  },
  {
    key: "day",
    min: 1,
    max: 31,
    labelKey: "cronjobs.editor.day_of_month",
    stepUnitKey: "cronjobs.editor.days",
    defaultStep: 1,
  },
  {
    key: "month",
    min: 1,
    max: 12,
    labelKey: "cronjobs.editor.month",
    stepUnitKey: "cronjobs.editor.months",
    defaultStep: 1,
  },
  {
    key: "week",
    min: 0,
    max: 6,
    labelKey: "cronjobs.editor.day_of_week",
    stepUnitKey: "cronjobs.editor.weekdays",
    defaultStep: 1,
  },
]

const DOW_KEYS = [
  "cronjobs.editor.dow_sun",
  "cronjobs.editor.dow_mon",
  "cronjobs.editor.dow_tue",
  "cronjobs.editor.dow_wed",
  "cronjobs.editor.dow_thu",
  "cronjobs.editor.dow_fri",
  "cronjobs.editor.dow_sat",
]

const range = (min: number, max: number): number[] => {
  const result: number[] = []
  for (let v = min; v <= max; v++) result.push(v)
  return result
}

const defaultState = (def: FieldDef): FieldState => ({
  mode: "every",
  step: def.defaultStep,
  values: [],
})

/** 把单个 cron 字段解析为构建器状态；范围/步进会展开成等价的具体值集合。 */
const parseField = (raw: string, def: FieldDef): FieldState | null => {
  const field = raw.trim()
  if (field === "*" || field === "?") return defaultState(def)
  if (field.startsWith("*/")) {
    const step = Number(field.slice(2))
    if (!Number.isInteger(step) || step < 1) return null
    return { mode: "everyN", step, values: [] }
  }

  const values = new Set<number>()
  const addValue = (v: number) => {
    // crontab 中 7 也表示周日，统一归一为 0。
    values.add(def.key === "week" && v === 7 ? 0 : v)
  }
  for (const part of field.split(",")) {
    if (part === "") return null
    const pieces = part.split("/")
    if (pieces.length > 2) return null
    const expr = pieces[0]
    const step = pieces.length === 2 ? Number(pieces[1]) : 1
    if (!Number.isInteger(step) || step < 1) return null
    if (expr === "*") {
      for (let v = def.min; v <= def.max; v += step) addValue(v)
    } else if (expr.includes("-")) {
      const [a, b] = expr.split("-").map(Number)
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a < def.min ||
        b > def.max ||
        a > b
      ) {
        return null
      }
      for (let v = a; v <= b; v += step) addValue(v)
    } else {
      const v = Number(expr)
      if (!Number.isInteger(v) || v < def.min || v > def.max) return null
      addValue(v)
    }
  }
  if (values.size === 0) return null
  return {
    mode: "specific",
    step: 1,
    values: [...values].sort((a, b) => a - b),
  }
}

/** 解析整条 5 字段表达式；不是 5 个字段或任一字段非法时返回 null。 */
const parseSpec = (spec: string): FieldState[] | null => {
  const fields = spec.trim().split(/\s+/)
  if (fields.length !== FIELD_DEFS.length) return null
  const states: FieldState[] = []
  for (let i = 0; i < FIELD_DEFS.length; i++) {
    const state = parseField(fields[i], FIELD_DEFS[i])
    if (!state) return null
    states.push(state)
  }
  return states
}

const generateField = (state: FieldState): string => {
  if (state.mode === "every") return "*"
  if (state.mode === "everyN") return `*/${state.step}`
  return state.values.join(",")
}

const generateSpec = (states: FieldState[]): string =>
  states.map(generateField).join(" ")

const specOf = (states: Record<string, FieldState>): FieldState[] =>
  FIELD_DEFS.map((def) => states[def.key] ?? defaultState(def))

export const CronEditor = (props: {
  isOpen: boolean
  onClose: () => void
  /** 当前编辑的执行时间列表。 */
  specs: string[]
  /** 本次编辑的行。 */
  editIndex: number
  /** 确认后回传新的执行时间列表。 */
  onSubmit: (specs: string[]) => void
}) => {
  const t = useT()
  const [states, setStates] = createStore<Record<string, FieldState>>({})
  const [error, setError] = createSignal("")
  /** 原表达式不可解析时禁止确认，避免确认后静默覆盖。 */
  const [allowConfirm, setAllowConfirm] = createSignal(true)

  createEffect(
    on(
      () => props.isOpen,
      (open) => {
        if (!open) return
        const current = props.specs[props.editIndex] ?? ""
        const parsed = parseSpec(current)
        const init: Record<string, FieldState> = {}
        if (parsed) {
          FIELD_DEFS.forEach((def, i) => (init[def.key] = parsed[i]))
          setStates(init)
          setError("")
          setAllowConfirm(true)
        } else {
          FIELD_DEFS.forEach((def) => (init[def.key] = defaultState(def)))
          setStates(init)
          setError(t("cronjobs.editor.unparseable"))
          setAllowConfirm(false)
        }
      },
    ),
  )

  /** 用户在构建器上做任意修改后，允许确认并清除提示。 */
  const touch = () => {
    setError("")
    setAllowConfirm(true)
  }

  const confirm = () => {
    for (const def of FIELD_DEFS) {
      const state = states[def.key] ?? defaultState(def)
      if (state.mode === "specific" && state.values.length === 0) {
        setError(t("cronjobs.editor.specific_empty"))
        return
      }
    }
    const built = generateSpec(specOf(states))
    props.onSubmit(
      props.specs.map((spec, i) => (i === props.editIndex ? built : spec)),
    )
    props.onClose()
  }

  return (
    <Modal size="xl" opened={props.isOpen} onClose={props.onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalCloseButton />
        <ModalHeader>{t("cronjobs.editor.title")}</ModalHeader>
        <ModalBody>
          <VStack spacing="$3" alignItems="start">
            <For each={FIELD_DEFS}>
              {(def) => {
                const state = () => states[def.key] ?? defaultState(def)
                return (
                  <Box w="$full">
                    <Text>{t(def.labelKey)}</Text>
                    <HStack spacing="$2">
                      <Button
                        variant={state().mode === "every" ? "solid" : "subtle"}
                        onClick={() => {
                          touch()
                          setStates(def.key, { ...state(), mode: "every" })
                        }}
                      >
                        {t("cronjobs.editor.every")}
                      </Button>
                      <Button
                        variant={state().mode === "everyN" ? "solid" : "subtle"}
                        onClick={() => {
                          touch()
                          setStates(def.key, { ...state(), mode: "everyN" })
                        }}
                      >
                        {t("cronjobs.editor.every_n")}
                      </Button>
                      <Button
                        variant={
                          state().mode === "specific" ? "solid" : "subtle"
                        }
                        onClick={() => {
                          touch()
                          setStates(def.key, {
                            ...state(),
                            mode: "specific",
                          })
                        }}
                      >
                        {t("cronjobs.editor.specific")}
                      </Button>
                    </HStack>
                    <Show when={state().mode === "everyN"}>
                      <HStack spacing="$2">
                        <Text>{t("cronjobs.editor.every")}</Text>
                        <Input
                          type="number"
                          min={1}
                          value={state().step}
                          w="$20"
                          onInput={(e) => {
                            touch()
                            const step = Math.max(
                              1,
                              Math.floor(Number(e.currentTarget.value) || 1),
                            )
                            setStates(def.key, {
                              ...state(),
                              mode: "everyN",
                              step,
                            })
                          }}
                        />
                        <Text>{t(def.stepUnitKey)}</Text>
                      </HStack>
                    </Show>
                    <Show when={state().mode === "specific"}>
                      <Grid templateColumns="repeat(10, 1fr)" gap="$1">
                        <For each={range(def.min, def.max)}>
                          {(v) => (
                            <Checkbox
                              checked={state().values.includes(v)}
                              onChange={() => {
                                touch()
                                const values = state().values.includes(v)
                                  ? state().values.filter((x) => x !== v)
                                  : [...state().values, v].sort((a, b) => a - b)
                                setStates(def.key, {
                                  ...state(),
                                  mode: "specific",
                                  values,
                                })
                              }}
                            >
                              {def.key === "week" ? t(DOW_KEYS[v]) : v}
                            </Checkbox>
                          )}
                        </For>
                      </Grid>
                    </Show>
                  </Box>
                )
              }}
            </For>

            <Text>
              {t("cronjobs.editor.preview")}: {generateSpec(specOf(states))}
            </Text>
            <Show when={error()}>
              <Text>{error()}</Text>
            </Show>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack spacing="$2">
            <Button onClick={props.onClose}>{t("global.cancel")}</Button>
            <Button disabled={!allowConfirm()} onClick={confirm}>
              {t("global.ok")}
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
