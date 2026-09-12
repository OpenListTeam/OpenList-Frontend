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
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js"
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

/**
 * 初始化阶段：
 *   idle    初始（第 2 步表单可编辑）
 *   creating 正在创建账号
 *   syncing  等待存储/密钥就绪
 *   done     已确认就绪（真正完成）
 *   timeout  超时未确认就绪（不谎报成功，可重试）
 */
type Phase = "idle" | "creating" | "syncing" | "done" | "timeout"

/** 向导步骤：env（环境自检）→ account（填写管理员信息）→ done（完成） */
type Step = "env" | "account" | "done"

/** 等待存储就绪的最长时间（毫秒）。超时后仍放行，由用户自行重试登录。 */
const READY_TIMEOUT_MS = 30_000
/** 轮询间隔（毫秒） */
const READY_POLL_MS = 1_000

/**
 * 存储配置文档地址（与服务端 public.ts 的 DOC_STORAGE 保持一致）。
 *
 * 自检接口自身失败时（503），我们拿不到后端随 issues 下发的 docUrl，
 * 因此这里提供一个固定的兜底链接 —— 用户此时最需要的就是「去哪看怎么配」。
 */
const STORAGE_DOC_URL =
  "https://doc.oplist.org/ecosystem/official_worker/guide_env"

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
  // 起始步骤取决于后端类型：Go 后端没有环境自检步骤，直接进账号表单。
  // 注意 isTsWorker() 依赖 /public/settings 的判定结果，而该判定可能在
  // 本组件挂载后才完成；下方 createEffect 会在类型明确后修正起始步骤。
  const [step, setStep] = createSignal<Step>(isTsWorker() ? "env" : "account")
  const [envCheck, setEnvCheck] = createSignal<EnvCheck>()
  const [envLoading, setEnvLoading] = createSignal(false)
  /**
   * 自检/状态接口失败的原因。
   *
   * 为什么需要单独保存：存储未配置时后端返回 503，`env_check` 与
   * `init_status` 都会失败。若静默吞掉，用户只会看到「面板空白 + 按钮灰掉」，
   * 完全没有可操作信息。这里保留后端给出的原始诊断（已含需要配置哪些
   * 环境变量），在向导里直接展示。
   */
  const [envError, setEnvError] = createSignal<string>()
  /**
   * 后端未能确认「是否已初始化」。
   *
   * 存储未配置时 /public/init_status 返回 503，无法判定初始化状态。
   * 此时必须留在向导页（而不是跳登录页），因为向导是修复配置的唯一入口。
   */
  const [initializedUnknown, setInitializedUnknown] = createSignal(false)

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

  /**
   * 环境是否允许进入下一步。
   *
   * 不满足时必须阻止初始化，而不是让用户填完表单再失败：
   *  - serverless（Worker）下内存存储是禁止的，写入即丢；
   *  - 拿不到自检结果（接口失败/未返回）同样视为未就绪。
   *
   * 非 TS Worker 后端没有该接口，无法自检，放行交由后端自己校验。
   */
  const canProceed = () => {
    if (!isTsWorker()) return true
    const check = envCheck()
    if (!check) return false
    // 显式拒绝内存兜底：`ready` 已隐含排除，这里显式判定是为了
    // 语义直白，并防止后端 ready 计算回归时前端跟着失效。
    if (check.storage?.memory) return false
    return Boolean(check.ready)
  }

  /**
   * 是否展示环境自检步骤。
   *
   * 只有 TS Worker 后端（OpenListNext）存在「存储未配置则无法工作」的问题，
   * 需要初始化前自检。Go 后端使用 MySQL/SQLite 等自带持久化，既没有
   * /public/env_check 接口，也不存在需要用户先修配置的场景 —— 给它展示
   * 一个永远通过、只有「请继续」的空步骤纯属噪音，因此整步跳过。
   */
  const showEnvStep = () => isTsWorker()

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
    setEnvError(undefined)
    try {
      const resp = (await r.get("/public/env_check")) as Resp<EnvCheck>
      if (resp?.code === 200 && resp.data) {
        setEnvCheck(resp.data)
      } else {
        // 非 200（典型为存储未配置的 503）：保留后端诊断原文
        setEnvCheck(undefined)
        setEnvError(resp?.message || t("init.env_check_failed"))
      }
    } catch (e: any) {
      setEnvCheck(undefined)
      setEnvError(e?.message || t("init.env_check_failed"))
    } finally {
      setEnvLoading(false)
    }
  }

  /**
   * 步骤列表：Go 后端只有「账号 → 完成」，TS Worker 多一个环境自检前置步。
   */
  const steps = createMemo<Step[]>(() =>
    showEnvStep() ? ["env", "account", "done"] : ["account", "done"],
  )

  /**
   * 后端类型判定可能在挂载后才完成（依赖 /public/settings）。
   * 若最终判定为非 TS Worker 而当前仍停在环境自检步，需把用户推进到账号步，
   * 否则会卡在一个已不再渲染的步骤上（页面空白）。
   */
  createEffect(() => {
    if (!showEnvStep() && step() === "env") {
      setStep("account")
    }
  })

  // 若系统已初始化，跳转到登录页
  onMount(async () => {
    loadEnvCheck()
    const resp = (await r.get("/public/init_status")) as Resp<InitStatus>
    if (resp?.code === 200) {
      // 已初始化 → 去登录页；未初始化 → 留在向导
      if (resp.data?.initialized === false) return
      window.location.href = base_path + "/@login"
      return
    }
    // 非 200：最典型的是存储未配置（503）。此时「是否已初始化」无从判断，
    // 绝不能跳登录页 —— 否则用户会被反复弹回，永远进不了向导。
    // 保存诊断信息并停留在此页，让用户看到问题并修正后重试。
    setEnvError(resp?.message || t("init.storage_unavailable_tip"))
    setInitializedUnknown(true)
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
        if (ready) {
          // 仅在**真正确认**后端已就绪时才进入完成态
          setPhase("done")
        } else {
          // 超时：不谎报成功，提示可重试（后端可能仍在同步）
          setPhase("timeout")
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

  /** 超时后重试：只重新等待就绪，不重复创建账号 */
  const retryReady = async () => {
    setPhase("syncing")
    const ready = await waitUntilReady()
    setPhase(ready ? "done" : "timeout")
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

        {/* 步骤指示器（Go 后端无环境自检步骤，只显示两步） */}
        <HStack w="$full" spacing="$2" justifyContent="center">
          <For each={steps()}>
            {(s, i) => (
              <HStack spacing="$1">
                <Badge
                  borderRadius="$full"
                  variant={step() === s ? "solid" : "subtle"}
                  colorScheme={
                    step() === s
                      ? "primary"
                      : steps().indexOf(step()) > i()
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

        {/* ── 第 1 步：环境自检（仅 TS Worker 后端会渲染） ── */}
        <Show when={step() === "env"}>
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

            {/*
                自检接口本身失败（最典型：存储未配置 / 绑定缺失返回 503）。

                这里刻意保持简短：后端原文是面向终端的排查材料，逐条摊开会得到
                一屏无法消化的文字，且与折叠区内容重复。改为给出「缺少存储驱动 /
                环境变量」这一句结论 + 文档链接，细节交给文档；原文折叠保留，
                仅供排查时对照。
              */}
            <Show when={!envLoading() && !envCheck() && envError()}>
              <VStack spacing="$2" alignItems="stretch">
                <HStack spacing="$2" alignItems="center">
                  <Badge colorScheme="danger" variant="subtle" flexShrink="0">
                    {t("init.storage_unavailable")}
                  </Badge>
                  <Text fontSize="$xs" color="$neutral11">
                    {t("init.storage_missing_hint")}
                  </Text>
                </HStack>

                <HStack spacing="$3" alignItems="center">
                  <Text
                    as="a"
                    fontSize="$xs"
                    color="$info11"
                    textDecoration="underline"
                    href={STORAGE_DOC_URL}
                    target="_blank"
                    rel="noopener"
                  >
                    {t("init.storage_doc_link")}
                  </Text>
                  {/* 原始诊断：默认折叠，排查时对照 */}
                  <details>
                    <summary
                      style={{
                        cursor: "pointer",
                        "font-size": "0.75rem",
                        opacity: 0.7,
                      }}
                    >
                      {t("init.storage_raw_detail")}
                    </summary>
                    <Text
                      fontSize="$xs"
                      color="$neutral11"
                      fontFamily="mono"
                      mt="$1"
                      css={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                    >
                      {envError()}
                    </Text>
                  </details>
                </HStack>
              </VStack>
            </Show>

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
                    color={envCheck()?.jwt?.ready ? "$success11" : "$danger11"}
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

          {/*
            后端未能确认初始化状态（典型：存储未配置导致 init_status 503）。
            这不是「已初始化」，明确说明并留在向导，避免用户困惑于为何
            没有自动跳转登录页。
          */}
          <Show when={initializedUnknown()}>
            <Text fontSize="$xs" color="$warning11" textAlign="center">
              {t("init.storage_unavailable_tip")}
            </Text>
          </Show>

          <Text fontSize="$xs" color="$neutral10" textAlign="center">
            {t("init.env_next_tip")}
          </Text>

          <HStack w="$full" spacing="$2">
            <Button
              variant="subtle"
              colorScheme="neutral"
              flex="1"
              loading={envLoading()}
              onClick={loadEnvCheck}
            >
              {t("init.env_check_refresh")}
            </Button>
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

            {/* 超时：不谎报成功，提示重试或直接登录 */}
            <Show when={phase() === "timeout"}>
              <VStack spacing="$3" w="$full" alignItems="center">
                <Badge colorScheme="warning" variant="subtle">
                  {t("init.timeout_title")}
                </Badge>
                <Text fontSize="$sm" color="$neutral11" textAlign="center">
                  {t("init.timeout_tip")}
                </Text>
                <HStack w="$full" spacing="$2">
                  <Button
                    variant="subtle"
                    colorScheme="neutral"
                    flex="1"
                    onClick={() => goTo("/@login")}
                  >
                    {t("init.done_go_login")}
                  </Button>
                  <Button colorScheme="primary" flex="1" onClick={retryReady}>
                    {t("init.env_check_refresh")}
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
