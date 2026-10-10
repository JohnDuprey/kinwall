// node --test test/ (npm test). Cast screen mode (Nest Hub and other Cast smart displays).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { castScale, castScreen, isCastAgent, screenParam, withoutScreenParam } from '../src/cast.ts'
import { screenScale } from '../src/screenScale.ts'

const HUB = 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 CrKey/1.56.500000 DeviceType/SmartDisplay'
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

test('a Cast device is found by its user agent; ordinary browsers are not', () => {
  assert.equal(isCastAgent(HUB), true)
  assert.equal(isCastAgent(CHROME), false)
  assert.equal(isCastAgent('Mozilla/5.0 (Linux; Android 14; TCL Tab 10)'), false)
})

test('the link turns it on or off and is stored; otherwise the user agent decides', () => {
  assert.equal(screenParam('?screen=cast'), true)
  assert.equal(screenParam('?lang=de&screen=normal'), false)
  assert.equal(screenParam('?screen=huge'), undefined)
  assert.equal(screenParam(''), undefined)
  assert.equal(castScreen(undefined, HUB), true)
  assert.equal(castScreen(undefined, CHROME), false)
  assert.equal(castScreen(true, CHROME), true)
  assert.equal(castScreen(false, HUB), false, 'a Cast device can be turned back to normal')
})

test('withoutScreenParam drops only screen=', () => {
  assert.equal(withoutScreenParam('https://k.example/?screen=cast#/calendar'), 'https://k.example/#/calendar')
  assert.equal(withoutScreenParam('https://k.example/?lang=de&screen=cast#key=abc'), 'https://k.example/?lang=de#key=abc')
})

test('castScale: 1 at 600px tall, bigger when the page is laid out taller, capped', () => {
  assert.equal(castScale(600), 1)
  assert.equal(castScale(500), 1)
  assert.equal(castScale(720), 1.2)
  assert.equal(castScale(1200), 1.4)
})

test('a cast screen is never shrunk by Screen scale Auto (a Hub is 600px tall, like a 10" Android tablet)', () => {
  assert.equal(screenScale(undefined, 600), 600 / 720)
  assert.equal(screenScale(undefined, 600, true), 1)
  assert.equal(screenScale(110, 600, true), 1.1, "the device's own pick still wins")
})
