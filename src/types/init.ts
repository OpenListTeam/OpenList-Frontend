export interface InitSetupRequest {
  username: string
  password: string
  site_title: string
}

/**
 * 后端「存储配置错误」错误码（TSWorker backend/index.ts 全局中间件）。
 *
 * 存储不可用时，后端对所有依赖持久化的接口返回 503 + data.error 为该值。
 * Go 后端不会返回它，故也可用于反推后端类型。
 */
export const STORAGE_CONFIG_ERROR = "STORAGE_CONFIG_ERROR"

export interface InitStatus {
  initialized: boolean
  /** 后端加解密密钥是否已在真实来源可读（KV 最终一致性的就绪标志） */
  ready?: boolean
}

/** 初始化前环境自检项 */
export interface EnvCheckIssue {
  code: string
  level: "error" | "warning"
  message: string
  docUrl: string
}

/** 初始化前环境自检结果（/public/env_check） */
export interface EnvCheck {
  runtime: {
    serverless: boolean
  }
  config: {
    /** 配置的存储格式（map / key / sql） */
    db_format: string
    /** 配置的驱动（auto / blob / kv / ...） */
    db_driver: string
    /** 实际解析后的格式（与配置值不同时，说明发生了回退） */
    resolved_format: string | null
    /** 实际解析后的驱动 */
    resolved_driver: string | null
  }
  storage: {
    available: boolean
  }
  jwt: {
    ready: boolean
  }
  /** 全部检查项是否通过 */
  ready: boolean
  /** 未通过项，每条附说明与文档链接 */
  issues: EnvCheckIssue[]
}
