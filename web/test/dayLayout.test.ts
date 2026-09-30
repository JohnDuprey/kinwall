// node --test test/ (npm test). Where timed events go in the Day and Week grids (dayLayout.ts), and
// which events count for Now / Next and leave-by (leadTime.ts blocksTime).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FREE_EDGE, layoutDay } from '../src/dayLayout.ts'
import { blocksTime } from '../src/leadTime.ts'
import type { EventInstance } from '../src/types.ts'

const ev = (id: string, start: string, end: string, busy?: boolean) => ({ id, start, end, allDay: false, ...(busy === undefined ? {} : { busy }) }) as EventInstance

test('layoutDay: a free window never splits busy events into columns; they step in past its edge', () => {
  const window = ev('w', '2026-10-07T08:00:00Z', '2026-10-07T20:00:00Z', false)
  const soccer = ev('s', '2026-10-07T16:00:00Z', '2026-10-07T17:00:00Z')
  const early = ev('e', '2026-10-07T06:00:00Z', '2026-10-07T07:00:00Z')
  const out = layoutDay([soccer, window, early], 'UTC')
  assert.deepEqual(out.map(p => [p.ev.id, p.free, p.totalCols]), [['w', true, 1], ['e', false, 1], ['s', false, 1]], 'free first (drawn behind), each set packed on its own')
  assert.equal(out[0].width, 'calc((100% - 0px) / 1 - 4px)', 'the window keeps the full width')
  assert.ok(out[2].left.startsWith(`calc(${FREE_EDGE}px`), 'Soccer overlaps the window: inset')
  assert.ok(out[1].left.startsWith('calc(0px'), 'the early event does not overlap it: no inset')
  // Two busy events still share the column between themselves.
  const clash = layoutDay([soccer, ev('p', '2026-10-07T16:30:00Z', '2026-10-07T17:30:00Z'), window], 'UTC').filter(p => !p.free)
  assert.deepEqual(clash.map(p => p.totalCols), [2, 2])
})

test('blocksTime: timed busy events only, so Now / Next and leave-by skip free and all-day ones', () => {
  assert.equal(blocksTime({ allDay: false }), true, 'busy when not said')
  assert.equal(blocksTime({ allDay: false, busy: true }), true)
  assert.equal(blocksTime({ allDay: false, busy: false }), false)
  assert.equal(blocksTime({ allDay: true, busy: true }), false)
})
