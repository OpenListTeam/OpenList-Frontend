import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Textarea,
  Box,
  VStack,
  Text,
  createDisclosure,
} from "@hope-ui/solid"
import { FolderChooseInput } from "~/components"
import { useFetch, usePath, useRouter, useT } from "~/hooks"
import { saveFromShare, bus, handleRespWithNotifySuccess } from "~/utils"
import { createSignal, onCleanup } from "solid-js"

export const SaveFromShare = () => {
  const t = useT()
  const { pathname } = useRouter()
  const { refresh } = usePath()
  const { isOpen, onOpen, onClose } = createDisclosure()
  const [linkValue, setLinkValue] = createSignal("")
  const [savePath, setSavePath] = createSignal("")
  const [loading, submit] = useFetch(saveFromShare)

  const handler = (name: string) => {
    if (name === "save_from_share") {
      setSavePath(pathname())
      onOpen()
    }
  }
  bus.on("tool", handler)
  onCleanup(() => {
    bus.off("tool", handler)
  })

  const handleClose = () => {
    setLinkValue("")
    onClose()
  }

  const handleSubmit = async () => {
    if (!linkValue().trim()) return
    const urls = linkValue()
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean)
    const resp = await submit(savePath(), urls)
    handleRespWithNotifySuccess(resp, () => {
      handleClose()
      refresh(undefined, true)
    })
  }

  return (
    <Modal
      size="xl"
      blockScrollOnMount={false}
      opened={isOpen()}
      onClose={handleClose}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{t("home.toolbar.save_from_share")}</ModalHeader>
        <ModalBody>
          <VStack spacing="$3" alignItems="stretch">
            <Textarea
              placeholder={t("home.toolbar.save_from_share-tips")}
              value={linkValue()}
              onInput={(e) => setLinkValue(e.currentTarget.value)}
              minH="120px"
            />
            <Box>
              <Text fontSize="$sm" mb="$1" fontWeight="$medium">
                {t("home.toolbar.offline_download_enhanced.save_path")}
              </Text>
              <FolderChooseInput
                value={savePath()}
                onChange={setSavePath}
                id="save-from-share-path"
              />
            </Box>
          </VStack>
        </ModalBody>
        <ModalFooter display="flex" gap="$2">
          <Button onClick={handleClose} colorScheme="neutral">
            {t("global.cancel")}
          </Button>
          <Button
            loading={loading()}
            onClick={handleSubmit}
            disabled={!linkValue().trim()}
          >
            {t("home.toolbar.save_from_share_start")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
