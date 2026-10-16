// Paint's zoom is view-only: the picture's canvas is scaled and moved on screen (a CSS transform on
// the layer stack), never redrawn bigger, so saving, undo and coloring pages don't know about it.
// Screen points are CSS px from the canvas box's top-left; picture points are the same box at 1×.
export type View = { z: number; x: number; y: number } // screen = picture × z + (x, y)
type Pt = [number, number]

export const MIN_ZOOM = 1 // the whole picture; less would only show empty space
export const MAX_ZOOM = 4 // past this a finger covers too few pixels to be any use
export const FIT: View = { z: 1, x: 0, y: 0 }

export const toPicture = (v: View, sx: number, sy: number): Pt => [(sx - v.x) / v.z, (sy - v.y) / v.z]

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Zoom within the limits, panned so the picture always covers the box (nothing to get lost in). */
export function clampView(v: View, w: number, h: number): View {
  const z = clamp(v.z, MIN_ZOOM, MAX_ZOOM)
  return { z, x: clamp(v.x, w - w * z, 0) || 0, y: clamp(v.y, h - h * z, 0) || 0 }
}

/** Zoom to `z` so the spot that was under `from` ends up under `to`: a pinch (center moving = pan),
 * or with from === to, zooming around a point (a wheel, the buttons). */
export function zoomTo(v: View, z: number, from: Pt, to: Pt, w: number, h: number): View {
  const [px, py] = toPicture(v, ...from)
  const zz = clamp(z, MIN_ZOOM, MAX_ZOOM)
  return clampView({ z: zz, x: to[0] - px * zz, y: to[1] - py * zz }, w, h)
}
