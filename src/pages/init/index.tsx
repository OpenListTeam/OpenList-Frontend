import {
  Image,
  Center,
  Flex,
  Heading,
  Input,
  Button,
  Progress,
  Text,
  Spinner,
  useColorModeValue,
  VStack,
} from "@hope-ui/solid"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { SwitchColorMode, SwitchLanguageWhite } from "~/components"
import { useLoading, useT, useTitle } from "~/hooks"
import { getSetting } from "~/store"
import { base_path, r, notify, handleRespWithoutAuthAndNotify } from "~/utils"
import { EmptyResp, InitSetupRequest, InitStatus, Resp } from "~/types"
import LoginBg from "../login/LoginBg"

/** 初始化阶段：idle → creating（建号中）→ syncing（等待存储同步）→ done */
type Phase = "idle" | "creating" | "syncing" | "done"

/** 等待存储就绪的最长时间（毫秒）。超时后仍放行，由用户自行重试登录。 */
const READY_TIMEOUT_MS = 30_000
/** 轮询间隔（毫秒） */
const READY_POLL_MS = 1_000

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
  const [phase, setPhase] = createSignal<Phase>("idle")

  // 若系统已初始化，跳转到登录页
  onMount(async () => {
    try {
      const resp = (await r.get("/public/init_status")) as Resp<InitStatus>
      if (resp?.data?.initialized === false) {
        return
      }
    } catch {
      // 状态接口不可用时回退到登录页。
    }
    // 已初始化或状态接口不可用时回退到登录页。
    window.location.href = base_path + "/@login"
  })

  const [loading, data] = useLoading<EmptyResp>(() =>
    r.post<EmptyResp, EmptyResp, InitSetupRequest>("/public/init/setup", {
      username: username(),
      password: password(),
      site_title: siteTitle(),
    }),
  )

  /**
   * 轮询 /public/init_status 直到后端报告 ready（密钥在真实来源可读）。
   *
   * 为什么需要：云端 KV 存在最终一致性，setup 写入密钥后可能尚未传播。
   * 若立即跳转登录，请求落在另一个实例会读不到密钥，导致「密码错误」。
   * 等待后端明确确认就绪，可彻底避免这次误判。
   */
  const waitUntilReady = async (): Promise<boolean> => {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      try {
        const resp = (await r.get("/public/init_status")) as Resp<InitStatus>
        if (resp?.data?.ready) return true
      } catch {
        // 忽略瞬时错误，继续轮询
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
    }
    return false
  }

  const submit = async () => {
    if (password().length < 4) {
      notify.error(t("init.password_too_short"))
      return
    }
    if (password() !== confirmPassword()) {
      notify.error(t("init.password_mismatch"))
      return
    }
    setPhase("creating")
    const resp = await data()
    handleRespWithoutAuthAndNotify(
      resp,
      async () => {
        // 账号已创建，进入等待存储同步阶段
        setPhase("syncing")
        const ready = await waitUntilReady()
        setPhase("done")
        if (ready) {
          notify.success(t("init.success"))
        } else {
          notify.warning(t("init.waiting_timeout"))
        }
        // 整页刷新跳转登录页，让 App 重新挂载并读取 init_status / settings
        window.location.href = base_path + "/@login"
      },
      (msg) => {
        setPhase("idle")
        notify.error(msg || t("init.failed"))
      },
    )
  }

  const busy = () => phase() === "creating" || phase() === "syncing"

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
          loading={busy()}
          disabled={busy()}
          onClick={submit}
        >
          {t("init.setup")}
        </Button>
        <Show when={busy()}>
          <VStack spacing="$2" w="$full" pt="$2">
            <Progress w="$full" size="xs" indeterminate />
            <Flex alignItems="center" w="$full">
              <Spinner size="xs" mr="$2" color="$info9" />
              <Text fontSize="$sm" color="$neutral11">
                {phase() === "creating"
                  ? t("init.creating_account")
                  : t("init.waiting_storage")}
              </Text>
            </Flex>
            <Show when={phase() === "syncing"}>
              <Text fontSize="$xs" color="$neutral10" textAlign="center">
                {t("init.waiting_storage_tip")}
              </Text>
            </Show>
          </VStack>
        </Show>
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
