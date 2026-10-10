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

/** Whether the Board shares out the screen's height in columns that don't scroll (styles.css, the
 *  `data-fixed` board): a wall or a tablet on its side, 880px wide and 700 tall; shorter, it stays
 *  two columns that scroll. A cast screen (a Nest Hub, 600px tall, nobody to scroll it) always
 *  shares it out once there's room for two columns, in its own layout's columns. */
export const boardFixed = (width: number, tall: boolean, cast = false) => cast ? width >= 620 : width >= 880 && tall

/** A cast screen's Board drawn smaller when even its cards' smallest sizes are taller than the screen
 *  (`client`: the Board's height, `need`: what its cards take at full size), so nothing is cut off
 *  and nothing scrolls; never under 75%, where a long Board scrolls rather than go unreadable. */
export const castFit = (client: number, need: number) => need > client + 0.5 ? Math.max(0.75, Math.floor(client / need * 1000) / 1000) : 1

/** Columns for the Board's count tiles: one row when each gets `min` px, else as few balanced rows as
 * fit (six on a tablet: 3 + 3, not six slivers with their words cut off, nor 4 + 2). */
export function tileColumns(width: number, count: number, min = 160, gap = 12): number {
  const fit = Math.max(1, Math.floor((width + gap) / (min + gap)))
  return Math.ceil(count / Math.ceil(count / fit))
}

/** Where the Board shows open family polls (Polls.tsx PollsOnBoard): at the foot of Today, else of
 *  Coming up when a layout leaves Today out, else a slim strip above the cards. */
export const pollHost = (shown: string[]): 'today' | 'coming' | 'strip' =>
  shown.includes('today') ? 'today' : shown.includes('coming') ? 'coming' : 'strip'

/** How a card's "in Today" slot (Board.tsx TodaySlot) shows its items. Each gets at least its one
 *  row; the card's own rows (`rows`: their height) come first, and what's left of `space` (what the
 *  rows and the slot share) goes to items in order, each whole only if that still fits. The card
 *  always keeps room for one of its own rows, two when it can (`keep`: what one and two need, with
 *  the More button when more are left): when the items' rows would take that, they become one line
 *  of small chips (`chips`: its height), the smallest the slot gets. `need`: the least space for
 *  that (one row of the card's own and the slot), which the card grows to when it has less. Whole
 *  items only on a fixed-height board: a phone or a scrolling board would just grow, so it gets rows. */
export function slotLayout({ fixed, rows, space, items, chips = 0, keep = [0, 0] }: { fixed: boolean; rows: number; space: number; items: { full: number; row: number }[]; chips?: number; keep?: [number, number] }): { chips: boolean; whole: boolean[]; need: number } {
  const asRows = items.reduce((n, i) => n + i.row, 0)
  const none = { chips: false, whole: items.map(() => false), need: 0 }
  if (!fixed) return none
  const leaves = (slot: number, k: 0 | 1) => space - slot >= keep[k] - 0.5
  // Two of the card's rows beside the items' rows, else beside chips, else one beside rows, else chips.
  if (items.length > 1 && chips && !leaves(asRows, 1) && (leaves(chips, 1) || !leaves(asRows, 0))) return { chips: true, whole: none.whole, need: keep[0] + chips }
  let left = space - rows - asRows
  return {
    chips: false,
    need: keep[0] + asRows,
    whole: items.map(i => {
      const fits = i.full - i.row <= left + 0.5
      if (fits) left -= i.full - i.row
      return fits
    }),
  }
}

/** Whether the Board's tile row becomes chips on its toolbar (Board.tsx): one or two tiles that are
 *  just a count (a list, Rewards) would each stretch across a whole row, so they go on the toolbar
 *  when there's room for them (`toolbar`: not a phone's, nor a locked view without one). Three or
 *  more, or Chores, Due soon and Take now (which show who and what), keep the row. */
export const tileChips = (tiles: string[], toolbar: boolean) =>
  toolbar && tiles.length > 0 && tiles.length <= 2 && tiles.every(t => !['meds', 'chores', 'due'].includes(t))

/** How the toolbar chips fit their spot (`room`, px, with the buttons' words showing): with their whole
 *  names (`full`: each chip's width) when all fit, else each just its icon and count (`short`; never
 *  "G… 14"), else 'tight': short chips, and the toolbar's Family wall and Polls buttons down to their
 *  icons, which frees `freed` px, else 'wrap': the chips on a row of their own (a portrait tablet).
 *  `was` is the current fit: measured while tight the spot is `freed` wider, and it takes a few px to
 *  spare to step back, so it can't flip back and forth at an edge. */
export function chipFit(full: number[], short: number[], room: number, freed: number, was: ChipFit = 'names', gap = 8): ChipFit {
  const r = was === 'tight' ? room - freed - gap : room
  const fits = (w: number[], n: number) => w.reduce((t, x) => t + x, 0) + gap * (w.length - 1) <= n + 0.5
  return fits(full, r) ? 'names' : fits(short, r) ? 'short' : fits(short, r + freed - (was === 'wrap' ? gap : 0)) ? 'tight' : 'wrap'
}
export type ChipFit = 'names' | 'short' | 'tight' | 'wrap'

/** Today's events on the Board, for a glance late in the day: what's on now (all-day ones too), then
 *  what's next, in start order; the ones already over go to `earlier`, which the card folds into one
 *  "3 earlier" row, so they never push what's on now behind "+N more". */
export function todayOrder<T extends { start: string; end: string; allDay: boolean }>(events: T[], now: number): { shown: T[]; earlier: T[] } {
  const byStart = [...events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const over = (e: T) => !e.allDay && Date.parse(e.end) < now
  const on = (e: T) => e.allDay || Date.parse(e.start) <= now
  return { shown: [...byStart.filter(e => !over(e) && on(e)), ...byStart.filter(e => !over(e) && !on(e))], earlier: byStart.filter(over) }
}

/** Whether the "in Today" slot's chips (slotLayout's `chips`) say what they count ("3 to take"): when
 *  that's still one line (`words`: its height, wrapping as it needs, vs `chips`: the counts alone), or
 *  when its lines still leave `keep` (the card's first row and More) of the `space`. Never clipped. */
export const chipWords = (chips: number, words: number, space: number, keep: number) =>
  words <= chips + 0.5 || space - words >= keep - 0.5

/** Today's rows on the Board: the events (in todayOrder's order) with the chores that have a start
 *  time or a timer between them by time of day. `minute`: an event's start in minutes after midnight
 *  (-1 for all day or one that began before today). A chore with a timer and no start time goes
 *  last; one that's done or waiting for a parent's OK drops off, like an event that's over. */
export function withTimedChores<E, C extends { dueTime: string | null; done: boolean; pending: boolean }>(events: E[], minute: (e: E) => number, chores: C[]): ({ event: E } | { chore: C })[] {
  const at = (t: string | null) => t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : 24 * 60
  const left = chores.filter(c => !c.done && !c.pending).sort((a, b) => at(a.dueTime) - at(b.dueTime))
  const out: ({ event: E } | { chore: C })[] = []
  let i = 0
  for (const event of events) {
    while (i < left.length && at(left[i].dueTime) < minute(event)) out.push({ chore: left[i++] })
    out.push({ event })
  }
  return [...out, ...left.slice(i).map(chore => ({ chore }))]
}
