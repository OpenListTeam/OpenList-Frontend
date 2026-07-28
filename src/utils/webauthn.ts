const webAuthnErrorMessages: Record<string, string> = {
  AbortError: "The passkey request was cancelled.",
  InvalidStateError: "This passkey is already registered.",
  NotAllowedError:
    "The passkey request was cancelled, timed out, or user verification failed.",
  NotSupportedError: "This browser or authenticator cannot use passkeys.",
  SecurityError:
    "Passkeys require HTTPS and a domain that matches the configured site URL.",
}

export const isWebAuthnSupported = () =>
  typeof window !== "undefined" &&
  window.isSecureContext &&
  !!globalThis.PublicKeyCredential &&
  !!navigator.credentials &&
  typeof PublicKeyCredential.parseCreationOptionsFromJSON === "function" &&
  typeof PublicKeyCredential.parseRequestOptionsFromJSON === "function" &&
  typeof PublicKeyCredential.prototype.toJSON === "function"

export const webAuthnErrorMessage = (error: unknown) => {
  if (!(error instanceof DOMException || error instanceof Error)) {
    return "The passkey request failed."
  }
  return webAuthnErrorMessages[error.name] || error.message
}

export const passkeyLoginQuery = (username: string) =>
  new URLSearchParams({ username }).toString()

export const runPasskeyAction = async (
  isLoading: () => boolean,
  setLoading: (loading: boolean) => void,
  action: () => Promise<void>,
) => {
  if (isLoading()) return false
  setLoading(true)
  try {
    await action()
    return true
  } finally {
    setLoading(false)
  }
}

export const createPasskey = async (
  options: PublicKeyCredentialCreationOptionsJSON,
) => {
  if (!isWebAuthnSupported()) {
    throw new DOMException("Passkeys are unavailable.", "NotSupportedError")
  }
  return (await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
  })) as PublicKeyCredential | null
}

export const getPasskey = async (
  options: PublicKeyCredentialRequestOptionsJSON,
  signal: AbortSignal,
) => {
  if (!isWebAuthnSupported()) {
    throw new DOMException("Passkeys are unavailable.", "NotSupportedError")
  }
  return (await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
    signal,
  })) as PublicKeyCredential | null
}
