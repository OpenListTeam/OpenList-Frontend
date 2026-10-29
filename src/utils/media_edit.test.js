import test from "node:test"
import assert from "node:assert/strict"
import {
  commitMediaCoverDraft,
  createMediaEditGuard,
  hasMediaGPS,
  hydrateMediaAlbumDraft,
  mediaAlbumPatch,
  mediaAlbumScope,
  prepareMediaCoverDraft,
  saveMediaCoverDraft,
} from "./media_edit.ts"

const album = { album_name: "Album", album_artist: "Artist", scan_path_id: 99 }

test("picking a cover reads only a local preview and can be discarded", async (t) => {
  const original = globalThis.FileReader
  t.after(() => {
    if (original === undefined) delete globalThis.FileReader
    else globalThis.FileReader = original
  })
  let reads = 0
  globalThis.FileReader = class {
    readAsDataURL(file) {
      reads++
      assert.equal(file.name, "cover.png")
      this.result = "data:image/png;base64,eA=="
      queueMicrotask(() => this.onload())
    }
  }
  const file = new File(["image"], "cover.png", { type: "image/png" })
  const selected = await prepareMediaCoverDraft(file)
  assert.equal(selected.file, file)
  assert.equal(selected.preview, "data:image/png;base64,eA==")
  assert.equal(reads, 1)
  assert.equal(
    await saveMediaCoverDraft(1, "old-cover", null, async () => {
      throw new Error("Cancel must not upload")
    }),
    "old-cover",
  )
})

test("empty and oversized covers are rejected before previewing", async () => {
  await assert.rejects(
    prepareMediaCoverDraft(new File([], "empty.png")),
    /8 MB/,
  )
  await assert.rejects(
    prepareMediaCoverDraft(
      new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.png"),
    ),
    /8 MB/,
  )
})

test("album operations use the selected scan path, not the aggregate MAX id", () => {
  assert.equal(mediaAlbumScope(album, 0).scan_path_id, undefined)
  assert.equal(mediaAlbumScope(album, 7).scan_path_id, 7)
})

test("unchanged, cleared and URL covers never upload a discarded draft", async () => {
  const draft = {
    file: new File(["image"], "cover.png"),
    preview: "data:image/png;base64,eA==",
  }
  let calls = 0
  const upload = async () => {
    calls++
    throw new Error("Unexpected upload")
  }
  for (const cover of [
    "",
    "thumb:/imgs/old.png",
    "https://example.com/new.png",
  ]) {
    assert.equal(await saveMediaCoverDraft(1, cover, draft, upload), cover)
  }
  assert.equal(
    await saveMediaCoverDraft(1, "thumb:/imgs/old.png", null, upload),
    "thumb:/imgs/old.png",
  )
  assert.equal(calls, 0)
})

test("saving a picked cover uploads without changing the first track", async () => {
  const file = new File(["image"], "cover.png")
  const draft = { file, preview: "data:image/png;base64,eA==" }
  let calls = 0
  const cover = await saveMediaCoverDraft(
    42,
    draft.preview,
    draft,
    async (id, uploaded, deferred) => {
      calls++
      assert.equal(id, 42)
      assert.equal(uploaded, file)
      assert.equal(deferred, true)
      return { code: 200, message: "", data: { cover: "thumb:/imgs/new.png" } }
    },
  )
  assert.equal(cover, "thumb:/imgs/new.png")
  assert.equal(calls, 1)
})

test("failed cover upload stops the final save", async () => {
  const draft = { file: new File(["image"], "cover.png"), preview: "preview" }
  await assert.rejects(
    saveMediaCoverDraft(42, draft.preview, draft, async () => ({
      code: 400,
      message: "Invalid image",
    })),
    /Invalid image/,
  )
})

const albumDraft = {
  name: "Album",
  artist: "Artist",
  cover: "old-cover",
  release_date: "2020",
  genre: "Rock",
  plot: "old-summary",
}

test("album patches preserve mixed track fields and explicitly clear summary fallback", () => {
  assert.deepEqual(mediaAlbumPatch(albumDraft, new Set()), {})
  assert.deepEqual(
    mediaAlbumPatch({ ...albumDraft, name: "Renamed" }, new Set(["name"])),
    { new_album_name: "Renamed" },
  )
  assert.deepEqual(
    mediaAlbumPatch(
      { ...albumDraft, cover: "", plot: "" },
      new Set(["cover", "plot"]),
    ),
    { cover: "", plot: "", description: "" },
  )
})

test("late first-track hydration preserves typed and explicitly cleared fields", () => {
  const typed = {
    ...albumDraft,
    genre: "Jazz",
    plot: "Typed",
    cover: "",
    release_date: "",
  }
  const first = {
    cover: "first-cover",
    release_date: "1999",
    genre: "Rock",
    plot: "",
    description: "Fallback",
  }
  assert.deepEqual(
    hydrateMediaAlbumDraft(
      typed,
      first,
      new Set(["genre", "plot", "cover", "release_date"]),
    ),
    typed,
  )
  const hydrated = hydrateMediaAlbumDraft(
    { ...albumDraft, genre: "", plot: "" },
    first,
    new Set(),
  )
  assert.equal(hydrated.plot, "Fallback")
  assert.equal(hydrated.genre, "Rock")
  assert.deepEqual(mediaAlbumPatch(hydrated, new Set()), {})
})

const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test("out-of-order album expansion does not replace current tracks or clear its loading", async () => {
  const guard = createMediaEditGuard()
  let tracks = []
  let loading = false
  const load = async (request) => {
    const version = guard.next()
    loading = true
    try {
      const result = await request.promise
      if (guard.isCurrent(version)) tracks = result
    } finally {
      if (guard.isCurrent(version)) loading = false
    }
  }
  const first = deferred(),
    second = deferred()
  const a = load(first),
    b = load(second)
  first.resolve(["A"])
  await a
  assert.deepEqual(tracks, [])
  assert.equal(loading, true)
  second.resolve(["B"])
  await b
  assert.deepEqual(tracks, ["B"])
  assert.equal(loading, false)
  const slow = deferred(),
    fast = deferred()
  const c = load(slow),
    d = load(fast)
  fast.resolve(["D"])
  await d
  slow.resolve(["C"])
  await c
  assert.deepEqual(tracks, ["D"])
  assert.equal(loading, false)
})

test("closing or changing a cover invalidates late preview and editor responses", async () => {
  for (const action of ["clear", "url", "close", "switch"]) {
    const guard = createMediaEditGuard()
    const token = guard.next()
    const request = deferred()
    let value = "old"
    const read = request.promise.then((preview) => {
      if (guard.isCurrent(token)) value = preview
    })
    guard.next()
    value = action === "url" ? "https://example.com/cover.jpg" : ""
    request.resolve("late-preview")
    await read
    assert.notEqual(value, "late-preview", action)
  }
})

test("failed final save reclaims deferred cover and retains local draft for retry", async () => {
  const draft = { file: new File(["image"], "cover.png"), preview: "preview" }
  for (const failure of ["response", "network"]) {
    let removed = ""
    const result = commitMediaCoverDraft(
      42,
      draft.preview,
      draft,
      async () => ({
        code: 200,
        message: "",
        data: { cover: "thumb:/imgs/cover-42-new.png" },
      }),
      async () => {
        if (failure === "network") throw new Error("Offline")
        return { code: 500 }
      },
      async (id, cover) => {
        assert.equal(id, 42)
        removed = cover
      },
    )
    if (failure === "network") await assert.rejects(result, /Offline/)
    else assert.equal((await result).code, 500)
    assert.equal(removed, "thumb:/imgs/cover-42-new.png")
    assert.equal(draft.preview, "preview")
  }
})

test("committed and existing covers are not reclaimed", async () => {
  for (const draft of [
    null,
    { file: new File(["image"], "cover.png"), preview: "preview" },
  ]) {
    let removed = false
    const resp = await commitMediaCoverDraft(
      42,
      draft?.preview ?? "existing",
      draft,
      async () => ({ code: 200, message: "", data: { cover: "uploaded" } }),
      async () => ({ code: draft ? 200 : 500 }),
      async () => {
        removed = true
      },
    )
    assert.equal(resp.code, draft ? 200 : 500)
    assert.equal(removed, false)
  }
})

test("failed upload never starts final commit or orphan discard", async () => {
  const draft = { file: new File(["image"], "cover.png"), preview: "preview" }
  let commits = 0,
    discards = 0
  await assert.rejects(
    commitMediaCoverDraft(
      42,
      draft.preview,
      draft,
      async () => ({ code: 400, message: "Invalid image" }),
      async () => {
        commits++
        return { code: 200 }
      },
      async () => {
        discards++
      },
    ),
    /Invalid image/,
  )
  assert.equal(commits, 0)
  assert.equal(discards, 0)
})

test("orphan cleanup failure is reported instead of claiming a successful save", async () => {
  const draft = { file: new File(["image"], "cover.png"), preview: "preview" }
  await assert.rejects(
    commitMediaCoverDraft(
      42,
      draft.preview,
      draft,
      async () => ({ code: 200, message: "", data: { cover: "uploaded" } }),
      async () => ({ code: 500 }),
      async () => {
        throw new Error("Cleanup failed")
      },
    ),
    /Cleanup failed/,
  )
})

test("GPS presence accepts equator, prime meridian and origin but not missing values", () => {
  for (const [latitude, longitude] of [
    [0, 30],
    [30, 0],
    [0, 0],
  ]) {
    assert.equal(hasMediaGPS({ latitude, longitude }), true)
  }
  for (const value of [
    {},
    { latitude: 0 },
    { latitude: null, longitude: 1 },
    { latitude: NaN, longitude: 1 },
  ]) {
    assert.equal(hasMediaGPS(value), false)
  }
})
