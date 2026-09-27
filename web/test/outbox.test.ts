// node --test test/ (npm test). The outbox with a fake IndexedDB: order, idempotent replays,
// the conflict rule, and surviving a reload.
import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as outbox from '../src/outbox.ts'
import type { Op } from '../src/outbox.ts'

const TAG = 'https://home.example/api/'
const err = (status: number, message = 'x') => Object.assign(new Error(message), { status })
const settle = () => new Promise(r => setTimeout(r, 20))

// A tiny fake server for one list, applying the same semantics as routes/lists.ts.
function fakeServer() {
  const items = new Map<string, { id: string; title: string; done: boolean; notes: string | null }>()
  let online = true
  const log: string[] = []
  const send = async (op: Op) => {
    if (!online) throw err(0, 'offline')
    log.push(`${op.method} ${op.path}`)
    const m = /^api\/lists\/L\/items(?:\/(.+))?$/.exec(op.path)!
    if (op.method === 'POST') {
      const b = op.body as { id: string; title: string }
      if (!items.has(b.id)) items.set(b.id, { id: b.id, title: b.title, done: false, notes: null }) // client id: replay is a no-op
    } else if (op.method === 'PATCH') {
      const it = items.get(m[1]!)
      if (!it) throw err(404, 'not found')
      Object.assign(it, op.body)
    } else if (!items.delete(m[1]!)) throw err(404, 'not found')
  }
  return { items, send, log, setOnline: (v: boolean) => { online = v } }
}

test('outbox: replays in order once back online, idempotently; a failed send keeps the rest queued', async () => {
  await outbox.clearOffline()
  const srv = fakeServer()
  srv.items.set('a', { id: 'a', title: 'Milk', done: false, notes: null })
  srv.items.set('b', { id: 'b', title: 'Eggs', done: false, notes: null })
  srv.setOnline(false)

  await outbox.enqueue({ tag: TAG, method: 'PATCH', path: 'api/lists/L/items/a', body: { done: true } })
  await outbox.enqueue({ tag: TAG, method: 'PATCH', path: 'api/lists/L/items/b', body: { done: true } })
  await outbox.enqueue({ tag: TAG, method: 'POST', path: 'api/lists/L/items', body: { id: 'c', title: 'Bread' } })
  await outbox.enqueue({ tag: TAG, method: 'PATCH', path: 'api/lists/L/items/a', body: { done: false } }) // changed mind
  await outbox.enqueue({ tag: 'https://other.example/api/', method: 'DELETE', path: 'api/lists/L/items/a' })

  const r1 = await outbox.flush(TAG, srv.send)
  assert.equal(r1.stalled, true)
  assert.equal(r1.sent, 0)
  assert.equal(outbox.pendingOps(TAG).length, 4, 'offline: nothing lost')

  srv.setOnline(true)
  const r2 = await outbox.flush(TAG, srv.send)
  assert.deepEqual([r2.sent, r2.dropped.length, r2.stalled], [4, 0, false])
  assert.deepEqual(srv.log, ['PATCH api/lists/L/items/a', 'PATCH api/lists/L/items/b', 'POST api/lists/L/items', 'PATCH api/lists/L/items/a'])
  assert.equal(srv.items.get('a')!.done, false, 'the later change wins')
  assert.equal(srv.items.get('b')!.done, true)
  assert.equal(srv.items.get('c')!.title, 'Bread')
  assert.equal(outbox.pendingOps(TAG).length, 0)
  assert.equal(outbox.pendingOps('https://other.example/api/').length, 1, "another server's change is never sent here")

  // The add replayed again (response lost the first time) doesn't duplicate.
  await outbox.enqueue({ tag: TAG, method: 'POST', path: 'api/lists/L/items', body: { id: 'c', title: 'Bread' } })
  await outbox.flush(TAG, srv.send)
  assert.equal([...srv.items.values()].filter(i => i.title === 'Bread').length, 1)
})

test('outbox: conflict rule - per field, last to reach the server wins; an edit to an item deleted elsewhere is dropped', async () => {
  await outbox.clearOffline()
  const srv = fakeServer()
  srv.items.set('a', { id: 'a', title: 'Milk', done: false, notes: null })
  srv.items.set('b', { id: 'b', title: 'Eggs', done: false, notes: null })
  srv.setOnline(false)
  await outbox.enqueue({ tag: TAG, method: 'PATCH', path: 'api/lists/L/items/a', body: { done: true } })
  await outbox.enqueue({ tag: TAG, method: 'PATCH', path: 'api/lists/L/items/b', body: { notes: 'a dozen' } })
  await outbox.enqueue({ tag: TAG, method: 'DELETE', path: 'api/lists/L/items/b' })
  // Meanwhile another device renames Milk and deletes Eggs.
  srv.items.get('a')!.title = 'Oat milk'
  srv.items.delete('b')

  srv.setOnline(true)
  const r = await outbox.flush(TAG, srv.send)
  assert.equal(srv.items.get('a')!.title, 'Oat milk', "the other device's field survives")
  assert.equal(srv.items.get('a')!.done, true, 'our field lands')
  assert.equal(r.dropped.length, 1, 'the notes edit on the deleted item is dropped')
  assert.equal(r.dropped[0].status, 404)
  assert.equal(r.sent, 2, 'a delete of something already gone counts as done')
  assert.equal(outbox.pendingOps(TAG).length, 0)
})

test('outbox: server errors retry (in order), refusals are dropped and reported', async () => {
  await outbox.clearOffline()
  let fail = 503
  const sent: string[] = []
  const send = async (op: Op) => {
    if (op.path.endsWith('/x') && fail) throw err(fail)
    if (op.path.endsWith('/forbidden')) throw err(403, "may not")
    sent.push(op.path)
  }
  await outbox.enqueue({ tag: TAG, method: 'PATCH', path: 'api/lists/L/items/x', body: { done: true } })
  await outbox.enqueue({ tag: TAG, method: 'PATCH', path: 'api/lists/L/items/forbidden', body: { done: true } })
  await outbox.enqueue({ tag: TAG, method: 'PATCH', path: 'api/lists/L/items/y', body: { done: true } })
  const r1 = await outbox.flush(TAG, send)
  assert.equal(r1.stalled, true)
  assert.deepEqual(sent, [], 'nothing overtakes the stuck change')
  assert.equal(outbox.pendingOps(TAG)[0].tries, 1)
  fail = 0
  const r2 = await outbox.flush(TAG, send)
  assert.deepEqual(sent, ['api/lists/L/items/x', 'api/lists/L/items/y'])
  assert.equal(r2.dropped[0].message, 'may not')
})

test('outbox: queued changes survive a reload (IndexedDB) and are cleared on sign-out', async () => {
  await outbox.clearOffline()
  await outbox.enqueue({ tag: TAG, method: 'PATCH', path: 'api/lists/L/items/a', body: { done: true } })
  await outbox.enqueue({ tag: TAG, method: 'POST', path: 'api/lists/L/items', body: { id: 'n', title: 'Apples' } })
  await outbox.cachePut('https://home.example/api/lists/L', { hello: 1 })
  // A fresh copy of the module is a reloaded page: same database, empty memory.
  const again = await import('../src/outbox.ts?reload=1') as typeof outbox
  assert.equal(again.pendingOps(TAG).length, 0)
  await again.outboxReady()
  assert.deepEqual(again.pendingOps(TAG).map(o => o.method), ['PATCH', 'POST'])
  assert.deepEqual(await again.cacheGet('https://home.example/api/lists/L'), { hello: 1 })

  await again.clearOffline(true) // a rejected key: cache goes, queue stays
  assert.equal(await again.cacheGet('https://home.example/api/lists/L'), undefined)
  assert.equal(again.pendingOps(TAG).length, 2)
  await again.clearOffline() // sign-out: everything goes
  const third = await import('../src/outbox.ts?reload=2') as typeof outbox
  await third.outboxReady()
  assert.equal(third.pendingOps(TAG).length, 0)
  await settle()
})

test('applyListOps: shows adds, edits and deletes on top of the last copy, marked pending', () => {
  const item = (id: string, sort: number) => ({ id, listId: 'L', title: id, done: false, doneAt: null, sort })
  const detail = { list: { id: 'L', itemCount: 2, openCount: 2 }, items: [item('a', 0), item('b', 1)] }
  const ops: Op[] = [
    { tag: TAG, method: 'PATCH', path: 'api/lists/L/items/a', body: { done: true } },
    { tag: TAG, method: 'POST', path: 'api/lists/L/items', body: { id: 'c', title: 'Bread' } },
    { tag: TAG, method: 'DELETE', path: 'api/lists/L/items/b' },
    { tag: TAG, method: 'PATCH', path: 'api/lists/OTHER/items/a', body: { done: false } },
  ]
  const out = outbox.applyListOps(detail, ops)
  assert.deepEqual(out.items.map(i => [i.id, i.done, !!i.pending]), [['a', true, true], ['c', false, true]])
  assert.ok(out.items[0].doneAt)
  assert.equal(out.items[1].sort, 2, 'after the last item')
  assert.deepEqual([out.list.itemCount, out.list.openCount], [2, 1])
  assert.equal(outbox.applyListOps(out, ops.slice(1, 2)).items.length, 2, 'an add already shown is not shown twice')
  assert.equal(detail.items[0].done, false, 'input untouched')
})

test('applyChoreOps: ticks and unticks for that day only', () => {
  const chores = [{ id: 'k1', completed: false, completedBy: null }, { id: 'k2', completed: true, completedBy: 'm1' }]
  const ops: Op[] = [
    { tag: TAG, method: 'POST', path: 'api/chores/k1/complete', body: { date: '2026-09-27', memberId: 'm2' } },
    { tag: TAG, method: 'DELETE', path: 'api/chores/k2/complete?date=2026-09-27' },
    { tag: TAG, method: 'DELETE', path: 'api/chores/k1/complete?date=2026-09-26' },
  ]
  assert.deepEqual(outbox.applyChoreOps(chores, '2026-09-27', ops), [
    { id: 'k1', completed: true, completedBy: 'm2' },
    { id: 'k2', completed: false, completedBy: null },
  ])
})
