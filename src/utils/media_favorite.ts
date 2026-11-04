interface FavoriteEntry {
  favorite: boolean
  loaded: boolean
  loading: boolean
  pending: boolean
  revision: number
}

export const createMediaFavoriteStore = (onChange: () => void) => {
  const entries = new Map<string, FavoriteEntry>()
  const entryFor = (key: string) => {
    let entry = entries.get(key)
    if (!entry) {
      entry = {
        favorite: false,
        loaded: false,
        loading: false,
        pending: false,
        revision: 0,
      }
      entries.set(key, entry)
    }
    return entry
  }

  const favorite = (key: string) => entryFor(key).favorite
  const load = async (
    key: string,
    itemId: number,
    read: (ids: number[]) => Promise<{
      code: number
      data?: { item_id: number; is_favorite: boolean }[]
    }>,
  ) => {
    const entry = entryFor(key)
    if (entry.loaded || entry.loading || entry.pending) return
    entry.loading = true
    const revision = entry.revision
    try {
      const resp = await read([itemId])
      if (entry.revision !== revision || resp.code !== 200 || !resp.data) return
      entry.favorite = !!resp.data.find((row) => row.item_id === itemId)
        ?.is_favorite
      entry.loaded = true
      onChange()
    } catch {
      /* 访客 / 未登录：忽略 */
    } finally {
      entry.loading = false
    }
  }

  const toggle = async (
    key: string,
    itemId: number,
    write: (
      id: number,
      favorite: boolean,
    ) => Promise<{ code: number; message?: string }>,
    onFailure: (message: string) => void,
  ) => {
    const entry = entryFor(key)
    if (entry.pending) return
    const previous = entry.favorite
    entry.pending = true
    ++entry.revision
    entry.favorite = !previous
    onChange()
    try {
      const resp = await write(itemId, entry.favorite)
      if (resp.code !== 200) throw new Error(resp.message)
      entry.loaded = true
    } catch (error) {
      entry.favorite = previous
      onChange()
      onFailure(error instanceof Error ? error.message : String(error))
    } finally {
      entry.pending = false
    }
  }

  return { favorite, load, toggle }
}
