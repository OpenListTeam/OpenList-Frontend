/**
 * 计划任务参数统一按 JSON 值保存。
 * 不同任务类型的字段由后端 HandlerInfo 描述，前端不硬编码具体业务类型。
 */
export type CronJobArgs = Record<string, string | number | boolean | string[]>

/** 后端参数字段类型；与 internal/cronjob.ArgFieldType 保持一致。 */
export enum CronJobArgType {
  String = "string",
  Text = "text",
  Lines = "lines",
  Number = "number",
  Bool = "bool",
  Path = "path",
}

/** 后端返回的参数字段描述。 */
export interface CronJobArgField {
  /** JSON 参数中的字段名。 */
  name: string
  /** 前端要渲染的控件类型。 */
  type: CronJobArgType
  /** 字段名 i18n key。 */
  label_key: string
  /** 字段说明 i18n key；空字符串表示没有说明。 */
  help_key: string
  /** 是否必须填写。 */
  required: boolean
  /** 默认值；统一使用字符串表示，前端按字段类型转换。 */
  default: string
}

/** 后端返回的任务类型描述。 */
export interface CronJobTypeInfo {
  /** 创建/更新 CronJob 时使用的稳定类型标识。 */
  type: string
  /** 任务类型显示名 i18n key。 */
  label_key: string
  /** 任务类型说明 i18n key。 */
  description_key: string
  /** 参数字段描述。 */
  fields: CronJobArgField[]
}

/**
 * 计划任务配置。
 * 后端返回的 Args 是 JSON 对象；当前类型系统只登记 sync 参数。
 */
export interface CronJob {
  /** 数据库主键。 */
  id: number
  /** 管理员设置的任务名称。 */
  name: string
  /** 任务类型；后端会根据已注册 Handler 校验。 */
  type: string
  /** 标准 5 字段 cron 表达式。 */
  cron_spec: string
  /** 是否启用定时调度。 */
  enabled: boolean
  /** 是否正在执行；执行中不能修改或删除。 */
  running: boolean
  /** 上次开始时间。 */
  last_run_at: string | null
  /** 下一次定时触发时间。 */
  next_run_at: string | null
  /** 上一次执行的错误信息；成功时为空。 */
  last_error: string
  /** 任务类型参数。 */
  args: CronJobArgs
}

/** 创建或编辑计划任务时使用的请求类型。 */
export interface CronJobReq {
  name: string
  type: string
  cron_spec: string
  enabled: boolean
  args: CronJobArgs
}
