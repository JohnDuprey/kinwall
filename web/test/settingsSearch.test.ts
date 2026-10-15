// node --test test/ (npm test). Settings search matching, the tabs it covers, links and the open sections kept per device.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fold, linkTab, matchesAll, queryWords, readOpen, tabsShown, writeOpen } from '../src/settingsSearch.ts'

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }

test('fold drops case, accents and extra spaces', () => {
  assert.equal(fold('  Café   TIME '), 'cafe time')
  assert.equal(fold('Ñandú Über'), 'nandu uber')
})

test('query words', () => {
  assert.deepEqual(queryWords('  Night  PIN '), ['night', 'pin'])
  assert.deepEqual(queryWords('   '), [])
})

test('every word must match, in any order, accent-insensitive', () => {
  const row = 'Night PIN to wake at night'
  assert.ok(matchesAll(queryWords('pin night'), row))
  assert.ok(matchesAll(queryWords('NÎGHT'), row))
  assert.ok(!matchesAll(queryWords('pin weather'), row))
  assert.ok(matchesAll(queryWords('cafe'), 'Le Café'))
  assert.ok(matchesAll([], 'anything'), 'no words matches everything')
})

test('open sections round-trip through storage', () => {
  const s = mem()
  assert.deepEqual([...readOpen(s)], [])
  writeOpen(new Set(['night', 'weather']), s)
  assert.deepEqual([...readOpen(s)].sort(), ['night', 'weather'])
})

test('bad or blocked storage reads as nothing open and never throws', () => {
  const s = mem()
  s.setItem('kinwall.settingsOpen', '{oops')
  assert.deepEqual([...readOpen(s)], [])
  s.setItem('kinwall.settingsOpen', '[1,"night",null]')
  assert.deepEqual([...readOpen(s)], ['night'])
  const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.deepEqual([...readOpen(blocked)], [])
  assert.doesNotThrow(() => writeOpen(new Set(['x']), blocked))
})

test('a search covers every tab the device can see; otherwise just the picked one', () => {
  const tabs = ['general', 'family', 'calendars', 'access']
  assert.deepEqual(tabsShown('family', tabs, false), ['family'])
  assert.deepEqual(tabsShown('family', tabs, true), tabs)
  assert.deepEqual(tabsShown('general', ['general', 'family'], true), ['general', 'family'], 'a wall screen has no Calendars or Access')
})

test('an old link to a card that moved tabs opens its new tab', () => {
  assert.equal(linkTab('access', 'this-device'), 'general')
  assert.equal(linkTab(null, 'this-device'), 'general')
  assert.equal(linkTab('access', 'paired-devices'), 'access')
  assert.equal(linkTab('family', null), 'family')
  assert.equal(linkTab(null, null), null)
})
