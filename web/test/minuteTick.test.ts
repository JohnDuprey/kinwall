import { test } from 'node:test'
import assert from 'node:assert/strict'
import { msToNextMinute } from '../src/minuteTick.ts'

test('the clock ticks just after each minute starts', () => {
  const at = (s: string) => Date.parse(`2026-09-30T20:04:${s}Z`)
  assert.equal(msToNextMinute(at('00.000')), 60_050)
  assert.equal(msToNextMinute(at('59.990')), 60)
  assert.equal((at('45.500') + msToNextMinute(at('45.500'))) % 60_000, 50, 'lands 50ms into the next minute')
})
