import { useManageTitle } from "~/hooks"
import { VStack } from "@hope-ui/solid"
import { TypeTasks } from "~/pages/manage/tasks/Tasks"
import {
  getSeedGenerateNameAnalyzer,
  getSeedSaveNameAnalyzer,
} from "~/pages/manage/tasks/helper"

/**
 * 种子任务：生成哈希（异步任务）与秒传 / 中转保存（同步请求，仅展示进度）。
 * 进度与阶段文案（正在计算哈希 2/5 ...）由后端任务实时上报。
 */
const Seed = () => {
  useManageTitle("manage.sidemenu.seed_tasks")
  return (
    <VStack w="$full" alignItems="start" spacing="$4">
      <TypeTasks type="seed_generate" nameAnalyzer={getSeedGenerateNameAnalyzer()} />
      <TypeTasks type="seed_save" nameAnalyzer={getSeedSaveNameAnalyzer()} />
    </VStack>
  )
}

export default Seed
