import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleaned, cleared, createInboxStore, openItems, organize, suggest, upsert, whereHref, type Inbox, type InboxItem } from '../src/inbox.ts'
import { seedInbox } from '../src/mock-inbox.ts'

const now = new Date(2026, 10, 13, 9, 30) // Friday, November 13, 2026
const item = (id: string, text: string, extra: Partial<InboxItem> = {}): InboxItem =>
  ({ id, text, status: 'open', target: null, createdAt: `2026-11-13T0${id.length}:00:00Z`, updatedAt: '', doneAt: null, ...extra })
const empty = (): Inbox => ({ items: [], saving: [] })

test('a thought is kept as typed (trimmed); blanks aren\'t saved', () => {
  assert.equal(cleaned('  Permission slip for Friday '), 'Permission slip for Friday')
  assert.equal(cleaned('   '), null)
})

test('open thoughts are newest first; sorted and cleared ones are listed by when', () => {
  let inbox = upsert(empty(), item('a', 'Permission slip for Friday'))
  inbox = upsert(inbox, item('bb', 'Ask about a library book'))
  inbox = upsert(inbox, item('ccc', 'Call grandma', { status: 'cleared', doneAt: '2026-11-13T09:00:00Z' }))
  inbox = upsert(inbox, item('dddd', 'Bake sale', { status: 'sorted', doneAt: '2026-11-13T10:00:00Z', target: { kind: 'event', id: 'e1', at: '2026-11-19' } }))
  assert.deepEqual(openItems(inbox).map(i => i.id), ['bb', 'a'])
  assert.deepEqual(cleared(inbox).map(i => i.id), ['dddd', 'ccc'])
  assert.equal(upsert(inbox, item('a', 'Permission slip for Friday', { status: 'cleared' })).items.length, 4, 'an update replaces, never duplicates')
})

test('a day word suggests a date the parent still confirms; nothing else guesses one', () => {
  assert.deepEqual(suggest('Permission slip for Friday', now), { kind: 'task', date: '2026-11-13', dateWord: 'Friday' })
  assert.deepEqual(suggest('soccer practice tuesday', now), { kind: 'event', date: '2026-11-17', dateWord: 'tuesday' })
  assert.deepEqual(suggest('Call the dentist tomorrow', now), { kind: 'task', date: '2026-11-14', dateWord: 'tomorrow' })
  assert.deepEqual(suggest('Remember an idea for dinner', now), { kind: 'note', date: null, dateWord: null })
  assert.deepEqual(suggest('Ask about a library book', now), { kind: 'task', date: null, dateWord: null })
  assert.equal(suggest('Fridays are pizza night', now).date, null) // a whole word only
})

test('sorting takes what the server says it became; a thought leaves the inbox only then', async () => {
  const store = createInboxStore(upsert(empty(), item('a', 'Permission slip for Friday')))
  const made = item('a', 'Permission slip for Friday', { status: 'sorted', doneAt: '2026-11-13T10:00:00Z', target: { kind: 'task', id: 'a', listId: 'l1', label: 'To-do' } })
  assert.equal(await organize(store, 'a', async () => made), 'done')
  assert.equal(openItems(store.get()).length, 0)
  assert.deepEqual(cleared(store.get())[0].target, made.target)
  assert.deepEqual(store.get().saving, [])
})

test('a failed sort keeps the thought, words intact, and it can be tried again', async () => {
  const store = createInboxStore(upsert(empty(), item('a', 'Permission slip for Friday')))
  await assert.rejects(organize(store, 'a', async () => { throw new Error('offline') }), /offline/)
  assert.deepEqual(openItems(store.get()).map(i => i.text), ['Permission slip for Friday'])
  assert.deepEqual(store.get().saving, [])
  assert.equal(await organize(store, 'a', async () => ({ ...store.get().items[0], status: 'sorted' })), 'done')
})

test('repeated taps send once', async () => {
  const store = createInboxStore(upsert(empty(), item('a', 'Ask about a library book')))
  let sends = 0
  let finish!: () => void
  const slow = () => new Promise<InboxItem>(resolve => { sends++; finish = () => resolve({ ...store.get().items[0], status: 'sorted' }) })
  const first = organize(store, 'a', slow)
  assert.deepEqual(store.get().saving, ['a'])
  assert.equal(await organize(store, 'a', slow), 'busy') // second tap while saving
  finish()
  assert.equal(await first, 'done')
  assert.equal(await organize(store, 'a', slow), 'busy') // already sorted
  assert.equal(sends, 1)
})

test('each sorted thought links to where it went', () => {
  assert.equal(whereHref({ kind: 'task', id: 'i1', listId: 'l 1' }), '#/lists/l%201')
  assert.equal(whereHref({ kind: 'event', id: 'e1', at: '2026-11-19' }), '#/calendar?event=e1&at=2026-11-19')
  assert.equal(whereHref({ kind: 'note', id: 'n1' }), '#/home')
  assert.equal(whereHref({ kind: 'task', id: null }), null, 'interrupted: nothing to open')
})

test('the store notifies listeners and the demo seed stays relative to today', () => {
  const store = createInboxStore(empty())
  let calls = 0
  const off = store.subscribe(() => calls++)
  store.set(upsert(store.get(), item('x', 'x')))
  off()
  store.set(upsert(store.get(), item('y', 'y')))
  assert.equal(calls, 1)
  const seed = seedInbox(now)
  assert.deepEqual(openItems({ items: seed, saving: [] }).map(i => i.text), ['Permission slip for Friday', 'Ask about a library book', 'Remember an idea for dinner'])
  for (const i of seed) assert.ok(Date.parse(i.createdAt) < now.getTime() && Date.parse(i.createdAt) > now.getTime() - 3 * 86400e3)
})
