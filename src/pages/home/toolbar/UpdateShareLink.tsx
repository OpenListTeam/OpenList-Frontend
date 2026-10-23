import {
  Button,
  createDisclosure,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  VStack,
} from "@hope-ui/solid"
import { createEffect, createSignal, Show } from "solid-js"
import { CgShare } from "solid-icons/cg"
import { usePath, useRouter, useT } from "~/hooks"
import { me, objStore } from "~/store"
import { UserMethods } from "~/types"
import { handleResp, notify, standardizePath, updateShareLink } from "~/utils"
import { RightIcon } from "./Icon"

/**
 * 悬浮工具栏里的「更新分享链接」入口 + 弹窗（组件名与文件名一致）。
 *
 * 只在分享驱动挂载的目录里显示 —— 是否分享目录由后端 `fs/list` 返回的
 * `is_share` 决定。点击后弹出窗口，填入分享 ID（必填）与提取码（没有则留空）并保存，
 * 请求 `/admin/storage/update_sharelink` 时只带弹窗打开时的目录路径、sid 与 pwd，
 * 存储配置的更新由后端完成。
 *
 * 更新成功后以该路径所在存储的挂载路径为落点：挂载路径由后端
 * `/admin/storage/update_sharelink` 返回（可能是多级的，如 /mnt/115分享，前端无法从
 * 路径形状可靠推导），本来就在挂载路径时原地重新拉取：
 * 新链接的目录结构可能和旧链接不同，原来所在的子目录未必还存在。
 *
 * 接口是 admin 权限，所以入口只对管理员显示；这里和 `Obj.tsx` 的存储错误按钮做法一致，
 * 非管理员直接不渲染入口。
 */
export const UpdateShareLinkModal = () => {
  const t = useT()
  const { pathname, to } = useRouter()
  const { refresh } = usePath()
  const { isOpen, onOpen, onClose } = createDisclosure()
  const [sid, setSid] = createSignal("")
  const [pwd, setPwd] = createSignal("")
  // 弹窗打开时的目录路径：避免弹窗开着时用户切换目录、提交却打到新目录的存储上
  const [path, setPath] = createSignal("")
  const [emptySid, setEmptySid] = createSignal(false)
  const [loading, setLoading] = createSignal(false)

  const open = () => {
    setPath(pathname())
    setSid("")
    setPwd("")
    setEmptySid(false)
    onOpen()
  }

  const close = () => {
    if (loading()) return
    setSid("")
    setPwd("")
    setEmptySid(false)
    onClose()
  }

  // 目录不再是分享目录（切换目录 / 后端更新后重新拉取）时收起弹窗，
  // 避免上一个目录的弹窗滞留在屏幕上
  createEffect(() => {
    if (!objStore.is_share && isOpen() && !loading()) {
      close()
    }
  })

  const submit = async () => {
    if (loading()) return
    const shareId = sid().trim()
    if (shareId === "") {
      setEmptySid(true)
      return
    }
    setEmptySid(false)
    const updatePath = standardizePath(path())
    setLoading(true)
    const resp = await updateShareLink({
      path: updatePath,
      sid: shareId,
      pwd: pwd().trim(),
    })
    setLoading(false)
    handleResp(resp, (data) => {
      const targetPath = data?.mount_path
        ? standardizePath(data.mount_path)
        : ""
      close()
      notify.success(t("home.toolbar.update_share_link_success"))
      if (standardizePath(pathname()) !== updatePath) return
      if (!targetPath || standardizePath(pathname()) === targetPath) {
        refresh()
      } else {
        to(targetPath)
      }
    })
  }

  return (
    <>
      <Show when={objStore.is_share && UserMethods.is_admin(me())}>
        <RightIcon
          as={CgShare}
          tips="update_share_link"
          onClick={open}
          class="toolbar-update-share-link"
        />
      </Show>
      <Modal
        blockScrollOnMount={false}
        opened={isOpen()}
        onClose={close}
        initialFocus="#update-share-sid-input"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{t("home.toolbar.update_share_link")}</ModalHeader>
          <ModalBody>
            <VStack spacing="$3" alignItems="stretch">
              <FormControl required display="flex" flexDirection="column">
                <FormLabel for="update-share-sid-input">
                  {t("home.toolbar.update_share_link_sid")}
                </FormLabel>
                <Input
                  id="update-share-sid-input"
                  value={sid()}
                  invalid={emptySid()}
                  onInput={(e) => {
                    setSid(e.currentTarget.value)
                    setEmptySid(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      submit()
                    }
                  }}
                />
                <Show when={emptySid()}>
                  <FormErrorMessage>
                    {t("home.toolbar.update_share_link_sid_empty")}
                  </FormErrorMessage>
                </Show>
                <FormHelperText>
                  {t("home.toolbar.update_share_link_sid-tips")}
                </FormHelperText>
              </FormControl>
              <FormControl display="flex" flexDirection="column">
                <FormLabel for="update-share-pwd-input">
                  {t("home.toolbar.update_share_link_pwd")}
                </FormLabel>
                <Input
                  id="update-share-pwd-input"
                  value={pwd()}
                  onInput={(e) => setPwd(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      submit()
                    }
                  }}
                />
                <FormHelperText>
                  {t("home.toolbar.update_share_link_pwd-tips")}
                </FormHelperText>
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter display="flex" gap="$2">
            <Button colorScheme="neutral" disabled={loading()} onClick={close}>
              {t("global.cancel")}
            </Button>
            <Button loading={loading()} onClick={submit}>
              {t("global.save")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
