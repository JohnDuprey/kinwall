// Back closes sheets: every open Sheet is one history entry, so Back (the browser's, Android's
// button, an iPhone's swipe) closes the top sheet instead of leaving the screen and losing a form.
//
// Opening pushes an entry with the same address, marked { kinwallSheet: token }, and marks the
// entry under it { kinwallBase: true }. Landing on a base (or on a sheet entry with sheets above
// it) asks the top sheet to close (onBack). Closed some other way (✕, Escape, a backdrop tap, a
// Save), a sheet steps back over its own entry, so history doesn't pile up. A sheet that closes
// while a route change sits on top of its entry leaves that entry behind; Back skips it.
// A fragment navigation (location.hash = …) also fires popstate, on an unmarked entry: ignored.
// Pure over a History-like object (web/test/sheetHistory.test.ts); the app's one is at the end.

export interface HistoryLike {
  readonly state: unknown
  pushState(state: unknown, unused: string, url?: string): void
  replaceState(state: unknown, unused: string, url?: string): void
  go(delta: number): void
}
type Marks = { kinwallSheet?: string; kinwallBase?: boolean; [key: string]: unknown }
interface Open { token: string; onBack: () => void; closed: boolean; onGone?: () => void }

export function createSheetHistory(h: HistoryLike) {
  const open: Open[] = [] // bottom → top; closed ones wait for flush()
  let pending = 0 // steps back we took ourselves: their popstate isn't a Back press
  let gone: (() => void)[] = []
  const marks = (): Marks => (h.state && typeof h.state === 'object' ? h.state as Marks : {})
  const sheetEntry = (token: string) => { const { kinwallBase: _base, ...rest } = marks(); void _base; return { ...rest, kinwallSheet: token } }
  const settle = () => { if (pending) return; const run = gone; gone = []; run.forEach(fn => fn()) }

  const flush = () => {
    const cur = marks().kinwallSheet
    let n = 0
    if (cur && open.length && open[open.length - 1].token === cur) while (n < open.length && open[open.length - 1 - n].closed) n++
    for (let i = open.length - 1; i >= 0; i--) {
      if (!open[i].closed) continue
      if (open[i].onGone) gone.push(open[i].onGone!)
      open.splice(i, 1)
    }
    if (n) { pending++; h.go(-n) }
    settle()
  }

  return {
    /** A sheet mounted. Called again for the same token (StrictMode's remount), it stays one entry. */
    opened(token: string, onBack: () => void) {
      const same = open.find(o => o.token === token)
      if (same) { same.closed = false; same.onBack = onBack; return }
      const cur = marks().kinwallSheet
      const replaced = cur ? open.findIndex(o => o.token === cur && o.closed) : -1
      if (replaced >= 0) { // closed in this same render (detail → edit): take over its entry
        const [old] = open.splice(replaced, 1)
        if (old.onGone) gone.push(old.onGone)
        h.replaceState(sheetEntry(token), '')
      } else {
        h.replaceState({ ...marks(), kinwallBase: true }, '')
        h.pushState(sheetEntry(token), '')
      }
      open.push({ token, onBack, closed: false })
      settle()
    },
    /** A sheet unmounted. Checked a moment later (StrictMode mounts it again at once). onGone runs
     * once its entry is off history. */
    closed(token: string, onGone?: () => void) {
      const o = open.find(x => x.token === token)
      if (!o) { onGone?.(); return }
      o.closed = true; o.onGone = onGone
      void Promise.resolve().then(flush)
    },
    /** Back asked a sheet that stays open (unsaved changes, busy): its entry goes back on top. */
    keep(token: string) {
      if (marks().kinwallSheet !== token) h.pushState(sheetEntry(token), '')
    },
    /** window's popstate. */
    popped() {
      if (pending) { pending--; settle(); return }
      const m = marks()
      const live = open.filter(o => !o.closed)
      const at = m.kinwallSheet ? live.findIndex(o => o.token === m.kinwallSheet) : -1
      if (at >= 0) { if (at < live.length - 1) live[live.length - 1].onBack(); return }
      if (m.kinwallBase) { live[live.length - 1]?.onBack(); return }
      if (m.kinwallSheet && !open.some(o => o.token === m.kinwallSheet)) h.go(-1) // left behind: skip it
    },
  }
}

export const sheetHistory = createSheetHistory(typeof history === 'undefined' ? { state: null, pushState() {}, replaceState() {}, go() {} } : history)
if (typeof window !== 'undefined') window.addEventListener('popstate', () => sheetHistory.popped())

/** Sheet's dirty prop: true, or 'auto' once something was typed or picked in its fields. When it
 * holds, ✕, Escape, a backdrop tap, a swipe down and Back ask "Discard changes?" first. */
export const unsavedChanges = (dirty: boolean | 'auto', typed: boolean) => dirty === true || (dirty === 'auto' && typed)
