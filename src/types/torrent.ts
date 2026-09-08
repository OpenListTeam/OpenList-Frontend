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
  missing_reasons?: string[]
}

export interface SeedCapabilities {
  formats: Partial<Record<SeedFormat, boolean>>
  files: SeedCapabilityFile[]
  existing_hashes?: SeedHashAlgorithm[]
  missing_hashes?: SeedHashAlgorithm[]
  estimated_traffic?: number
  conversion?: Partial<
    Record<SeedFormat, { feasible: boolean; missing?: string[] }>
  >
}

export interface SeedGenerateRequest {
  paths: string[]
  formats: SeedFormat[]
  hash_matrix: SeedHashMatrix
  piece_size: number
  comment?: string
  file_comments?: Record<string, string>
  trackers?: string[]
  include_share?: boolean
  include_direct_source?: boolean
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
}

export interface SeedInfo extends Partial<TorrentInfo> {
  format: SeedFormat
  name: string
  total_size: number
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
  recalc_files?: Array<{ path: string; source_path: string }>
  options?: Record<string, unknown>
}

export interface SeedOperationResult {
  message?: string
  file_name?: string
  file_size?: number
  path?: string
  channel?: SeedInfo["channel"]
  artifact?: SeedArtifact
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
