// node --test test/ (npm test). Passkey failures reach people as plain sentences.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { passkeyErrorText as friendlyError } from '../src/failureMessage.ts'
import { ApiError } from '../src/apiError.ts'

test('friendlyError: a dismissed or timed-out prompt is a plain sentence, not browser text', () => {
  const e = new Error('The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/')
  e.name = 'NotAllowedError'
  assert.equal(friendlyError(e), 'That was cancelled or timed out. Try again.')
})

test('friendlyError: unknown errors never show their own text; the server\'s words pass through', () => {
  assert.equal(friendlyError(new TypeError('Failed to fetch')), "Couldn't use the passkey. Try again.")
  assert.equal(friendlyError(new ApiError(400, 'That recovery link has expired.')), 'That recovery link has expired.')
})
