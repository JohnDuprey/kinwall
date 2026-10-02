import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mediaTokenStale } from '../src/mediaToken.ts'

test('mediaTokenStale: a kept token is checked once per load, then trusted for that key', () => {
  const key = 'kw_abcdefghijklmnopqrstuvwxyz'
  const kept = { of: key.slice(-12) }
  assert.equal(mediaTokenStale(kept, key, false), true, 'kept from before (maybe an old v1 token): ask once')
  assert.equal(mediaTokenStale(kept, key, true), false, 'checked this load')
  assert.equal(mediaTokenStale(null, key, true), true, 'none kept')
  assert.equal(mediaTokenStale({ of: 'other-key-12' }, key, true), true, 'another sign-in')
})
