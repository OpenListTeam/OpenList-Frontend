export type SeedFormat = "torrent" | "cas" | "oss"
export type SeedHashAlgorithm = "md5" | "sha1" | "sha256"

export interface SeedHashSelection {
  whole: boolean
  pieces: boolean
}

export type SeedHashMatrix = Record<SeedHashAlgorithm, SeedHashSelection>

export interface TorrentFile {
  path: string
  size: number
  selected?: boolean
  modified?: string
  comment?: string
  hashes?: Partial<Record<SeedHashAlgorithm, string>> & {
    pieces?: Partial<Record<SeedHashAlgorithm, string[]>>
  }
  piece_hashes?: Partial<Record<SeedHashAlgorithm, string[]>>
  sources?: Array<{
    type: string
    url: string
    expires_at?: string
    share_id?: string
  }>
  cas_slice_md5?: string
  cas_create_time?: string
  /** Cloud drive identifier the CAS metadata follows (e.g. "189"); empty = "189". */
  cas_cloud?: string
  existing_hashes?: SeedHashAlgorithm[]
  requires_fetch?: boolean
  estimated_traffic?: number
}

export interface CASInfo {
  file_md5: string
  slice_md5: string
  slice_size: number
  cloud: string
}

export interface TorrentInfo {
  name: string
  total_size: number
  piece_length: number
  piece_count: number
  info_hash: string
  files: TorrentFile[]
  has_cas: boolean
  cas?: CASInfo
}

export interface SeedCapabilityFile extends TorrentFile {
  source_path?: string
  available_hashes?: SeedHashAlgorithm[]
  direct_source_available?: boolean
  share_available?: boolean
  streamable?: boolean
  missing_reasons?: string[]
}

export interface SeedCapabilities {
  formats: Partial<Record<SeedFormat, boolean>>
  files: SeedCapabilityFile[]
  existing_hashes?: SeedHashAlgorithm[]
  missing_hashes?: SeedHashAlgorithm[]
  estimated_traffic?: number
  default_matrix?: SeedHashMatrix
  trackers?: string[]
  conversion?: Partial<
    Record<SeedFormat, { feasible: boolean; missing?: string[] }>
  >
}

// Per-file save method returned by the destination import planning probe.
// "rapid_upload" covers hash-based rapid upload (秒传/CAS) for any cloud drive
// that supports it (189pc, 115, aliyundrive_open, ...). "189pc_cas" is retained
// for backward compatibility with older backends.
export type SeedSaveMethod =
  | "rapid_upload"
  | "189pc_cas"
  | "put_url"
  | "offline_download"
  | "download_required"
  | "unavailable"

export interface SeedSaveCapabilityFile {
  path: string
  method: SeedSaveMethod
  requires_download?: boolean
}

export interface SeedSaveCapabilities {
  driver?: string
  global_policy?: string
  resolved_policy?: string
  files: SeedSaveCapabilityFile[]
  driver_supports?: {
    cas_rapid?: boolean
    put_url?: boolean
    offline_download?: boolean
    rapid_hash_algos?: string[] // 支持的哈希算法名称 (MD5, SHA1, SHA256, GCID)
    rapid_uses_pieces?: boolean
  }
}

export interface SeedGenerateRequest {
  paths: string[]
  formats: SeedFormat[]
  hash_matrix: SeedHashMatrix
  piece_size: number
  name?: string
  comment?: string
  file_comments?: Record<string, string>
  trackers?: string[]
  include_share?: boolean
  include_direct_source?: boolean
  share_files?: string[]
  direct_files?: string[]
  output_path?: string
}

export interface SeedArtifact {
  format: SeedFormat
  name: string
  path?: string
  data?: string
  size?: number
}

export interface SeedGenerateResult {
  files?: SeedArtifact[]
  artifacts?: SeedArtifact[]
  generated?: SeedArtifact[]
  estimated_traffic?: number
  message?: string
  async?: boolean
  task?: {
    id?: string
    name?: string
    state?: string
    status?: string
    error?: string
  }
}

export interface SeedInfo extends Partial<TorrentInfo> {
  format: SeedFormat
  name: string
  total_size: number
  piece_size?: number
  files: SeedCapabilityFile[]
  created_at?: string
  comment?: string
  trackers?: string[]
  share?: {
    url?: string
    valid?: boolean
    expires_at?: string
    reason?: string
  }
  channel?: { name?: string; status?: string; updated_at?: string }
  channels?: Array<{ driver: string; mount_path?: string }>
  source?: { direct?: string; valid?: boolean; reason?: string }
  conversions?: Partial<
    Record<SeedFormat, { feasible: boolean; missing?: string[] }>
  >
  capabilities?: {
    rapid_upload?: boolean
    offline_download?: boolean
    transfer?: boolean
    convert?: boolean
    edit?: boolean
    recalculate?: boolean
  }
}

export interface SeedParseResult {
  info?: SeedInfo
  seed?: SeedInfo
  data?: SeedInfo
  format?: SeedFormat
  name?: string
  total_size?: number
  files?: SeedCapabilityFile[]
  created_at?: string
  comment?: string
  trackers?: string[]
  share?: SeedInfo["share"]
  channel?: SeedInfo["channel"]
  conversions?: SeedInfo["conversions"]
  capabilities?: SeedInfo["capabilities"]
  direct_preview?: boolean
}

export interface SeedOperationRequest {
  seed_data: string
  file_name?: string
  path?: string
  selected_files?: number[]
  format?: SeedFormat
  transit_path?: string
  tool?: string
  delete_policy?: string
  remove_files?: string[]
  recalc_files?: Array<{ path: string; source_path: string }>
  hash_matrix?: SeedHashMatrix
  options?: Record<string, unknown>
}

export interface SeedOperationResult {
  message?: string
  file_name?: string
  file_size?: number
  path?: string
  channel?: SeedInfo["channel"]
  artifact?: SeedArtifact
  seed_data?: string
  seed?: SeedInfo
  share_status?: Record<string, boolean>
  results?: Array<{
    path?: string
    name?: string
    method?: string
    error?: string
  }>
}

export interface TorrentUploadParseResult {
  info: TorrentInfo
  torrent_data: string
}

export interface TorrentRapidUploadResult {
  message: string
  file_name: string
  file_size: number
}
