import test from "node:test"
import assert from "node:assert/strict"
import { deflateRawSync } from "node:zlib"
import { ZipLimitError, extractZipNative } from "./zip_read.ts"

/**
 * 构造最小 ZIP（无 CRC、无 extra field）。
 * entries: [{ name, data, method }]，method 0 = store，8 = deflate
 */
const buildZip = (entries) => {
  const locals = []
  const centrals = []
  let offset = 0

  for (const { name, data, method = 8 } of entries) {
    const nameBytes = Buffer.from(name, "utf-8")
    const payload = method === 8 ? deflateRawSync(data) : data

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 14) // crc32（解析不需要）
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(0, 16) // crc32
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)

    locals.push(local, nameBytes, Buffer.from(payload))
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + payload.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  const zip = Buffer.concat([...locals, centralBuf, eocd])
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength)
}

const bytes = (n) => new Uint8Array(n)

test("解压普通条目", async () => {
  const zip = buildZip([
    { name: "a.txt", data: Buffer.from("hello") },
    { name: "b.txt", data: Buffer.from("world"), method: 0 },
  ])
  const files = await extractZipNative(zip)
  assert.equal(new TextDecoder().decode(files["a.txt"]), "hello")
  assert.equal(new TextDecoder().decode(files["b.txt"]), "world")
})

test("单条目超过 maxEntryBytes 时抛 ZipLimitError", async () => {
  const zip = buildZip([{ name: "big.bin", data: bytes(2 * 1024 * 1024) }])
  await assert.rejects(
    () => extractZipNative(zip, { limits: { maxEntryBytes: 1024 } }),
    (err) => err instanceof ZipLimitError,
  )
})

test("skipOversizedEntries 跳过超限条目并继续解压其它条目", async () => {
  const zip = buildZip([
    { name: "big.bin", data: bytes(2 * 1024 * 1024) },
    { name: "keep.txt", data: Buffer.from("keep") },
  ])
  const files = await extractZipNative(zip, {
    limits: { maxEntryBytes: 1024, skipOversizedEntries: true },
  })
  assert.equal(files["big.bin"], undefined)
  assert.equal(new TextDecoder().decode(files["keep.txt"]), "keep")
})

test("跳过超限条目时通过 onSkip 上报条目名", async () => {
  const zip = buildZip([
    { name: "big.bin", data: bytes(2 * 1024 * 1024) },
    { name: "keep.txt", data: Buffer.from("keep") },
  ])
  const skipped = []
  const files = await extractZipNative(zip, {
    limits: { maxEntryBytes: 1024, skipOversizedEntries: true },
    onSkip: (name) => skipped.push(name),
  })
  assert.deepEqual(skipped, ["big.bin"])
  assert.equal(new TextDecoder().decode(files["keep.txt"]), "keep")
})

test("总量超过 maxTotalBytes 时即使允许跳过条目也要终止", async () => {
  const zip = buildZip([
    { name: "a.bin", data: bytes(1000) },
    { name: "b.bin", data: bytes(1000) },
  ])
  await assert.rejects(
    () =>
      extractZipNative(zip, {
        limits: {
          maxEntryBytes: 4096,
          maxTotalBytes: 1500,
          skipOversizedEntries: true,
        },
      }),
    (err) => err instanceof ZipLimitError,
  )
})

test("条目数超过 maxEntries 时抛 ZipLimitError", async () => {
  const zip = buildZip([
    { name: "a.txt", data: Buffer.from("a") },
    { name: "b.txt", data: Buffer.from("b") },
  ])
  await assert.rejects(
    () => extractZipNative(zip, { limits: { maxEntries: 1 } }),
    (err) => err instanceof ZipLimitError,
  )
})

test("store 条目同样受 maxEntryBytes 约束", async () => {
  const zip = buildZip([{ name: "raw.bin", data: bytes(4096), method: 0 }])
  await assert.rejects(
    () => extractZipNative(zip, { limits: { maxEntryBytes: 1024 } }),
    (err) => err instanceof ZipLimitError,
  )
  const files = await extractZipNative(zip, {
    limits: { maxEntryBytes: 1024, skipOversizedEntries: true },
  })
  assert.deepEqual(Object.keys(files), [])
})
