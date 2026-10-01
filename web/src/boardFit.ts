// How many of a Board card's rows fit its space (Board.tsx FitBody measures, this decides), and whose chores it counts. Pure, so
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

/** The Board's chore rows for who's shown, the same rule as the Chores tab: with someone picked,
 *  only their chores plus Anyone's, which only a device pinned to them (`focusMemberId`) can hide. */
export function boardChores<T extends { memberId: string | null }>(chores: T[], selectedMemberId: string | null, focusMemberId: string | null, focusShowsShared: boolean): T[] {
  if (!selectedMemberId) return chores
  return chores.filter(c => c.memberId === selectedMemberId || (!c.memberId && (!focusMemberId || focusShowsShared)))
}

/** Due soon's items for who's shown, the same rule as the chores: with someone picked, items
 *  assigned to them or unassigned on a list that's theirs, plus unassigned ones on a list for
 *  nobody (which only a device pinned to them can hide). `lists` says whose each list is. */
export function boardItems<T extends { memberId: string | null; listId: string }>(items: T[], lists: { id: string; memberIds: string[] }[], selectedMemberId: string | null, focusMemberId: string | null, focusShowsShared: boolean): T[] {
  if (!selectedMemberId) return items
  const whose = new Map(lists.map(l => [l.id, l.memberIds]))
  return items.filter(i => {
    if (i.memberId) return i.memberId === selectedMemberId
    const on = whose.get(i.listId)
    return !!on && (on.includes(selectedMemberId) || (!on.length && (!focusMemberId || focusShowsShared)))
  })
}

/** grid-template-areas for the cards actually on the Board, one per layout (styles.css picks one
 * per container width), so a card that's turned off leaves no hole. `shown` is in phone order. */
export function boardAreas(shown: string[]): Record<string, string> {
  const has = (a: string) => shown.includes(a)
  // Two columns: rows of two cards; a card whose partner is off spans the row.
  const two = [['tiles'], ['clock', 'photo'], ['today', 'coming'], ['due', 'chores'], ['meals', 'tidbit'], ['tidbit2', 'tidbit3']]
    .map(row => row.filter(has)).filter(row => row.length).map(([a, b = a]) => `"${a} ${b}"`)
  // Three full-height columns: a missing card's rows go to the card above it.
  // Tidbit cards share the bottom row: a second under Coming up / Due soon, a third under Today,
  // which moves Today's meals up a row (beside Chores' slot, taking it when Chores is off).
  const middle = has('tidbit3') ? ['today', has('chores') ? 'chores' : 'today', 'meals', 'tidbit3'] : ['today', 'today', 'chores', 'meals']
  const cols = [['clock', 'photo', 'photo', 'tidbit'], middle, ['coming', 'coming', 'due', 'tidbit2']]
    .map(col => col.reduce<string[]>((out, a) => [...out, has(a) ? a : out[out.length - 1]], []))
  const three = [...(has('tiles') ? ['"tiles tiles tiles"'] : []), ...[0, 1, 2, 3].map(r => `"${cols.map(c => c[r]).join(' ')}"`)]
  return {
    // The last row is capped so a long meals or tidbit card can't squeeze the photo.
    '--board-rows-3': `${has('tiles') ? 'auto ' : ''}auto minmax(40px, 1fr) minmax(40px, 1fr) fit-content(30%)`,
    '--board-areas-1': shown.map(a => `"${a}"`).join(' '),
    '--board-areas-2': two.join(' '),
    '--board-areas-3': three.join(' '),
  }
}

/** How many tidbit cards a Board this size (CSS px) has room for: one on a phone (one column) and on
 *  a short three-column board (a tablet on its side), where the bottom row can't hold three; up to
 *  three on two columns (the page scrolls) and on a wall-sized three-column board. */
export function tidbitCardsThatFit(width: number, height: number): number {
  if (width < 620) return 1
  return width < 880 || height >= 640 ? 3 : 1
}

/** Columns for the Board's count tiles: one row when each gets `min` px, else as few balanced rows as
 * fit (six on a tablet: 3 + 3, not six slivers with their words cut off, nor 4 + 2). */
export function tileColumns(width: number, count: number, min = 160, gap = 12): number {
  const fit = Math.max(1, Math.floor((width + gap) / (min + gap)))
  return Math.ceil(count / Math.ceil(count / fit))
}
