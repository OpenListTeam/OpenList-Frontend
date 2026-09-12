export interface InitSetupRequest {
  username: string
  password: string
  site_title: string
}

export interface InitStatus {
  initialized: boolean
  /** 后端加解密密钥是否已在真实来源可读（KV 最终一致性的就绪标志） */
  ready?: boolean
}
