// node --test test/ (npm test). Back closes sheets: one history entry per open sheet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSheetHistory, unsavedChanges, type HistoryLike } from '../src/sheetHistory.ts'

// A browser's session history, enough of it: entries with state and a URL, traversals that land
// later (popstate is async in browsers), pushes that drop the forward entries.
function fakeHistory(url = '#/home') {
  const entries: { state: unknown; url: string }[] = [{ state: null, url }]
  let i = 0
  const queue: (() => void)[] = []
  let onPop = () => {}
  const h: HistoryLike & { url: string } = {
    get state() { return entries[i].state },
    get url() { return entries[i].url },
    pushState(state, _t, u) { entries.splice(i + 1); entries.push({ state: structuredClone(state), url: u ?? entries[i].url }); i++ },
    replaceState(state, _t, u) { entries[i] = { state: structuredClone(state), url: u ?? entries[i].url } },
    go(n) { queue.push(() => { i = Math.max(0, Math.min(entries.length - 1, i + n)); onPop() }) },
  }
  const navigate = (u: string) => { h.pushState(null, '', u); onPop() } // location.hash = …: a new entry, and popstate
  const back = () => h.go(-1)
  const settle = async () => { await new Promise(r => setTimeout(r, 0)); while (queue.length) { queue.shift()!(); await new Promise(r => setTimeout(r, 0)) } }
  return { h, entries, index: () => i, navigate, back, settle, listen: (fn: () => void) => { onPop = fn } }
}

function setup(url?: string) {
  const f = fakeHistory(url)
  const sh = createSheetHistory(f.h)
  f.listen(() => sh.popped())
  return { ...f, sh }
}

test('opening a sheet adds one entry; Back asks it to close', async () => {
  const t = setup()
  let backs = 0
  t.sh.opened('a', () => backs++)
  assert.equal(t.entries.length, 2)
  assert.equal(t.entries[1].url, '#/home') // same address: nothing else on screen changes
  t.back(); await t.settle()
  assert.equal(backs, 1)
  t.sh.closed('a'); await t.settle() // unmounted: its entry is already gone, so no further step back
  assert.equal(t.index(), 0)
})

test('closed by ✕, Escape or Save: the sheet steps back over its own entry', async () => {
  const t = setup()
  let backs = 0
  t.sh.opened('a', () => backs++)
  t.sh.closed('a'); await t.settle()
  assert.equal(t.index(), 0)
  assert.equal(backs, 0) // our own step back isn't a Back press
})

test('nested sheets: Back closes the top one only', async () => {
  const t = setup()
  const closed: string[] = []
  t.sh.opened('a', () => closed.push('a'))
  t.sh.opened('b', () => closed.push('b'))
  assert.equal(t.entries.length, 3)
  t.back(); await t.settle()
  assert.deepEqual(closed, ['b'])
  t.sh.closed('b'); await t.settle()
  t.back(); await t.settle()
  assert.deepEqual(closed, ['b', 'a'])
})

test('two sheets closing at once step back over both entries', async () => {
  const t = setup()
  t.sh.opened('a', () => {}); t.sh.opened('b', () => {})
  t.sh.closed('b'); t.sh.closed('a'); await t.settle()
  assert.equal(t.index(), 0)
})

test('a sheet replaced by another in the same render reuses its entry', async () => {
  const t = setup()
  let backs = ''
  t.sh.opened('detail', () => { backs += 'd' })
  t.sh.closed('detail'); t.sh.opened('edit', () => { backs += 'e' }); await t.settle()
  assert.equal(t.entries.length, 2)
  t.back(); await t.settle()
  assert.equal(backs, 'e')
})

test('StrictMode remount: the same sheet unmounted and mounted again keeps its one entry', async () => {
  const t = setup()
  t.sh.opened('a', () => {}); t.sh.closed('a'); t.sh.opened('a', () => {}); await t.settle()
  assert.equal(t.entries.length, 2)
  assert.equal(t.index(), 1)
})

test('Back on a sheet that stays open (unsaved changes): keep() puts its entry back', async () => {
  const t = setup()
  t.sh.opened('a', () => t.sh.keep('a'))
  t.back(); await t.settle()
  assert.equal(t.index(), 1)
  assert.equal((t.h.state as { kinwallSheet?: string }).kinwallSheet, 'a')
  t.sh.closed('a'); await t.settle() // later discarded: its entry goes too
  assert.equal(t.index(), 0)
})

test('a route change from inside a sheet: no close request, and the entry left behind is skipped on the way back', async () => {
  const t = setup()
  let backs = 0
  t.sh.opened('a', () => backs++)
  t.navigate('#/calendar') // the sheet's link, before it unmounts
  assert.equal(backs, 0)
  t.sh.closed('a'); await t.settle()
  assert.equal(t.h.url, '#/calendar') // not stepped back off the new screen
  t.back(); await t.settle()
  assert.equal(t.index(), 0) // the sheet's leftover entry stepped over: one Back, back on Home
  assert.equal(t.h.url, '#/home')
})

test('onGone runs once the sheet’s entry is off history, so the caller can navigate', async () => {
  const t = setup()
  let gone = -1
  t.sh.opened('a', () => {})
  t.sh.closed('a', () => { gone = t.index() })
  assert.equal(gone, -1)
  await t.settle()
  assert.equal(gone, 0)
  t.sh.opened('b', () => {})
  t.back(); await t.settle()
  t.sh.closed('b', () => { gone = 42 }); await t.settle() // already off history: right away
  assert.equal(gone, 42)
})

test('a link that closes its sheet on click: the navigation after the click stays (WebKit order)', async () => {
  const t = setup()
  t.sh.opened('more', () => {})
  t.sh.closed('more') // onClick closes the sheet…
  await Promise.resolve() // …the click's microtasks run…
  t.navigate('#/meals') // …then the link navigates. A step back queued before it would undo it.
  await t.settle()
  assert.equal(t.h.url, '#/meals')
  t.back(); await t.settle()
  assert.equal(t.h.url, '#/home') // the sheet's leftover entry is skipped on the way back
})

test('other state on the entry (an open activity) is kept on the sheet entry', async () => {
  const t = setup('#/activities/plugin/x')
  t.h.replaceState({ kinwallActivity: 'x' }, '')
  t.sh.opened('a', () => {})
  assert.equal((t.h.state as { kinwallActivity?: string }).kinwallActivity, 'x')
  t.sh.closed('a'); await t.settle()
  assert.deepEqual(Object.keys(t.h.state as object).includes('kinwallActivity'), true)
})

test('unsavedChanges: Discard changes? only for a form with changes', () => {
  assert.equal(unsavedChanges(false, true), false) // read-only and settings sheets never ask
  assert.equal(unsavedChanges(true, false), true) // the form says it changed
  assert.equal(unsavedChanges('auto', false), false) // opened and closed untouched
  assert.equal(unsavedChanges('auto', true), true) // something was typed
})
