import { Button, Heading, HStack, Stack, Text, VStack } from "@hope-ui/solid"
import { createSignal, Show } from "solid-js"
import { ModalInput, PasskeyIcon } from "~/components"
import { useFetch, useT } from "~/hooks"
import { PasskeyCredential, PEmptyResp } from "~/types"
import { handleResp, notify, r } from "~/utils"

interface WebauthnItemProps extends PasskeyCredential {
  onRenamed: (name: string) => void
  onRevoked: () => void
}

export const WebauthnItem = (props: WebauthnItemProps) => {
  const t = useT()
  const [renameOpened, setRenameOpened] = createSignal(false)
  const [removeLoading, remove] = useFetch(
    (): PEmptyResp =>
      r.post(`/authn/delete_authn`, {
        id: props.id,
      }),
  )
  const [renameLoading, rename] = useFetch(
    (name: string): PEmptyResp =>
      r.post(`/authn/rename_authn`, {
        id: props.id,
        name,
      }),
  )
  const formatTime = (value: string | undefined, fallback: string) =>
    value ? new Date(value).toLocaleString() : fallback

  return (
    <Stack
      role="listitem"
      w="$full"
      overflowX="auto"
      shadow="$md"
      rounded="$lg"
      p="$3"
      direction={{ "@initial": "column", "@xl": "row" }}
      spacing="$3"
    >
      <VStack w="$full" alignItems="start" spacing="$1">
        <HStack spacing="$2">
          <PasskeyIcon />
          <Heading color="$info9" size="sm">
            {props.name}
          </Heading>
        </HStack>
        <Text fontSize="$sm">
          {t("users.passkey_created")}:{" "}
          {formatTime(props.created_at, t("users.passkey_unknown"))}
        </Text>
        <Text fontSize="$sm">
          {t("users.passkey_last_used")}:{" "}
          {formatTime(props.last_used_at, t("users.passkey_never_used"))}
        </Text>
        <Text
          fontSize="$xs"
          color="$neutral10"
          css={{ wordBreak: "break-all" }}
        >
          {t("users.passkey_fingerprint")}: {props.fingerprint || "—"}
        </Text>
        <Text
          fontSize="$xs"
          color="$neutral10"
          css={{ wordBreak: "break-all" }}
        >
          ID: {props.id}
        </Text>
      </VStack>
      <HStack alignSelf={{ "@xl": "center" }} spacing="$2">
        <Button size="sm" onClick={() => setRenameOpened(true)}>
          {t("users.passkey_rename")}
        </Button>
        <Button
          size="sm"
          colorScheme="danger"
          loading={removeLoading()}
          onClick={async () => {
            handleResp(await remove(), () => {
              notify.success(t("users.passkey_revoked"))
              props.onRevoked()
            })
          }}
        >
          {t("users.passkey_revoke")}
        </Button>
      </HStack>
      <Show when={renameOpened()}>
        <ModalInput
          opened
          onClose={() => setRenameOpened(false)}
          title="users.passkey_rename"
          defaultValue={props.name}
          loading={renameLoading()}
          onSubmit={async (name) => {
            handleResp(await rename(name), () => {
              notify.success(t("users.passkey_renamed"))
              props.onRenamed(name.trim())
              setRenameOpened(false)
            })
          }}
        />
      </Show>
    </Stack>
  )
}
