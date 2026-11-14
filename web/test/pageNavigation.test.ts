import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openRoutine, leaveRoutine, openJournal, leaveJournal, enterJournal } from '../src/pageNavigation.ts'

function browser(from: string) {
  const entries = [{ hash: from, state: null as unknown }]
  let at = 0
  const location = {
    get hash() { return entries[at].hash },
    set hash(hash: string) { entries.splice(++at); entries.push({ hash, state: null }) },
    replace(hash: string) { entries[at] = { hash, state: null } },
  }
  const history = {
    get state() { return entries[at].state },
    replaceState(state: unknown) { entries[at].state = state },
    back() { if (at) at-- },
  }
  return { location, history, entries }
}
function click(hash = '#/routine?child=maya', overrides = {}) {
  return { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    currentTarget: { hash }, preventDefault() {}, ...overrides }
}

for (const from of ['#/home', '#/home?gsd=bedtime', '#/chores']) {
  test(`Free time returns to its entry point ${from} without a Back loop`, () => {
    const b = browser(from)
    openRoutine(click(), b)
    assert.equal(b.location.hash, '#/routine?child=maya')
    leaveRoutine(b)
    assert.equal(b.location.hash, from)
    b.history.back()
    assert.equal(b.location.hash, from)
  })
  test(`browser Back from Free time preserves ${from}`, () => {
    const b = browser(from)
    openRoutine(click(), b)
    b.history.back()
    assert.equal(b.location.hash, from)
  })
}

test('a direct Free time link falls back to Home by replacement', () => {
  const b = browser('#/routine?child=maya&returnTo=https://example.com')
  leaveRoutine(b)
  assert.equal(b.location.hash, '#/home')
  assert.equal(b.entries.length, 1)
})

test('modified clicks keep normal link behavior and do not mark history', () => {
  for (const overrides of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const b = browser('#/home')
    openRoutine(click(undefined, { ...overrides, preventDefault() { assert.fail('intercepted new-tab click') } }), b)
    assert.equal(b.location.hash, '#/home')
    assert.equal(b.history.state, null)
  }
})

for (const from of ['#/profile/m3', '#/home', '#/calendar']) {
  test(`Journal Back returns to ${from}`, () => {
    const b = browser(from)
    openJournal(click('#/journal/m3'), b)
    leaveJournal(b)
    assert.equal(b.location.hash, from)
    b.history.back()
    assert.equal(b.location.hash, from, 'no new return entry')
  })
}

test('journal notification entry returns to the screen under notifications', () => {
  const b = browser('#/lists')
  enterJournal('#/journal/m3', b)
  b.history.back()
  assert.equal(b.location.hash, '#/lists')
})

test('direct journal links use Home and ignore supplied return URLs', () => {
  const b = browser('#/journal/m3?returnTo=https://example.com')
  leaveJournal(b)
  assert.equal(b.location.hash, '#/home')
  assert.equal(b.entries.length, 1)
})

test('selecting the current journal does not invent a previous entry', () => {
  const b = browser('#/journal/m3')
  openJournal(click('#/journal/m3'), b)
  assert.equal(b.history.state, null)
  leaveJournal(b)
  assert.equal(b.location.hash, '#/home')
})

test('journal entry refuses unrelated routes and modified clicks', () => {
  const b = browser('#/home')
  enterJournal('https://example.com', b)
  enterJournal('#/routine', b)
  openJournal(click('#/journal/m3', { ctrlKey: true }), b)
  assert.equal(b.location.hash, '#/home')
  assert.equal(b.history.state, null)
})
