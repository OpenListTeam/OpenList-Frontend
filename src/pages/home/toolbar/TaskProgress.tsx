import {
  VStack,
  HStack,
  Text,
  Badge,
  Progress,
  ProgressIndicator,
} from "@hope-ui/solid"
import type { TaskInfo } from "~/types"
import { getFileSize } from "~/utils"
import { Show } from "solid-js"
import { useT } from "~/hooks"
import { getPath } from "~/pages/manage/tasks/helper"

// 解析任务名称，返回文件名和路径信息
const parseTaskName = (name: string) => {
  // download 类型：download 文件名 to (路径)
  let match = name.match(/^download (.+) to \((.+)\)$/)
  if (match) {
    return {
      type: "download" as const,
      fileName: match[1],
      path: match[2],
    }
  }
  // transfer/upload 类型：transfer [设备](路径) to [目标设备](目标路径) 或 upload [文件名](URL) to [目标设备](目标路径)
  match = name.match(
    /^(transfer|upload) \[(.*?)\]\((.*?)\) to \[(.*?)\]\((.*?)\)$/,
  )
  if (match) {
    const type = match[1] as "transfer" | "upload"
    const bracketContent = match[2] // 方括号内：transfer 为设备，upload 为文件名
    const urlOrPath = match[3] // 圆括号内：transfer 为路径，upload 为 URL
    const dstDevice = match[4]
    const dstPath = match[5]

    if (type === "transfer") {
      // 从路径中提取文件名（最后一段，去除参数）
      const fileName =
        urlOrPath.split("/").pop()?.split("?")[0] || "Unknown file"
      return {
        type,
        fileName,
        srcDevice: bracketContent,
        srcPath: urlOrPath,
        dstDevice,
        dstPath,
      }
    } else {
      // upload 类型：文件名直接取自方括号
      return {
        type,
        fileName: bracketContent,
        srcDevice: "",
        srcPath: urlOrPath,
        dstDevice,
        dstPath,
      }
    }
  }
  return null
}

export const StatusColor = {
  0: "neutral",
  1: "info",
  2: "warning",
  3: "danger",
  4: "success",
  5: "info",
} as const

export const OfflineDownloadTaskItem = (props: TaskInfo) => {
  const t = useT()
  const parsed = parseTaskName(props.name)

  return (
    <VStack
      w="$full"
      spacing="$1"
      rounded="$lg"
      border="1px solid $neutral7"
      alignItems="start"
      p="$2"
      _hover={{ border: "1px solid $info6" }}
    >
      {parsed ? (
        <>
          <Text css={{ wordBreak: "break-all" }}>{parsed.fileName}</Text>
          {parsed.type === "download" && parsed.path && (
            <Text css={{ wordBreak: "break-all" }} size="sm" color="$neutral11">
              {t("tasks.attr.offline_download.path")}:{" "}
              {getPath("", parsed.path)}
            </Text>
          )}
          {parsed.type === "transfer" && parsed.dstPath && (
            <Text css={{ wordBreak: "break-all" }} size="sm" color="$neutral11">
              {t("tasks.attr.offline_download.transfer_dst")}:{" "}
              {getPath(parsed.dstDevice, parsed.dstPath)}
            </Text>
          )}
          {parsed.type === "upload" && parsed.dstPath && (
            <Text css={{ wordBreak: "break-all" }} size="sm" color="$neutral11">
              {t("tasks.attr.offline_download.path")}:{" "}
              {getPath(parsed.dstDevice, parsed.dstPath)}
            </Text>
          )}
        </>
      ) : (
        <Text css={{ wordBreak: "break-all" }}>{props.name}</Text>
      )}
      <HStack spacing="$2" w="$full" justifyContent="space-between">
        <Badge
          colorScheme={
            StatusColor[props.state as keyof typeof StatusColor] ?? "info"
          }
        >
          {t("tasks.state." + props.state)}
        </Badge>
        <Text color="$neutral11">{getFileSize(props.total_bytes)}</Text>
      </HStack>
      <Progress
        w="$full"
        trackColor="$info3"
        rounded="$full"
        value={props.progress}
        size="sm"
      >
        <ProgressIndicator color="$info6" rounded="$md" />
      </Progress>
      <Show when={props.error}>
        <Text color="$danger10" css={{ wordBreak: "break-all" }}>
          {props.error}
        </Text>
      </Show>
    </VStack>
  )
}

export default OfflineDownloadTaskItem
