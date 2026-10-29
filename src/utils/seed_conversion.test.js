import test from "node:test"
import assert from "node:assert/strict"
import { seedConversionNeedsFiles } from "./seed_conversion.ts"

const seed = {
  format: "torrent",
  piece_size: 1024 * 1024,
  files: [
    { path: "a.bin", size: 3 },
    { path: "b.bin", size: 4 },
  ],
  available_piece_hashes: ["sha1"],
  conversions: { torrent: { feasible: true }, oss: { feasible: true } },
}
const emptyMatrix = () => ({
  md5: { whole: false, pieces: false },
  sha1: { whole: false, pieces: false },
  sha256: { whole: false, pieces: false },
})

test("identity conversion reuses global pieces without reading files", () => {
  assert.equal(seedConversionNeedsFiles(seed, ["torrent"], [0, 1]), false)
})

test("file selection invalidates unavailable global pieces for torrent", () => {
  assert.equal(seedConversionNeedsFiles(seed, ["torrent"], [0]), true)
  assert.equal(seedConversionNeedsFiles(seed, ["oss"], [0]), false)
})

test("an extra algorithm requires the same source path used by conversion", () => {
  const matrix = emptyMatrix()
  matrix.sha256.whole = true
  assert.equal(seedConversionNeedsFiles(seed, ["oss"], [0, 1], matrix), true)
})

test("dropping optional algorithms does not require reading source files", () => {
  assert.equal(
    seedConversionNeedsFiles(seed, ["oss"], [0, 1], emptyMatrix()),
    false,
  )
})

test("per-file aligned pieces permit converting a subset without fetching", () => {
  const info = {
    ...seed,
    files: seed.files.map((file) => ({
      ...file,
      hashes: { pieces: { sha1: ["fixture"] } },
    })),
  }
  assert.equal(seedConversionNeedsFiles(info, ["torrent"], [1]), false)
})

test("a convertible CAS subset ignores missing hashes on unselected files", () => {
  const info = {
    ...seed,
    files: [
      { path: "ready.bin", size: 3, hashes: { md5: "fixture" } },
      { path: "missing.bin", size: 4 },
    ],
    conversions: { cas: { feasible: false } },
  }
  assert.equal(seedConversionNeedsFiles(info, ["cas"], [0]), false)
  assert.equal(seedConversionNeedsFiles(info, ["cas"], [0, 1]), true)
})
