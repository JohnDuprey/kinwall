// node --test test/ (npm test). The built-in coloring pages: each one renders, and Fill stays inside
// the lines. Every page is drawn the way Paint draws it (its lines on their own layer, then Fill
// held in by them), then filled at points a kid would tap: each fill must stay off the edge of the
// picture (the area is closed) and away from every other point (two areas haven't leaked together).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { COLORING_PAGES, PAGE_CATEGORIES } from '../src/coloringPages.ts'
import { floodFill, packRGBA } from '../src/paintTools.ts'

type Pt = [number, number]
/** Where a kid would tap with Fill, in the page's own 800×600 coordinates: one point per area. */
const AREAS: Record<string, Record<string, Pt>> = {
  cat: { sky: [60, 300], floor: [400, 560], body: [400, 420], head: [400, 180], 'left ear': [328, 125], 'right ear': [472, 125], tail: [638, 430], yarn: [180, 470], paw: [352, 506] },
  dog: { sky: [60, 300], floor: [400, 560], body: [400, 420], head: [340, 262], 'left ear': [280, 260], 'right ear': [520, 260], snout: [430, 262], patch: [420, 175], tail: [578, 450], ball: [650, 455], bowl: [192, 495] },
  dinosaur: { sky: [250, 250], ground: [400, 560], body: [485, 300], 'between the legs': [370, 480], sun: [130, 110] },
  unicorn: { sky: [100, 300], neck: [450, 400], mane: [590, 390], horn: [338, 145], heart: [700, 460] },
  fish: { water: [400, 80], sand: [400, 560], body: [520, 240], head: [260, 350], tail: [690, 300], starfish: [560, 552] },
  butterfly: { sky: [60, 300], 'top wing': [180, 230], 'bottom wing': [560, 440], body: [400, 360], head: [400, 175] },
  car: { sky: [400, 100], road: [400, 560], body: [180, 400], window: [380, 290], tire: [230, 410], hubcap: [230, 452] },
  train: { sky: [300, 150], 'cab window': [485, 315], car: [255, 410], boiler: [600, 380], sleeper: [100, 518], ground: [400, 560], smoke: [712, 112] },
  rocket: { space: [250, 500], body: [400, 380], window: [400, 260], planet: [650, 150], moon: [135, 305], flame: [400, 510], fin: [307, 407] },
  house: { sky: [400, 40], grass: [600, 560], walls: [240, 450], roof: [300, 250], door: [370, 440], 'window pane': [262, 325], 'attic window': [370, 230], tree: [650, 340], trunk: [650, 470], sun: [115, 112], chimney: [470, 190] },
  castle: { sky: [400, 170], cloud: [380, 95], ground: [400, 570], wall: [250, 400], tower: [130, 400], 'tower roof': [130, 150], gate: [400, 520], window: [270, 315], flag: [145, 45] },
  garden: { sky: [400, 50], 'outer band': [400, 90], 'second band': [400, 130], 'third band': [400, 170], 'under the rainbow': [400, 250], sun: [400, 330], grass: [340, 420], 'flower bed': [400, 575] },
  cupcake: { background: [100, 300], frosting: [400, 255], 'lower frosting': [420, 335], cup: [400, 450], cherry: [400, 172] },
  'ice-cream': { background: [100, 300], 'top scoop': [400, 120], 'bottom scoop': [400, 220], cherry: [400, 52] },
  pumpkin: { sky: [400, 100], ground: [400, 570], middle: [400, 400], side: [200, 390], stem: [395, 200], leaf: [470, 180] },
  snowman: { sky: [100, 450], ground: [400, 560], 'bottom ball': [400, 420], 'middle ball': [370, 270], head: [370, 120], hat: [400, 50], brim: [400, 103], 'hat band': [400, 85], tree: [700, 480] },
}

const SCALE = 1.5 // about a phone's or tablet's canvas: a gap in the lines shows up at any size this big
const WHITE = packRGBA('#FFFFFF'), RED = packRGBA('#FF0000')

async function render(svg: string) {
  const w = 800 * SCALE, h = 600 * SCALE
  const c = createCanvas(w, h)
  c.getContext('2d').drawImage(await loadImage(Buffer.from(svg)), 0, 0, w, h)
  const a = c.getContext('2d').getImageData(0, 0, w, h).data
  return { w, h, wall: Uint8Array.from({ length: w * h }, (_, i) => a[i * 4 + 3]) }
}

test('there are plenty of pages, each in a category, with original line art', () => {
  assert.ok(COLORING_PAGES.length >= 12, String(COLORING_PAGES.length))
  assert.equal(new Set(COLORING_PAGES.map(p => p.id)).size, COLORING_PAGES.length)
  for (const p of COLORING_PAGES) {
    assert.ok(PAGE_CATEGORIES.includes(p.category), p.id)
    assert.match(p.svg, /^<svg [^>]*viewBox="0 0 800 600"/, p.id)
    assert.doesNotMatch(p.svg, /fill="#fff|fill="white|<image|<text/i, `${p.id}: lines only (a white fill would be a wall)`)
  }
  for (const c of PAGE_CATEGORIES) assert.ok(COLORING_PAGES.some(p => p.category === c), c)
})

for (const pg of COLORING_PAGES) {
  test(`${pg.name}: renders, and Fill stays inside each area`, async () => {
    const areas = AREAS[pg.id]
    assert.ok(areas, `${pg.id}: list its areas in AREAS`)
    const { w, h, wall } = await render(pg.svg)
    const lines = wall.filter(a => a >= 128).length
    assert.ok(lines > w * h * 0.03 && lines < w * h * 0.3, `${pg.id}: ${lines} line pixels`)
    const at = ([x, y]: Pt) => Math.round(y * SCALE) * w + Math.round(x * SCALE)
    for (const [name, pt] of Object.entries(areas)) {
      const img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
      const px = new Uint32Array(img.data.buffer).fill(WHITE)
      assert.ok(floodFill(img, Math.round(pt[0] * SCALE), Math.round(pt[1] * SCALE), RED, 64, wall), `${pg.id} ${name}: the point is on a line`)
      let edge = false
      for (let x = 0; x < w && !edge; x++) edge = px[x] === RED || px[(h - 1) * w + x] === RED
      for (let y = 0; y < h && !edge; y++) edge = px[y * w] === RED || px[y * w + w - 1] === RED
      assert.ok(!edge, `${pg.id} ${name}: Fill leaks out of the picture`)
      for (const [other, q] of Object.entries(areas)) if (other !== name) assert.notEqual(px[at(q)], RED, `${pg.id}: ${name} leaks into ${other}`)
      const area = px.filter(v => v === RED).length / SCALE ** 2
      assert.ok(area > 150, `${pg.id} ${name}: only ${area} px, too small to fill`)
    }
  })
}
