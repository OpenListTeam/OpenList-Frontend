import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  Heading,
  HStack,
  Input,
  SimpleGrid,
  VStack,
  Text,
} from "@hope-ui/solid"
import {
  createSignal,
  For,
  JSXElement,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import { LinkWithBase, MaybeLoading, ModalInput } from "~/components"
import { useFetch, useManageTitle, useRouter, useT } from "~/hooks"
import { setMe, me, getSettingBool } from "~/store"
import {
  PasskeyChallenge,
  PasskeyCredential,
  PEmptyResp,
  UserMethods,
  UserPermissions,
  PResp,
} from "~/types"
import {
  createPasskey,
  handleResp,
  handleRespWithoutNotify,
  isWebAuthnSupported,
  notify,
  r,
  runPasskeyAction,
  webAuthnErrorMessage,
} from "~/utils"
import { WebauthnItem } from "./Webauthnitems"
import { PublicKeys } from "./PublicKeys"

const PermissionBadge = (props: { can: boolean; children: JSXElement }) => {
  return (
    <Badge colorScheme={props.can ? "success" : "danger"}>
      {props.children}
    </Badge>
  )
}

const Profile = () => {
  const t = useT()
  useManageTitle("manage.sidemenu.profile")
  const { searchParams, to } = useRouter()
  const [username, setUsername] = createSignal(me().username)
  const [password, setPassword] = createSignal("")
  const [confirmPassword, setConfirmPassword] = createSignal("")
  const usecompatibility = getSettingBool("sso_compatibility_mode")
  const [loading, save] = useFetch(
    (ssoID?: boolean): PEmptyResp =>
      r.post("/me/update", {
        username: ssoID ? me().username : username(),
        password: ssoID ? "" : password(),
        sso_id: me().sso_id,
      }),
  )

  const [getauthncredentialsloading, getauthncredentials] = useFetch(
    (): PResp<PasskeyCredential[]> => r.get("/authn/getcredentials"),
  )
  const [, getauthntemp] = useFetch(
    (
      name: string,
    ): PResp<PasskeyChallenge<PublicKeyCredentialCreationOptionsJSON>> =>
      r.get(
        `/authn/webauthn_begin_registration?name=${encodeURIComponent(name)}`,
      ),
  )
  const [, postregistration] = useFetch(
    (session: string, credentials: PublicKeyCredential): PEmptyResp =>
      r.post(
        "/authn/webauthn_finish_registration",
        JSON.stringify(credentials.toJSON()),
        {
          headers: {
            session: session,
          },
        },
      ),
  )
  const saveMe = async (ssoID?: boolean) => {
    if (password() && password() !== confirmPassword()) {
      notify.warning(t("users.confirm_password_not_same"))
      return
    }
    const resp = await save(ssoID)
    handleResp(resp, () => {
      setMe({ ...me(), username: username() })
      if (!ssoID) {
        notify.success(t("users.update_profile_success"))
        to(`/@login?redirect=${encodeURIComponent(location.pathname)}`)
      } else {
        to("")
      }
    })
  }
  const ssoID = searchParams["sso_id"]
  if (ssoID) {
    setMe({ ...me(), sso_id: ssoID })
    saveMe(true)
  }
  function messageEvent(event: MessageEvent) {
    const data = event.data
    if (data.sso_id) {
      setMe({ ...me(), sso_id: data.sso_id })
      saveMe(true)
    }
  }
  window.addEventListener("message", messageEvent)
  onCleanup(() => {
    window.removeEventListener("message", messageEvent)
  })
  const [credentials, setcredentials] = createSignal<PasskeyCredential[]>([])
  const [credentialsError, setCredentialsError] = createSignal("")
  const [addPasskeyOpened, setAddPasskeyOpened] = createSignal(false)
  const [registrationLoading, setRegistrationLoading] = createSignal(false)
  const refreshCredentials = async () => {
    setCredentialsError("")
    const resp = await getauthncredentials()
    handleRespWithoutNotify(resp, setcredentials, (message) =>
      setCredentialsError(message),
    )
  }
  const registerPasskey = async (name: string) => {
    if (!isWebAuthnSupported()) {
      notify.error(t("users.webauthn_not_supported"))
      return
    }
    await runPasskeyAction(
      registrationLoading,
      setRegistrationLoading,
      async () => {
        const resp = await getauthntemp(name)
        if (resp.code !== 200) {
          handleResp(resp)
          return
        }

        const data = resp.data
        try {
          const credential = await createPasskey(data.options.publicKey)
          if (!credential) {
            throw new DOMException(
              "No passkey credential was returned.",
              "NotAllowedError",
            )
          }
          const finishResp = await postregistration(data.session, credential)
          if (finishResp.code !== 200) {
            handleResp(finishResp)
            return
          }
          notify.success(t("users.add_webauthn_success"))
          setAddPasskeyOpened(false)
          await refreshCredentials()
        } catch (error: unknown) {
          notify.error(webAuthnErrorMessage(error))
        }
      },
    )
  }
  onMount(() => {
    if (
      !UserMethods.is_guest(me()) &&
      getSettingBool("webauthn_login_enabled")
    ) {
      refreshCredentials()
    }
  })
  return (
    <VStack w="$full" spacing="$4" alignItems="start">
      <Show
        when={!UserMethods.is_guest(me())}
        fallback={
          <>
            <Alert
              status="warning"
              flexDirection={{
                "@initial": "column",
                "@lg": "row",
              }}
            >
              <AlertIcon mr="$2_5" />
              <AlertTitle mr="$2_5">{t("users.guest-tips")}</AlertTitle>
              <AlertDescription>{t("users.modify_nothing")}</AlertDescription>
            </Alert>
            <HStack spacing="$2">
              <Text>{t("global.have_account")}</Text>
              <Text
                color="$info9"
                as={LinkWithBase}
                href={`/@login?redirect=${encodeURIComponent(
                  location.pathname,
                )}`}
              >
                {t("global.go_login")}
              </Text>
            </HStack>
          </>
        }
      >
        <Heading>{t("users.update_profile")}</Heading>
        <SimpleGrid gap="$2" columns={{ "@initial": 1, "@md": 2 }}>
          <FormControl>
            <FormLabel for="username">{t("users.change_username")}</FormLabel>
            <Input
              id="username"
              value={username()}
              onInput={(e) => {
                setUsername(e.currentTarget.value)
              }}
            />
          </FormControl>
        </SimpleGrid>
        <SimpleGrid gap="$2" columns={{ "@initial": 1, "@md": 2 }}>
          <FormControl>
            <FormLabel for="password">{t("users.change_password")}</FormLabel>
            <Input
              id="password"
              type="password"
              placeholder="********"
              value={password()}
              onInput={(e) => {
                setPassword(e.currentTarget.value)
              }}
            />
            <FormHelperText>{t("users.change_password-tips")}</FormHelperText>
          </FormControl>
          <FormControl>
            <FormLabel for="confirm-password">
              {t("users.confirm_password")}
            </FormLabel>
            <Input
              id="confirm-password"
              type="password"
              placeholder="********"
              value={confirmPassword()}
              onInput={(e) => {
                setConfirmPassword(e.currentTarget.value)
              }}
            />
            <FormHelperText>{t("users.confirm_password-tips")}</FormHelperText>
          </FormControl>
        </SimpleGrid>
        <HStack spacing="$2">
          <Button loading={loading()} onClick={[saveMe, false]}>
            {t("global.save")}
          </Button>
          <Show when={!me().otp}>
            <Button
              colorScheme="accent"
              onClick={() => {
                to("/@manage/2fa")
              }}
            >
              {t("users.enable_2fa")}
            </Button>
          </Show>
        </HStack>
      </Show>
      <Show
        when={
          getSettingBool("sso_login_enabled") && !UserMethods.is_guest(me())
        }
      >
        <Heading>{t("users.sso_login")}</Heading>
        <HStack spacing="$2">
          <Show
            when={me().sso_id}
            fallback={
              <Button
                onClick={() => {
                  const url = r.getUri() + "/auth/sso?method=get_sso_id"
                  if (usecompatibility) {
                    window.location.href = url
                    return
                  }
                  window.open(url, "authPopup", "width=500,height=600")
                }}
              >
                {t("users.connect_sso")}
              </Button>
            }
          >
            <Button
              colorScheme="danger"
              loading={loading()}
              onClick={() => {
                setMe({ ...me(), sso_id: "" })
                saveMe(true)
              }}
            >
              {t("users.disconnect_sso")}
            </Button>
          </Show>
        </HStack>
      </Show>
      <Show
        when={
          !UserMethods.is_guest(me()) &&
          getSettingBool("webauthn_login_enabled")
        }
      >
        <Heading>{t("users.webauthn")}</Heading>
        <Text color="$neutral11">{t("users.passkey_description")}</Text>
        <VStack
          role={credentials().length > 0 ? "list" : undefined}
          w="$full"
          alignItems="start"
          spacing="$2"
          mt="$2"
        >
          <MaybeLoading loading={getauthncredentialsloading()}>
            <Show when={credentialsError()}>
              <Alert status="danger">
                <AlertIcon mr="$2_5" />
                <AlertDescription>{credentialsError()}</AlertDescription>
                <Button ml="auto" size="sm" onClick={refreshCredentials}>
                  {t("users.passkey_retry")}
                </Button>
              </Alert>
            </Show>
            <Show
              when={!credentialsError() && credentials().length > 0}
              fallback={
                <Show when={!credentialsError()}>
                  <Text role="status">{t("users.passkey_empty")}</Text>
                </Show>
              }
            >
              <For each={credentials()}>
                {(item) => (
                  <WebauthnItem
                    {...item}
                    onRenamed={(name) =>
                      setcredentials((current) =>
                        current.map((credential) =>
                          credential.id === item.id
                            ? { ...credential, name }
                            : credential,
                        ),
                      )
                    }
                    onRevoked={() =>
                      setcredentials((current) =>
                        current.filter(
                          (credential) => credential.id !== item.id,
                        ),
                      )
                    }
                  />
                )}
              </For>
            </Show>
          </MaybeLoading>
        </VStack>
        <Button
          loading={registrationLoading()}
          onClick={() => setAddPasskeyOpened(true)}
        >
          {t("users.add_webauthn")}
        </Button>
        <ModalInput
          opened={addPasskeyOpened()}
          onClose={() => setAddPasskeyOpened(false)}
          title="users.passkey_name"
          loading={registrationLoading()}
          tips={t("users.passkey_name_tips")}
          onSubmit={registerPasskey}
        />
      </Show>
      <HStack wrap="wrap" gap="$2" mt="$2">
        <For each={UserPermissions}>
          {(item, i) => (
            <PermissionBadge can={UserMethods.can(me(), i())}>
              {t(`users.permissions.${item}`)}
            </PermissionBadge>
          )}
        </For>
      </HStack>
      <Show
        when={UserMethods.can(
          me(),
          UserPermissions.findIndex((p) => p === "ftp_read"),
        )}
      >
        <PublicKeys isMine={true} userId={me().id} />
      </Show>
    </VStack>
  )
}

export default Profile
