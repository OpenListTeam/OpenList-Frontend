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
import {
  EmptyResp,
  InitSetupError,
  InitSetupRequest,
  InitStatus,
  Resp,
} from "~/types"
import LoginBg from "../login/LoginBg"
import EnvCheck, { useEnvCheck } from "./EnvCheck"

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
 * 初始化向导的 logo 兜底地址。
 *
 * 为什么不能直接用 getSetting("logo")：初始化阶段 /public/settings 会被后端
 * 以 503 拦截（存储未绑定），settings store 始终为空，于是 logo 解析成空串，
 * <Image src=""> 渲染出一个 src 为空的 <img>（浏览器还会把当前页 URL 当作
 * src 再请求一次，控制台报错）。
 *
 * 这里改用 CDN 上的绝对地址：不依赖后端、不依赖 settings，且初始化页面必然
 * 处在「还没配置好站点设置」的状态，用官方 logo 是唯一确定的选项。
 */
const INIT_LOGO_FALLBACK = "https://res.oplist.org/logo/logo.png"

/**
 * 解析配置中的 logo 列表（首行亮色、末行暗色）。
 *
 * 历史实现写作 `getSetting("logo").split("\n")` 然后用 `logos.pop()` 取暗色
 * 值 —— `pop()` 会**改写数组**，且空/单行配置时取到 undefined。这里统一
 * 过滤空行后返回，由调用方做兜底。
 */
const resolveLogos = (): string[] =>
  getSetting("logo")
    .split("\n")
    .map((i) => i.trim())
    .filter(Boolean)

const Init = () => {
  // 用户已配置 logo 时优先用配置值（多行时首行为亮色、末行为暗色）；
  // 初始化阶段 settings 为空 -> 回退到绝对地址，避免空 src。
  const logos = resolveLogos()
  const logo = useColorModeValue(
    logos[0] ?? INIT_LOGO_FALLBACK,
    logos[logos.length - 1] ?? INIT_LOGO_FALLBACK,
  )
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
  const env = useEnvCheck()
  /**
   * 上一次初始化失败的具体原因（来自 /public/init/setup 的 data.code/reason）。
   *
   * 失败时会把用户带回第 2 步，必须在这里持续展示原因 —— 只弹一条 toast
   * 会一闪而过，用户既不知道错在哪，也不知道该改什么。
   */
  const [failure, setFailure] = createSignal<InitSetupError | null>(null)
  /**
   * 后端自报的基础设施问题（存储配置不可用 / 读库失败）。
   *
   * 与 env_check 的 issues 互补：env_check 回答「配置是否正确」，这里回答
   * 「后端能不能读」。两者可能单独出现，因此都要展示，否则用户只会看到
   * 「未初始化」加一个没有原因的 500。
   */
  const [storageIssue, setStorageIssue] = createSignal<string | null>(null)
  /**
   * 上述问题的修复建议（「改什么」）。
   *
   * 后端单独给出而不是让前端解析原因文案：原因会被截断（多行说明只透传前
   * 3 行），而用户最需要的是下一步动作，因此这里单独成行展示。
   */
  const [storageSuggestion, setStorageSuggestion] = createSignal<string | null>(
    null,
  )

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
   * 不满足时必须阻止初始化，而不是让用户填完表单再失败：serverless 下内存
   * 存储重启即丢，而 ready 拿不到（接口失败）同样视为未就绪。
   * 后端不提供自检接口（Go）时无法自检，放行交由后端自己校验。
   */
  const canProceed = () => !env.supported() || env.ready()

  /**
   * 环境自检步骤是否渲染。
   *
   * 以「能否取到 /public/env_check」为准，而非 isTsWorker()：后者依赖
   * /public/settings，存储未绑定时该接口不可用，会让判定停留在 Go 后端，
   * 导致自检步骤整步消失 —— 恰恰是最需要它的时候。
   * Go 后端未注册该路由，探测自然失败、步骤不显示，符合预期。
   */
  const showEnvStep = env.supported

  /** 环境就绪时进入下一步，否则重新拉取自检 */
  const goNextFromEnv = () => {
    if (canProceed()) {
      setStep("account")
    } else {
      env.refresh()
    }
  }

  /**
   * 步骤列表：后端无自检能力时只有「账号 → 完成」。
   */
  const steps = createMemo<Step[]>(() =>
    showEnvStep() ? ["env", "account", "done"] : ["account", "done"],
  )

  /**
   * 探测完成后若后端不支持自检，把停留在自检步的用户推进到账号步，
   * 否则会卡在一个已不再渲染的步骤上（页面空白）。
   */
  createEffect(() => {
    if (!env.loading() && !env.supported() && step() === "env") {
      setStep("account")
    }
  })

  // 首屏探测自检能力；若系统已初始化则跳转登录页
  onMount(async () => {
    env.refresh()
    const resp = (await r.get("/public/init_status")) as Resp<InitStatus>
    // 后端自报的存储问题（TS Worker 后端）：直接展示，否则用户只能看到
    // 「未初始化」，然后在提交时收到一个没有原因的 500。
    setStorageIssue(
      resp?.data?.storage_error || resp?.data?.db_load_error || null,
    )
    setStorageSuggestion(resp?.data?.storage_suggestion ?? null)
    // init_status 在诊断豁免名单中，存储未绑定时同样返回 200 且
    // initialized 为 false —— 即「未初始化」，应留在向导。
    // 只有明确「已初始化」才跳登录页，否则会把用户从唯一能修复配置的
    // 地方反复弹走。
    if (resp?.code === 200 && resp.data?.initialized !== false) {
      window.location.href = base_path + "/@login"
    }
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
    // 后端无自检能力（Go，无该路由）时无需等待存储同步，直接放行
    if (!env.supported()) return true
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
    // 失败时先取出后端给出的具体原因（data.code / data.reason），
    // 供第 2 步持续展示；成功则清掉上一次的失败信息。
    if ((resp as any)?.code !== 200) {
      const detail = (resp as any)?.data as InitSetupError | null
      setFailure({
        code: detail?.code,
        summary: detail?.summary ?? null,
        reason: detail?.reason || (resp as any)?.message,
        suggestion: detail?.suggestion ?? null,
      })
    } else {
      setFailure(null)
    }
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

        {/*
          后端自报的存储问题（来自 /public/init_status）。

          第 1 步不展示：那一屏的环境自检面板已经把同一条问题连同「怎么改」和
          文档链接列出来了，同一个事实在一屏出现两次会让人以为出了两个问题。
          第 2/3 步自检面板不可见，这里继续作为提醒（否则用户只看到「未初始化」
          却看不到原因）。
          说明：后端无自检能力时（showEnvStep 为 false）第 1 步也不会渲染面板，
          此时横幅照常展示。
        */}
        <Show when={storageIssue() && (!showEnvStep() || step() !== "env")}>
          <VStack
            spacing="$1"
            w="$full"
            p="$3"
            rounded="$md"
            bgColor="$danger3"
            alignItems="stretch"
          >
            <Text fontSize="$xs" fontWeight="$medium" color="$neutral12">
              {t("init.storage_issue_title")}
            </Text>
            <Text fontSize="$xs" color="$neutral12">
              {storageIssue()}
            </Text>
            <Show when={storageSuggestion()}>
              <Text fontSize="$xs" fontWeight="$medium" color="$neutral12">
                {t("init.env_fix_title")}
              </Text>
              <Text fontSize="$xs" color="$neutral12">
                {storageSuggestion()}
              </Text>
            </Show>
            <Text fontSize="$xs" color="$neutral10">
              {t("init.storage_issue_hint")}
            </Text>
          </VStack>
        </Show>

        {/*
          说明：这里不再有「存储降级告警」横幅 —— 显式配置的驱动不可用时后端
          直接报错（不换后端），由上面的问题横幅 + 环境自检面板展示原因与建议。
        */}

        {/* ── 第 1 步：环境自检（仅 TS Worker 后端会渲染） ── */}
        <Show when={step() === "env"}>
          <EnvCheck
            check={env.check}
            loading={env.loading}
            failed={env.failed}
          />

          {/* 就绪时才提「下一步做什么」；未就绪时面板里已有
              「Resolve the issues above to continue」，两句话意思重复 */}
          <Show when={canProceed()}>
            <Text fontSize="$xs" color="$neutral10" textAlign="center">
              {t("init.env_next_tip")}
            </Text>
          </Show>

          <HStack w="$full" spacing="$2">
            <Button
              variant="subtle"
              colorScheme="neutral"
              flex="1"
              loading={env.loading()}
              onClick={env.refresh}
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
          {/* 上一次初始化的失败原因（来自后端 data.code/data.reason） */}
          <Show when={failure()}>
            <VStack
              spacing="$1"
              w="$full"
              p="$3"
              rounded="$md"
              bgColor="$danger3"
              alignItems="stretch"
            >
              <Text fontSize="$xs" fontWeight="$medium" color="$neutral12">
                {t("init.error_title")}
              </Text>
              {/* 只展示一行短原因：reason 是多行/可能被截断的完整说明，留给排查 */}
              <Text fontSize="$xs" color="$neutral12">
                {failure()?.summary || failure()?.reason || t("init.failed")}
              </Text>
              <Show when={failure()?.suggestion}>
                <Text fontSize="$xs" fontWeight="$medium" color="$neutral12">
                  {t("init.env_fix_title")}
                </Text>
                <Text fontSize="$xs" color="$neutral12">
                  {failure()?.suggestion}
                </Text>
              </Show>
              <Show when={failure()?.code}>
                <HStack fontSize="$xs">
                  <Text color="$neutral11">{t("init.error_code")}</Text>
                  <Spacer />
                  <Text fontFamily="mono" color="$neutral11">
                    {failure()?.code}
                  </Text>
                </HStack>
              </Show>
            </VStack>
          </Show>
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
