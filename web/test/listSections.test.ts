// node --test test/ (npm test). The Lists page's sections by type, and reordering inside one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listSections, listType, reorderWithin, typeFields } from '../src/listSections.ts'

type L = { id: string; kind: 'todo' | 'shopping' | 'reusable'; catalog?: 'groceries' | 'shopping' | null; sort: number; createdAt: string }
const l = (id: string, kind: L['kind'], sort: number, createdAt = '2026-01-01', catalog?: L['catalog']) => ({ id, kind, sort, createdAt, catalog })

test('listSections: Groceries, Shopping, To-dos, Reusable in that order, each in the family order, empty ones left out', () => {
  const lists = [l('packing', 'reusable', 0), l('chores', 'todo', 3), l('hardware', 'shopping', 4, undefined, 'shopping'), l('groceries', 'shopping', 1, undefined, 'groceries'), l('market', 'shopping', 5), l('errands', 'todo', 2)]
  const s = listSections(lists)
  assert.deepEqual(s.map(x => [x.type, x.label, x.lists.map(i => i.id)]), [
    ['groceries', 'Groceries', ['groceries', 'market']], // no catalog (an older server): groceries
    ['shopping', 'Shopping', ['hardware']],
    ['todo', 'To-dos', ['errands', 'chores']],
    ['reusable', 'Reusable', ['packing']],
  ])
  assert.deepEqual(listSections([l('a', 'todo', 0)]).map(x => x.type), ['todo'])
})

test('listType and typeFields: a type is a kind, and a catalog on shopping lists', () => {
  assert.equal(listType({ kind: 'shopping', catalog: 'shopping' }), 'shopping')
  assert.equal(listType({ kind: 'shopping' }), 'groceries')
  assert.equal(listType({ kind: 'todo', catalog: null }), 'todo')
  assert.deepEqual(typeFields('groceries'), { kind: 'shopping', catalog: 'groceries' })
  assert.deepEqual(typeFields('shopping'), { kind: 'shopping', catalog: 'shopping' })
  assert.deepEqual(typeFields('reusable'), { kind: 'reusable' })
})

test('listSections: equal sort (lists from before ordering) falls back to oldest first', () => {
  const s = listSections([l('new', 'todo', 0, '2026-03-01'), l('old', 'todo', 0, '2026-01-01')])
  assert.deepEqual(s[0].lists.map(i => i.id), ['old', 'new'])
})

test('reorderWithin: the moved section takes its own slots; every other list stays put', () => {
  const all = [l('g', 'shopping', 0), l('c', 'todo', 1), l('h', 'shopping', 2), l('e', 'todo', 3), l('p', 'reusable', 4)]
  assert.deepEqual(reorderWithin(all, ['e', 'c']), ['g', 'e', 'h', 'c', 'p'])
  assert.deepEqual(reorderWithin(all, ['h', 'g']), ['h', 'c', 'g', 'e', 'p'])
})
