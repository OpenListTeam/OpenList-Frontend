import mitt from "mitt"
import { SeedInfo, TorrentInfo } from "~/types"

type Events = {
  to: string
  gallery: string
  tool: string
  pathname: string
  extract: string
  torrent_parsed: { torrentData: string; info: TorrentInfo }
  seed_parsed: { seedData: string; fileName: string; info: SeedInfo }
  /** hasDir 表示所选路径里含目录，用于提示「保留目录结构」选项 */
  generate_transfer_seed: { paths: string[]; hasDir?: boolean }
  "plugin:file_action_registered": any
  "plugin:header_action_registered": any
}

export const bus = mitt<Events>()
