import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routinePoller } from '../src/routinePolling.ts'

test('routine polling skips disabled children, pauses when hidden, and refreshes on return or change', async () => {
  let visible = true
  const calls: string[] = []
  const enabled: Record<string, boolean> = { maya: true, leo: false }
  const poller = routinePoller(['maya', 'leo'], async id => { calls.push(id); return { enabled: enabled[id] } }, () => visible)
  await poller.refresh()
  assert.deepEqual(calls.splice(0), ['maya', 'leo'])
  await poller.poll()
  assert.deepEqual(calls.splice(0), ['maya'])
  visible = false
  await poller.poll(); await poller.refresh()
  assert.deepEqual(calls, [])
  visible = true; enabled.leo = true
  await poller.refresh()
  assert.deepEqual(calls.splice(0), ['maya', 'leo'])
  await poller.poll()
  assert.deepEqual(calls.splice(0), ['maya', 'leo'])
  poller.stop()
  await poller.refresh(); await poller.poll()
  assert.deepEqual(calls, [])
})

test('routine polling prevents overlapping reads and retries failures', async () => {
  let calls = 0
  let finish!: (value: { enabled: boolean } | undefined) => void
  const poller = routinePoller(['maya'], () => { calls++; return new Promise(resolve => { finish = resolve }) }, () => true)
  const pending = poller.refresh()
  await poller.poll()
  assert.equal(calls, 1)
  finish(undefined); await pending
  const retry = poller.poll()
  assert.equal(calls, 2)
  finish({ enabled: false }); await retry
  await poller.poll()
  assert.equal(calls, 2)
})

test('a failed refresh of a disabled routine retries on the next poll', async () => {
  let calls = 0
  const poller = routinePoller(['maya'], async () => {
    calls++
    return calls === 2 ? undefined : { enabled: calls > 2 }
  }, () => true)
  await poller.refresh() // previously disabled
  await poller.refresh() // the page returns, but the connection fails
  await poller.poll()
  assert.equal(calls, 3)
})
