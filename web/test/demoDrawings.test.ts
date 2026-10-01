// node --test test/ (npm test). The demo's Paint drawings look like a kid drew them, and the same
// pictures show in Newscast, Photos and the Night screen slideshow (which reads family photos).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mock } from '../src/mock.ts'
import { DEMO_DRAWINGS } from '../src/mock-drawings.ts'

const isKidDrawing = (url: string) => url.startsWith('data:image/svg+xml,') && decodeURIComponent(url).includes('feDisplacementMap')

test('every demo drawing is a crayon-style SVG', () => {
  assert.ok(DEMO_DRAWINGS.length >= 4)
  for (const d of DEMO_DRAWINGS) assert.ok(isKidDrawing(d.url), d.caption)
})

test('Newscast drawing items show the kid drawings, never a stock photo', async () => {
  const items = (await mock.getNewscast({ days: 7 })).items.filter(i => i.kind === 'drawings')
  assert.ok(items.length >= 2)
  for (const i of items) {
    assert.equal(i.photos.length, 1)
    assert.ok(isKidDrawing(i.photos[0].url), i.title)
    assert.ok(i.title.includes(DEMO_DRAWINGS.find(d => d.id === i.photos[0].id)!.caption), i.title)
  }
})

test('family photos (Photos page and Night screen slideshow) include the drawings, credited', async () => {
  const photos = await mock.getPhotos()
  for (const d of DEMO_DRAWINGS) {
    const p = photos.find(x => x.id === d.id)
    assert.ok(p, d.caption)
    assert.equal(p.url, d.url)
    assert.equal(p.caption, d.caption)
    assert.equal(p.memberId, d.memberId)
  }
})
