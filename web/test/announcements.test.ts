import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeAnnouncements, announcementStatus, announcementLocalInput, announcementTimestamp, type Announcement } from '../src/announcements.ts'
const a: Announcement = { id: 'a', title: 'School closed tomorrow', details: '', priority: 'important', startsAt: '2026-11-01T22:00:00Z', expiresAt: '2026-11-02T17:00:00Z', createdAt: '', updatedAt: '' }
test('announcements appear at their start and disappear at expiration, including cached messages', () => {
  for (const [at, status, count] of [['2026-11-01T21:59:59Z', 'scheduled', 0], ['2026-11-01T22:00:00Z', 'active', 1], ['2026-11-02T16:59:59Z', 'active', 1], ['2026-11-02T17:00:00Z', 'expired', 0]] as const) {
    assert.equal(announcementStatus(a, Date.parse(at)), status)
    assert.equal(activeAnnouncements([a], Date.parse(at)).length, count)
  }
})
test('announcement date inputs round-trip through the device timezone and reject invalid dates', () => {
  for (const iso of ['2026-11-01T22:00:00.000Z', '2026-03-08T12:00:00.000Z']) assert.equal(announcementTimestamp(announcementLocalInput(iso)), iso)
  for (const input of ['', 'tomorrow', '2026-02-30T12:00', '2026-11-02T25:00']) assert.equal(announcementTimestamp(input), null)
})
