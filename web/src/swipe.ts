// Swipe-to-delete on a list item row (Lists.tsx SwipeRow): the gesture math, kept pure for tests.

/** Width of the revealed Delete button, px. */
export const SWIPE_REVEAL = 96

/** Which way a drag is going once it's moved 10px: 'x' swipes the row, 'y' leaves it to scrolling. */
export function swipeAxis(dx: number, dy: number, slop = 10): 'x' | 'y' | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < slop) return null
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
}

/** How far left the row sits for a drag of dx: from closed (0) or open (-reveal), between 0 and -width. */
export function swipeOffset(dx: number, open: boolean, width: number, reveal = SWIPE_REVEAL): number {
  return Math.max(-width, Math.min(0, (open ? -reveal : 0) + dx))
}

/** Where a released row lands: far enough (60% of the row, and past the button) deletes; past half
 * the button snaps open to show it; anything less closes. */
export function swipeEnd(offset: number, width: number, reveal = SWIPE_REVEAL): 'delete' | 'open' | 'closed' {
  const d = -offset
  if (d >= Math.max(width * 0.6, reveal + 24)) return 'delete'
  return d >= reveal / 2 ? 'open' : 'closed'
}
