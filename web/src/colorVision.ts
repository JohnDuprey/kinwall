// Color vision: how a color looks with color blindness, and whether two people's colors would look
// alike. Simulation uses the Machado, Oliveira and Fernandes (2009) matrices at full severity, applied
// in linear RGB. Distance is CIE76 ΔE (straight-line distance in CIELAB): the question here is coarse
// ("can you tell these two calendar colors apart at a glance?"), well above the small differences
// where CIEDE2000's corrections matter, and CIE76 is a few lines anyone can check by hand.

export type Cvd = 'protan' | 'deutan' | 'tritan'
export type Vision = 'typical' | Cvd

const MATRIX: Record<Cvd, number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}
const VISIONS: Vision[] = ['typical', 'protan', 'deutan', 'tritan']
const HEX = /^#[0-9a-f]{6}$/i

/** Under this ΔE (CIE76) two colors count as looking alike. Tuned on the member palette: it flags
 * pink and green under deuteranopia (3.8) and sky blue and lavender (2.7), and leaves pairs that stay
 * clearly apart (blue and orange: 82+ under every type). */
export const ALIKE_DE = 10

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
const clamp = (v: number) => Math.min(1, Math.max(0, v))

function linear(hex: string, vision: Vision): number[] {
  const v = [1, 3, 5].map(i => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255))
  if (vision === 'typical') return v
  return MATRIX[vision].map(r => clamp(r[0] * v[0] + r[1] * v[1] + r[2] * v[2]))
}

/** `hex` (#RRGGBB) as someone with this type of color blindness sees it. */
export function simulate(hex: string, type: Cvd): string {
  return '#' + linear(hex, type).map(v => Math.round(toSrgb(v) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}

function lab([r, g, b]: number[]): number[] {
  // Linear sRGB → XYZ (D65, normalized to the white point) → CIELAB.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/** CIE76 ΔE between two colors, as seen with `vision`. */
export function deltaE(a: string, b: string, vision: Vision = 'typical'): number {
  const [p, q] = [lab(linear(a, vision)), lab(linear(b, vision))]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

/** The first kind of vision (typical first) under which `a` and `b` look alike, or null. */
export function alikeUnder(a: string, b: string): Vision | null {
  if (!HEX.test(a) || !HEX.test(b)) return null // a custom or legacy color we can't read: no warning
  return VISIONS.find(v => deltaE(a, b, v) < ALIKE_DE) ?? null
}

export const looksAlike = (a: string, b: string) => alikeUnder(a, b) !== null

/** Typical-vision ΔE a suggestion should keep from everyone, so it doesn't sit next to a near twin
 * (a rose beside a pink) even when it's far enough apart for color blindness. */
export const DISTINCT_DE = 25

/** From `palette`, a color for someone that looks like no one in `taken`: preferably clearly different
 * with typical vision (ΔE ≥ DISTINCT_DE from everyone), and among those the one farthest from
 * everyone under the color blindness simulations. With none that clear, the one farthest under every
 * kind of vision. Null when even that would look like someone's. */
export function suggestColor(taken: readonly string[], palette: readonly string[]): string | null {
  const minDe = (c: string, visions: readonly Vision[]) => Math.min(...taken.flatMap(t => visions.map(v => deltaE(c, t, v))))
  const ok = palette.filter(c => minDe(c, VISIONS) >= ALIKE_DE)
  const clear = ok.filter(c => minDe(c, ['typical']) >= DISTINCT_DE)
  const [pool, visions] = clear.length ? [clear, VISIONS.slice(1)] : [ok, VISIONS]
  let best: string | null = null, bestScore = -1
  for (const c of pool) { const s = minDe(c, visions); if (s > bestScore) { best = c; bestScore = s } }
  return best
}

/** Words for the warning: "to someone with red-green color blindness". */
export const VISION_WORDS: Record<Vision, string> = {
  typical: 'at a glance',
  protan: 'to someone with red-green color blindness',
  deutan: 'to someone with red-green color blindness',
  tritan: 'to someone with blue-yellow color blindness',
}

/** The first pair (in list order) whose colors look alike, with the vision it's under, or null. */
export function firstClash<T extends { color: string }>(list: readonly T[]): [T, T, Vision] | null {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const v = alikeUnder(list[i].color, list[j].color)
    if (v) return [list[i], list[j], v]
  }
  return null
}
