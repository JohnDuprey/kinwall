// node --test test/ (npm test). The wording of Settings → Access → Security activity.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SECURITY_FILTERS, groupByDay, matchesSecurityQuery, securityDay, securityHint, securityLine } from '../src/securityActivity.ts'
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
  assert.equal(securityLine({ kind: 'pin.set', summary: 'Night PIN set', by: { memberId: 'gone' }, at }, members, now).text, 'Night PIN set')
  assert.equal(securityLine({ kind: 'something.new', summary: 'Something new', by: null, at }, members, now).icon, '🛡️', 'a kind this app version does not know')
})

test('securityLine: a support sign-in from the host gets its own icon', () => {
  const at = new Date(2026, 8, 30, 9, 0).toISOString()
  const line = securityLine({ kind: 'support.signin', summary: 'Kinwall support signed in to help, until 10:00 UTC', by: null, at }, members, now)
  assert.deepEqual([line.icon, line.text], ['🛟', 'Kinwall support signed in to help, until 10:00 UTC'])
  assert.equal(securityLine({ kind: 'support.link_issued', summary: 'x', by: null, at }, members, now).icon, '🛟')
})

test('securityHint: the latest event and when, or nothing yet', () => {
  setHour12(true)
  assert.equal(securityHint({ summary: 'Passkey "iPhone" added', at: new Date(2026, 8, 30, 9, 0).toISOString() }, now), 'Passkey "iPhone" added · 9:00 AM')
  assert.equal(securityHint(undefined, now), 'Nothing yet')
})

test('securityDay and groupByDay: today, yesterday, then the date, in runs', () => {
  assert.equal(securityDay(new Date(2026, 8, 30, 0, 5).toISOString(), now), 'Today')
  assert.equal(securityDay(new Date(2026, 8, 29, 23, 59).toISOString(), now), 'Yesterday')
  assert.equal(securityDay(new Date(2026, 8, 28, 12).toISOString(), now), 'Mon, Sep 28')
  assert.equal(securityDay(new Date(2025, 11, 31, 12).toISOString(), now), 'Wed, Dec 31, 2025')
  const at = (d: number, h: number) => ({ at: new Date(2026, 8, d, h).toISOString() })
  const groups = groupByDay([at(30, 9), at(30, 8), at(29, 20), at(27, 7), at(27, 6)], now)
  assert.deepEqual(groups.map(g => [g.day, g.events.length]), [['Today', 2], ['Yesterday', 1], ['Sun, Sep 27', 2]])
  assert.deepEqual(groupByDay([], now), [])
})

test('SECURITY_FILTERS: every kind has exactly one chip, and All sends none', () => {
  const kinds = ['passkey.added', 'passkey.renamed', 'passkey.removed', 'signin.passkey', 'signin.recovery', 'signout', 'recovery.generated', 'device.paired', 'device.owner', 'key.created', 'key.removed', 'widgets.added', 'widgets.removed', 'app.connected', 'app.disconnected', 'pin.set', 'pin.removed', 'journal.privacy', 'member.grown_up', 'support.link_issued', 'support.link_revoked', 'support.signin']
  const chipped = SECURITY_FILTERS.flatMap(f => [...f.kinds])
  assert.deepEqual([...chipped].sort(), [...kinds].sort())
  assert.equal(SECURITY_FILTERS[0].key, 'all')
  assert.equal(SECURITY_FILTERS[0].kinds.length, 0)
  assert.deepEqual([...SECURITY_FILTERS.find(f => f.key === 'signins')!.kinds], ['signin.passkey', 'signin.recovery', 'signout', 'recovery.generated', 'support.link_issued', 'support.link_revoked', 'support.signin'])
})

test('matchesSecurityQuery: summary, the thing it was about, or who did it, ignoring case', () => {
  const e = { summary: 'Passkey "iPhone" added', device: 'iPhone', by: { memberId: 'm1' } }
  assert.ok(matchesSecurityQuery(e, 'IPHONE', members))
  assert.ok(matchesSecurityQuery(e, ' alex ', members))
  assert.ok(matchesSecurityQuery(e, '', members))
  assert.ok(!matchesSecurityQuery(e, 'sam', members))
  assert.ok(matchesSecurityQuery({ summary: 'Widgets key added', device: null, by: { label: 'Kitchen wall' } }, 'kitchen', members))
  assert.ok(!matchesSecurityQuery({ summary: 'Night PIN set', device: null, by: null }, 'kitchen', members))
})
