import { Button, HStack, Text, VStack } from "@hope-ui/solid"
import { createMemo, createSignal, Show } from "solid-js"
import { useFetch, useManageTitle, useT } from "~/hooks"
import { me } from "~/store"
import { PEmptyResp, PResp, SettingItem, UserRole } from "~/types"
import { handleResp, notify, r } from "~/utils"
import { TypeTasks } from "./Tasks"
import { getPath } from "./helper"

const copyWorkersSettingKey = "copy_task_threads_num"
const resumeWorkersStorageKey = "openlist-copy-resume-workers"
const defaultResumeWorkers = 3

const validPositiveWorkers = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= 32

const getRememberedWorkers = () => {
  try {
    const value = Number(localStorage.getItem(resumeWorkersStorageKey))
    return validPositiveWorkers(value) ? value : defaultResumeWorkers
  } catch (_) {
    return defaultResumeWorkers
  }
}

const rememberWorkers = (value: number) => {
  if (!validPositiveWorkers(value)) return
  try {
    localStorage.setItem(resumeWorkersStorageKey, value.toString())
  } catch (_) {
    // The control remains usable when browser storage is unavailable.
  }
}

const CopyQueueControl = () => {
  const t = useT()
  const [setting, setSetting] = createSignal<SettingItem>()
  const [workers, setWorkers] = createSignal<number>()
  const [resumeWorkers, setResumeWorkers] = createSignal(getRememberedWorkers())
  const [loadSettingLoading, loadSetting] = useFetch((): PResp<SettingItem> =>
    r.get(`/admin/setting/get?key=${copyWorkersSettingKey}`),
  )
  const [saveSettingLoading, saveSetting] = useFetch(
    (item: SettingItem): PEmptyResp => r.post("/admin/setting/save", [item]),
  )

  const updateFromSetting = (item: SettingItem) => {
    const value = Number(item.value)
    if (!Number.isInteger(value) || value < 0 || value > 32) {
      notify.error(t("tasks.invalid_copy_worker_setting"))
      setSetting(undefined)
      setWorkers(undefined)
      return
    }
    setSetting(item)
    setWorkers(value)
    if (validPositiveWorkers(value)) {
      setResumeWorkers(value)
      rememberWorkers(value)
    }
  }

  const refresh = async () => {
    const resp = await loadSetting()
    handleResp(resp, updateFromSetting)
  }

  const paused = createMemo(() => workers() === 0)
  const toggleQueue = async () => {
    const item = setting()
    const currentWorkers = workers()
    if (item === undefined || currentWorkers === undefined) return
    const nextWorkers = currentWorkers === 0 ? resumeWorkers() : 0
    if (nextWorkers !== 0 && !validPositiveWorkers(nextWorkers)) {
      notify.error(t("tasks.invalid_copy_worker_setting"))
      return
    }
    const updated = { ...item, value: nextWorkers.toString() }
    const resp = await saveSetting(updated)
    handleResp(resp, () => {
      updateFromSetting(updated)
      notify.success(
        nextWorkers === 0
          ? t("tasks.copy_queue_paused_success")
          : t("tasks.copy_queue_resumed_success", { count: nextWorkers }),
      )
    })
  }

  refresh()

  return (
    <VStack w="$full" alignItems="start" spacing="$1">
      <HStack gap="$2" flexWrap="wrap">
        <Text fontWeight="bold">
          {paused()
            ? t("tasks.copy_queue_paused")
            : t("tasks.copy_queue_status", { count: workers() ?? "-" })}
        </Text>
        <Button
          size="sm"
          colorScheme={paused() ? "success" : "warning"}
          loading={saveSettingLoading()}
          disabled={setting() === undefined}
          onClick={toggleQueue}
        >
          {paused()
            ? t("tasks.resume_copy_queue", { count: resumeWorkers() })
            : t("tasks.pause_copy_queue")}
        </Button>
        <Button
          size="sm"
          colorScheme="neutral"
          loading={loadSettingLoading()}
          onClick={refresh}
        >
          {t("global.refresh")}
        </Button>
      </HStack>
      <Text size="sm" color="$neutral10">
        {t("tasks.pause_copy_queue_help")}
      </Text>
    </VStack>
  )
}

const Copy = () => {
  const t = useT()
  useManageTitle("manage.sidemenu.copy")
  return (
    <VStack w="$full" alignItems="start" spacing="$4">
      <Show when={me().role === UserRole.ADMIN}>
        <CopyQueueControl />
      </Show>
      <TypeTasks
        type="copy"
        canRetry
        nameAnalyzer={{
          regex:
            /^(?:copy|merge) \[(.*\/([^\/]*))]\((.*\/([^\/]*))\) to \[(.+)]\((.+)\)$/,
          title: (matches) => {
            if (matches[4] !== "") return matches[4]
            return matches[2] === "" ? "/" : matches[2]
          },
          attrs: {
            [t(`tasks.attr.copy.src`)]: (matches) =>
              getPath(matches[1], matches[3]),
            [t(`tasks.attr.copy.dst`)]: (matches) =>
              getPath(matches[5], matches[6]),
          },
        }}
      />
    </VStack>
  )
}

export default Copy
