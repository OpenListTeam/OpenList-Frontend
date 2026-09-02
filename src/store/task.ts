import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { r } from "~/utils"
import type { TaskInfo } from "~/types"

const [tasks, setTasks] = createStore<TaskInfo[]>([])
const [loading, setLoading] = createSignal(false)

export const fetchOfflineDownloadTasks = async (showLoading = true) => {
  if (showLoading) setLoading(true)
  try {
    const [respOld, respNew] = await Promise.all([
      r.get("/task/offline_download/undone"),
      r.get("/task/offline_download_transfer/undone"),
    ])
    const getTasksFromResp = (resp: any, label: string): any[] => {
      if (!resp || resp.code !== 200) {
        const message =
          resp && typeof resp.message === "string"
            ? resp.message
            : "Unknown error"
        throw new Error(`Failed to fetch ${label}: ${message}`)
      }
      const data = resp.data
      return Array.isArray(data) ? data : []
    }
    const taskMap = new Map<string, TaskInfo>()
    const oldTasks = getTasksFromResp(respOld, "offline download tasks")
    oldTasks.forEach((item: any) => {
      if (!item.state) item.state = 0
      taskMap.set(item.id, item)
    })
    const newTasks = getTasksFromResp(
      respNew,
      "offline download transfer tasks",
    )
    newTasks.forEach((item: any) => {
      taskMap.set(item.id, item)
    })

    const mergedTasks = Array.from(taskMap.values())

    // 按 start_time 降序排序（最新的在前），null 值视为最旧，排在后面
    mergedTasks.sort((a, b) => {
      if (!a.start_time && !b.start_time) return 0
      if (!a.start_time) return 1
      if (!b.start_time) return -1
      return b.start_time.localeCompare(a.start_time) // 字符串降序比较
    })

    setTasks(mergedTasks)
  } catch (e) {
    console.error("Failed to fetch tasks:", e)
  } finally {
    if (showLoading) setLoading(false)
  }
}

export const useTasks = () => ({ tasks, loading, fetchOfflineDownloadTasks })
