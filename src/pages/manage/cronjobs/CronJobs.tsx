import {
  Box,
  Button,
  HStack,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
} from "@hope-ui/solid"
import { createSignal, For, onCleanup, Show } from "solid-js"
import { Wether } from "~/components"
import {
  useFetch,
  useListFetch,
  useManageTitle,
  useT,
  useRouter,
} from "~/hooks"
import { handleResp, notify, r } from "~/utils"
import { formatDate } from "~/utils/str"
import { CronJob, PEmptyResp, PResp } from "~/types"
import { TaskNameAnalyzer, TypeTasks } from "~/pages/manage/tasks/Tasks"
import { getPath } from "~/pages/manage/tasks/helper"

/**
 * 让任务组件识别同步编排任务名称，例如 `sync [/a] to [/b]`。
 * 这个 analyzer 只影响展示；不同任务类型后续可以继续在 helper 中补充 analyzer。
 */
const syncNameAnalyzer = (): TaskNameAnalyzer => {
  return {
    regex: /^sync \[(.+)] to \[(.+)]$/,
    title: (matches) => `${matches[1]} -> ${matches[2]}`,
    attrs: {
      src: (matches) => getPath("", matches[1]),
      dst: (matches) => getPath("", matches[2]),
    },
  }
}

const CronJobs = () => {
  const t = useT()
  const { to } = useRouter()
  useManageTitle("manage.sidemenu.cronjobs")

  /** 计划任务配置列表。 */
  const [jobs, setJobs] = createSignal<CronJob[]>([])
  const [getJobsLoading, getJobs] = useFetch((): PResp<CronJob[]> =>
    r.get("/admin/cronjobs/list"),
  )

  /** 拉取配置列表；手动刷新和轮询共用同一个函数。 */
  const refresh = async () => {
    const resp = await getJobs()
    handleResp(resp, (data) => setJobs(data))
  }
  refresh()
  // 轻量轮询让 running 和 next_run_at 近似实时；表单页自身不再轮询。
  const refreshTimer = setInterval(refresh, 10000)
  onCleanup(() => clearInterval(refreshTimer))

  /** 手动触发一次；定时和手动触发共用后端 running 锁。 */
  const [runningId, runJob] = useListFetch((id: number): PEmptyResp =>
    r.post(`/admin/cronjobs/run?id=${id}`),
  )

  /** 删除计划任务；后端会拒绝正在执行的任务。 */
  const [deletingId, deleteJob] = useListFetch((id: number): PEmptyResp =>
    r.post(`/admin/cronjobs/delete?id=${id}`),
  )

  return (
    <VStack w="$full" alignItems="start" spacing="$4">
      <HStack w="$full" spacing="$2">
        <Button
          colorScheme="accent"
          loading={getJobsLoading()}
          onClick={refresh}
        >
          {t("global.refresh")}
        </Button>
        {/* 新建任务必须进入独立页面；页面会根据任务类型动态渲染配置。 */}
        <Button onClick={() => to("/@manage/cronjobs/add")}>
          {t("cronjobs.add")}
        </Button>
      </HStack>

      <Box w="$full" overflowX="auto">
        <Table highlightOnHover dense>
          <Thead>
            <Tr>
              <For
                each={[
                  "name",
                  "type",
                  "cron_spec",
                  "enabled",
                  "running",
                  "last_run_at",
                  "next_run_at",
                  "last_error",
                ]}
              >
                {(title) => <Th>{t(`cronjobs.${title}`)}</Th>}
              </For>
              <Th>{t("global.operations")}</Th>
            </Tr>
          </Thead>
          <Tbody>
            <For each={jobs()}>
              {(job) => (
                <Tr>
                  <Td>{job.name}</Td>
                  <Td>{t(`cronjobs.types.${job.type}`)}</Td>
                  <Td>{job.cron_spec}</Td>
                  <Td>
                    <Wether yes={job.enabled} />
                  </Td>
                  <Td>
                    <Wether yes={job.running} />
                  </Td>
                  <Td>{job.last_run_at ? formatDate(job.last_run_at) : "-"}</Td>
                  <Td>{job.next_run_at ? formatDate(job.next_run_at) : "-"}</Td>
                  <Td>{job.last_error || t("cronjobs.no_last_error")}</Td>
                  <Td>
                    <HStack spacing="$2">
                      <Button
                        disabled={job.running}
                        onClick={() => to(`/@manage/cronjobs/edit/${job.id}`)}
                      >
                        {t("global.edit")}
                      </Button>
                      <Button
                        colorScheme="accent"
                        loading={runningId() === job.id}
                        onClick={async () => {
                          const resp = await runJob(job.id)
                          handleResp(resp, () => {
                            notify.success(t("cronjobs.run_success"))
                            refresh()
                          })
                        }}
                      >
                        {t("cronjobs.run")}
                      </Button>
                      <Show
                        when={!job.running}
                        fallback={<Text>{t("cronjobs.running")}</Text>}
                      >
                        <Button
                          colorScheme="danger"
                          loading={deletingId() === job.id}
                          onClick={async () => {
                            const resp = await deleteJob(job.id)
                            handleResp(resp, () => {
                              notify.success(t("global.delete_success"))
                              refresh()
                            })
                          }}
                        >
                          {t("global.delete")}
                        </Button>
                      </Show>
                    </HStack>
                  </Td>
                </Tr>
              )}
            </For>
          </Tbody>
        </Table>
      </Box>

      <Box w="$full">
        {/* cron_sync 是同步编排任务；具体文件复制仍在 copy 任务列表中展示。 */}
        <TypeTasks
          type="cron_sync"
          canRetry
          nameAnalyzer={syncNameAnalyzer()}
        />
      </Box>
    </VStack>
  )
}

export default CronJobs
