import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dueRecheckDelay } from '../src/dueRecheck.ts'

test('medicine deadline accounts for elapsed time and differences between device and server clocks', () => {
 const now=Date.parse('2026-01-01T12:00:00Z')
 const answer={checkedAt:'2026-01-01T11:00:00Z',recheckAt:'2026-01-01T11:10:00Z',receivedAt:now-30_000}
 assert.equal(dueRecheckDelay(answer,now),570_000)
 assert.equal(dueRecheckDelay(answer,now+700_000),1000)
})
test('failed reads and older servers retry, invalid dates do not create tight loops', () => {
 assert.equal(dueRecheckDelay(null,0),60_000)
 assert.equal(dueRecheckDelay({receivedAt:0},0),60_000)
 assert.equal(dueRecheckDelay({receivedAt:0,checkedAt:'bad',recheckAt:'bad'},0),60_000)
})
