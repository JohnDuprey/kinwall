// node --test test/ (npm test). The demo's points behave like the server's (mock.ts): chores raise the
// balance for whoever did them, and a split takes and gives back only what it took.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
;(globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }
const { mock } = await import('../src/mock.ts')
const { dateKey } = await import('../src/date.ts')
const balance = async (id: string) => (await mock.getMembers()).find(m => m.id === id)!.balance
const today = dateKey(new Date())

test('completing a chore credits whoever did it, and unticking takes it back', async () => {
  const leo = await balance('m4')
  await mock.completeChore('ch4', today, 'm4') // Water plants, an Anyone chore, 5 points
  assert.equal(await balance('m4'), leo + 5)
  await mock.completeChore('ch4', today, 'm3') // re-ticked for Maya: the points move to her
  assert.equal(await balance('m4'), leo)
  await mock.uncompleteChore('ch4', today)
  assert.equal(await balance('m4'), leo)
})

test("a split on a kid's device takes the asker's share now, the rest on yes, and a no gives back only what it took", async () => {
  store.set('kinwall.demoKid', 'm4')
  const [leo, maya] = [await balance('m4'), await balance('m3')]
  const { redemption } = await mock.redeemReward('rw4', 'm4', [{ memberId: 'm4', points: 10 }, { memberId: 'm3', points: 30 }])
  assert.equal(redemption.status, 'pending')
  assert.deepEqual([await balance('m4'), await balance('m3')], [leo - 10, maya])
  await mock.decideRedemption(redemption.id, 'approve')
  assert.deepEqual([await balance('m4'), await balance('m3')], [leo - 10, maya - 30])
  await mock.decideRedemption(redemption.id, 'decline')
  assert.deepEqual([await balance('m4'), await balance('m3')], [leo, maya])

  const again = (await mock.redeemReward('rw4', 'm4', [{ memberId: 'm4', points: 10 }, { memberId: 'm3', points: 30 }])).redemption
  await mock.decideRedemption(again.id, 'decline') // declined while waiting: Maya never paid, so nothing comes back to her
  assert.deepEqual([await balance('m4'), await balance('m3')], [leo, maya])
  const ledger = await mock.getMemberPoints('m4')
  assert.equal(ledger.entries.filter(e => e.ref === again.id).reduce((n, e) => n + e.amount, 0), 0)
  store.delete('kinwall.demoKid')
})
