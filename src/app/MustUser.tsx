import { createSignal, JSXElement, Match, onMount, Switch } from "solid-js"
import { Error, FullScreenLoading } from "~/components"
import { useFetch, useT } from "~/hooks"
import { Me, setMe } from "~/store"
import { PResp } from "~/types"
import { r, handleResp, handleRespWithoutAuthAndNotify } from "~/utils"

const MustUser = (props: { children: JSXElement }) => {
  const t = useT()
  const [loading, data] = useFetch((): PResp<Me> => r.get("/me"))
  const [err, setErr] = createSignal<string>()
  ;(async () => {
    // const resp: Resp<User> = await data();
    handleResp(await data(), setMe, setErr)
  })()
  return (
    <Switch fallback={props.children}>
      <Match when={loading()}>
        <FullScreenLoading />
      </Match>
      <Match when={err() !== undefined}>
        <Error msg={t("home.get_current_user_failed") + err()} />
      </Match>
    </Switch>
  )
}

const UserOrGuest = (props: { children: JSXElement }) => {
  const [loading, data] = useFetch((): PResp<Me> => r.get("/me"))
  const [skipLogin, setSkipLogin] = createSignal(false)
  onMount(async () => {
    handleRespWithoutAuthAndNotify(await data(), setMe, (_msg, _code) => {
      setMe({
        id: 2,
        username: "guest",
        password: "",
        base_path: "/",
        role: 1,
        disabled: false,
        permission: 0,
        sso_id: "",
        otp: false,
      })
      setSkipLogin(true)
    })
  })
  return (
    <Switch fallback={props.children}>
      <Match when={!skipLogin() && loading()}>
        <FullScreenLoading />
      </Match>
    </Switch>
  )
}

export { MustUser, UserOrGuest }
