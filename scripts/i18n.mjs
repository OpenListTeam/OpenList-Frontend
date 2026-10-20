import fs from "fs"
import path from "path"

const root = "./src/lang"
const entry = "entry.ts"
const sourceDir = path.join(root, "en")
const sourceFiles = fs
  .readdirSync(sourceDir)
  .filter((file) => file.endsWith(".json"))
const langs = fs.readdirSync(root)
langs
  .filter((lang) => lang !== "en")
  .forEach((lang) => {
    const langDir = path.join(root, lang)
    sourceFiles.forEach((file) => {
      const target = path.join(langDir, file)
      if (!fs.existsSync(target)) {
        fs.copyFileSync(path.join(sourceDir, file), target)
      }
    })
    fs.copyFileSync(path.join(sourceDir, entry), path.join(langDir, entry))
  })
