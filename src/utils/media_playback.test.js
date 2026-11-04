import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { createMediaFavoriteStore } from "./media_favorite.ts"

const require = createRequire(import.meta.url)
const solid = require(join(dirname(require.resolve("solid-js")), "solid.cjs"))
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
const compile = (
  text,
  mocks = {},
  globals = {},
  fileName = "regression.tsx",
) => {
  const exports = {}
  const output = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
    fileName,
  }).outputText
  vm.runInNewContext(output, {
    exports,
    require: (id) => mocks[id] ?? {},
    React: {
      createElement: (type, props, ...children) => ({ type, props, children }),
    },
    ...globals,
  })
  return exports
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

const playerModule = (api = {}) => {
  const [me, setMe] = solid.createSignal({ id: 1 })
  const errors = []
  const module = compile(
    source("../pages/media/music/player.tsx") +
      "\nexports.useTrackFavorite = useTrackFavorite;",
    {
      "solid-js": solid,
      "~/store/user": { me },
      "~/utils/media_favorite": { createMediaFavoriteStore },
      "~/hooks": { useT: () => (key) => key },
      "~/utils": { notify: { error: (message) => errors.push(message) } },
      "~/utils/media_api": {
        getMediaProgress: async () => ({ code: 200, data: null }),
        saveMediaProgress: async () => ({}),
        getSignedProxyUrl: async () => "https://media.test/audio",
        ...api,
      },
    },
    {
      Audio: class {
        paused = true
        src = ""
        volume = 0
        plays = 0
        addEventListener() {}
        pause() {
          this.paused = true
        }
        play() {
          this.plays++
          this.paused = false
          return Promise.resolve()
        }
      },
      fetch: async () => ({ ok: false }),
    },
  )
  return { ...module, setMe, errors }
}

test("pauseMusic cancels a pending signed track without clearing the playlist", async () => {
  const signed = deferred()
  const player = playerModule({ getSignedProxyUrl: () => signed.promise })
  const item = { id: 1, folder_path: "/music", file_name: "song.mp3" }
  player.setPlayerState((state) => ({ ...state, playlist: [item] }))
  const playing = player.playTrack(item)
  player.pauseMusic()
  signed.resolve("https://media.test/late.mp3")
  await playing
  assert.equal(player.initAudio().plays, 0)
  assert.equal(player.initAudio().src, "")
  assert.equal(player.playerState().playing, false)
  assert.equal(player.playerState().playlist[0], item)
})

test("bottom bar and lyrics share favorite reads and optimistic writes per user/item", async (t) => {
  let reads = 0
  const saving = deferred()
  const player = playerModule({
    getMediaUserData: async ([id]) => {
      reads++
      return { code: 200, data: [{ item_id: id, is_favorite: false }] }
    },
    setMediaFavorite: () => saving.promise,
  })
  player.setPlayerState((state) => ({ ...state, playlist: [{ id: 10 }] }))
  let bar, lyrics
  solid.createRoot((dispose) => {
    t.after(dispose)
    bar = player.useTrackFavorite()
    lyrics = player.useTrackFavorite()
  })
  await tick()
  assert.equal(reads, 1)
  const save = bar.toggle()
  assert.equal(bar.favorite(), true)
  assert.equal(lyrics.favorite(), true)
  saving.resolve({ code: 200 })
  await save
  for (let i = 0; i < 10; i++) {
    player.setPlayerState((state) => ({ ...state, currentTime: i }))
  }
  assert.equal(reads, 1)
  player.setMe({ id: 2 })
  await tick()
  assert.equal(reads, 2)
  assert.equal(bar.favorite(), false)
  assert.equal(lyrics.favorite(), false)
})

test("failure of track A rolls back A, never the newly selected track B", async (t) => {
  const saving = deferred()
  const player = playerModule({
    getMediaUserData: async ([id]) => ({
      code: 200,
      data: [{ item_id: id, is_favorite: id === 20 }],
    }),
    setMediaFavorite: () => saving.promise,
  })
  player.setPlayerState((state) => ({ ...state, playlist: [{ id: 10 }] }))
  let favorite
  solid.createRoot((dispose) => {
    t.after(dispose)
    favorite = player.useTrackFavorite()
  })
  await tick()
  const save = favorite.toggle()
  player.setPlayerState((state) => ({ ...state, playlist: [{ id: 20 }] }))
  await tick()
  assert.equal(favorite.favorite(), true)
  saving.reject(new Error("offline"))
  await save
  assert.equal(favorite.favorite(), true)
  assert.equal(player.errors.length, 1)
  player.setPlayerState((state) => ({ ...state, playlist: [{ id: 10 }] }))
  assert.equal(favorite.favorite(), false)
})

test("favorite failures and thrown requests are caught and roll back the same key", async () => {
  const store = createMediaFavoriteStore(() => {})
  const failures = []
  for (const write of [
    async () => ({ code: 500, message: "server error" }),
    async () => {
      throw new Error("offline")
    },
  ]) {
    await store.toggle("1:10", 10, write, (message) => failures.push(message))
    assert.equal(store.favorite("1:10"), false)
  }
  assert.deepEqual(failures, ["server error", "offline"])
})

test("late favorite reads cannot overwrite an optimistic write; duplicate writes are coalesced", async () => {
  const store = createMediaFavoriteStore(() => {})
  const reading = deferred()
  const saving = deferred()
  const load = store.load("1:10", 10, () => reading.promise)
  let writes = 0
  const write = () => {
    writes++
    return saving.promise
  }
  const save = store.toggle("1:10", 10, write, assert.fail)
  await store.toggle("1:10", 10, write, assert.fail)
  reading.resolve({ code: 200, data: [{ item_id: 10, is_favorite: false }] })
  await load
  assert.equal(store.favorite("1:10"), true)
  assert.equal(writes, 1)
  saving.resolve({ code: 200 })
  await save
})

test("401 redirect preserves the complete media query and hash and keeps manage fallback", () => {
  const destinations = []
  const location = {
    pathname: "/@media/video/7",
    search: "?play=1&ep=3",
    hash: "#resume",
  }
  const { handleResp } = compile(
    source("./handle_resp.ts"),
    {
      ".": { bus: { emit: (_, to) => destinations.push(to) } },
    },
    { location },
    "handle_resp.ts",
  )
  handleResp({ code: 401, message: "login" }, undefined, undefined, true, false)
  assert.equal(
    destinations[0],
    "/@login?redirect=" +
      encodeURIComponent(location.pathname + location.search + location.hash),
  )
  location.pathname = "/@manage"
  handleResp({ code: 401 }, undefined, undefined, true, false)
  assert.equal(destinations[1], "/")
})

test("ISO episode selection records its URL position and reaches the existing alternative layer", () => {
  const text = source("../pages/media/video/VideoLibrary.tsx")
  const body = text.match(
    /const playEpisode = ([\s\S]*?)\n  const closePlayer/,
  )[1]
  const positions = []
  const episode = { file_name: "disc.iso", index: 0 }
  const { playEpisode } = compile(
    "const playEpisode = " + body + "\nexports.playEpisode = playEpisode;",
    {},
    {
      route: { startPlay: (position) => positions.push(position) },
      episodes: () => [{ file_name: "one.mp4" }, episode],
      isDiscImage: () => true,
      notify: { error: assert.fail },
      t: (key) => key,
    },
  )
  playEpisode(episode)
  playEpisode(null)
  assert.deepEqual(positions, [2, 0])
  assert.match(text, /<Show when=\{showPlayer\(\) && discPlayBlocked\(\)\}>/)
  assert.match(text, /downloadStrm\(data\(\)\)/)
})

test("disabled browser is never the default for ISO, with or without external players", () => {
  for (const players of [
    [{ id: "vlc", name: "VLC", scheme: "vlc://{durl}" }],
    [],
  ]) {
    const { MediaPlayButton } = compile(
      source("../components/MediaPlayButton.tsx"),
      {
        "solid-js": { ...solid, onMount() {} },
        "@hope-ui/solid": { useColorMode: () => ({ colorMode: () => "dark" }) },
        "~/utils": { getPlatform: () => "Windows", notify: { error() {} } },
        "~/utils/players": { playersForPlatform: () => players },
        "~/store/accent": { accent: () => "blue" },
      },
      { localStorage: { getItem: () => "browser" } },
    )
    const tree = solid.createRoot(() =>
      MediaPlayButton({ browserUnsupported: true, onBrowserPlay: assert.fail }),
    )
    const main = tree.children[1].children[0]
    assert.equal(main.children[1], players.length ? "播放器播放" : "选择播放器")
  }
})

test("unknown artist is an explicit selection and sends album_artist as an empty string", () => {
  const text = source("../pages/media/music/MusicLibrary.tsx")
  const file = ts.createSourceFile(
    "MusicLibrary.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const initializers = new Map()
  const visit = (node) => {
    if (ts.isVariableDeclaration(node))
      initializers.set(node.name.getText(file), node.initializer?.getText(file))
    ts.forEachChild(node, visit)
  }
  visit(file)
  let sourceParams
  const { selectedArtist, setSelectedArtist } = compile(
    "const [selectedArtist, setSelectedArtist] = " +
      initializers.get("[selectedArtist, setSelectedArtist]") +
      "; const [albumData] = " +
      initializers.get("[albumData]") +
      "; exports.selectedArtist = selectedArtist; exports.setSelectedArtist = setSelectedArtist;",
    {},
    {
      createSignal: solid.createSignal,
      createResource: (source) => {
        sourceParams = source
        return [() => null]
      },
      category: () => "artist",
      page: () => 1,
      pageSize: 40,
      keyword: () => "",
      orderBy: () => "name",
      orderDir: () => "asc",
      browseMode: () => "all",
    },
  )
  assert.equal(selectedArtist(), null)
  assert.equal(sourceParams(), null)
  setSelectedArtist("")
  assert.equal(selectedArtist(), "")
  assert.equal(sourceParams().album_artist, "")
  setSelectedArtist(null)
  assert.equal(sourceParams(), null)
  assert.doesNotMatch(text, /!selectedArtist\(\)/)
  assert.match(text, /<Show when=\{selectedArtist\(\) !== null\}>/)
})
