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
  file_name?: string
  file_size?: number
  error: string
}
