// Profile pictures: the crop sheet's math (pure, so it's tested) and what an avatar shows.
// A crop is the picture's top-left corner (x, y) inside the square viewport of side v and its scale
// (viewport px per image px). The picture always covers the circle: no empty corners.

/** The saved picture: a 256 px square, crisp at a wall's biggest avatar on a 2x screen. */
export const PICTURE_SIZE = 256
const MAX_ZOOM = 6

export type Crop = { x: number; y: number; scale: number }
type Size = { w: number; h: number }

const cover = (img: Size, v: number) => v / Math.min(img.w, img.h)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function clampCrop(c: Crop, img: Size, v: number): Crop {
  const min = cover(img, v)
  const scale = clamp(c.scale, min, min * MAX_ZOOM)
  return { x: clamp(c.x, v - img.w * scale, 0), y: clamp(c.y, v - img.h * scale, 0), scale }
}

/** Centered, as small as it can be while still covering the circle. */
export function startCrop(w: number, h: number, v: number): Crop {
  const scale = cover({ w, h }, v)
  return { x: (v - w * scale) / 2, y: (v - h * scale) / 2, scale }
}

/** Zoom to `scale` keeping the image point under (px, py) (viewport px) where it is. */
export function zoomTo(c: Crop, scale: number, px: number, py: number, img: Size, v: number): Crop {
  const ix = (px - c.x) / c.scale, iy = (py - c.y) / c.scale
  return clampCrop({ x: px - ix * scale, y: py - iy * scale, scale }, img, v)
}

/** The square of the image (image px) the viewport shows: what gets drawn into the picture. */
export function sourceRect(c: Crop, v: number): { sx: number; sy: number; size: number } {
  return { sx: (0 - c.x) / c.scale, sy: (0 - c.y) / c.scale, size: v / c.scale } // 0 - x, not -x: no -0
}

/** What an avatar shows: its picture (as an <img src>, via `src`) unless it failed to load or there's
 * no media token yet, and always the emoji or initial (under the picture while it loads, and instead
 * of it when it can't). */
export function faceOf(m: { name: string; avatar?: string | null; picture?: string | null }, src: (path: string) => string, broken: boolean): { text: string; src: string | null } {
  return { text: m.avatar || m.name[0], src: (!broken && m.picture && src(m.picture)) || null }
}
