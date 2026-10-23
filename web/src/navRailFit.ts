/** Visible destinations, including More when needed. Sizes come from the actual rail typography. */
export function navRailFit(available: number, heights: number[], gap: number, moreHeight: number): number {
  if (!heights.length) return 0
  const total = heights.reduce((n, h) => n + h, 0) + Math.max(0, heights.length - 1) * gap
  if (total <= available) return heights.length
  let used = moreHeight, visible = 0
  for (const height of heights) {
    if (used + gap + height > available) break
    used += gap + height
    visible++
  }
  return Math.min(heights.length, visible + 1)
}
