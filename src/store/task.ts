// src/store/task.ts
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { r } from "~/utils"

export interface TaskInfo {
  id: string
  name: string
  creator: string
  creator_role: number
  state: number
  status: string
  progress: number
  start_time: string | null
  end_time: string | null
  total_bytes: number
  error: string
}

const [tasks, setTasks] = createStore<TaskInfo[]>([])
const [loading, setLoading] = createSignal(false)

export const fetchTasks = async (showLoading = true) => {
  // 只有当 showLoading 为 true 时才设置 loading 为 true
  if (showLoading) setLoading(true)
  try {
    // 同时请求两个 API（旧 API 和 新 API）
    const [respOld, respNew] = await Promise.all([
      r.get("/task/offline_download/undone").catch(() => ({ data: [] })),
      r
        .get("/task/offline_download_transfer/undone")
        .catch(() => ({ data: [] })),
    ])

    // 用 Map 以 id 去重合并
    const taskMap = new Map<string, TaskInfo>()

    // 处理旧 API 数据（等待中的离线下载任务）
    const oldTasks = respOld.data || []
    oldTasks.forEach((item: any) => {
      // 如果旧 API 返回的数据没有 state，设置默认值 0（等待中）
      if (!item.state) item.state = 0
      taskMap.set(item.id, item)
    })

    // 处理新 API 数据（进行中的任务）
    const newTasks = respNew.data || []
    newTasks.forEach((item: any) => {
      taskMap.set(item.id, item) // 新数据覆盖旧数据
    })

    const mergedTasks = Array.from(taskMap.values())
    setTasks(mergedTasks)
  } catch (e) {
    console.error("Failed to fetch tasks:", e)
  } finally {
    // 只有当 showLoading 为 true 时才设置 loading 为 false
    if (showLoading) setLoading(false)
  }
}

export const useTasks = () => ({ tasks, loading, fetchTasks })
