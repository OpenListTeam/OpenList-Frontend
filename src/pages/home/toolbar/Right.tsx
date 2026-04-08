import { Box, createDisclosure, HStack, VStack } from "@hope-ui/solid"
import { createMemo, Show } from "solid-js"
import { RightIcon } from "./Icon"
import { CgMoreO } from "solid-icons/cg"
import { TbCheckbox } from "solid-icons/tb"
import { objStore, selectAll, State, toggleCheckbox, userCan } from "~/store"
import { bus } from "~/utils"
import { operations } from "./operations"
import { IoMagnetOutline } from "solid-icons/io"
import { AiOutlineCloudUpload, AiOutlineSetting } from "solid-icons/ai"
import { RiSystemRefreshLine } from "solid-icons/ri"
import { usePath, useRouter } from "~/hooks"
import { Motion } from "solid-motionone"
import { isTocVisible, setTocDisabled } from "~/components"
import { BiSolidBookContent } from "solid-icons/bi"

// ─── 顶栏工具按钮（水平排列，嵌入顶栏使用）────────────────────
export const TopBarActions = () => {
  const isFolder = createMemo(() => objStore.state === State.Folder)
  const { refresh } = usePath()
  const { isShare } = useRouter()
  return (
    <HStack spacing="$1" class="topbar-actions">
      <RightIcon
        as={RiSystemRefreshLine}
        tips="refresh"
        onClick={() => {
          refresh(undefined, true)
        }}
      />
      <Show
        when={isFolder() && !isShare() && (userCan("write") || objStore.write)}
      >
        <RightIcon
          as={operations.new_file.icon}
          tips="new_file"
          onClick={() => {
            bus.emit("tool", "new_file")
          }}
        />
        <RightIcon
          as={operations.mkdir.icon}
          p="$1_5"
          tips="mkdir"
          onClick={() => {
            bus.emit("tool", "mkdir")
          }}
        />
        <RightIcon
          as={operations.recursive_move.icon}
          tips="recursive_move"
          onClick={() => {
            bus.emit("tool", "recursiveMove")
          }}
        />
        <RightIcon
          as={operations.remove_empty_directory.icon}
          tips="remove_empty_directory"
          onClick={() => {
            bus.emit("tool", "removeEmptyDirectory")
          }}
        />
        <RightIcon
          as={operations.batch_rename.icon}
          tips="batch_rename"
          onClick={() => {
            selectAll(true)
            bus.emit("tool", "batchRename")
          }}
        />
        <RightIcon
          as={AiOutlineCloudUpload}
          tips="upload"
          onClick={() => {
            bus.emit("tool", "upload")
          }}
        />
      </Show>
      <Show when={isFolder() && !isShare() && userCan("offline_download")}>
        <RightIcon
          as={IoMagnetOutline}
          pl="0"
          tips="offline_download"
          onClick={() => {
            bus.emit("tool", "offline_download")
          }}
        />
      </Show>
      <Show when={isTocVisible()}>
        <RightIcon
          as={BiSolidBookContent}
          tips="toggle_markdown_toc"
          onClick={() => {
            setTocDisabled((disabled) => !disabled)
          }}
        />
      </Show>
      <RightIcon
        tips="toggle_checkbox"
        as={TbCheckbox}
        onClick={toggleCheckbox}
      />
      <RightIcon
        as={AiOutlineSetting}
        tips="local_settings"
        onClick={() => {
          bus.emit("tool", "local_settings")
        }}
      />
    </HStack>
  )
}

// ─── 原右下角浮动按钮（已迁移到顶栏，保留空组件避免引用报错）────
export const Right = () => {
  return null
}
