// Settings → General: which sections are open (kept per device) and the search that filters them.
// The pure parts are tested in test/settingsSearch.test.ts; filterSettings works on the DOM.

/** Lowercase, accents and extra spaces dropped: "Café  Time" → "cafe time". */
export const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** The query's words, folded. */
export const queryWords = (query: string) => fold(query).split(' ').filter(Boolean)

/** Every word appears somewhere in the text (case- and accent-insensitive). */
export const matchesAll = (words: string[], text: string) => {
  const t = fold(text)
  return words.every(w => t.includes(w))
}

const OPEN_KEY = 'kinwall.settingsOpen'
type Store = Pick<Storage, 'getItem' | 'setItem'>
const store = (): Store | undefined => { try { return localStorage } catch { return undefined } }

/** The sections this device keeps open. Blocked or bad storage reads as none open. */
export function readOpen(s: Store | undefined = store()): Set<string> {
  try {
    const v: unknown = JSON.parse(s?.getItem(OPEN_KEY) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch { return new Set() }
}

export function writeOpen(open: Set<string>, s: Store | undefined = store()) {
  try { s?.setItem(OPEN_KEY, JSON.stringify([...open])) } catch { /* storage blocked: open only for now */ }
}

const ROWS = '.settings-row, .toggle-row, .device-pref-row'

/** A row's own words: its labels, notes and buttons, not a select's options or a nested row's text. */
function rowText(row: Element): string {
  const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  let s = ''
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const p = n.parentElement
    if (p && !p.closest('select, textarea') && p.closest(ROWS) === row) s += ` ${n.nodeValue}`
  }
  return s
}

/** Marks what doesn't match `query` with data-search-hide (CSS hides it) and returns how many
 * sections match. A section matching by title or keywords shows whole; otherwise only its matching
 * rows (and the rows around or inside them). An empty query shows everything. Only rows already
 * rendered are searched, so what a device or a switch hides stays hidden. */
export function filterSettings(panel: HTMLElement, query: string): number {
  const words = queryWords(query)
  let shown = 0
  for (const sec of panel.querySelectorAll<HTMLElement>('[data-acc]')) {
    const title = sec.dataset.title ?? ''
    const rows = [...sec.querySelectorAll(ROWS)]
    const own = rows.map(r => !words.length || matchesAll(words, `${title} ${rowText(r)}`))
    const hit = own.some(Boolean) || matchesAll(words, `${title} ${sec.dataset.keywords ?? ''}`)
    const whole = !words.length || matchesAll(words, title) || !own.some(Boolean)
    rows.forEach(r => r.toggleAttribute('data-search-hide',
      !whole && !rows.some((o, j) => own[j] && (o === r || o.contains(r) || r.contains(o)))))
    sec.toggleAttribute('data-search-hide', !hit)
    if (hit) shown++
  }
  for (const g of panel.querySelectorAll('.settings-group-head')) {
    let n = g.nextElementSibling, any = false
    while (n && !n.matches('.settings-group-head')) { if (n.matches('[data-acc]:not([data-search-hide])')) any = true; n = n.nextElementSibling }
    g.toggleAttribute('data-search-hide', !any)
  }
  return shown
}
