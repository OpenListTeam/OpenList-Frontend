import sha256 from "sha256"

// TODO: use argon2
const hash_salt = "https://github.com/OpenListTeam/OpenList"

export function hashPwd(pwd: string) {
  return sha256(`${pwd}-${hash_salt}`)
}
