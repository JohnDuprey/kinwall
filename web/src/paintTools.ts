// Paint's brushes, fill and coloring-page line art. No React here: Paint.tsx draws with these, and
// so does web/scripts/demo-drawings.html, which makes the demo's drawings with the same brushes.
// Strokes work in canvas pixels on a 2D context; everything random takes a seeded generator so a
// scripted drawing comes out the same every time. Per-pixel work happens only for Fill and for
// importing a page, never on a pointer move.

export type Brush = 'pencil' | 'marker' | 'crayon' | 'soft' | 'spray' | 'rainbow' | 'stamp' | 'eraser'
export const PAPER = '#FFFFFF'

/** Shapes take the chosen color; emoji stamps bring their own. U+FE0E keeps the heart a shape. */
export const STAMPS: [stamp: string, name: string][] = [
  ['★', 'Star'], ['♥︎', 'Heart'], ['●', 'Dot'], ['◆', 'Diamond'],
  ['🌸', 'Flower'], ['🦋', 'Butterfly'], ['🐶', 'Dog'], ['🐱', 'Cat'], ['🐟', 'Fish'], ['🚀', 'Rocket'], ['🌈', 'Rainbow'], ['🍎', 'Apple'],
]

/** mulberry32: a small, fast seeded generator in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `n` airbrush dots spread evenly over a disc of radius `r` around (cx, cy). */
export function sprayDots(rand: () => number, cx: number, cy: number, r: number, n: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r // sqrt: even over the area, not bunched in the middle
    out.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d])
  }
  return out
}

/** Paper grain: a size×size tile of alpha values, holes (0) where the paper shows through and
 * slightly see-through color (min-255) elsewhere. Fixed to the paper, like real paper tooth. */
export function grainAlpha(size: number, seed: number, holes = 0.16, min = 205): Uint8ClampedArray {
  const rand = rng(seed)
  const a = new Uint8ClampedArray(size * size)
  for (let i = 0; i < a.length; i++) a[i] = rand() < holes ? 0 : min + Math.floor(rand() * (256 - min))
  return a
}
/** The grain each textured brush draws through. Crayon: soft clumps of wax (drawn at half size and
 * smoothed up). Pencil: fine, light graphite that builds up over a few passes. */
export const GRAIN = {
  crayon: { seed: 7, holes: 0.16, min: 205, up: 2 },
  pencil: { seed: 11, holes: 0.3, min: 120, up: 1 },
}

/** Pencil: a stylus's pressure (0-1; none from a finger or mouse) → line width (× the brush size)
 * and opacity. Light is thin and faint, hard is wide and dark; no pressure is the middle. */
export function pencilParams(pressure?: number) {
  const p = pressure === undefined ? 0.5 : Math.min(1, Math.max(0, pressure))
  return { width: 0.6 + 0.8 * p, alpha: 0.25 + 0.7 * p }
}

/** Brush sizes in CSS px, smallest to biggest, and what a screen reader calls them. */
export const SIZES = [2, 4, 7, 11, 16, 24, 34, 48, 68, 96]
export const SIZE_NAMES = ['Teeny', 'Tiny', 'Small', 'Medium', 'Big', 'Bigger', 'Huge', 'Giant', 'Enormous', 'Gigantic']
const DEFAULT_SIZE: Record<Brush, number> = { pencil: 1, marker: 3, crayon: 4, soft: 4, spray: 5, rainbow: 4, stamp: 5, eraser: 5 }
/** The size (an index into SIZES) each brush was last used at on this device. */
export type SizeMemory = Partial<Record<Brush, number>>
export const sizeFor = (mem: SizeMemory, b: Brush) => {
  const i = mem[b]
  return Number.isInteger(i) && i! >= 0 && i! < SIZES.length ? i! : DEFAULT_SIZE[b]
}
export const parseSizes = (json: string | null): SizeMemory => {
  try { const v = JSON.parse(json ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} }
}

/** Rainbow brush: the hue moves a third of a degree per CSS pixel drawn. */
export const nextHue = (hue: number, cssDistance: number) => (hue + cssDistance / 3) % 360

export const packRGBA = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return ((255 << 24) | ((n & 255) << 16) | (n & 0xff00) | (n >> 16)) >>> 0 // little-endian ABGR
}

/** Scanline flood fill in place. `tol`: largest per-channel difference from the start pixel that
 * still counts as the same area (soaks up anti-aliased stroke edges). `wall`: one alpha per pixel
 * (a coloring page's lines); 128 or more stops the fill, so a page's outlines hold it in even
 * though they're on their own layer. Returns false if nothing changed. */
export function floodFill(img: Pick<ImageData, 'width' | 'height' | 'data'>, x0: number, y0: number, rgba: number, tol = 64, wall?: ArrayLike<number>): boolean {
  const { width: w, height: h } = img
  const px = new Uint32Array(img.data.buffer, img.data.byteOffset, w * h)
  const start = px[y0 * w + x0]
  if (start === rgba || (wall && wall[y0 * w + x0] >= 128)) return false
  const sr = start & 255, sg = (start >>> 8) & 255, sb = (start >>> 16) & 255
  const same = (i: number) => {
    if (wall && wall[i] >= 128) return false
    const v = px[i]
    return Math.abs((v & 255) - sr) <= tol && Math.abs(((v >>> 8) & 255) - sg) <= tol && Math.abs(((v >>> 16) & 255) - sb) <= tol
  }
  const done = new Uint8Array(w * h)
  const stack = [x0, y0]
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!
    const row = y * w
    if (done[row + x] || !same(row + x)) continue
    let l = x, r = x
    while (l > 0 && !done[row + l - 1] && same(row + l - 1)) l--
    while (r < w - 1 && !done[row + r + 1] && same(row + r + 1)) r++
    let up = false, down = false // push one seed per run above/below, not one per pixel
    for (let i = l; i <= r; i++) {
      done[row + i] = 1
      px[row + i] = rgba
      if (y > 0) { const ok = !done[row - w + i] && same(row - w + i); if (ok && !up) stack.push(i, y - 1); up = ok }
      if (y < h - 1) { const ok = !done[row + w + i] && same(row + w + i); if (ok && !down) stack.push(i, y + 1); down = ok }
    }
  }
  return true
}

/** A picture (RGBA) → coloring-page line art: one alpha per pixel, dark lines opaque, the rest
 * clear. Gray at `threshold` (0-255) is the cut, with a soft ramp either side so edges stay smooth;
 * transparent pixels count as white paper. `cleanup` removes dark specks smaller than that many
 * pixels (dust, paper texture, a phone photo's noise). */
export function lineArt(rgba: ArrayLike<number>, w: number, h: number, threshold = 150, cleanup = 0): Uint8ClampedArray {
  const RAMP = 24
  const out = new Uint8ClampedArray(w * h)
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255
    const lum = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) * a + 255 * (1 - a)
    out[i] = Math.round(255 * Math.min(1, Math.max(0, (threshold + RAMP - lum) / (2 * RAMP))))
  }
  if (cleanup > 0) {
    // Connected dark areas (8 neighbors); a small one is a speck, not a line.
    const seen = new Uint8Array(w * h)
    const comp: number[] = []
    for (let s = 0; s < w * h; s++) {
      if (seen[s] || out[s] < 128) continue
      comp.length = 0
      const stack = [s]
      seen[s] = 1
      while (stack.length) {
        const i = stack.pop()!
        comp.push(i)
        const x = i % w, y = (i - x) / w
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, j = ny * w + nx
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && !seen[j] && out[j] >= 128) { seen[j] = 1; stack.push(j) }
        }
      }
      if (comp.length < cleanup) for (const i of comp) out[i] = 0
    }
  }
  return out
}

// ---------- Strokes on a canvas ----------

type Ctx = CanvasRenderingContext2D
type Pt = [number, number]
export interface StrokeOpts {
  brush: Brush
  color: string
  width: number   // canvas px
  ratio: number   // canvas px per CSS px (spacing and the rainbow's pace are in CSS px)
  stamp?: string
  seed?: number
}
export interface Stroke extends StrokeOpts { rand: () => number; last: Pt; mid: Pt; hue: number; carry: number; pts: Pt[]; pressure?: number }

const patterns = new Map<string, CanvasPattern>()
/** A crayon's or pencil's paint: the color through the paper's grain, one tile per color (cached). */
function grainPaint(ctx: Ctx, color: string, brush: keyof typeof GRAIN): CanvasPattern | string {
  const key = brush + color
  let p = patterns.get(key)
  if (p) return p
  const g = GRAIN[brush], n = 64, N = n * g.up
  const small = document.createElement('canvas')
  small.width = small.height = n
  const img = small.getContext('2d')!.createImageData(n, n)
  const grain = grainAlpha(n, g.seed, g.holes, g.min)
  for (let i = 0; i < grain.length; i++) img.data[i * 4 + 3] = grain[i]
  small.getContext('2d')!.putImageData(img, 0, 0)
  const tile = document.createElement('canvas')
  tile.width = tile.height = N
  const t = tile.getContext('2d')!
  t.drawImage(small, 0, 0, N, N)
  t.globalCompositeOperation = 'source-in'
  t.fillStyle = color
  t.fillRect(0, 0, N, N)
  p = ctx.createPattern(tile, 'repeat') ?? undefined
  if (!p) return color
  if (patterns.size > 64) patterns.clear()
  patterns.set(key, p)
  return p
}

const inkOf = (s: Stroke) => s.brush === 'eraser' ? PAPER : s.brush === 'rainbow' ? `hsl(${s.hue} 90% 55%)` : s.color
const SOFT_ALPHA = 0.4

function dot(ctx: Ctx, s: Stroke, p: Pt) {
  const pencil = s.brush === 'pencil' ? pencilParams(s.pressure) : null
  ctx.fillStyle = s.brush === 'crayon' || s.brush === 'pencil' ? grainPaint(ctx, s.color, s.brush) : inkOf(s)
  ctx.globalAlpha = pencil?.alpha ?? 1
  ctx.beginPath(); ctx.arc(p[0], p[1], s.width * (pencil?.width ?? 1) / 2, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 1
}
/** The pen for a line brush's next bit of stroke. A pencil is see-through, so its pieces meet end
 * to end (butt caps) instead of overlapping in darker beads; the midpoint curves join smoothly. */
function pen(ctx: Ctx, s: Stroke) {
  ctx.lineJoin = 'round'
  ctx.lineCap = s.brush === 'pencil' ? 'butt' : 'round'
  if (s.brush === 'crayon') {
    ctx.strokeStyle = grainPaint(ctx, s.color, 'crayon')
    ctx.lineWidth = s.width * (0.82 + s.rand() * 0.3) // a wax stick's uneven edge
  } else if (s.brush === 'pencil') {
    const k = pencilParams(s.pressure)
    ctx.strokeStyle = grainPaint(ctx, s.color, 'pencil')
    ctx.lineWidth = s.width * k.width
    ctx.globalAlpha = k.alpha
  } else {
    ctx.strokeStyle = inkOf(s)
    ctx.lineWidth = s.width
  }
}
function spray(ctx: Ctx, s: Stroke, p: Pt) {
  const r = Math.max(s.width * 1.2, 6 * s.ratio), d = Math.max(1, s.ratio * 1.2)
  ctx.fillStyle = s.color
  for (const [x, y] of sprayDots(s.rand, p[0], p[1], r, Math.min(90, Math.round(10 + r / s.ratio * 1.2)))) ctx.fillRect(x - d / 2, y - d / 2, d, d)
}
function softPath(wet: Ctx, s: Stroke) {
  wet.clearRect(0, 0, wet.canvas.width, wet.canvas.height)
  wet.strokeStyle = wet.fillStyle = s.color
  wet.lineWidth = s.width * 2.5
  wet.lineCap = wet.lineJoin = 'round'
  const [first, ...rest] = s.pts
  wet.beginPath(); wet.moveTo(first[0], first[1])
  if (!rest.length) wet.lineTo(first[0] + 0.01, first[1])
  for (let i = 0; i < rest.length; i++) {
    const a = s.pts[i], b = rest[i]
    wet.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
  }
  wet.stroke()
}

/** Start a stroke at `p` (a tap leaves a dot, a spray puff or a stamp). `wet` is a same-size
 * canvas above the drawing that shows the Soft brush's stroke until it's finished. */
export function beginStroke(ctx: Ctx, wet: Ctx | null, o: StrokeOpts, p: Pt, pressure?: number): Stroke {
  const rand = rng(o.seed ?? (Math.random() * 2 ** 32))
  const s: Stroke = { ...o, rand, last: p, mid: p, hue: rand() * 360, carry: 0, pts: [p], pressure }
  if (o.brush === 'stamp') {
    const px = Math.max(o.width * 2.5, 28 * o.ratio)
    ctx.font = `${px}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = o.color
    ctx.fillText(o.stamp ?? '★', p[0], p[1])
  } else if (o.brush === 'spray') spray(ctx, s, p)
  else if (o.brush === 'soft') { if (wet) softPath(wet, s) }
  else dot(ctx, s, p)
  return s
}

/** `pressure`: a stylus's, smoothed a little so the line doesn't jump in width. */
export function strokeTo(ctx: Ctx, wet: Ctx | null, s: Stroke, p: Pt, pressure?: number) {
  const dist = Math.hypot(p[0] - s.last[0], p[1] - s.last[1])
  if (s.brush === 'stamp' || dist === 0) return
  if (pressure !== undefined) s.pressure = s.pressure === undefined ? pressure : s.pressure * 0.6 + pressure * 0.4
  if (s.brush === 'soft') { s.pts.push(p); s.last = p; if (wet) softPath(wet, s); return }
  if (s.brush === 'spray') {
    // A puff every few pixels along the way; `carry` keeps the spacing even across pointer events.
    const step = Math.max(s.width * 0.6, 3 * s.ratio)
    let t = step - s.carry
    for (; t <= dist; t += step) spray(ctx, s, [s.last[0] + (p[0] - s.last[0]) * t / dist, s.last[1] + (p[1] - s.last[1]) * t / dist])
    s.carry = dist - (t - step)
    s.last = p
    return
  }
  // Smooth: a quadratic from the previous midpoint, through the last point, to the new midpoint.
  const mid: Pt = [(s.last[0] + p[0]) / 2, (s.last[1] + p[1]) / 2]
  pen(ctx, s)
  ctx.beginPath(); ctx.moveTo(s.mid[0], s.mid[1]); ctx.quadraticCurveTo(s.last[0], s.last[1], mid[0], mid[1]); ctx.stroke()
  ctx.globalAlpha = 1
  if (s.brush === 'rainbow') s.hue = nextHue(s.hue, dist / s.ratio)
  s.last = p; s.mid = mid
}

export function endStroke(ctx: Ctx, wet: Ctx | null, s: Stroke) {
  if (s.brush === 'soft') {
    // Drawn whole, then laid down once: overlapping bits of one stroke don't darken, and it tints
    // like a highlighter (multiply) instead of covering what's under it.
    const own = wet ?? document.createElement('canvas').getContext('2d')!
    if (!wet) { own.canvas.width = ctx.canvas.width; own.canvas.height = ctx.canvas.height }
    softPath(own, s)
    ctx.save()
    ctx.globalAlpha = SOFT_ALPHA
    ctx.globalCompositeOperation = 'multiply'
    ctx.drawImage(own.canvas, 0, 0)
    ctx.restore()
    own.clearRect(0, 0, own.canvas.width, own.canvas.height)
    return
  }
  if (s.brush === 'stamp' || s.brush === 'spray') return
  if (s.last[0] === s.mid[0] && s.last[1] === s.mid[1]) return
  pen(ctx, s)
  ctx.beginPath(); ctx.moveTo(s.mid[0], s.mid[1]); ctx.lineTo(s.last[0], s.last[1]); ctx.stroke()
  ctx.globalAlpha = 1
}

/** Scripted strokes (the demo drawings): each one a list of points, drawn as if by a finger. */
export function drawStroke(ctx: Ctx, wet: Ctx | null, o: StrokeOpts, pts: Pt[]) {
  const s = beginStroke(ctx, wet, o, pts[0])
  for (const p of pts.slice(1)) strokeTo(ctx, wet, s, p)
  endStroke(ctx, wet, s)
}
