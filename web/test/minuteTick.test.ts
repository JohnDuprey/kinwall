import { test } from 'node:test'
import assert from 'node:assert/strict'
import { msToNextMinute, rollToToday } from '../src/minuteTick.ts'

test('the clock ticks just after each minute starts', () => {
  const at = (s: string) => Date.parse(`2026-09-30T20:04:${s}Z`)
  assert.equal(msToNextMinute(at('00.000')), 60_050)
  assert.equal(msToNextMinute(at('59.990')), 60)
  assert.equal((at('45.500') + msToNextMinute(at('45.500'))) % 60_000, 50, 'lands 50ms into the next minute')
})

test('a date showing today moves to the new day after midnight; a picked date stays', () => {
  const now = new Date(2026, 10, 14, 0, 1)
  assert.equal(rollToToday(new Date(2026, 10, 13, 15, 30), '2026-11-13', now), now, 'yesterday-as-today rolls over')
  const picked = new Date(2026, 10, 20, 9)
  assert.equal(rollToToday(picked, '2026-11-13', now), picked, 'a paged-to date stays put')
  const back = new Date(2026, 10, 10)
  assert.equal(rollToToday(back, '2026-11-13', now), back)
})
