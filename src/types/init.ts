export interface InitSetupRequest {
  username: string
  password: string
  site_title: string
}

/**
 * 后端「存储配置错误」的错误码。
 *
 * 后端全局中间件（TSWorker backend/index.ts）在存储不可用时对所有依赖持久化
 * 的接口返回 503 + data.error = STORAGE_CONFIG_ERROR。该错误码只有 TS Worker
 * 后端会返回，可据此在拿不到 /public/settings 时反推后端类型。
 */
export const STORAGE_CONFIG_ERROR = "STORAGE_CONFIG_ERROR"

/** 503 响应体中的业务数据 */
export interface StorageConfigErrorData {
  error: typeof STORAGE_CONFIG_ERROR
  /** 后端生成的可读诊断（含需要配置哪项环境变量） */
  configError: string
}

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
    platform: string | null
  }
  config: {
    /** 配置的存储格式（map / key / sql） */
    db_format: string
    /** 配置的驱动（auto / blob / kv / ...） */
    db_driver: string
    /** 实际解析后的格式 */
    resolved_format: string | null
    /** 实际解析后的驱动 */
    resolved_driver: string | null
  }
  storage: {
    available: boolean
    configured: boolean | null
    connected: boolean | null
    platform: string | null
    /** 是否处于内存兜底模式：本地开发可接受，serverless 下重启即丢数据 */
    memory?: boolean
  }
  jwt: {
    ready: boolean
    /** 仅表示来源类型，不含任何密钥值 */
    source: string
  }
  ready: boolean
  issues: EnvCheckIssue[]
  docUrl: string
}
