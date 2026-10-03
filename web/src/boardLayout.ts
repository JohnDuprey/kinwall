import type { Features } from './types.ts'
// Board layouts (Board.tsx): which cards a screen shows, in which column, how much of the column's
// height each takes and how big its text is. A screen shows the default arrangement (boardAreas in
// boardFit.ts), a preset (built in, or one a parent saved for the family: settings.boardPresets),
// or its own layout kept on the device. Pure, so web/test/boardLayout.test.ts covers it. The server
// checks family presets against the same shape (server/src/schemas.ts BoardLayoutSchema).

export const BOARD_CARDS = ['clock', 'today', 'meals', 'photo', 'coming', 'due', 'chores', 'tidbit', 'tidbit2', 'tidbit3', 'checklist'] as const
export type BoardCardId = typeof BOARD_CARDS[number]
export const CARD_NAMES: Record<BoardCardId, string> = {
  clock: 'Clock & weather', today: 'Today', meals: 'Today’s meals', photo: 'Picture', coming: 'Coming up',
  due: 'Due soon', chores: 'Chores today', tidbit: 'Quote or fact', tidbit2: 'Quote or fact 2', tidbit3: 'Quote or fact 3',
  checklist: 'Get stuff done',
}
export const CARD_SIZES = ['s', 'm', 'l'] as const
export type CardSize = typeof CARD_SIZES[number]
export const SIZE_NAMES: Record<CardSize, string> = { s: 'Short', m: 'Medium', l: 'Tall' }
export const CARD_DENSITIES = ['big', 'normal', 'small'] as const
export type CardDensity = typeof CARD_DENSITIES[number]
export const DENSITY_NAMES: Record<CardDensity, string> = { big: 'Big text', normal: 'Normal', small: 'Small text' }

/** `listId`: the Checklist card's list (absent: the first reusable list). */
export interface BoardCardSpec { id: BoardCardId; size: CardSize; density: CardDensity; listId?: string }
/** `tiles`: the row of count tiles across the top (medicines, chores, due soon, groceries, rewards). */
export interface BoardLayout { tiles: boolean; columns: BoardCardSpec[][] }
export interface BoardPreset { id: string; name: string; layout: BoardLayout }
export const MAX_COLUMNS = 4, MAX_PER_COLUMN = 6, MAX_PRESETS = 10

const c = (id: BoardCardId, size: CardSize = 'm', density: CardDensity = 'normal'): BoardCardSpec => ({ id, size, density })
/** Starting points for who looks at the screen. The family's default arrangement isn't one of these:
 * it's no preset at all (DEFAULT_CHOICE), and adapts to the screen on its own. */
export const BUILT_IN_PRESETS: BoardPreset[] = [
  { id: 'kids', name: 'Kids', layout: { tiles: false, columns: [[c('clock', 'm', 'big'), c('photo', 'l')], [c('today', 'l', 'big'), c('chores', 'm', 'big')], [c('tidbit', 'm', 'big'), c('coming', 'm', 'big')]] } },
  { id: 'kitchen', name: 'Kitchen', layout: { tiles: true, columns: [[c('clock', 's'), c('meals', 'l', 'big')], [c('today', 'l'), c('photo', 'm')], [c('coming', 'l'), c('tidbit', 's')]] } },
  { id: 'parents', name: 'Parents', layout: { tiles: true, columns: [[c('clock', 's', 'small'), c('today', 'l', 'small')], [c('coming', 'l', 'small'), c('due', 'm', 'small')], [c('chores', 'm', 'small'), c('meals', 's', 'small')]] } },
  { id: 'simple', name: 'Simple', layout: { tiles: false, columns: [[c('clock', 'm', 'big'), c('photo', 'l')], [c('today', 'l', 'big')]] } },
]
/** The layout the family's default arrangement roughly matches, to start editing from. */
export const DEFAULT_LAYOUT: BoardLayout = {
  tiles: true,
  columns: [[c('clock', 's'), c('photo', 'l'), c('tidbit', 's')], [c('today', 'l'), c('meals', 'm')], [c('coming', 'l'), c('tidbit2', 's')]],
}

/** A screen's choice (device.boardLayout): absent is the default arrangement, CUSTOM its own
 * layout (device.boardCustom), anything else a preset's id. */
export const CUSTOM = 'custom'

/** A layout as stored, made safe to show: known cards once each, 1 to MAX_COLUMNS columns, sizes
 * and densities it knows (anything else falls back). Device storage can hold anything. */
export function normalizeLayout(raw: unknown): BoardLayout {
  const r = (raw ?? {}) as { tiles?: unknown; columns?: unknown }
  const seen = new Set<string>()
  const cols = (Array.isArray(r.columns) ? r.columns : []).slice(0, MAX_COLUMNS).map(col => (Array.isArray(col) ? col : []).flatMap((x: Partial<BoardCardSpec>) => {
    if (!BOARD_CARDS.includes(x?.id as BoardCardId) || seen.has(x.id!)) return []
    seen.add(x.id!)
    const listId = x.id === 'checklist' && typeof x.listId === 'string' && x.listId ? { listId: x.listId } : {}
    return [{ id: x.id!, size: CARD_SIZES.includes(x.size!) ? x.size! : 'm', density: CARD_DENSITIES.includes(x.density!) ? x.density! : 'normal', ...listId }]
  }).slice(0, MAX_PER_COLUMN))
  return { tiles: r.tiles !== false, columns: cols.length ? cols : [[]] }
}

/** The layout a screen shows, or null for the default arrangement (also when its preset was deleted). */
export function layoutFor(choice: string | undefined, custom: unknown, presets: BoardPreset[]): BoardLayout | null {
  if (!choice) return null
  if (choice === CUSTOM) return custom ? normalizeLayout(custom) : null
  const p = [...BUILT_IN_PRESETS, ...presets].find(x => x.id === choice)
  return p ? normalizeLayout(p.layout) : null
}

const WEIGHT: Record<CardSize, number> = { s: 1, m: 2, l: 3 }
const ROWS = 12

/** How many of ROWS each card spans: its share of the column's weight, at least 1, adding up to ROWS. */
export function rowSpans(sizes: CardSize[]): number[] {
  const total = sizes.reduce((n, s) => n + WEIGHT[s], 0)
  const exact = sizes.map(s => WEIGHT[s] / total * ROWS)
  const spans = exact.map(x => Math.max(1, Math.floor(x)))
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i)
  let left = ROWS - spans.reduce((n, s) => n + s, 0)
  for (let k = 0; left > 0; left--, k++) spans[order[k % order.length].i]++
  // A short card bumped up to its one row: the tallest give it back.
  for (; left < 0; left++) spans[spans.indexOf(Math.max(...spans))]--
  return spans
}

/** The Board's grid for a layout (the same custom properties boardAreas sets), with only the cards
 * that can show (`can`: a feature that's off, a quote card with nothing to say, no tiles to show).
 * A column left empty goes and the others widen. `shown`: the cards on the Board, in reading order
 * (column by column), which is also the order on a phone. */
export function layoutAreas(layout: BoardLayout, can: (id: BoardCardId | 'tiles') => boolean): { shown: string[]; style: Record<string, string>; density: Map<string, CardDensity> } {
  const cols = layout.columns.map(col => col.filter(x => can(x.id))).filter(col => col.length)
  const tiles = layout.tiles && can('tiles')
  const flat = cols.flat().map(x => x.id)
  const shown = [...(tiles ? ['tiles'] : []), ...flat]
  const n = Math.max(1, cols.length)
  const spans = cols.map(col => rowSpans(col.map(x => x.size)))
  const at = (ci: number, r: number) => { let end = 0; return cols[ci][spans[ci].findIndex(s => (end += s) > r)].id }
  const two = [...(tiles ? [['tiles']] : []), ...Array.from({ length: Math.ceil(flat.length / 2) }, (_, i) => flat.slice(i * 2, i * 2 + 2))]
  return {
    shown,
    density: new Map(cols.flat().map(x => [x.id, x.density])),
    style: {
      '--board-cols-3': `repeat(${n}, minmax(0, 1fr))`,
      '--board-rows-3': `${tiles ? 'auto ' : ''}${cols.length ? `repeat(${ROWS}, minmax(0, 1fr))` : ''}`,
      '--board-areas-1': shown.map(a => `"${a}"`).join(' '),
      '--board-areas-2': two.map(([a, b = a]) => `"${a} ${b}"`).join(' '),
      '--board-areas-3': [...(tiles ? [`"${Array(n).fill('tiles').join(' ')}"`] : []), ...(cols.length ? Array.from({ length: ROWS }, (_, r) => `"${cols.map((_, ci) => at(ci, r)).join(' ')}"`) : [])].join(' '),
    },
  }
}

// ---- Editing (BoardEditor.tsx) ----

export type Spot = { col: number; i: number }
const copy = (l: BoardLayout): BoardLayout => ({ ...l, columns: l.columns.map(col => [...col]) })

/** Moves a card to `to` (its index as if the card were already out of its old place). A full column takes no more. */
export function moveCard(l: BoardLayout, from: Spot, to: Spot): BoardLayout {
  if (from.col !== to.col && l.columns[to.col].length >= MAX_PER_COLUMN) return l
  const next = copy(l)
  const [card] = next.columns[from.col].splice(from.i, 1)
  next.columns[to.col].splice(Math.max(0, Math.min(to.i, next.columns[to.col].length)), 0, card)
  return next
}
export function removeCard(l: BoardLayout, at: Spot): BoardLayout {
  const next = copy(l)
  next.columns[at.col].splice(at.i, 1)
  return next
}
export function updateCard(l: BoardLayout, at: Spot, patch: Partial<Omit<BoardCardSpec, 'id'>>): BoardLayout {
  const next = copy(l)
  next.columns[at.col][at.i] = { ...next.columns[at.col][at.i], ...patch }
  return next
}
/** Adds a card to the bottom of the column with the least in it. */
export function addCard(l: BoardLayout, id: BoardCardId): BoardLayout {
  const load = l.columns.map(col => col.length >= MAX_PER_COLUMN ? Infinity : col.reduce((n, x) => n + WEIGHT[x.size], 0))
  const col = load.indexOf(Math.min(...load))
  if (load[col] === Infinity || l.columns.some(cl => cl.some(x => x.id === id))) return l
  const next = copy(l)
  next.columns[col].push(c(id))
  return next
}
/** More columns start empty; fewer move the dropped columns' cards to the last one kept (what doesn't fit comes off). */
export function setColumnCount(l: BoardLayout, n: number): BoardLayout {
  n = Math.max(1, Math.min(MAX_COLUMNS, n))
  const cols = l.columns.slice(0, n).map(col => [...col])
  while (cols.length < n) cols.push([])
  cols[n - 1] = [...cols[n - 1], ...l.columns.slice(n).flat()].slice(0, MAX_PER_COLUMN)
  return { ...l, columns: cols }
}
/** A card whose feature is on (Settings → Features): Meals, Due soon, Chores and Checklist go with theirs. */
export const cardOn = (id: BoardCardId, f: Pick<Features, 'meals' | 'lists' | 'chores'>) => id === 'meals' ? f.meals : id === 'due' || id === 'checklist' ? f.lists : id === 'chores' ? f.chores : true
export const unplaced = (l: BoardLayout) => BOARD_CARDS.filter(id => !l.columns.some(col => col.some(x => x.id === id)))
