// node --test test/ (npm test). The wording of Settings → Access → Security activity.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { securityLine } from '../src/securityActivity.ts'
import { setHour12 } from '../src/timeFormat.ts'

const members = [{ id: 'm1', name: 'Alex', avatar: '🦊' }, { id: 'm2', name: 'Sam', avatar: '' }]
const now = new Date(2026, 8, 30, 18, 0) // Wed Sep 30

test('securityLine: what happened, by whom, and when', () => {
  setHour12(true)
  assert.deepEqual(
    securityLine({ kind: 'passkey.added', summary: 'Passkey "iPhone" added', by: { memberId: 'm1' }, at: new Date(2026, 8, 29, 16, 12).toISOString() }, members, now),
    { icon: '🔑', text: 'Passkey "iPhone" added by 🦊 Alex', when: 'Tue 4:12 PM' },
  )
  const device = securityLine({ kind: 'widgets.added', summary: 'Widgets key "Kitchen widgets" added', by: { label: 'Kitchen wall' }, at: new Date(2026, 8, 30, 9, 5).toISOString() }, members, now)
  assert.deepEqual([device.icon, device.text, device.when], ['🧩', 'Widgets key "Kitchen widgets" added by Kitchen wall', '9:05 AM'])
})

test('securityLine: nobody to credit, or someone who left, reads as just what happened', () => {
  const at = new Date(2026, 8, 30, 9, 0).toISOString()
  assert.equal(securityLine({ kind: 'signin.recovery', summary: 'Recovery code used to sign in (7 left)', by: null, at }, members, now).text, 'Recovery code used to sign in (7 left)')
  assert.equal(securityLine({ kind: 'signin.recovery', summary: 'x', by: null, at }, members, now).icon, '🔐', 'not the plain sign-in icon')
  assert.equal(securityLine({ kind: 'pin.set', summary: 'Quiet-hours PIN set', by: { memberId: 'gone' }, at }, members, now).text, 'Quiet-hours PIN set')
  assert.equal(securityLine({ kind: 'something.new', summary: 'Something new', by: null, at }, members, now).icon, '🛡️', 'a kind this app version does not know')
})
