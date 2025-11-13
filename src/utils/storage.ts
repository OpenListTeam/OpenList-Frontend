import { MountDetails } from "~/types"

export const showDiskUsage = (details?: MountDetails) => {
  return details?.total_space > 0
}

export const toReadableUsage = (details: MountDetails) => {
  let total = details.total_space!
  let used = total - details.free_space!
  const units = ["B", "K", "M", "G", "T", "P", "E"]
  const k = 1024
  let unit_i = 0
  while (unit_i < units.length - 1 && (used >= k || total >= k)) {
    used /= k
    total /= k
    unit_i++
  }
  return `${used.toFixed(2)} / ${total.toFixed(2)} ${units[unit_i]}`
}

export const usedPercentage = (details: MountDetails) => {
  return (
    ((details.total_space! - details.free_space!) / details.total_space!) *
    100.0
  )
}

export const nearlyFull = (details: MountDetails) => {
  return details.free_space! / details.total_space! < 0.1
}
