import fs from "fs"
import path from "path"
import https from "https"
import { execSync } from "child_process"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const langDir = path.join(root, "src", "lang")
const tarball = path.join(root, "i18n.tar.gz")
const api =
  "https://api.github.com/repos/OpenListTeam/OpenList-Frontend/releases?per_page=10"

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "openlist-frontend-i18n-fetch",
          Accept: "application/vnd.github+json",
        },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          get(res.headers.location).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          res.resume()
          return
        }
        const chunks = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => resolve(Buffer.concat(chunks)))
      },
    )
    req.on("error", reject)
  })
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const req = https.get(
      url,
      { headers: { "User-Agent": "openlist-frontend-i18n-fetch" } },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close()
          fs.unlinkSync(dest)
          download(res.headers.location, dest).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          res.resume()
          return
        }
        res.pipe(file)
        file.on("finish", () => file.close(() => resolve()))
      },
    )
    req.on("error", (err) => {
      try {
        fs.unlinkSync(dest)
      } catch {}
      reject(err)
    })
  })
}

const body = JSON.parse((await get(api)).toString("utf8"))
let url
for (const release of body) {
  const asset = (release.assets || []).find((a) => a.name === "i18n.tar.gz")
  if (asset) {
    url = asset.browser_download_url
    console.log(`Using i18n from release ${release.tag_name}`)
    break
  }
}
if (!url) {
  console.error("i18n.tar.gz not found in recent releases")
  process.exit(1)
}

fs.mkdirSync(langDir, { recursive: true })
await download(url, tarball)
execSync(`tar -xzf "${tarball}" -C "${langDir}"`, { stdio: "inherit" })
fs.unlinkSync(tarball)

// remove incomplete locale dirs (no index.json), keep en
for (const name of fs.readdirSync(langDir)) {
  const full = path.join(langDir, name)
  if (!fs.statSync(full).isDirectory() || name === "en") continue
  if (!fs.existsSync(path.join(full, "index.json"))) {
    fs.rmSync(full, { recursive: true, force: true })
    console.log(`removed incomplete locale: ${name}`)
  }
}

// copy entry.ts from en
execSync("node ./scripts/i18n.mjs", { cwd: root, stdio: "inherit" })
console.log("i18n fetch done:", fs.readdirSync(langDir).join(", "))
