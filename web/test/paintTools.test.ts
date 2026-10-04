// node --test test/ (npm test). Paint's fill, coloring-page line art and brush helpers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { beginStroke, endStroke, floodFill, grainAlpha, GRAIN, lineArt, nextHue, packRGBA, parseSizes, pencilParams, rng, sizeFor, SIZES, SIZE_NAMES, sprayDots, strokeTo, type StrokeOpts } from '../src/paintTools.ts'

const WHITE = packRGBA('#FFFFFF'), BLACK = packRGBA('#000000'), RED = packRGBA('#FF0000')
/** A w×h image from rows of characters: '.' white, '#' black, 'g' light gray (anti-aliased edge). */
function image(rows: string[]) {
  const w = rows[0].length, h = rows.length
  const data = new Uint8ClampedArray(w * h * 4)
  const px = new Uint32Array(data.buffer)
  const GRAY = packRGBA('#D0D0D0')
  rows.forEach((row, y) => [...row].forEach((ch, x) => { px[y * w + x] = ch === '#' ? BLACK : ch === 'g' ? GRAY : WHITE }))
  return { width: w, height: h, data, px }
}
const show = (img: ReturnType<typeof image>) => Array.from({ length: img.height }, (_, y) =>
  Array.from({ length: img.width }, (_, x) => { const v = img.px[y * img.width + x]; return v === RED ? 'R' : v === BLACK ? '#' : v === WHITE ? '.' : 'g' }).join(''))

test('fill: stays inside a closed shape', () => {
  const img = image([
    '.......',
    '.#####.',
    '.#...#.',
    '.#...#.',
    '.#####.',
    '.......',
  ])
  assert.equal(floodFill(img, 3, 2, RED), true)
  assert.deepEqual(show(img), ['.......', '.#####.', '.#RRR#.', '.#RRR#.', '.#####.', '.......'])
})

test('fill: leaks through a gap, and filling with the same color changes nothing', () => {
  const img = image(['#####', '#...#', '#....', '#####'])
  floodFill(img, 1, 1, RED)
  assert.equal(show(img)[2], '#RRRR')
  assert.equal(floodFill(img, 1, 1, RED), false)
})

test('fill: tolerance soaks up soft line edges, but a zero tolerance stops at them', () => {
  const rows = ['#######', '#g...g#', '#g...g#', '#######']
  const soft = image(rows)
  floodFill(soft, 3, 1, RED) // default tolerance (64) treats light gray as the same white
  assert.deepEqual(show(soft).slice(1, 3), ['#RRRRR#', '#RRRRR#'])
  const strict = image(rows)
  floodFill(strict, 3, 1, RED, 0)
  assert.deepEqual(show(strict).slice(1, 3), ['#gRRRg#', '#gRRRg#'])
})

test("fill: a coloring page's lines (their own layer) hold the fill in", () => {
  const img = image(['.....', '.....', '.....'])
  const wall = new Uint8Array(15)
  for (const i of [2, 7, 12]) wall[i] = 255 // a vertical line down the middle
  wall[1] = 100 // a faint edge pixel: fillable, it sits under the line
  floodFill(img, 0, 1, RED, 64, wall)
  assert.deepEqual(show(img), ['RR...', 'RR...', 'RR...'])
  assert.equal(floodFill(img, 2, 0, RED, 64, wall), false, 'tapping on a line does nothing')
})

test('line art: dark is opaque, light is clear, transparent counts as paper, with a soft edge', () => {
  const rgba = Uint8ClampedArray.from([
    0, 0, 0, 255, // black
    255, 255, 255, 255, // white
    20, 20, 20, 0, // transparent black: paper
    150, 150, 150, 255, // right at the threshold: half
  ])
  const a = lineArt(rgba, 4, 1, 150)
  assert.deepEqual([a[0], a[1], a[2]], [255, 0, 0])
  assert.ok(a[3] > 100 && a[3] < 160, String(a[3]))
  assert.equal(lineArt(rgba, 4, 1, 100)[3], 0, 'a lower threshold keeps only darker lines')
})

test('line art: clean up removes specks but keeps lines', () => {
  const w = 10, h = 3
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255)
  const ink = (x: number, y: number) => rgba.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3)
  for (let x = 0; x < 8; x++) ink(x, 0) // a line, 8 px
  ink(5, 2) // a speck
  const kept = lineArt(rgba, w, h, 150, 4)
  assert.equal(kept[0], 255)
  assert.equal(kept[2 * w + 5], 0)
  assert.equal(lineArt(rgba, w, h, 150, 0)[2 * w + 5], 255, 'no clean up keeps the speck')
  assert.equal(lineArt(rgba, w, h, 150, 9)[0], 0, 'a strong clean up drops short lines too')
})

test('seeded randomness: same seed, same strokes', () => {
  const a = rng(42), b = rng(42)
  assert.deepEqual([a(), a(), a()], [b(), b(), b()])
  assert.notEqual(rng(1)(), rng(2)())
  assert.deepEqual(grainAlpha(8, 3), grainAlpha(8, 3))
  assert.notDeepEqual(grainAlpha(64, 3, 0.1), grainAlpha(64, 3, 0.4))
})

const grainOf = (b: 'crayon' | 'pencil') => { const g = GRAIN[b]; return grainAlpha(64, g.seed, g.holes, g.min) }
const holesIn = (g: Uint8ClampedArray) => g.filter(v => v === 0).length / g.length
const mean = (g: Uint8ClampedArray) => g.reduce((a, v) => a + v, 0) / g.length

test('crayon grain: a little paper shows through, the wax is slightly see-through', () => {
  const g = grainOf('crayon')
  assert.ok(holesIn(g) > 0.08 && holesIn(g) < 0.22, String(holesIn(g))) // lighter than it was (a quarter holes)
  assert.ok(g.every(v => v === 0 || (v >= GRAIN.crayon.min && v <= 255)))
})

test('pencil grain: finer and lighter than crayon, so it builds up over a few passes', () => {
  const pencil = grainOf('pencil'), crayon = grainOf('crayon')
  assert.ok(holesIn(pencil) > holesIn(crayon), 'more paper tooth shows')
  assert.ok(mean(pencil) < mean(crayon), 'less graphite per pass')
  assert.ok(holesIn(pencil) < 0.45, 'still reads as a line')
  assert.equal(GRAIN.pencil.up, 1, 'full-size grain: fine, not clumpy')
})

test('pencil: pressure makes it wider and darker; a finger or mouse gets a medium line', () => {
  const none = pencilParams(), light = pencilParams(0.1), hard = pencilParams(1)
  assert.deepEqual(none, pencilParams(0.5))
  assert.equal(none.width, 1)
  assert.ok(light.width < none.width && none.width < hard.width)
  assert.ok(light.alpha < none.alpha && none.alpha < hard.alpha)
  assert.ok(light.alpha > 0.15 && hard.alpha <= 1, 'a light touch still shows; a hard one never goes past solid')
  assert.deepEqual(pencilParams(7), hard, 'out of range is clamped')
  assert.ok(none.alpha < 0.75, 'see-through: strokes build up')
})

test('sizes: more of them, tiny to huge, each with a name', () => {
  assert.ok(SIZES.length >= 10)
  assert.equal(SIZE_NAMES.length, SIZES.length)
  assert.ok(SIZES.every((s, i) => i === 0 || s > SIZES[i - 1]))
  assert.ok(SIZES[0] <= 2 && SIZES.at(-1)! >= 90)
})

test('sizes: each brush remembers its own, with a sensible default', () => {
  assert.ok(SIZES[sizeFor({}, 'pencil')] < SIZES[sizeFor({}, 'marker')], 'a pencil starts thin')
  assert.ok(SIZES[sizeFor({}, 'eraser')] > SIZES[sizeFor({}, 'marker')], 'an eraser starts wide')
  const mem = { ...parseSizes(null), pencil: 7 }
  assert.equal(sizeFor(mem, 'pencil'), 7)
  assert.equal(sizeFor(mem, 'marker'), sizeFor({}, 'marker'), 'other brushes keep theirs')
  assert.deepEqual(parseSizes(JSON.stringify(mem)), mem)
  assert.deepEqual(parseSizes('not json'), {})
  assert.deepEqual(parseSizes('[3]'), {})
  assert.equal(sizeFor({ marker: 99 }, 'marker'), sizeFor({}, 'marker'), 'an old or broken value falls back')
  assert.equal(sizeFor({ marker: 1.5 }, 'marker'), sizeFor({}, 'marker'))
})

test('spray: dots land inside the nozzle circle', () => {
  const dots = sprayDots(rng(9), 50, 50, 10, 200)
  assert.equal(dots.length, 200)
  assert.ok(dots.every(([x, y]) => Math.hypot(x - 50, y - 50) <= 10))
  assert.ok(dots.some(([x, y]) => Math.hypot(x - 50, y - 50) > 7), 'reaches the edge, not bunched in the middle')
})

test('rainbow: the hue moves with distance and wraps', () => {
  assert.equal(nextHue(0, 30), 10)
  assert.equal(nextHue(355, 30), 5)
})

/** A pretend 2D context that records what was drawn. */
function fakeCtx() {
  const calls: string[] = []
  const ctx = {
    canvas: { width: 100, height: 100 }, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '', font: '', textAlign: '', textBaseline: '',
    globalAlpha: 1, globalCompositeOperation: '',
    fillRect: (x: number, y: number) => calls.push(`rect ${x.toFixed(2)},${y.toFixed(2)}`),
    fillText: (t: string, x: number, y: number) => calls.push(`text ${t} ${x},${y}`),
    beginPath() {}, moveTo() {}, lineTo() {}, arc: () => calls.push('arc'), fill() {},
    quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) => calls.push(`curve ${x},${y}`),
    stroke: () => calls.push('stroke'), clearRect() {}, save() {}, restore() {}, drawImage: () => calls.push('drawImage'),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}
const run = (o: StrokeOpts, pts: [number, number][]) => {
  const { ctx, calls } = fakeCtx(), wet = fakeCtx()
  const s = beginStroke(ctx, wet.ctx, o, pts[0])
  for (const p of pts.slice(1)) strokeTo(ctx, wet.ctx, s, p)
  endStroke(ctx, wet.ctx, s)
  return calls
}

test('spray strokes are the same for the same seed, and evenly spaced however the pointer reports', () => {
  const o: StrokeOpts = { brush: 'spray', color: '#000', width: 10, ratio: 1, seed: 5 }
  const once = run(o, [[0, 0], [60, 0]])
  assert.deepEqual(run(o, [[0, 0], [60, 0]]), once)
  // The same path in many small moves puffs the same number of times (the spacing carries over).
  assert.equal(run(o, [[0, 0], ...Array.from({ length: 30 }, (_, i) => [(i + 1) * 2, 0] as [number, number])]).length, once.length)
})

test('marker smooths through midpoints; a stamp is one tap; soft is laid down once at the end', () => {
  const marker = run({ brush: 'marker', color: '#000', width: 4, ratio: 1 }, [[0, 0], [10, 0], [20, 10]])
  assert.deepEqual(marker, ['arc', 'curve 5,0', 'stroke', 'curve 15,5', 'stroke', 'stroke'])
  assert.deepEqual(run({ brush: 'stamp', color: '#f00', width: 10, ratio: 1, stamp: '★' }, [[5, 5], [50, 50]]), ['text ★ 5,5'])
  assert.deepEqual(run({ brush: 'soft', color: '#ff0', width: 10, ratio: 1 }, [[0, 0], [10, 0], [20, 0]]), ['drawImage'])
})
