# PR: 系统初始化向导（System Setup Wizard）

> 分支：`feat/init-storage-progress` → `main`
> 提交范围：`5cc21c1`、`33f5221`、`75867ff`、`1cc6698`
> 改动文件：`src/pages/init/index.tsx`、`src/types/init.ts`、`src/lang/en/init.json`

---

## 1. 背景与动机（Why）

此前 OpenList 的首次初始化只有一屏表单：填写管理员账号、点击提交，然后就**没有任何反馈**，直接跳转登录页。

这在 **OpenListNext（TSWorker / Cloudflare Workers）后端**上会产生两个真实且高频的问题：

1. **「密码错误」误报**
   云端 KV 存储是**最终一致性**的。`/public/init/setup` 写入管理员凭据与 JWT 密钥后，密钥可能尚未传播到其它边缘实例；此时前端立刻跳转登录并提交，请求落到另一个实例会读不到密钥，从而被判定为密码错误。用户完全无从判断这是「等待几秒就好」还是「真的填错了」。

2. **环境配错只能靠猜**
   Serverless 部署下 `DB_DRIVER` / `DB_FORMAT` / KV 绑定 / JWT 密钥来源任意一项配置错误，都会让初始化在**服务端静默失败或半成功**。前端缺少任何前置自检手段，用户只能反复试错，且几乎没有可执行的下一步指引。

Go 后端因为是 MySQL / SQLite 等强一致存储，不存在传播延迟，但同样存在「环境配错无反馈」的问题。

**本 PR 的目标**：把初始化从「一次性盲提交」升级为一个 **三步向导**，让用户在动手之前就知道环境能不能撑住、在提交之后能明确知道「什么时候可以登录」。

---

## 2. 用户可感知的变化（What）

### 2.1 三步向导

初始化页面从单屏表单改为带步骤指示器的三步流程：

| 步骤 | 名称                   | 内容                                                                                                |
| ---- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| 1    | `env` · 环境自检       | 展示运行时、存储格式/驱动（含实际解析结果）、存储可用性、JWT 密钥就绪状态；列出阻塞问题并附文档链接 |
| 2    | `account` · 管理员账号 | 用户名、密码、确认密码、站点标题；支持回车提交                                                      |
| 3    | `done` · 完成          | 实时进度反馈 → 展示管理员用户名与站点地址 → 「进入首页 / 前往登录」                                 |

顶部步骤指示器会区分 **当前步骤**（实心 primary）、**已完成步骤**（success）与未开始步骤（neutral）。

### 2.2 提交后的进度反馈

点击「初始化」后不再是无反馈跳转，而是进入第 3 步并显示两个阶段：

- `creating` — 正在创建管理员账号（`Spinner` + 不确定进度条 + 「请保持页面打开」提示）
- `syncing` — 正在等待存储同步（仅 TS Worker 后端会出现）

### 2.3 存储就绪轮询（核心修复）

- 账号创建成功后，前端轮询 `/public/init_status`，直到后端明确返回 `ready: true`，**才**允许用户去登录。
- 轮询间隔 **1s**，最长 **30s**（`READY_TIMEOUT_MS`）。
- **超时不阻塞**：超时后仍然放行到完成页，只给出一条 warning（「存储同步超时，可先尝试登录，若失败请稍后重试」）。
- 轮询期间的单次请求失败被静默忽略，不会中断流程。

### 2.4 完成页

展示 **管理员用户名** 与 **站点地址**（`window.location.origin + base_path`，可点击新窗口打开），并提供「进入首页」「前往登录」两个整页跳转按钮（整页刷新以便 `App` 重新挂载并读取最新 settings）。

### 2.5 完成后跳转使用整页刷新

`goTo()` 使用 `window.location.href` 而非路由 `to()`，确保 App 完整重新挂载并重新拉取 `/public/settings` 与 `/public/init_status`，避免客户端路由状态残留导致的**重定向死循环**。

---

## 3. 双后端兼容设计（重要）

这是本 PR 中**最容易踩坑**的部分：向导中的环境自检与就绪轮询**都是 TS Worker 后端独有的能力**，Go 后端既不提供 `/public/env_check`，也不返回 `init_status.ready` 字段。

前端通过 `~/utils/backend` 的 `isTsWorker()` 做能力分支，保证 Go 后端行为**与改动前完全一致**：

| 能力                 | TS Worker                   | Go 后端                                             |
| -------------------- | --------------------------- | --------------------------------------------------- |
| 第 1 步环境自检面板  | 展示面板 + 「重新检测」按钮 | 展示 `env_skip_tip` 文案，无检测按钮                |
| 「继续」按钮可用条件 | `envCheck.ready === true`   | 恒为可用                                            |
| 存储就绪轮询         | 轮询至 `ready` 或超时       | **完全跳过**，`waitUntilReady()` 直接 `return true` |
| 超时 warning         | 可能弹出                    | **不会弹出**                                        |

> 若不做 `isTsWorker()` 分支，Go 环境会因为拿不到 `ready` 字段而**白白轮询 30 秒**，并在结束时弹出误导性的失败警告 —— 这正对应提交 `33f5221 fix(init): skip storage-readiness wait on Go backend` 所修复的问题。

---

## 4. 实现要点（How）

### 4.1 状态机

用两个正交状态替代原来的单一 loading 标志：

```ts
/** 初始化阶段：idle → creating（建号中）→ syncing（等待存储同步）→ done */
type Phase = "idle" | "creating" | "syncing" | "done"

/** 向导步骤：env（环境自检）→ account（填写管理员信息）→ done（完成） */
type Step = "env" | "account" | "done"
```

`busy()` 派生自 `phase()`，用于第 3 步区分「进行中」与「已完成」两种渲染。

### 4.2 环境自检懒加载

- `onMount` 中调用 `loadEnvCheck()`（仅 TS Worker 生效），与 `/public/init_status` 检查并行。
- 自检请求**失败不阻塞初始化**，仅不展示面板（catch 后静默）。
- 「继续」按钮在环境未就绪时**保持可点击**，点击后 `notify.error(env_blocked_tip)` 并**重新拉取**一次自检 —— 让用户在修好服务端配置后可以原地重试，不必刷新页面。

### 4.3 失败回退

`handleRespWithoutAuthAndNotify` 的失败回调中：

```ts
setPhase("idle")
setStep("account") // 回到第 2 步，保留已填内容
notify.error(msg || t("init.failed"))
```

用户修正后可直接重试，无需重新填写表单。

### 4.4 环境自检数据契约

新增 `EnvCheck` 类型（`src/types/init.ts`），对接后端 `/public/env_check`：

```ts
export interface EnvCheck {
  runtime: { serverless: boolean; platform: string | null }
  config: {
    db_format: string // 配置的存储格式（map / key / sql）
    db_driver: string // 配置的驱动（auto / blob / kv / ...）
    resolved_format: string | null // 实际解析后的格式
    resolved_driver: string | null // 实际解析后的驱动
  }
  storage: {
    available: boolean
    configured: boolean | null
    connected: boolean | null
    platform: string | null
  }
  jwt: { ready: boolean; source: string } // source 仅为来源类型，不含任何密钥值
  ready: boolean
  issues: EnvCheckIssue[]
  docUrl: string
}
```

同时在 `InitStatus` 上新增可选字段 `ready?: boolean`，作为 KV 最终一致性的就绪标志：

```ts
export interface InitStatus {
  initialized: boolean
  /** 后端加解密密钥是否已在真实来源可读（KV 最终一致性的就绪标志） */
  ready?: boolean
}
```

UI 上，当 `resolved_*` 与配置值不同时，会以 `配置值 → 实际解析值` 的形式展示，让用户一眼看出实际生效的驱动/格式。

### 4.5 安全

- `jwt.source` 仅暴露**来源类型**，UI 不展示也不接收任何密钥值。
- 自检面板中的问题清单只输出后端给的 `message`，并附带 `docUrl` 外链（`target="_blank" rel="noopener"`）。

---

## 5. 兼容性与风险

| 项                      | 说明                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| **破坏性变更**          | 无                                                                       |
| **公开 API 变更**       | 无（仅前端消费已有的 `/public/env_check`、`/public/init_status`）        |
| **配置 / 存储格式变更** | 无                                                                       |
| **关联仓库同步**        | 否                                                                       |
| **Go 后端行为差异**     | 无（通过 `isTsWorker()` 全量分支隔离）                                   |
| **未知后端 / 接口缺失** | `/public/init_status` 不可用时回退跳转登录页；`env_check` 失败仅隐藏面板 |
| **超时兜底**            | 30s 上限 + 超时放行 + warning 提示，不会把用户卡死在向导里               |

---

## 6. i18n

`src/lang/en/init.json` 新增 40 条文案（其余语言由 Crowdin 同步）：

- 向导与步骤：`step_env`、`step_account`、`step_done`、`back`、`env_continue`、`env_next_tip`、`env_skip_tip`
- 环境自检：`env_check`、`env_check_ready`、`env_check_not_ready`、`env_check_refresh`、`env_runtime`、`env_serverless`、`env_local`、`env_format`、`env_driver`、`env_resolved`、`env_storage`、`env_jwt`、`env_status_ok`、`env_status_bad`、`env_doc_link`、`env_blocked_tip`
- 进度与完成：`finalizing`、`finalizing_tip`、`done_title`、`done_subtitle`、`done_username`、`done_site_url`、`done_go_login`、`done_go_home`

> `env_resolved` 与 `env_check_loading` 已在语言包中预留；当前 UI 直接以 `原始值 → 解析值` 内联展示，条目保留供后续使用。

---

## 7. 测试建议（Testing）

### 7.1 手动验证矩阵

| #   | 场景                                       | 预期                                                                            |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| 1   | Go 后端，未初始化                          | 第 1 步显示 `env_skip_tip`，无检测按钮；「继续」直接可用                        |
| 2   | Go 后端，提交成功                          | 短暂 `creating` → 直接 `done`，**不出现 syncing、无 30s 轮询、无超时警告**      |
| 3   | TS Worker，环境就绪                        | 自检面板绿色 Ready，「继续」可用                                                |
| 4   | TS Worker，`DB_DRIVER` 配错                | 自检红色 Not Ready，问题清单列出原因 + 文档链接；「继续」被阻止；点击后重新自检 |
| 5   | TS Worker，`resolved_driver !== db_driver` | 展示 `kv → blob` 形式，用户可见实际生效驱动                                     |
| 6   | TS Worker，KV 传播延迟                     | `creating` → `syncing` 轮询 → `ready` 后进入完成页                              |
| 7   | TS Worker，KV 长时间不就绪                 | 30s 后进入完成页 + warning「存储同步超时…」                                     |
| 8   | 提交失败（如用户名已存在）                 | 回到第 2 步，**已填内容保留**，错误提示可见                                     |
| 9   | 已初始化后访问 `/@init`                    | `onMount` 检测到 `initialized !== false`，整页跳 `/@login`                      |
| 10  | 全局路由守卫                               | 未初始化时访问任意路径 → 自动 `to("/@init", true)`                              |
| 11  | 完成页跳转                                 | 「进入首页 / 前往登录」整页刷新，无重定向死循环                                 |
| 12  | 密码校验                                   | < 4 位报 `password_too_short`；两次不一致报 `password_mismatch`                 |

### 7.2 建议执行的检查

```bash
pnpm lint
pnpm build      # 验证类型与构建产物
pnpm dev        # 手动跑上述矩阵
```

---

## 8. 涉及文件清单

| 文件                       | 变更                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| `src/pages/init/index.tsx` | 重构为三步向导（+514 / -51）                                          |
| `src/types/init.ts`        | 新增 `EnvCheck` / `EnvCheckIssue`；`InitStatus` 增加 `ready?` （+42） |
| `src/lang/en/init.json`    | 新增向导、自检、完成页文案（+40）                                     |

**依赖的前置改动**（来自基线分支 `feat/init-setup`，**不在本 PR 范围内**）：

- `src/utils/backend.ts` — 后端类型探测（`isTsWorker` / `isGo`）
- `src/app/App.tsx` — `/@init` 路由注册与未初始化自动跳转
- `src/store/settings.ts` — `setSettings()` 中调用 `setBackendKind()`
- `src/types/index.ts` — 导出 `./init`

---

## 9. Checklist

- [x] 无破坏性变更
- [x] 无公开 API / 配置 / 存储格式变更
- [x] 无需关联仓库同步修改
- [x] Go 与 TS Worker 双后端行为均已覆盖
- [x] 已补充英文文案（其余语言待 Crowdin 同步）
- [x] 已按 prettier 格式化
- [ ] 手动测试矩阵全部通过（待执行）
- [ ] 关联文档已补充环境自检与 `ready` 语义说明

---

## 10. 提交记录

| Commit    | 说明                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `5cc21c1` | `feat(init): show progress while waiting for storage to sync` — 引入 `creating` / `syncing` 阶段与就绪轮询       |
| `33f5221` | `fix(init): skip storage-readiness wait on Go backend` — 用 `isTsWorker()` 隔离，避免 Go 环境空转 30s 与误报超时 |
| `75867ff` | `feat(init): show environment readiness before setup` — 新增第 1 步环境自检面板与问题清单                        |
| `1cc6698` | `feat(init): turn setup into a three-step wizard` — 整合为三步向导 + 完成页 + 整页跳转                           |
