// node --test test/ (npm test). Which picture sources the Night screen and the Board's picture use.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardSources, familyNightFields, nextPhoto, nightFieldsFor, nightSources, ownsNight, toNightLook, type NightLook } from '../src/saverSources.ts'

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

const family: NightLook = { sources: ['google', 'art'], every: 10, brightness: 'medium', clock: false, clockPosition: 'top-left' }

test("nightFieldsFor: a screen that never chose follows the family's Night screen", () => {
  assert.equal(ownsNight({}), false)
  assert.deepEqual(nightFieldsFor({ lowStim: true }, family), { saverSources: ['google', 'art'], saverEvery: 10, saverBright: 'medium', saverClock: false, clockPos: 'top-left' })
  assert.deepEqual(nightFieldsFor({}, undefined), {}, 'settings from before the family default: the plain clock')
})

test("nightFieldsFor: a screen's own choice wins, even one that is just the plain clock", () => {
  assert.deepEqual(nightFieldsFor({ nightOwn: true }, family), {}, 'own, clock only')
  assert.deepEqual(nightFieldsFor({ nightOwn: true, saverSources: ['nature'], saverEvery: 2 }, family), { saverSources: ['nature'], saverEvery: 2 })
})

test('ownsNight: a device that picked anything before the family default keeps it as its own', () => {
  for (const d of [{ saverSources: ['drawings' as const] }, { saverClock: false as const }, { clockPos: 'center' as const }, { saverEvery: 2 }, { saverBright: 'medium' as const }]) {
    assert.equal(ownsNight(d), true, JSON.stringify(d))
    assert.deepEqual(nightFieldsFor(d, family), d)
  }
  assert.equal(ownsNight({ saverSources: [] }), false, 'an empty pick is nothing picked')
})

test('toNightLook and familyNightFields convert both ways', () => {
  assert.deepEqual(toNightLook(familyNightFields(family)), family)
  assert.deepEqual(toNightLook({}), { sources: [], every: 5, brightness: 'low', clock: true, clockPosition: null })
})

test('nightSources: drawings with Paint turned off become nature, like family photos', () => {
  assert.deepEqual(nightSources(['drawings', 'art'], { photos: true, paint: false }), ['nature', 'art'])
  assert.deepEqual(nightSources(['drawings', 'photos'], { photos: false, paint: false }), ['nature'])
  assert.deepEqual(nightSources(['drawings'], { photos: true }), ['drawings'], 'an older caller without paint keeps drawings')
  assert.deepEqual(boardSources([], { photos: false, googlePhotos: 'ready' }, true), ['google'], 'photos off: the Board still has a picture')
})

test('nextPhoto: reads the caption from the latest list, so an edited caption shows', () => {
  const queue = ['a', 'b']
  assert.deepEqual(nextPhoto(queue, [{ id: 'a', caption: null }, { id: 'b', caption: 'Beach day' }]), { id: 'b', caption: 'Beach day' })
  assert.deepEqual(queue, ['a'])
})

test('nextPhoto: skips photos deleted since the pass began; null when the pass is over', () => {
  const queue = ['a', 'gone']
  assert.deepEqual(nextPhoto(queue, [{ id: 'a', caption: 'River trip' }]), { id: 'a', caption: 'River trip' })
  assert.equal(nextPhoto(queue, [{ id: 'a', caption: 'River trip' }]), null)
})
