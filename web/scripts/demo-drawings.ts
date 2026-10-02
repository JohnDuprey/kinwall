// Draws the demo's Paint pictures with Paint's own tools (see demo-drawings.html). Every mark here
// is something a kid can make in Paint: a brush stroke along a path, a tap with Fill, a stamp, or
// a coloring page with Fill held in by its lines. Seeded, so the pictures come out the same each run.
import { drawStroke, floodFill, packRGBA, PAPER, rng, type Brush } from '../src/paintTools.ts'
import { COLORING_PAGES, pageUrl } from '../src/coloringPages.ts'

type Pt = [number, number]
const W = 800, H = 600
// Paint's brush sizes (CSS px): Tiny 3, Small 6, Medium 10, Big 16, Bigger 24, Huge 36, Giant 52.
const SIZE = { tiny: 3, small: 6, medium: 10, big: 16, bigger: 24, huge: 36, giant: 52 }

function picture(seed: number) {
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H)
  const rand = rng(seed)
  let lines: Uint8Array | undefined
  /** A finger isn't a ruler: nudge every point a little, smoothly. */
  const wobble = (pts: Pt[], amt = 2.5): Pt[] => {
    let dx = 0, dy = 0
    return pts.map(([x, y]) => { dx = dx * 0.7 + (rand() - 0.5) * amt; dy = dy * 0.7 + (rand() - 0.5) * amt; return [x + dx, y + dy] })
  }
  return {
    c, ctx,
    stroke(brush: Brush, color: string, size: keyof typeof SIZE, pts: Pt[], wob = 2.5) {
      drawStroke(ctx, null, { brush, color, width: SIZE[size], ratio: 1, seed: Math.floor(rand() * 1e9) }, wob ? wobble(pts, wob) : pts)
    },
    stamp(stamp: string, color: string, size: keyof typeof SIZE, at: Pt) {
      drawStroke(ctx, null, { brush: 'stamp', color, width: SIZE[size], ratio: 1, stamp }, [at])
    },
    fill(color: string, at: Pt) {
      const img = ctx.getImageData(0, 0, W, H)
      if (floodFill(img, Math.round(at[0]), Math.round(at[1]), packRGBA(color), 64, lines)) ctx.putImageData(img, 0, 0)
    },
    /** A coloring page's lines, as Paint keeps them: their own layer, fitted with a 4% margin. */
    async page(id: string) {
      const img = new Image()
      img.src = pageUrl(COLORING_PAGES.find(p => p.id === id)!.svg)
      await img.decode()
      const l = document.createElement('canvas')
      l.width = W; l.height = H
      const m = Math.min(W, H) * 0.04, k = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height)
      l.getContext('2d')!.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k)
      const a = l.getContext('2d')!.getImageData(0, 0, W, H).data
      lines = new Uint8Array(W * H).map((_, i) => a[i * 4 + 3])
      return { lines: l, at: (x: number, y: number): Pt => [(W - img.width * k) / 2 + x * k, (H - img.height * k) / 2 + y * k] }
    },
  }
}

// ---------- Shapes as finger paths ----------
const seg = (a: Pt, b: Pt, n = 12): Pt[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n])
const poly = (...pts: Pt[]): Pt[] => pts.slice(1).flatMap((p, i) => seg(pts[i], p).slice(i ? 1 : 0))
const ring = (cx: number, cy: number, rx: number, ry = rx, n = 40, turns = 1.05): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = -Math.PI / 2 + i / n * Math.PI * 2 * turns; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] })
/** Coloring in a box the way kids do: back and forth. */
const scribble = (x0: number, y0: number, x1: number, y1: number, gap: number): Pt[] => {
  const pts: Pt[] = []
  for (let y = y0, i = 0; y <= y1; y += gap, i++) pts.push(...seg(i % 2 ? [x1, y] : [x0, y], i % 2 ? [x0, y + gap] : [x1, y + gap], 8))
  return pts
}
/** Coloring in a circle: round and round, smaller each time. */
const spiral = (cx: number, cy: number, r: number, gap: number): Pt[] => {
  const pts: Pt[] = []
  for (let a = 0, rr = r; rr > 1; a += 0.25, rr -= gap * 0.25 / (Math.PI * 2)) pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
  return pts
}

// ---------- The pictures ----------

/** Maya: "Our garden at night". Crayon sky, moon and ground; marker stems; star stamps; spray fireflies. */
function garden() {
  const p = picture(3)
  p.stroke('crayon', '#1E3A5F', 'giant', scribble(-10, -10, W + 10, 400, 24), 4)
  p.stroke('crayon', '#1D4ED8', 'huge', scribble(0, 10, W, 380, 70), 4)
  p.stroke('crayon', '#FFD166', 'bigger', spiral(640, 110, 62, 20), 2)
  p.stroke('crayon', '#FFCC00', 'medium', ring(640, 110, 64), 2)
  for (const [x, y, s] of [[90, 70, 'bigger'], [210, 140, 'big'], [330, 60, 'bigger'], [470, 170, 'big'], [140, 260, 'big'], [520, 60, 'medium'], [750, 230, 'big'], [380, 280, 'medium']] as const)
    p.stamp('★', y % 3 ? '#FFCC00' : '#FFFFFF', s, [x, y])
  p.stroke('crayon', '#1E7B3A', 'giant', scribble(0, 410, W, H, 30), 4)
  p.stroke('crayon', '#34C759', 'bigger', poly(...Array.from({ length: 27 }, (_, i): Pt => [i * 31, i % 2 ? 380 : 410])), 3)
  for (const [x, top, petal] of [[110, 300, '#FF5FA2'], [270, 250, '#B39DFF'], [450, 320, '#FF9500'], [620, 270, '#FF5FA2'], [740, 340, '#FFFFFF']] as const) {
    p.stroke('marker', '#34C759', 'medium', poly([x, 560], [x + 4, (560 + top) / 2], [x, top]), 3)
    p.stroke('marker', '#34C759', 'medium', poly([x + 2, 470], [x + 34, 446], [x + 2, 488]), 2)
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 5; p.stroke('crayon', petal, 'bigger', spiral(x + 30 * Math.cos(a), top + 30 * Math.sin(a), 20, 14), 1.5) }
    p.stamp('●', '#FFCC00', 'big', [x, top])
  }
  for (const [x, y] of [[200, 360], [360, 200], [560, 380], [700, 420], [40, 330]] as const) p.stroke('spray', '#C7E27A', 'medium', ring(x, y, 4, 4, 6), 0)
  return p.c
}

/** Maya: "Our house and our family". The House coloring page, colored with Fill and crayon, plus the family in marker. */
async function house() {
  const p = picture(9)
  const { lines, at } = await p.page('house')
  p.fill('#7AB8FF', at(400, 40)) // sky
  p.stroke('crayon', '#4DA3FF', 'huge', scribble(...at(200, 20), ...at(540, 110), 40), 4) // scribbled more sky on top
  p.stroke('crayon', '#34C759', 'huge', scribble(...at(-20, 528), ...at(820, 600), 24), 3) // grass
  p.fill('#FFD166', at(110, 100)) // sun
  p.fill('#FF9E7A', at(240, 450)) // walls
  p.fill('#FF9E7A', at(500, 300))
  p.fill('#FF3B30', at(300, 250)) // roof
  p.fill('#B3261E', at(470, 190)) // chimney
  p.fill('#8B5A2B', at(370, 440)) // door
  for (const [x, y] of [[262, 325], [298, 325], [262, 355], [298, 355], [442, 325], [478, 325], [442, 355], [478, 355], [370, 230]] as const) p.fill('#FFF3B0', at(x, y)) // windows lit
  p.fill('#1E7B3A', at(650, 340)) // tree
  p.fill('#8B5A2B', at(650, 470))
  // The family, small, by the path: Alex, Sam, Maya and Leo.
  const person = (x: number, ground: number, h: number, shirt: string, hair: string) => {
    const head = h * 0.2, neck = ground - h + head * 2, hip = ground - h * 0.4
    p.stroke('marker', '#C68A5A', 'tiny', ring(x, ground - h + head, head, head, 24), 1)
    p.fill('#FDDBB4', [x, ground - h + head])
    p.stroke('marker', hair, 'small', poly([x - head, ground - h + head * 0.6], [x, ground - h - head * 0.1], [x + head, ground - h + head * 0.6]), 1)
    p.stroke('marker', shirt, 'small', poly([x, neck], [x, hip]), 1)
    p.stroke('marker', shirt, 'small', poly([x - h * 0.25, neck + h * 0.08], [x, neck + h * 0.12], [x + h * 0.25, neck + h * 0.08]), 1)
    p.stroke('marker', '#1E3A5F', 'small', poly([x - h * 0.13, ground], [x, hip], [x + h * 0.13, ground]), 1)
  }
  const g = at(0, 520)[1]
  person(...[at(70, 0)[0], g] as Pt, 120, '#4DA3FF', '#5C3A21')
  person(...[at(140, 0)[0], g] as Pt, 112, '#FF5FA2', '#B8860B')
  person(...[at(200, 0)[0], g] as Pt, 80, '#8E5CF7', '#5C3A21')
  person(...[at(250, 0)[0], g] as Pt, 66, '#34C759', '#B8860B')
  p.stamp('♥︎', '#FF3B30', 'big', at(160, 330))
  p.ctx.drawImage(lines, 0, 0) // saved pictures keep the page's lines on top
  return p.c
}

/** Leo: "Rocket to the moon". Marker outlines filled in, a dark sky with Fill, then stamps. */
function rocket() {
  const p = picture(5)
  // The rocket, tilted up to the right.
  const rot = (x: number, y: number): Pt => { const a = 0.6, cx = 330, cy = 340; return [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)] }
  const R = (...pts: Pt[]) => pts.map(([x, y]) => rot(x, y))
  p.stroke('marker', '#222222', 'small', poly(...R([290, 470], [290, 270], [330, 190], [370, 270], [370, 470], [290, 470])), 2)
  p.stroke('marker', '#222222', 'small', poly(...R([290, 270], [370, 270])), 1.5)
  p.stroke('marker', '#222222', 'small', ring(...rot(330, 330), 24, 24, 30), 1)
  p.stroke('marker', '#222222', 'small', poly(...R([290, 400], [240, 480], [290, 470])), 1.5)
  p.stroke('marker', '#222222', 'small', poly(...R([370, 400], [420, 480], [370, 470])), 1.5)
  p.stroke('marker', '#222222', 'small', poly(...R([300, 470], [330, 560], [360, 470])), 1.5)
  // The moon.
  p.stroke('marker', '#8A8A8A', 'small', ring(650, 140, 80, 80, 50), 2)
  p.fill('#0F1F45', [30, 30]) // the sky, one tap
  p.fill('#FFFFFF', rot(330, 400)) // body
  p.fill('#FF3B30', rot(330, 240)) // nose
  p.fill('#7AB8FF', rot(330, 330)) // window
  p.fill('#FF3B30', rot(270, 455)); p.fill('#FF3B30', rot(390, 455)) // fins
  p.fill('#FF9500', rot(330, 500)) // flame
  p.fill('#D9D9D9', [650, 140])
  for (const [x, y, r] of [[620, 110, 16], [680, 170, 12], [665, 100, 8]] as const) p.stroke('marker', '#A0AEC0', 'small', ring(x, y, r, r, 20), 1)
  for (const [x, y, s, c] of [[90, 80, 'big', '#FFCC00'], [200, 200, 'medium', '#FFFFFF'], [470, 70, 'big', '#FFCC00'], [520, 300, 'medium', '#FFFFFF'], [730, 400, 'big', '#FFCC00'], [90, 400, 'medium', '#FFFFFF'], [600, 520, 'big', '#FFCC00'], [160, 540, 'medium', '#FFFFFF']] as const) p.stamp('★', c, s, [x, y])
  p.stroke('spray', '#FFD166', 'big', poly(rot(330, 560), rot(330, 640)), 4)
  return p.c
}

/** Leo: "My dinosaur Stompy". A marker dinosaur filled green, dot-stamp spots, crayon grass, stamps and his name. */
function dino() {
  const p = picture(13)
  const outline: Pt[] = [[60, 430], [150, 410], [210, 350], [300, 320], [380, 300], [430, 230], [450, 160], [490, 120], [550, 120], [580, 150], [570, 185], [520, 195], [495, 240], [480, 330], [470, 400], [470, 480], [430, 480], [420, 420], [300, 420], [290, 480], [250, 480], [245, 425], [160, 445], [60, 430]]
  p.stroke('marker', '#1E7B3A', 'small', poly(...outline), 2)
  p.fill('#7ED9A6', [330, 370])
  for (const [x, y, s] of [[290, 360, 'bigger'], [350, 345, 'big'], [400, 380, 'bigger'], [240, 390, 'big'], [430, 300, 'medium']] as const) p.stamp('●', '#1E7B3A', s, [x, y])
  p.stamp('●', '#222222', 'tiny', [540, 145])
  p.stroke('marker', '#222222', 'tiny', poly([525, 172], [545, 178], [562, 168]), 1)
  // Spikes along the back.
  p.stroke('marker', '#FF9500', 'medium', poly([220, 345], [235, 315], [255, 336], [272, 305], [290, 325], [310, 296], [330, 318], [352, 288], [370, 305]), 1.5)
  // Sun: a big dot stamp with marker rays.
  p.stamp('●', '#FFCC00', 'giant', [700, 90])
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; p.stroke('marker', '#FF9500', 'small', seg([700 + 75 * Math.cos(a), 90 + 75 * Math.sin(a)], [700 + 105 * Math.cos(a), 90 + 105 * Math.sin(a)], 4), 1) }
  p.stroke('soft', '#7AB8FF', 'bigger', poly([80, 90], [200, 70], [330, 100]), 3) // a cloud, with the highlighter
  p.stroke('crayon', '#34C759', 'huge', scribble(0, 485, W, H, 22), 4)
  for (const [x, s] of [[110, '🌸'], [560, '🌸'], [660, '🦋'], [720, '🌸']] as const) p.stamp(s, '#000', s === '🦋' ? 'bigger' : 'big', [x, s === '🦋' ? 300 : 530])
  // LEO, the way a five-year-old signs it.
  p.stroke('marker', '#FF5FA2', 'medium', poly([40, 120], [40, 200], [80, 200]), 2)
  p.stroke('marker', '#FF5FA2', 'medium', poly([135, 120], [100, 120], [100, 200], [140, 200]), 2)
  p.stroke('marker', '#FF5FA2', 'medium', poly([100, 160], [130, 160]), 1)
  p.stroke('marker', '#FF5FA2', 'medium', ring(185, 160, 30, 40, 36), 2)
  return p.c
}

const out: Record<string, string> = {}
for (const [name, make] of [['garden', garden], ['house', house], ['rocket', rocket], ['dino', dino]] as const) {
  const c = await make()
  out[name] = c.toDataURL('image/webp', 0.8)
  const img = document.createElement('img')
  img.src = out[name]; img.width = 400; img.title = name
  document.getElementById('pics')!.append(img)
}
document.getElementById('out')!.textContent = JSON.stringify(out)
