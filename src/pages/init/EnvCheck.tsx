import { Badge, HStack, Spacer, Spinner, Text, VStack } from "@hope-ui/solid"
import { Accessor, createSignal, For, JSX, Show } from "solid-js"
import { useT } from "~/hooks"
import { EnvCheck as EnvCheckData, EnvCheckIssue, Resp } from "~/types"
import { r } from "~/utils"

/** 各平台部署教程：对照绑定存储驱动 */
const DEPLOY_DOCS = [
  {
    label: "CF Worker",
    url: "https://doc.oplist.org/ecosystem/official_worker/guide_cfw",
  },
  {
    label: "EdgeOne",
    url: "https://doc.oplist.org/ecosystem/official_worker/guide_eom",
  },
  {
    label: "ESA",
    url: "https://doc.oplist.org/ecosystem/official_worker/guide_esa",
  },
]

/** 拿不到自检结果时各项的占位符 */
const UNKNOWN = "-"

/**
 * 环境自检状态（仅 TS Worker 后端提供 /public/env_check）。
 *
 * Go 后端用 MySQL/SQLite 自带持久化，既没有该接口，也不存在「先修配置才能
 * 初始化」的场景，故由调用方决定是否调用。
 */
export const useEnvCheck = () => {
  const [check, setCheck] = createSignal<EnvCheckData>()
  const [loading, setLoading] = createSignal(false)
  /** 接口不可用（最典型：存储未绑定返回 503）——仍需渲染骨架而非整块消失 */
  const [failed, setFailed] = createSignal(false)

  const refresh = async () => {
    setLoading(true)
    setFailed(false)
    try {
      const resp = (await r.get("/public/env_check")) as Resp<EnvCheckData>
      if (resp?.code === 200 && resp.data) {
        setCheck(resp.data)
      } else {
        // 非 200：后端无法给出各项状态，但仍保留面板骨架，
        // 让用户看到「检查了哪些项、哪项没过」。
        setCheck(undefined)
        setFailed(true)
      }
    } catch {
      setCheck(undefined)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  /** 环境是否允许继续：ready 为真才放行 */
  const ready = () => Boolean(check()?.ready)

  return { check, loading, failed, refresh, ready }
}

/** 解析值：与配置值不同时以 `配置值 → 解析值` 展示 */
const Resolved = (props: { raw?: string | null; actual?: string | null }) => (
  <>
    {props.raw || UNKNOWN}
    <Show when={props.actual && props.actual !== props.raw}>
      {" → " + props.actual}
    </Show>
  </>
)

/** 一行「标签 —— 值」；传 ok 时按状态着色，否则用等宽字体 */
const Row = (props: { label: string; ok?: boolean; children: JSX.Element }) => (
  <HStack fontSize="$xs">
    <Text color="$neutral11">{props.label}</Text>
    <Spacer />
    <Text
      fontFamily={props.ok === undefined ? "mono" : undefined}
      color={
        props.ok === undefined
          ? undefined
          : props.ok
            ? "$success11"
            : "$danger11"
      }
    >
      {props.children}
    </Text>
  </HStack>
)

/**
 * 环境自检面板（纯展示）。
 *
 * 状态由 useEnvCheck 提供，调用方据此判断能否进入下一步。
 */
const EnvCheck = (props: {
  check: Accessor<EnvCheckData | undefined>
  loading: Accessor<boolean>
  failed: Accessor<boolean>
}) => {
  const t = useT()
  const status = (ok?: boolean) =>
    ok ? t("init.env_status_ok") : t("init.env_status_bad")

  return (
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
        <Show when={props.loading()}>
          <Spinner size="xs" color="$info9" />
        </Show>
        <Show when={!props.loading() && (props.check() || props.failed())}>
          <Badge
            colorScheme={props.check()?.ready ? "success" : "danger"}
            variant="subtle"
          >
            {props.check()?.ready
              ? t("init.env_check_ready")
              : t("init.env_check_not_ready")}
          </Badge>
        </Show>
      </HStack>

      {/* 骨架始终渲染：接口不可用时各行显示占位符，让用户看到检查了哪些项 */}
      <Show when={props.check() || (!props.loading() && props.failed())}>
        <VStack spacing="$1" alignItems="stretch">
          <Row label={t("init.env_format")}>
            <Resolved
              raw={props.check()?.config.db_format}
              actual={props.check()?.config.resolved_format}
            />
          </Row>
          <Row label={t("init.env_driver")}>
            <Resolved
              raw={props.check()?.config.db_driver}
              actual={props.check()?.config.resolved_driver}
            />
          </Row>
          <Row label={t("init.env_runtime")}>
            {props.check()
              ? props.check()?.runtime.serverless
                ? t("init.env_serverless")
                : t("init.env_local")
              : UNKNOWN}
          </Row>
          <Row
            label={t("init.env_storage")}
            ok={props.check()?.storage.available}
          >
            {status(props.check()?.storage.available)}
          </Row>
          <Row label={t("init.env_jwt")} ok={props.check()?.jwt.ready}>
            {status(props.check()?.jwt.ready)}
          </Row>
        </VStack>
      </Show>

      {/* 问题清单：每条附文档链接 */}
      <For each={props.check()?.issues ?? []}>
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

      <Show when={props.check() && !props.check()?.ready}>
        <Text fontSize="$xs" color="$danger11">
          {t("init.env_blocked_tip")}
        </Text>
      </Show>

      {/* 部署教程：按平台直达，方便用户对照绑定存储 */}
      <HStack spacing="$3" pt="$1" flexWrap="wrap">
        <Text fontSize="$xs" color="$neutral11">
          {t("init.env_deploy_docs")}
        </Text>
        <For each={DEPLOY_DOCS}>
          {(doc) => (
            <Text
              as="a"
              fontSize="$xs"
              color="$info11"
              textDecoration="underline"
              href={doc.url}
              target="_blank"
              rel="noopener"
            >
              {doc.label}
            </Text>
          )}
        </For>
      </HStack>
    </VStack>
  )
}

export default EnvCheck
