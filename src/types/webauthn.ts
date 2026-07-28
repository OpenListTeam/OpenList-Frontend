export interface PasskeyCredential {
  id: string
  name: string
  fingerprint: string
  created_at?: string
  last_used_at?: string
}

export interface PasskeyChallenge<T> {
  session: string
  options: { publicKey: T }
}
