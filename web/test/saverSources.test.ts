// node --test test/ (npm test). Which picture sources the Night screen and the Board's picture use.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardSources, nightSources } from '../src/saverSources.ts'

const ready = { photos: true, googlePhotos: 'ready' as const }

test('nightSources: Google Photos shows once it is ready', () => {
  assert.deepEqual(nightSources(['google', 'art'], ready), ['google', 'art'])
})

test('nightSources: Google Photos not ready or needing reconnecting falls back to the other picks', () => {
  for (const googlePhotos of ['off', 'signing-in', 'choosing', 'reconnect', 'refused', undefined] as const) {
    assert.deepEqual(nightSources(['drawings', 'google', 'art'], { photos: true, googlePhotos }), ['drawings', 'art'])
    // Picked alone: nature pictures stand in, like family photos turned off.
    assert.deepEqual(nightSources(['google'], { photos: true, googlePhotos }), ['nature'])
  }
})

test('nightSources: family photos turned off become nature, once', () => {
  assert.deepEqual(nightSources(['photos', 'nature'], { photos: false }), ['nature'])
  assert.deepEqual(nightSources([], ready), [], 'nothing picked: the clock')
})

test("boardSources: nothing picked on this display: the family's own pictures, else nature", () => {
  assert.deepEqual(boardSources([], ready, true), ['google', 'photos'])
  assert.deepEqual(boardSources([], ready, false), ['google'])
  assert.deepEqual(boardSources([], { photos: true, googlePhotos: 'reconnect' }, true), ['photos'])
  assert.deepEqual(boardSources([], { photos: true, googlePhotos: 'off' }, false), ['nature'])
})

test("boardSources: this display's picks win, with the same fallbacks", () => {
  assert.deepEqual(boardSources(['art', 'google'], ready, true), ['art', 'google'])
  assert.deepEqual(boardSources(['google'], { photos: true, googlePhotos: 'choosing' }, true), ['nature'])
})
