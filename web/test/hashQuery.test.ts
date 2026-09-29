// node --test test/ (npm test). Links into the app: #/<path>?<query>.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPath, hashQuery } from '../src/hashQuery.ts'

test('hashQuery: the query after the path, decoded; none is empty', () => {
  assert.equal(hashQuery('#/lists/abc/shop?store=Trader%20Joe%27s').get('store'), "Trader Joe's")
  assert.equal(hashQuery('#/meals?recipe=r1&date=2026-09-29').get('recipe'), 'r1')
  assert.equal(hashQuery('#/contacts').get('contact'), null)
  assert.equal(hashQuery('').toString(), '')
  assert.equal(hashQuery('#/calendar?checkin=').get('checkin'), '')
})

test('hashPath: the hash without its query, so a reload doesn\'t run a link twice', () => {
  assert.equal(hashPath('#/lists/abc/shop?store=Market'), '#/lists/abc/shop')
  assert.equal(hashPath('#/meals'), '#/meals')
  assert.equal(hashPath(''), '')
})
