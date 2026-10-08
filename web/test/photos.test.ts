import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeImageSrc } from '../src/photos.ts'

test('safeImageSrc: only object URLs, inline images and same-origin addresses render', () => {
  const origin = 'https://wall.example'
  assert.equal(safeImageSrc('blob:https://wall.example/1b2c', origin), 'blob:https://wall.example/1b2c')
  assert.equal(safeImageSrc('data:image/webp;base64,AAAA', origin), 'data:image/webp;base64,AAAA')
  assert.equal(safeImageSrc('/api/photos/p1', origin), '/api/photos/p1')
  assert.equal(safeImageSrc('https://wall.example/api/photos/p1', origin), 'https://wall.example/api/photos/p1')
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'blob:https://other.example/1', 'https://other.example/a.png', '//other.example/a.png']) {
    assert.equal(safeImageSrc(bad, origin), undefined, bad)
  }
})
