// node --test test/ (npm test). Screen scale's Auto rule and the viewport tag it writes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoScale, screenScale, viewportContent } from '../src/screenScale.ts'

test('autoScale: a 10" Android tablet is drawn as a 720px-wide tablet; everything else stays at 100%', () => {
  assert.equal(autoScale(600), 600 / 720, '1200x1920 at density 320')
  assert.equal(autoScale(560), 560 / 720)
  assert.equal(autoScale(719), 719 / 720)
  for (const phone of [320, 375, 390, 430, 440]) assert.equal(autoScale(phone), 1, `phone ${phone}`)
  assert.equal(autoScale(559), 1)
  assert.equal(autoScale(720), 1)
  for (const big of [744, 768, 810, 834, 1024, 1080]) assert.equal(autoScale(big), 1, `iPad or wall ${big}`)
})

test('screenScale: a pick wins over Auto; anything else is Auto', () => {
  assert.equal(screenScale(125, 600), 1.25)
  assert.equal(screenScale(100, 600), 1)
  assert.equal(screenScale(75, 390), 0.75)
  assert.equal(screenScale(undefined, 600), 600 / 720)
  assert.equal(screenScale(undefined, 390), 1)
  assert.equal(screenScale(42, 390), 1, 'not a choice')
})

test('viewportContent: 100% is the tag the app always had; scaled drops width; only a wall display pins the zoom', () => {
  assert.equal(viewportContent(1, false), 'width=device-width, initial-scale=1.0, viewport-fit=cover')
  assert.equal(viewportContent(1, true), 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover')
  assert.equal(viewportContent(600 / 720, false), 'initial-scale=0.8333, viewport-fit=cover')
  assert.equal(viewportContent(1.25, true), 'initial-scale=1.25, minimum-scale=1.25, maximum-scale=1.25, user-scalable=no, viewport-fit=cover')
})
