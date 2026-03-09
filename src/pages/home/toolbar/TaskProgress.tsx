// src/pages/home/toolbar/TaskProgress.tsx
import {
  VStack,
  HStack,
  Text,
  Badge,
  Progress,
  ProgressIndicator,
  Box,
} from "@hope-ui/solid"
import { TaskInfo } from "~/store/task"
import { getFileSize } from "~/utils"
import { Show } from "solid-js"

const TaskItem = (props: TaskInfo) => {
  // 根据 state 数字映射状态文本和颜色
  const getStatusInfo = () => {
    switch (props.state) {
      case 0:
        return { text: "pending", color: "neutral" }
      case 1:
        return { text: "downloading", color: "info" }
      case 2:
        return { text: "paused", color: "warning" }
      case 3:
        return { text: "error", color: "danger" }
      case 4:
        return { text: "done", color: "success" }
      case 5:
        return { text: "seeding", color: "info" }
      default:
        return { text: "unknown", color: "neutral" }
    }
  }

  const statusInfo = getStatusInfo()

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
      <Text css={{ wordBreak: "break-all" }}>{props.name}</Text>
      <HStack spacing="$2" w="$full" justifyContent="space-between">
        <Badge colorScheme={statusInfo.color as any}>{statusInfo.text}</Badge>
        <Text color="$neutral11">{getFileSize(props.total_bytes)}</Text>
      </HStack>
      {/* 关键修复：传递 value 属性，并将 progress 转换为 0-100 的数字 */}
      <Progress
        w="$full"
        trackColor="$info3"
        rounded="$full"
        value={props.progress * 100} // 假设后端返回的是小数 (0~1)
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

export default TaskItem
