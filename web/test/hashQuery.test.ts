// node --test test/ (npm test). Links into the app: #/<path>?<query>.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPath, hashQuery, listRoute, withHashParam } from '../src/hashQuery.ts'

test('hashQuery: the query after the path, decoded; none is empty', () => {
  assert.equal(hashQuery('#/lists/abc/shop?store=Trader%20Joe%27s').get('store'), "Trader Joe's")
  assert.equal(hashQuery('#/meals?recipe=r1&date=2026-09-29').get('recipe'), 'r1')
  assert.equal(hashQuery('#/contacts').get('contact'), null)
  assert.equal(hashQuery('').toString(), '')
  assert.equal(hashQuery('#/home?checkin=').get('checkin'), '')
})

test('hashPath: the hash without its query, so a reload doesn\'t run a link twice', () => {
  assert.equal(hashPath('#/lists/abc/shop?store=Market'), '#/lists/abc/shop')
  assert.equal(hashPath('#/meals'), '#/meals')
  assert.equal(hashPath(''), '')
})

test('withHashParam: sets or takes out one param, keeping the path and the others', () => {
  assert.equal(withHashParam('#/lists', 'gsd', 'L1'), '#/lists?gsd=L1')
  assert.equal(withHashParam('#/meals?cook=r1', 'cook', 'r2'), '#/meals?cook=r2')
  assert.equal(withHashParam('#/home?view=x&gsd=L1', 'gsd', null), '#/home?view=x')
  assert.equal(withHashParam('#/lists?gsd=L1', 'gsd', null), '#/lists')
  assert.equal(withHashParam('', 'gsd', 'a b'), '#/home?gsd=a+b')
  assert.equal(hashQuery(withHashParam('#/chores', 'checklist', 'c&1')).get('checklist'), 'c&1')
})

test('listRoute: the open list is in the address; old ?list= links move to it', () => {
  assert.deepEqual(listRoute('#/lists'), { id: null, shop: false, redirect: null })
  assert.deepEqual(listRoute('#/lists/l1'), { id: 'l1', shop: false, redirect: null })
  assert.deepEqual(listRoute('#/lists/l1?gsd=l1'), { id: 'l1', shop: false, redirect: null })
  assert.deepEqual(listRoute('#/lists/l1/shop?store=Market'), { id: 'l1', shop: true, redirect: null })
  assert.deepEqual(listRoute('#/lists?list=l%202'), { id: 'l 2', shop: false, redirect: '#/lists/l%202' })
  assert.deepEqual(listRoute('#/home?list=l1'), { id: null, shop: false, redirect: null })
})
