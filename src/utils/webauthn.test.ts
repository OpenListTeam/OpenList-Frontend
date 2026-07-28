import assert from "node:assert/strict"
import test from "node:test"
import { runPasskeyAction } from "./webauthn.ts"

test("keeps passkey actions loading until the credential promise settles", async () => {
  let loading = false
  let actionCalls = 0
  let resolveCredential: () => void
  const credential = new Promise<void>((resolve) => {
    resolveCredential = resolve
  })

  const run = () =>
    runPasskeyAction(
      () => loading,
      (value) => {
        loading = value
      },
      async () => {
        actionCalls++
        await credential
      },
    )

  const pending = run()
  await Promise.resolve()

  assert.equal(loading, true)
  assert.equal(await run(), false)
  assert.equal(actionCalls, 1)

  resolveCredential!()
  assert.equal(await pending, true)
  assert.equal(loading, false)

  await assert.rejects(
    runPasskeyAction(
      () => loading,
      (value) => {
        loading = value
      },
      async () => {
        throw new DOMException("Cancelled", "NotAllowedError")
      },
    ),
    { name: "NotAllowedError" },
  )
  assert.equal(loading, false)
})
