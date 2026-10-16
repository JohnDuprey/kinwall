// node --test test/ (npm test). Paint's view-only zoom: screen ↔ picture and keeping the picture in view.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampView, FIT, MAX_ZOOM, MIN_ZOOM, toPicture, zoomTo, type View } from '../src/paintZoom.ts'

const W = 400, H = 300
const near = (a: number[], b: number[]) => a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-9, `${a} ≈ ${b}`))

test('fit shows the picture 1:1', () => {
  assert.deepEqual(toPicture(FIT, 120, 80), [120, 80])
})

test('toPicture undoes the zoom and pan', () => {
  const v: View = { z: 2, x: -100, y: -50 }
  near(toPicture(v, 0, 0), [50, 25])
  near(toPicture(v, 300, 250), [200, 150])
})

test('zooming around a point keeps that spot under it', () => {
  const v = zoomTo(FIT, 2, [100, 60], [100, 60], W, H)
  assert.equal(v.z, 2)
  near(toPicture(v, 100, 60), [100, 60])
  const w = zoomTo(v, 3, [250, 200], [250, 200], W, H)
  near(toPicture(w, 250, 200), toPicture(v, 250, 200))
})

test('a pinch that moves pans with the fingers', () => {
  const start: View = { z: 2, x: -100, y: -100 }
  const v = zoomTo(start, 2, [200, 150], [180, 140], W, H)
  near(toPicture(v, 180, 140), toPicture(start, 200, 150))
})

test('zoom stays between the limits', () => {
  assert.equal(zoomTo(FIT, 99, [0, 0], [0, 0], W, H).z, MAX_ZOOM)
  assert.deepEqual(zoomTo({ z: 2, x: -50, y: -50 }, 0.2, [10, 10], [10, 10], W, H), FIT)
  assert.equal(MIN_ZOOM, 1)
})

test('panning never leaves blank space beside the picture', () => {
  assert.deepEqual(clampView({ z: 2, x: 50, y: 30 }, W, H), { z: 2, x: 0, y: 0 })
  assert.deepEqual(clampView({ z: 2, x: -900, y: -900 }, W, H), { z: 2, x: -W, y: -H })
  assert.deepEqual(clampView({ z: 1, x: -20, y: 10 }, W, H), FIT)
})
