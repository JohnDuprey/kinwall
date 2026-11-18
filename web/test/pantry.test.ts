// node --test test/ (npm test). Pantry use-by lines, groups and simple demo suggestions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expiryLabel, expiryShort, expiryStatus } from '../src/pantry.ts'

const today = '2026-11-08'

test('expiryStatus: days left in the calendar, and what that means', () => {
  assert.deepEqual(expiryStatus('2026-11-07', today), { daysLeft: -1, status: 'expired' })
  assert.deepEqual(expiryStatus(today, today), { daysLeft: 0, status: 'today' })
  assert.deepEqual(expiryStatus('2026-11-11', today), { daysLeft: 3, status: 'soon' })
  assert.deepEqual(expiryStatus('2026-11-12', today), { daysLeft: 4, status: 'later' })
  assert.equal(expiryStatus(null, today), null)
  assert.equal(expiryStatus('2026-13-45', today), null)
})

test('expiryLabel: a word and a mark for each state, never color alone; nothing once used up', () => {
  const label = (dueDate: string | null, done = false) => expiryLabel({ dueDate, done }, today)?.text
  assert.match(label('2026-11-06')!, /^⚠ Expired · Nov 6$/)
  assert.equal(label(today), '⏳ Use today')
  assert.equal(label('2026-11-09'), '⏳ Use by tomorrow')
  assert.match(label('2026-11-10')!, /^⏳ Use by Tue, Nov 10$/)
  assert.match(label('2026-11-20')!, /^Use by Nov 20$/)
  assert.equal(label('2026-11-06', true), undefined)
  assert.equal(label(null), undefined)
  assert.equal(expiryShort({ useBy: '2026-11-06', daysLeft: -2, status: 'expired' }), 'expired')
  assert.equal(expiryShort({ useBy: '2026-11-09', daysLeft: 1, status: 'soon' }), 'tomorrow')
})

test('soonestGroupFirst: the place with the food to use first leads; undated places last, then A-Z', async () => {
  const { soonestGroupFirst } = await import('../src/pantry.ts')
  const g = (name: string, ...dates: (string | null)[]) => ({ name, items: dates.map(dueDate => ({ dueDate })) })
  const groups = [g('Freezer', '2027-01-07'), g('Pantry', null), g('Fridge', '2026-11-07', '2026-11-20'), g('Cellar', null), g('Garage fridge', '2026-11-07')]
  assert.deepEqual(groups.sort(soonestGroupFirst).map(x => x.name), ['Fridge', 'Garage fridge', 'Freezer', 'Cellar', 'Pantry'])
})

test('demo pantry suggestions show simple ingredient matches without ranking or a shopping forecast', async () => {
  const store = new Map<string, string>()
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }
  const { mock } = await import('../src/mock.ts')
  const { dateKey } = await import('../src/date.ts')
  const list = await mock.createList({ name: 'Kitchen', kind: 'todo', purpose: 'pantry' })
  await mock.addListItems(list.id, [{ title: 'Chicken', dueDate: dateKey(new Date()) }])
  const result = await mock.getPantrySuggestions()
  assert.ok(result.suggestions.length > 0)
  for (const suggestion of result.suggestions) {
    assert.equal(suggestion.score, 1)
    assert.deepEqual(suggestion.alsoHave, [])
    assert.deepEqual(suggestion.missing, [])
    assert.ok(suggestion.uses.length > 0)
  }
  const used = new Set(result.suggestions.flatMap(s => s.uses.map(i => i.id)))
  assert.deepEqual(result.unmatched, result.expiring.filter(i => !used.has(i.id)))
})
