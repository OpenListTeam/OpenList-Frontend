import {
  Button,
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Switch as HopeSwitch,
  createDisclosure,
} from "@hope-ui/solid"
import { useFetch, usePath, useRouter, useT } from "~/hooks"
import { bus, fsRecurseList, handleRespWithNotifySuccess } from "~/utils"
import { createSignal, onCleanup } from "solid-js"
import { FaSolidMinus, FaSolidPlus } from "solid-icons/fa"

export const RecurseList = () => {
  const { isOpen, onOpen, onClose } = createDisclosure()
  const { pathname } = useRouter()
  const [loading, ok] = useFetch(fsRecurseList)
  const { refresh } = usePath()
  const [intervalSec, setIntervalSec] = createSignal(3)
  const [refreshEnabled, setRefreshEnabled] = createSignal(false)
  const t = useT()

  const handler = (name: string) => {
    if (name === "recurseList") {
      setIntervalSec(3)
      setRefreshEnabled(false)
      onOpen()
    }
  }
  bus.on("tool", handler)
  onCleanup(() => {
    bus.off("tool", handler)
  })

  const handleSubmit = async () => {
    const resp = await ok(pathname(), refreshEnabled(), intervalSec())
    handleRespWithNotifySuccess(resp, () => {
      refresh()
      onClose()
    })
  }

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
        <ModalHeader>{t("home.toolbar.recurse_list")}</ModalHeader>
        <ModalBody>
          <FormControl mb="$4">
            <FormLabel>{t("home.toolbar.recurse_list_interval")}</FormLabel>
            <HStack>
              <IconButton
                aria-label="decrease"
                icon={<FaSolidMinus />}
                onClick={() => {
                  setIntervalSec((prev) => Math.max(0, prev - 1))
                }}
              />
              <Input
                type="number"
                value={intervalSec()}
                onInput={(e) => {
                  const value = parseInt(e.currentTarget.value) || 0
                  setIntervalSec(Math.max(0, value))
                }}
                style={{
                  "-moz-appearance": "textfield",
                  "::-webkit-inner-spin-button": { display: "none" },
                  "::-webkit-outer-spin-button": { display: "none" },
                }}
                class="hide-spin"
                textAlign="center"
              />
              <IconButton
                aria-label="increase"
                icon={<FaSolidPlus />}
                onClick={() => {
                  setIntervalSec((prev) => prev + 1)
                }}
              />
            </HStack>
          </FormControl>
          <FormControl>
            <FormLabel>{t("home.toolbar.recurse_list_refresh")}</FormLabel>
            <HopeSwitch
              checked={refreshEnabled()}
              onChange={(e: { currentTarget: HTMLInputElement }) => {
                setRefreshEnabled(e.currentTarget.checked)
              }}
            />
          </FormControl>
        </ModalBody>
        <ModalFooter display="flex" gap="$2">
          <Button onClick={onClose} colorScheme="neutral">
            {t("global.cancel")}
          </Button>
          <Button loading={loading()} onClick={handleSubmit}>
            {t("global.confirm")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
