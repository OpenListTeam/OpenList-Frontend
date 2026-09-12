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
  Badge,
  HStack,
  Spacer,
  useColorModeValue,
  VStack,
} from "@hope-ui/solid"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { SwitchColorMode, SwitchLanguageWhite } from "~/components"
import { useLoading, useT, useTitle } from "~/hooks"
import { getSetting } from "~/store"
import { base_path, r, notify, handleRespWithoutAuthAndNotify } from "~/utils"
import { isTsWorker } from "~/utils/backend"
import {
  EmptyResp,
  EnvCheck,
  EnvCheckIssue,
  InitSetupRequest,
  InitStatus,
  Resp,
} from "~/types"
import LoginBg from "../login/LoginBg"

/** 初始化阶段：idle → creating（建号中）→ syncing（等待存储同步）→ done */
type Phase = "idle" | "creating" | "syncing" | "done"

/** 向导步骤：env（环境自检）→ account（填写管理员信息）→ done（完成） */
type Step = "env" | "account" | "done"

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
  const [step, setStep] = createSignal<Step>("env")
  const [envCheck, setEnvCheck] = createSignal<EnvCheck>()
  const [envLoading, setEnvLoading] = createSignal(false)

  /**
   * 站点地址（同源根路径）。
   *
   * base_path 由 setBasePath 归一化：以 "/" 开头、不以 "/" 结尾（可能是空串）。
   * 因此直接拼接 origin + base_path 即可，空串时即为 origin。
   */
  const siteUrl = createMemo(() => {
    if (typeof window === "undefined") return base_path || "/"
    return window.location.origin + base_path
  })

  /** 环境是否允许进入下一步：非 TS Worker（无自检接口）或自检通过 */
  const canProceed = () => {
    if (!isTsWorker()) return true
    const check = envCheck()
    return Boolean(check?.ready)
  }

  /** 环境未就绪时重新拉取自检 */
  const goNextFromEnv = () => {
    if (canProceed()) {
      setStep("account")
      return
    }
    notify.error(t("init.env_blocked_tip"))
    loadEnvCheck()
  }

  /** 拉取环境自检（仅 TS Worker 后端提供该接口） */
  const loadEnvCheck = async () => {
    if (!isTsWorker()) return
    setEnvLoading(true)
    try {
      const resp = (await r.get("/public/env_check")) as Resp<EnvCheck>
      setEnvCheck(resp?.data)
    } catch {
      // 自检失败不阻塞初始化，仅不展示面板
    } finally {
      setEnvLoading(false)
    }
  }

  // 若系统已初始化，跳转到登录页
  onMount(async () => {
    loadEnvCheck()
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
   *
   * 仅对 TS Worker 后端生效：`ready` 是该后端特有的就绪标志；
   * Go 后端使用 MySQL/SQLite 等强一致存储，无传播延迟，且不返回该字段。
   * 若不做区分，Go 环境下会白白轮询到超时并弹出误导性的失败警告。
   */
  const waitUntilReady = async (): Promise<boolean> => {
    if (!isTsWorker()) return true
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
    // 进入第 3 步并开始进度反馈
    setStep("done")
    setPhase("creating")
    const resp = await data()
    handleRespWithoutAuthAndNotify(
      resp,
      async () => {
        // 账号已创建，等待存储/密钥真正就绪
        setPhase("syncing")
        const ready = await waitUntilReady()
        setPhase("done")
        if (!ready) {
          notify.warning(t("init.waiting_timeout"))
        }
      },
      (msg) => {
        // 失败回到第 2 步，让用户修正后重试
        setPhase("idle")
        setStep("account")
        notify.error(msg || t("init.failed"))
      },
    )
  }

  const busy = () => phase() === "creating" || phase() === "syncing"

  /** 完成后跳转（整页刷新，让 App 重新挂载并读取 settings） */
  const goTo = (path: string) => {
    window.location.href = base_path + path
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

        {/* 步骤指示器 */}
        <HStack w="$full" spacing="$2" justifyContent="center">
          <For each={["env", "account", "done"] as Step[]}>
            {(s, i) => (
              <HStack spacing="$1">
                <Badge
                  borderRadius="$full"
                  variant={step() === s ? "solid" : "subtle"}
                  colorScheme={
                    step() === s
                      ? "primary"
                      : ["env", "account", "done"].indexOf(step()) > i()
                        ? "success"
                        : "neutral"
                  }
                >
                  {i() + 1}
                </Badge>
                <Text
                  fontSize="$xs"
                  color={step() === s ? "$primary11" : "$neutral10"}
                >
                  {t(`init.step_${s}`)}
                </Text>
              </HStack>
            )}
          </For>
        </HStack>

        {/* ── 第 1 步：环境自检 ── */}
        <Show when={step() === "env"}>
          <Show
            when={isTsWorker()}
            fallback={
              <Text fontSize="$sm" color="$neutral11" textAlign="center">
                {t("init.env_skip_tip")}
              </Text>
            }
          >
            <VStack
              w="$full"
              spacing="$2"
              p="$3"
              rounded="$md"
              bgColor="$neutral2"
              alignItems="stretch"
            >
              <HStack>
                <Text fontSize="$sm" fontWeight="$medium">
                  {t("init.env_check")}
                </Text>
                <Spacer />
                <Show when={envLoading()}>
                  <Spinner size="xs" color="$info9" />
                </Show>
                <Show when={!envLoading() && envCheck()}>
                  <Badge
                    colorScheme={envCheck()?.ready ? "success" : "danger"}
                    variant="subtle"
                  >
                    {envCheck()?.ready
                      ? t("init.env_check_ready")
                      : t("init.env_check_not_ready")}
                  </Badge>
                </Show>
              </HStack>

              <Show when={envCheck()}>
                <VStack spacing="$1" alignItems="stretch">
                  <HStack fontSize="$xs" color="$neutral11">
                    <Text>{t("init.env_format")}</Text>
                    <Spacer />
                    <Text fontFamily="mono">
                      {envCheck()?.config?.db_format}
                      <Show
                        when={
                          envCheck()?.config?.resolved_format &&
                          envCheck()?.config?.resolved_format !==
                            envCheck()?.config?.db_format
                        }
                      >
                        {" → " + envCheck()?.config?.resolved_format}
                      </Show>
                    </Text>
                  </HStack>
                  <HStack fontSize="$xs" color="$neutral11">
                    <Text>{t("init.env_driver")}</Text>
                    <Spacer />
                    <Text fontFamily="mono">
                      {envCheck()?.config?.db_driver}
                      <Show
                        when={
                          envCheck()?.config?.resolved_driver &&
                          envCheck()?.config?.resolved_driver !==
                            envCheck()?.config?.db_driver
                        }
                      >
                        {" → " + envCheck()?.config?.resolved_driver}
                      </Show>
                    </Text>
                  </HStack>
                  <HStack fontSize="$xs" color="$neutral11">
                    <Text>{t("init.env_runtime")}</Text>
                    <Spacer />
                    <Text>
                      {envCheck()?.runtime?.serverless
                        ? t("init.env_serverless")
                        : t("init.env_local")}
                    </Text>
                  </HStack>
                  <HStack fontSize="$xs">
                    <Text color="$neutral11">{t("init.env_storage")}</Text>
                    <Spacer />
                    <Text
                      color={
                        envCheck()?.storage?.available
                          ? "$success11"
                          : "$danger11"
                      }
                    >
                      {envCheck()?.storage?.available
                        ? t("init.env_status_ok")
                        : t("init.env_status_bad")}
                    </Text>
                  </HStack>
                  <HStack fontSize="$xs">
                    <Text color="$neutral11">{t("init.env_jwt")}</Text>
                    <Spacer />
                    <Text
                      color={
                        envCheck()?.jwt?.ready ? "$success11" : "$danger11"
                      }
                    >
                      {envCheck()?.jwt?.ready
                        ? t("init.env_status_ok")
                        : t("init.env_status_bad")}
                    </Text>
                  </HStack>
                </VStack>
              </Show>

              {/* 问题清单：每条附文档链接 */}
              <For each={envCheck()?.issues ?? []}>
                {(issue: EnvCheckIssue) => (
                  <VStack
                    spacing="$1"
                    alignItems="stretch"
                    p="$2"
                    rounded="$sm"
                    bgColor={issue.level === "error" ? "$danger3" : "$warning3"}
                  >
                    <Text fontSize="$xs" color="$neutral12">
                      {issue.message}
                    </Text>
                    <Text
                      as="a"
                      href={issue.docUrl}
                      target="_blank"
                      rel="noopener"
                      fontSize="$xs"
                      color="$info11"
                      textDecoration="underline"
                    >
                      {t("init.env_doc_link")}
                    </Text>
                  </VStack>
                )}
              </For>

              <Show when={envCheck() && !envCheck()?.ready}>
                <Text fontSize="$xs" color="$danger11">
                  {t("init.env_blocked_tip")}
                </Text>
              </Show>
            </VStack>
          </Show>

          <Text fontSize="$xs" color="$neutral10" textAlign="center">
            {t("init.env_next_tip")}
          </Text>

          <HStack w="$full" spacing="$2">
            <Show when={isTsWorker()}>
              <Button
                variant="subtle"
                colorScheme="neutral"
                flex="1"
                loading={envLoading()}
                onClick={loadEnvCheck}
              >
                {t("init.env_check_refresh")}
              </Button>
            </Show>
            <Button
              colorScheme="primary"
              flex="2"
              disabled={!canProceed()}
              onClick={goNextFromEnv}
            >
              {t("init.env_continue")}
            </Button>
          </HStack>
        </Show>

        {/* ── 第 2 步：填写管理员信息 ── */}
        <Show when={step() === "account"}>
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
          <HStack w="$full" spacing="$2">
            <Button
              variant="subtle"
              colorScheme="neutral"
              flex="1"
              onClick={() => setStep("env")}
            >
              {t("init.back")}
            </Button>
            <Button colorScheme="primary" flex="2" onClick={submit}>
              {t("init.setup")}
            </Button>
          </HStack>
        </Show>

        {/* ── 第 3 步：初始化进度与完成 ── */}
        <Show when={step() === "done"}>
          <VStack spacing="$4" w="$full" py="$4">
            <Show when={busy()}>
              <VStack spacing="$3" w="$full" alignItems="center">
                <Spinner size="lg" color="$info9" />
                <Progress w="$full" size="xs" indeterminate />
                <Text fontSize="$sm" color="$neutral11">
                  {phase() === "creating"
                    ? t("init.creating_account")
                    : t("init.waiting_storage")}
                </Text>
                <Text fontSize="$xs" color="$neutral10" textAlign="center">
                  {phase() === "creating"
                    ? t("init.finalizing_tip")
                    : t("init.waiting_storage_tip")}
                </Text>
              </VStack>
            </Show>

            {/* 完成：展示用户名与站点地址，提供进入后台/首页按钮 */}
            <Show when={phase() === "done"}>
              <VStack spacing="$3" w="$full" alignItems="center">
                <Badge colorScheme="success" variant="subtle">
                  {t("init.done_title")}
                </Badge>
                <Text fontSize="$sm" color="$neutral11" textAlign="center">
                  {t("init.done_subtitle")}
                </Text>

                <VStack
                  spacing="$2"
                  w="$full"
                  p="$3"
                  rounded="$md"
                  bgColor="$neutral2"
                  alignItems="stretch"
                >
                  <HStack fontSize="$sm">
                    <Text color="$neutral11">{t("init.done_username")}</Text>
                    <Spacer />
                    <Text fontFamily="mono" fontWeight="$medium">
                      {username()}
                    </Text>
                  </HStack>
                  <HStack fontSize="$sm">
                    <Text color="$neutral11">{t("init.done_site_url")}</Text>
                    <Spacer />
                    <Text
                      as="a"
                      href={siteUrl()}
                      target="_blank"
                      rel="noopener"
                      fontFamily="mono"
                      color="$info11"
                      textDecoration="underline"
                    >
                      {siteUrl()}
                    </Text>
                  </HStack>
                </VStack>

                <HStack w="$full" spacing="$2">
                  <Button
                    variant="subtle"
                    colorScheme="neutral"
                    flex="1"
                    onClick={() => goTo("/")}
                  >
                    {t("init.done_go_home")}
                  </Button>
                  <Button
                    colorScheme="primary"
                    flex="1"
                    onClick={() => goTo("/@login")}
                  >
                    {t("init.done_go_login")}
                  </Button>
                </HStack>
              </VStack>
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
