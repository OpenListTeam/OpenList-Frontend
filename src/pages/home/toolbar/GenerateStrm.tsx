import {
  Box,
  Button,
  createDisclosure,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
  useColorModeValue,
  VStack,
} from "@hope-ui/solid"
import { IoCheckmarkCircleOutline, IoCloseCircleOutline } from "solid-icons/io"
import { createSignal, onCleanup, Show, For } from "solid-js"
import { bus, fsGenerateStrm, handleRespWithoutNotify } from "~/utils"
import { useFetch, useRouter, useT } from "~/hooks"

import { FullLoading } from "~/components"

export const StrmItem = (props: {
  path: string
  success: boolean
  index: number
}) => {
  let strings = props.path.split("\n")
  return (
    <Box
      w="$full"
      p="$3"
      borderWidth="1px"
      borderRadius="$lg"
      borderColor={props.success ? "$success6" : "$danger6"}
      bgColor={props.success ? "$success1" : "$danger1"}
      transition="all 0.2s"
      _hover={{ transform: "translateX(5px)" }}
    >
      <HStack w="$full" spacing="$4">
        <Text
          class="index"
          fontSize="$lg"
          fontWeight="bold"
          color={props.success ? "$success9" : "$danger9"}
          w="$12"
          textAlign="center"
        >
          {props.index + 1}
        </Text>
        <VStack w="$full" alignItems="start" spacing="$2">
          <Text class="path" fontSize="$md">
            {strings[0]}
          </Text>
          <Show when={strings[1]}>
            <Text
              class="errorReason"
              color="$danger9"
              fontSize="$sm"
              fontStyle="italic"
            >
              {strings[1].trim()}
            </Text>
          </Show>
        </VStack>

        <Box
          as="span"
          color={props.success ? "$success8" : "$danger8"}
          fontSize="$xl"
        >
          {props.success ? (
            <IoCheckmarkCircleOutline />
          ) : (
            <IoCloseCircleOutline />
          )}
        </Box>
      </HStack>
    </Box>
  )
}

export const GenerateStrm = () => {
  const t = useT()
  const cardBg = useColorModeValue("white", "$neutral3")
  const { isOpen, onOpen, onClose } = createDisclosure()
  const { pathname } = useRouter()
  const [loading, ok] = useFetch(fsGenerateStrm)
  const [successResult, setSuccessResult] = createSignal<string[]>([])
  const [failResult, setFailResult] = createSignal<string[]>([])
  const [deleteResult, setDeleteResult] = createSignal<string[]>([])
  const handler = (name: string) => {
    if (name === "generate_strm") {
      setSuccessResult([])
      setFailResult([])
      setDeleteResult([])
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
        "@initial": "xl",
        "@md": "2xl",
      }}
    >
      <ModalOverlay />

      <ModalContent>
        <ModalHeader>{t("home.toolbar.strm.generate_strm")}</ModalHeader>
        <ModalBody maxH="70vh" overflow="auto" p="$4">
          <Show
            when={successResult()?.length == 0 && failResult()?.length == 0}
          >
            <Text>{t("home.toolbar.strm.generate_strm_tips")}</Text>
          </Show>
          <Show when={loading()}>
            <FullLoading />
          </Show>
          <Show
            when={
              successResult()?.length != 0 ||
              failResult()?.length != 0 ||
              deleteResult().length != 0
            }
          >
            <VStack
              maxH="70vh"
              overflow="auto"
              class="obj-box"
              w="$full"
              rounded="$xl"
              bgColor={cardBg()}
              p="$4"
              shadow="$lg"
              spacing="$6"
            >
              <Show when={successResult().length > 0}>
                <Text
                  color="$success9"
                  fontSize="$xl"
                  fontWeight="bold"
                  borderBottom="2px solid"
                  borderColor="$success6"
                  pb="$2"
                >
                  {t("home.toolbar.strm.success")}
                </Text>
                <For each={successResult()}>
                  {(obj, i) => (
                    <StrmItem path={obj} success={true} index={i()} />
                  )}
                </For>
              </Show>

              <Show when={failResult().length > 0}>
                <Text
                  color="$danger9"
                  fontSize="$xl"
                  fontWeight="bold"
                  borderBottom="2px solid"
                  borderColor="$danger6"
                  pb="$2"
                >
                  {t("home.toolbar.strm.failed")}
                </Text>
                <For each={failResult()}>
                  {(obj, i) => (
                    <StrmItem path={obj} success={false} index={i()} />
                  )}
                </For>
              </Show>

              <Show when={deleteResult().length > 0}>
                <Text
                  color="$danger9"
                  fontSize="$xl"
                  fontWeight="bold"
                  borderBottom="2px solid"
                  borderColor="$danger6"
                  pb="$2"
                >
                  {t("home.toolbar.strm.delete_file")}
                </Text>
                <For each={deleteResult()}>
                  {(obj, i) => (
                    <StrmItem path={obj} success={false} index={i()} />
                  )}
                </For>
              </Show>
            </VStack>
          </Show>
        </ModalBody>

        {/*底部按钮*/}
        <ModalFooter display="flex" gap="$2">
          <Button onClick={onClose} colorScheme="neutral">
            {successResult()?.length == 0 && failResult()?.length == 0
              ? t("global.cancel")
              : t("global.back")}
          </Button>
          <Show
            when={successResult()?.length == 0 && failResult()?.length == 0}
          >
            <Button
              loading={loading()}
              onClick={async () => {
                const resp = await ok(pathname())
                handleRespWithoutNotify(resp, () => {
                  setSuccessResult(resp.data.successPaths?.sort() || [])
                  setFailResult(resp.data.failedPaths?.sort() || [])
                  setDeleteResult(resp.data.deleteFiles?.sort() || [])
                })
              }}
            >
              {t("global.confirm")}
            </Button>
          </Show>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
