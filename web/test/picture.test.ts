// node --test test/ (npm test). Profile pictures: the crop sheet's math and the avatar's fallback.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampCrop, faceOf, sourceRect, startCrop, zoomTo } from '../src/picture.ts'

test('startCrop: the picture covers the circle, centered, at the smallest zoom', () => {
  const c = startCrop(1200, 800, 300) // landscape: the short side (800) fills the 300 px circle
  assert.equal(c.scale, 300 / 800)
  assert.equal(c.y, 0)
  assert.equal(c.x, (300 - 1200 * c.scale) / 2)
  assert.deepEqual(sourceRect(c, 300), { sx: 200, sy: 0, size: 800 }, 'the middle square')
})

test('clampCrop: never drags or zooms out past the edge (no empty corners)', () => {
  const img = { w: 1000, h: 1000 }
  assert.deepEqual(clampCrop({ x: 50, y: -2000, scale: 0.1 }, img, 200), { x: 0, y: 0, scale: 0.2 }, 'zoom at least covers; offsets stay inside')
  assert.deepEqual(clampCrop({ x: -300, y: 10, scale: 0.4 }, img, 200), { x: -200, y: 0, scale: 0.4 })
  assert.deepEqual(clampCrop({ x: -1, y: -1, scale: 50 }, img, 200).scale, 0.2 * 6, 'at most 6x zoom')
})

test('zoomTo: the point under the fingers stays put', () => {
  const img = { w: 1000, h: 1000 }
  const c = zoomTo({ x: 0, y: 0, scale: 0.2 }, 0.4, 100, 100, img, 200) // zoom 2x around the center
  assert.deepEqual(c, { x: -100, y: -100, scale: 0.4 })
  assert.deepEqual(sourceRect(c, 200), { sx: 250, sy: 250, size: 500 }, 'the middle quarter')
})

test('faceOf: the picture when there is one and it loaded, else the emoji, else the initial', () => {
  const src = (p: string) => `https://kinwall.test${p}?key=t`
  const maya = { name: 'Maya', avatar: '🦄', picture: '/api/photos/p1/image' }
  assert.deepEqual(faceOf(maya, src, false), { text: '🦄', src: 'https://kinwall.test/api/photos/p1/image?key=t' })
  assert.deepEqual(faceOf(maya, src, true), { text: '🦄', src: null }, 'a failed load (offline, deleted) falls back')
  assert.deepEqual(faceOf({ name: 'Leo', avatar: '', picture: null }, src, false), { text: 'L', src: null })
  assert.deepEqual(faceOf(maya, () => '', false), { text: '🦄', src: null }, 'no media token yet')
})
