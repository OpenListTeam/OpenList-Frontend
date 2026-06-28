import {
  Component,
  createSignal,
  createMemo,
  onMount,
  onCleanup,
  Show,
} from "solid-js"
import { Box, Button } from "@hope-ui/solid"
import { useColorMode } from "@hope-ui/solid"
import { objStore, userCan, getSetting } from "~/store"
import { BoxWithFullScreen, FullLoading } from "~/components"
import { useRouter, useT } from "~/hooks"
import { r } from "~/utils"

interface WopiSession {
  id: string
  access_token: string
  expires: number
}

/** Factory: returns a WOPI preview component bound to a specific service name */
export function generateWopiPreview(serviceName: string): Component {
  return () => <WopiPreview serviceName={serviceName} />
}

const WopiPreview = (props: { serviceName: string }) => {
  const t = useT()
  const { colorMode } = useColorMode()
  const { pathname } = useRouter()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [session, setSession] = createSignal<WopiSession | null>(null)
  const [wopiSrc, setWopiSrc] = createSignal("")
  let formRef: HTMLFormElement | undefined
  let submittedRef = false

  const canEdit = createMemo(
    () =>
      (userCan("write_content") || objStore.write_content_bypass) &&
      objStore.write !== false,
  )

  const replacedSrc = createMemo(() => {
    const actionUrl = wopiSrc() // already built with params
    if (!actionUrl) return ""
    return actionUrl
  })

  const createSession = async () => {
    try {
      setLoading(true)
      const resp = (await r.post("/wopi/create-session", {
        path: pathname(),
        edit: canEdit(),
        service: props.serviceName,
      })) as any

      const data = resp?.data
      if (!data?.session || !data?.action_url || !data?.wopi_src_url) {
        setError(data?.message || t("global.failed"))
        setLoading(false)
        return
      }

      setSession(data.session)

      // If the service has an external_url configured, replace the origin
      // in action_url (discovery XML often returns Docker internal IPs)
      let actionUrl = data.action_url
      try {
        const services = JSON.parse(getSetting("wopi_services") || "[]")
        const svc = services.find((s: any) => s.name === props.serviceName)
        if (svc?.external_url) {
          const discoveryOrigin = new URL(data.action_url).origin
          const externalOrigin = new URL(svc.external_url).origin
          actionUrl = actionUrl.replace(discoveryOrigin, externalOrigin)
        }
      } catch {
        // ignore
      }

      // Frontend builds the final URL — backend only returns raw parts
      const lang = navigator.language?.toLowerCase() ?? "en"
      const darkMode = colorMode() === "dark" ? "2" : "1"
      const params = new URLSearchParams({
        WOPISrc: data.wopi_src_url,
        lang: lang,
        ui: lang,
        thm: darkMode,
      })
      setWopiSrc(actionUrl + "?" + params.toString())

      setLoading(false)

      setTimeout(() => {
        if (formRef && !submittedRef) {
          formRef.submit()
          submittedRef = true
        }
      }, 100)
    } catch (err: any) {
      setError(err?.message || t("global.failed"))
      setLoading(false)
    }
  }

  onMount(() => {
    window.addEventListener("message", handlePostMessage, false)
    createSession()
  })
  onCleanup(() => {
    window.removeEventListener("message", handlePostMessage, false)
  })

  function handlePostMessage(e: MessageEvent) {
    try {
      const msg = typeof e.data === "string" ? JSON.parse(e.data) : e.data
      if (msg.MessageId === "UI_Close") {
        /* editor closed */
      }
    } catch {
      /* ignore non-JSON */
    }
  }

  return (
    <BoxWithFullScreen w="$full" h="70vh">
      <Show when={loading()}>
        <FullLoading />
      </Show>

      <Show when={error()}>
        <Box
          display="flex"
          justifyContent="center"
          alignItems="center"
          h="100%"
          flexDirection="column"
          gap="$4"
        >
          <Box color="$danger11" fontSize="$lg">
            {error()}
          </Box>
          <Button
            onClick={() => {
              setError(null)
              submittedRef = false
              createSession()
            }}
          >
            {t("global.retry")}
          </Button>
        </Box>
      </Show>

      <Show when={session() && replacedSrc()}>
        <form
          ref={formRef!}
          id="office_form"
          name="office_form"
          target="wopi_frame"
          action={replacedSrc()}
          method="post"
          style={{ display: "none" }}
        >
          <input
            name="access_token"
            value={session()!.access_token}
            type="hidden"
          />
          <input
            name="access_token_ttl"
            value={String(session()!.expires)}
            type="hidden"
          />
        </form>

        <Box
          as="iframe"
          id="wopi_frame"
          name="wopi_frame"
          onLoad={() => {
            if (submittedRef) setLoading(false)
          }}
          allow="clipboard-read *; clipboard-write *"
          allowfullscreen
          w="100%"
          h={loading() ? "0" : "100%"}
          border="none"
        />
      </Show>
    </BoxWithFullScreen>
  )
}

export default WopiPreview
