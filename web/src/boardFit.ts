// How many of a Board card's rows fit its space (Board.tsx FitBody measures, this decides). Pure, so
// it's tested in test/boardFit.test.ts.

/** Rows in order, each with its bottom edge (px from the top of the card's body) and whether it's a
 *  heading (a day in Coming up). Returns how many rows to show: all of them when they fit in `space`,
 *  else as many as fit above the More button (`moreSpace`), never ending on a heading with nothing under it. */
export function rowsThatFit(rows: { bottom: number; heading?: boolean }[], space: number, moreSpace: number): number {
  if (!rows.length || rows[rows.length - 1].bottom <= space + 0.5) return rows.length
  let n = 0
  while (n < rows.length && rows[n].bottom <= space - moreSpace + 0.5) n++
  while (n > 0 && rows[n - 1].heading) n--
  return n
}

/** The More button's label: how many rows (not headings) the sheet adds, "Show 4" when none fit. */
export function moreLabel(rows: { heading?: boolean }[], shown: number): string {
  const n = rows.slice(shown).filter(r => !r.heading).length
  return n === 0 ? 'More' : shown === 0 ? `Show ${n}` : `+${n} more`
}
