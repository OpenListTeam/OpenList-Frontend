export interface MediaCoverDraft {
  file: File
  preview: string
}

export interface MediaAlbumDraft {
  name: string
  artist: string
  cover: string
  release_date: string
  genre: string
  plot: string
}

export const createMediaEditGuard = () => {
  let version = 0
  return {
    next: () => ++version,
    isCurrent: (token: number) => token === version,
  }
}

export const hydrateMediaAlbumDraft = (
  draft: MediaAlbumDraft,
  first: {
    cover: string
    release_date: string
    genre: string
    plot: string
    description: string
  },
  dirty: ReadonlySet<keyof MediaAlbumDraft>,
): MediaAlbumDraft => ({
  ...draft,
  cover: dirty.has("cover") ? draft.cover : draft.cover || first.cover,
  release_date: dirty.has("release_date")
    ? draft.release_date
    : draft.release_date || first.release_date || "",
  genre: dirty.has("genre") ? draft.genre : first.genre || "",
  plot: dirty.has("plot") ? draft.plot : first.plot || first.description || "",
})

export const mediaAlbumPatch = (
  draft: MediaAlbumDraft,
  dirty: ReadonlySet<keyof MediaAlbumDraft>,
) => ({
  ...(dirty.has("name") ? { new_album_name: draft.name } : {}),
  ...(dirty.has("artist") ? { new_album_artist: draft.artist } : {}),
  ...(dirty.has("cover") ? { cover: draft.cover } : {}),
  ...(dirty.has("release_date") ? { release_date: draft.release_date } : {}),
  ...(dirty.has("genre") ? { genre: draft.genre } : {}),
  ...(dirty.has("plot") ? { plot: draft.plot, description: draft.plot } : {}),
})

export const hasMediaGPS = (value: { latitude?: number; longitude?: number }) =>
  typeof value.latitude === "number" &&
  Number.isFinite(value.latitude) &&
  typeof value.longitude === "number" &&
  Number.isFinite(value.longitude)

export const mediaAlbumScope = (
  album: { album_name: string; album_artist: string },
  scanPathId: number,
) => ({
  album_name: album.album_name,
  album_artist: album.album_artist,
  scan_path_id: scanPathId || undefined,
})

export const prepareMediaCoverDraft = (file: File): Promise<MediaCoverDraft> =>
  new Promise((resolve, reject) => {
    if (file.size === 0 || file.size > 8 * 1024 * 1024) {
      reject(new Error("Image must be between 1 byte and 8 MB"))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve({ file, preview: String(reader.result) })
    reader.onerror = () =>
      reject(reader.error ?? new Error("Cannot read image"))
    reader.readAsDataURL(file)
  })

export const saveMediaCoverDraft = async (
  id: number,
  cover: string,
  draft: MediaCoverDraft | null,
  upload: (
    id: number,
    file: File,
    deferred: boolean,
  ) => Promise<{ code: number; message: string; data?: { cover: string } }>,
): Promise<string> => {
  if (!draft || cover !== draft.preview) return cover
  const resp = await upload(id, draft.file, true)
  if (resp.code !== 200 || !resp.data?.cover) {
    throw new Error(resp.message || "Cover upload failed")
  }
  return resp.data.cover
}

export const commitMediaCoverDraft = async <T extends { code: number }>(
  id: number,
  cover: string,
  draft: MediaCoverDraft | null,
  upload: Parameters<typeof saveMediaCoverDraft>[3],
  commit: (cover: string) => Promise<T>,
  discard: (id: number, cover: string) => Promise<unknown>,
): Promise<T> => {
  const saved = await saveMediaCoverDraft(id, cover, draft, upload)
  const uploaded = !!draft && cover === draft.preview
  let committed = false
  try {
    const resp = await commit(saved)
    committed = resp.code === 200
    return resp
  } finally {
    if (uploaded && !committed) await discard(id, saved)
  }
}
