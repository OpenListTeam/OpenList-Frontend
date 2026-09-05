import {
  Image,
  Center,
  Flex,
  Heading,
  Input,
  Button,
  useColorModeValue,
  VStack,
} from "@hope-ui/solid"
import { createMemo, createSignal, onMount } from "solid-js"
import { SwitchColorMode, SwitchLanguageWhite } from "~/components"
import { useLoading, useT, useTitle } from "~/hooks"
import { getSetting } from "~/store"
import { base_path, r, notify, handleRespWithoutAuthAndNotify } from "~/utils"
import { Resp } from "~/types"
import LoginBg from "../login/LoginBg"

const Init = () => {
  const logos = getSetting("logo").split("\n")
  const logo = useColorModeValue(logos[0], logos.pop())
  const t = useT()
  const title = createMemo(
    () => `${t("init.setup_to")} ${getSetting("site_title")}`,
  )
  useTitle(title)
  const bgColor = useColorModeValue("white", "$neutral1")

  const [username, setUsername] = createSignal("admin")
  const [password, setPassword] = createSignal("")
  const [confirmPassword, setConfirmPassword] = createSignal("")
  const [siteTitle, setSiteTitle] = createSignal(
    getSetting("site_title") || "OpenList",
  )

  // 若系统已初始化，跳转到登录页
  onMount(async () => {
    const resp = (await r.get("/public/init_status")) as Resp<{
      initialized: boolean
    }>
    if (resp.code === 200 && resp.data?.initialized) {
      // 已初始化：整页刷新跳转，确保 App 重新读取 init_status 为 true，
      // 避免 SPA 跳转被 App 的「未初始化」检测再次拉回本页形成循环。
      window.location.href = base_path + "/@login"
    }
  })

  const [loading, data] = useLoading(() =>
    r.post("/public/init/setup", {
      username: username(),
      password: password(),
      site_title: siteTitle(),
    }),
  )

  const submit = async () => {
    if (password().length < 4) {
      notify.error(t("init.password_too_short"))
      return
    }
    if (password() !== confirmPassword()) {
      notify.error(t("init.password_mismatch"))
      return
    }
    const resp = await data()
    handleRespWithoutAuthAndNotify(
      resp,
      () => {
        notify.success(t("init.success"))
        // 整页刷新跳转登录页，让 App 重新挂载并读取 init_status / settings
        window.location.href = base_path + "/@login"
      },
      (msg) => notify.error(msg),
    )
  }

  return (
    <Center zIndex="$docked" w="$full" h="100vh">
      <VStack
        bgColor={bgColor()}
        rounded="$xl"
        p="24px"
        w={{
          "@initial": "90%",
          "@sm": "364px",
        }}
        spacing="$4"
      >
        <Flex alignItems="center" justifyContent="space-around">
          <Image mr="$2" boxSize="$12" src={logo()} />
          <Heading color="$info9" fontSize="$2xl">
            {t("init.title")}
          </Heading>
        </Flex>
        <Input
          name="username"
          placeholder={t("init.username-tips")}
          value={username()}
          onInput={(e) => setUsername(e.currentTarget.value)}
        />
        <Input
          name="password"
          type="password"
          placeholder={t("init.password-tips")}
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
        />
        <Input
          name="confirm_password"
          type="password"
          placeholder={t("init.confirm_password-tips")}
          value={confirmPassword()}
          onInput={(e) => setConfirmPassword(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              submit()
            }
          }}
        />
        <Input
          name="site_title"
          placeholder={t("init.site_title-tips")}
          value={siteTitle()}
          onInput={(e) => setSiteTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              submit()
            }
          }}
        />
        <Button
          colorScheme="primary"
          w="$full"
          loading={loading()}
          onClick={submit}
        >
          {t("init.setup")}
        </Button>
        <Flex
          mt="$2"
          justifyContent="space-evenly"
          alignItems="center"
          color="$neutral10"
          w="$full"
        >
          <SwitchLanguageWhite />
          <SwitchColorMode />
        </Flex>
      </VStack>
      <LoginBg />
    </Center>
  )
}

export default Init
