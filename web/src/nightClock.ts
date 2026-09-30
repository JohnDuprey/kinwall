// Where the Night screen clock sits (Settings → Night → What they show → Clock position, or a screen's own).
// A spot is a percentage of the free space: CSS puts the clock at left x%, top y% and pulls it back
// by x%, y% of its own size (.night-spot), so any spot keeps it fully on screen at any size.

import type { CSSProperties } from 'react'

export type ClockPos = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export interface Spot { x: number; y: number }

export const CLOCK_SPOTS: Record<ClockPos, Spot> = {
  center: { x: 50, y: 50 }, 'top-left': { x: 0, y: 0 }, 'top-right': { x: 100, y: 0 }, 'bottom-left': { x: 0, y: 100 }, 'bottom-right': { x: 100, y: 100 },
}

const GRID = [0, 50, 100].flatMap(y => [0, 50, 100].map(x => ({ x, y })))
const CORNERS = GRID.filter(s => s.x !== 50 && s.y !== 50)

/** "Moves around" (burn-in guard): a random spot on a 3 × 3 grid, never the one it's on. `corners`
 * keeps it to the corners, for the small clock over a slideshow. */
export function nextSpot(prev: Spot | undefined, corners: boolean, random = Math.random): Spot {
  const options = (corners ? CORNERS : GRID).filter(s => !prev || s.x !== prev.x || s.y !== prev.y)
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))]
}

/** The CSS variables .night-spot places the clock with, and its text lined up with the nearer edge. */
export const spotStyle = (s: Spot) =>
  ({ '--x': s.x, '--y': s.y, textAlign: s.x === 0 ? 'left' : s.x === 100 ? 'right' : 'center' }) as CSSProperties
