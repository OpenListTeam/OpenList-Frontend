import test from "node:test"
import assert from "node:assert/strict"
import { resolveDownloadLinkBase } from "./download_link_base.ts"

const fallback = "http://127.0.0.1:5244"

test("empty or missing value falls back", () => {
  assert.equal(resolveDownloadLinkBase("", fallback), fallback)
  assert.equal(resolveDownloadLinkBase(undefined, fallback), fallback)
  assert.equal(resolveDownloadLinkBase("   ", fallback), fallback)
})

test("invalid value falls back", () => {
  for (const value of [
    "files.example.com",
    "/openlist",
    "ftp://files.example.com",
    "https:///d",
    "https:// files.example.com",
  ]) {
    assert.equal(resolveDownloadLinkBase(value, fallback), fallback)
  }
})

test("valid base trims whitespace and trailing slashes", () => {
  assert.equal(
    resolveDownloadLinkBase("  https://files.example.com//  ", fallback),
    "https://files.example.com",
  )
})

test("valid base keeps sub-path", () => {
  assert.equal(
    resolveDownloadLinkBase("https://files.example.com/openlist/", fallback),
    "https://files.example.com/openlist",
  )
})

test("uppercase scheme is accepted", () => {
  assert.equal(
    resolveDownloadLinkBase("HTTPS://files.example.com", fallback),
    "HTTPS://files.example.com",
  )
})
