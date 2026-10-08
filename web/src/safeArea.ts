// An iPhone on its side reports the same safe-area inset on both sides (about 60px), though only one
// has the notch or Dynamic Island; the other only needs to clear the screen's rounded corners.
// watchIsland() marks <html data-island="left|right"> with the island's side, and styles.css trims
// the other side's --safe-l / --safe-r to a corner's clearance.

/** Which side an iPhone's island is on: the top of the phone, so left when it's turned
 *  counterclockwise (landscape-primary, window.orientation 90), right when clockwise
 *  (landscape-secondary, -90). null standing up, or off an iPhone (an iPad, Android, a computer). */
export function islandSide(ua: string, type: string | undefined, angle: number | undefined): 'left' | 'right' | null {
  if (!/\biPhone\b/.test(ua)) return null
  if (type) return type === 'landscape-primary' ? 'left' : type === 'landscape-secondary' ? 'right' : null
  return angle === 90 ? 'left' : angle === -90 || angle === 270 ? 'right' : null
}

/** Keeps data-island current as the phone turns. */
export function watchIsland() {
  const w = window as Window & { orientation?: number }
  const set = () => {
    const side = islandSide(navigator.userAgent, screen.orientation?.type, w.orientation)
    if (side) document.documentElement.dataset.island = side
    else delete document.documentElement.dataset.island
  }
  set()
  screen.orientation?.addEventListener?.('change', set)
  addEventListener('orientationchange', set) // iOS before 16.4 has no screen.orientation
  addEventListener('resize', set)
}
