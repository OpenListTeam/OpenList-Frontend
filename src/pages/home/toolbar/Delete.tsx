import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Checkbox,
  createDisclosure,
} from "@hope-ui/solid"
import { createSignal, onCleanup } from "solid-js"
import { useFetch, usePath, useRouter, useT } from "~/hooks"
import { selectedObjs } from "~/store"
import { bus, fsRemove, handleRespWithNotifySuccess } from "~/utils"

export const Delete = () => {
  const t = useT()
  const { isOpen, onOpen, onClose } = createDisclosure()
  const [loading, ok] = useFetch(fsRemove)
  const { refresh } = usePath()
  const { pathname } = useRouter()
  const [followSeed, setFollowSeed] = createSignal(false)
  const handler = (name: string) => {
    if (name === "delete") {
      setFollowSeed(false)
      onOpen()
    }
  }
  bus.on("tool", handler)
  onCleanup(() => {
    bus.off("tool", handler)
  })
  return (
    <Modal
      blockScrollOnMount={false}
      opened={isOpen()}
      onClose={onClose}
      size={{
        "@initial": "xs",
        "@md": "md",
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{t("home.toolbar.delete")}</ModalHeader>
        <ModalBody>
          <p>{t("home.toolbar.delete-tips")}</p>
          <Checkbox
            mt="$2"
            checked={followSeed()}
            disabled={selectedObjs().some((obj) => obj.is_dir)}
            onChange={() => setFollowSeed(!followSeed())}
          >
            {t("home.toolbar.follow_seed")}
          </Checkbox>
        </ModalBody>
        <ModalFooter display="flex" gap="$2">
          <Button onClick={onClose} colorScheme="neutral">
            {t("global.cancel")}
          </Button>
          <Button
            colorScheme="danger"
            loading={loading()}
            onClick={async () => {
              const resp = await ok(
                pathname(),
                selectedObjs().map((obj) => obj.name),
                followSeed(),
              )
              handleRespWithNotifySuccess(resp, () => {
                refresh()
                onClose()
              })
            }}
          >
            {t("global.confirm")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
