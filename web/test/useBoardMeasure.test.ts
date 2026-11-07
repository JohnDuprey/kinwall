import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frameMeasure } from '../src/useBoardMeasure.ts'

function frames() {
  let id = 0
  const pending = new Map<number, FrameRequestCallback>()
  const request = (callback: FrameRequestCallback) => { pending.set(++id, callback); return id }
  const cancel = (key: number) => { pending.delete(key) }
  const run = () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(0)) }
  return { pending, request, cancel, run }
}

test('card resize notifications share one measurement per animation frame', () => {
  const clock = frames()
  let reads = 0
  const measure = frameMeasure(() => { reads++ }, clock.request, clock.cancel)
  for (let i = 0; i < 20; i++) measure.schedule()
  assert.equal(clock.pending.size, 1)
  assert.equal(reads, 0)
  clock.run()
  assert.equal(reads, 1)
  measure.schedule(); clock.run()
  assert.equal(reads, 2, 'later changes still remeasure')
})

test('a content measurement replaces a pending resize, and cleanup cancels pending work', () => {
  const clock = frames()
  let reads = 0
  const measure = frameMeasure(() => { reads++ }, clock.request, clock.cancel)
  measure.schedule(); measure.flush()
  assert.equal(reads, 1)
  assert.equal(clock.pending.size, 0)
  measure.schedule(); measure.cancel(); clock.run()
  assert.equal(reads, 1)
  measure.schedule(); clock.run()
  assert.equal(reads, 2, 'Strict Mode can set up the observer again after cleanup')
})
