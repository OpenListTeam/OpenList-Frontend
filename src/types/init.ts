export interface InitSetupRequest {
  username: string
  password: string
  site_title: string
}

/**
 * 初始化失败时后端给出的结构化原因（TS Worker 后端）。
 *
 * 兼容性：Go 后端只返回 message，因此这里的字段全部可选；展示时以
 * `reason` 优先、`message` 兜底。
 */
export interface InitSetupError {
  /** 机器可读的分类：INVALID_COMBINATION / DRIVER_UNAVAILABLE / STORAGE_READ_FAILED ... */
  code?: string
  /** 一行短原因（完整一句，界面直接展示这个） */
  summary?: string | null
  /** 已脱敏的完整原因（多行、可能被截断）：仅供排查，界面不展示 */
  reason?: string
  /**
   * 一句话修复建议（「改什么」，如 `Set DB_DRIVER=d1 (or DB_DRIVER=auto)`）。
   *
   * 后端单独给出而不是让前端解析 reason：原因会被截断，解析文案不可靠。
   */
  suggestion?: string | null
}

export interface InitStatus {
  initialized: boolean
  /** 后端加解密密钥是否已在真实来源可读（KV 最终一致性的就绪标志） */
  ready?: boolean
  /** 内存库是否来自一次成功的持久化读取（仅 TS Worker 后端返回） */
  db_trusted?: boolean
  /** 存储配置不可用的原因（已脱敏，可直接展示；仅 TS Worker 后端返回） */
  storage_error?: string | null
  /** 存储配置不可用时的修复建议（「改什么」；仅 TS Worker 后端返回） */
  storage_suggestion?: string | null
  /** 上一次从持久化后端读取失败的原因（已脱敏） */
  db_load_error?: string | null
}

/** 初始化前环境自检项 */
export interface EnvCheckIssue {
  code: string
  level: "error" | "warning"
  /** 一行短原因（界面展示这个；后端保证是完整的一句） */
  summary?: string
  /** 完整说明（多行、已脱敏）：仅排查用，界面不展示 */
  message: string
  docUrl: string
  /** 一句话修复建议（「改什么」）；无建议时为 null/缺省 */
  suggestion?: string | null
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
    /** 配置错误的机器可读分类（无错误时为 null） */
    error_code?: string | null
    /** 配置错误的原因（已脱敏，可直接展示） */
    error_message?: string | null
    /** 配置错误时的修复建议（「改什么」） */
    suggestion?: string | null
  }
  jwt: {
    ready: boolean
  }
  /** 全部检查项是否通过 */
  ready: boolean
  /** 未通过项，每条附说明与文档链接 */
  issues: EnvCheckIssue[]
}
