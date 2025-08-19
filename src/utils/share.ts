import { ShareInfo } from "~/types"
import { base_path } from "."

const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

export const randomPwd = () => {
  const arr: string[] = Array.from(
    { length: 5 },
    () => letters[Math.floor(Math.random() * letters.length)],
  )
  return arr.join("")
}

export const makeTemplateData = (
  share: ShareInfo,
  other?: { [k: string]: any },
) => {
  return {
    base_url: location.origin + base_path,
    ...share,
    ...other,
  }
}
