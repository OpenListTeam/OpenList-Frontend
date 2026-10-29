import type { SeedFormat, SeedHashMatrix, SeedInfo } from "~/types"

export const seedConversionNeedsFiles = (
  info: SeedInfo | null,
  formats: SeedFormat[],
  selected: number[],
  matrix?: SeedHashMatrix,
): boolean => {
  if (!info) return true
  const selectedIndexes = new Set(selected)
  const files = info.files.filter((_, index) => selectedIndexes.has(index))
  const allSelected = files.length === info.files.length
  const pieces = (
    file: SeedInfo["files"][number],
    algorithm: keyof SeedHashMatrix,
  ) => file.hashes?.pieces?.[algorithm] || file.piece_hashes?.[algorithm] || []
  const pieceSize = info.piece_size || info.piece_length || 10 * 1024 * 1024
  for (const format of formats) {
    if (format === "torrent" && !allSelected) {
      if (
        files.some(
          (file, index) =>
            file.size > 0 &&
            (pieces(file, "sha1").length === 0 ||
              (index < files.length - 1 && file.size % pieceSize !== 0)),
        )
      )
        return true
    } else if (allSelected && info.conversions?.[format]?.feasible !== true) {
      return true
    }
    if (
      format === "cas" &&
      files.some(
        (file) =>
          !file.hashes?.md5 ||
          (file.size > 10 * 1024 * 1024 &&
            !file.cas_slice_md5 &&
            (pieceSize !== 10 * 1024 * 1024 ||
              pieces(file, "md5").length === 0)),
      )
    )
      return true
    if (!matrix) continue
    const required = {
      ...matrix,
      ...(format === "torrent" ? { sha1: { whole: true, pieces: true } } : {}),
      ...(format === "cas" ? { md5: { whole: true, pieces: true } } : {}),
    }
    for (const algorithm of ["md5", "sha1", "sha256"] as const) {
      if (
        files.some(
          (file) =>
            (required[algorithm].whole && !file.hashes?.[algorithm]) ||
            (required[algorithm].pieces &&
              file.size > 0 &&
              pieces(file, algorithm).length === 0 &&
              !(
                algorithm === "sha1" &&
                allSelected &&
                info.available_piece_hashes?.includes("sha1")
              )),
        )
      )
        return true
    }
  }
  return false
}
