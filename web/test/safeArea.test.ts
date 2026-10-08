// node --test test/ (npm test). Which side of an iPhone on its side has the island.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { islandSide } from '../src/safeArea.ts'

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KinwallApp/1.2'

test('islandSide: the island is at the top of the phone, left or right as it turns', () => {
  assert.equal(islandSide(iphone, 'landscape-primary', 90), 'left')
  assert.equal(islandSide(iphone, 'landscape-secondary', -90), 'right')
  assert.equal(islandSide(iphone, 'portrait-primary', 0), null)
})

test('islandSide: older iOS without screen.orientation goes by window.orientation', () => {
  assert.equal(islandSide(iphone, undefined, 90), 'left')
  assert.equal(islandSide(iphone, undefined, -90), 'right')
  assert.equal(islandSide(iphone, undefined, 0), null)
})

test('islandSide: only iPhones (an iPad, Android and computers keep their insets)', () => {
  assert.equal(islandSide('Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X)', 'landscape-primary', 90), null)
  assert.equal(islandSide('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'landscape-primary', 0), null)
  assert.equal(islandSide('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 'landscape-primary', 90), null)
})
