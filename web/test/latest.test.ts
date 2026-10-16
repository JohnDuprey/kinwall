import { test } from 'node:test'
import assert from 'node:assert/strict'
import { latestOnly } from '../src/latest.ts'

const later = <T,>(v: T, ms: number, fail = false) => new Promise<T>((ok, no) => setTimeout(() => (fail ? no(new Error('x')) : ok(v)), ms))

test('latestOnly: an older load that answers last is dropped, the newest one wins', async () => {
  const fresh = latestOnly()
  const seen: string[] = []
  void fresh(later('before the chore (stale)', 30)).then(v => seen.push(v))
  void fresh(later('after the chore', 5)).then(v => seen.push(v))
  await later(null, 60)
  assert.deepEqual(seen, ['after the chore'])
})

test('latestOnly: the newest answer and its errors still come through', async () => {
  const fresh = latestOnly()
  assert.equal(await fresh(later(1, 1)), 1)
  await assert.rejects(fresh(later(2, 1, true)))
  let old = false
  void fresh(later(3, 20, true)).catch(() => { old = true })
  assert.equal(await fresh(later(4, 1)), 4)
  await later(null, 40)
  assert.equal(old, false, "an outdated load's failure is dropped too")
})
