// A repeating ICS event that began long ago (a weekday pickup since 2005, a daily reminder since
// 2012) still shows today. The expansion walks every occurrence from DTSTART, and its 5,000-step
// cap used to run out before reaching the sync window, so the whole series vanished.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcsEvents } from '../src/providers/ics.ts';

const feed = (dtstart: string, rrule: string) => [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:old-series',
  `DTSTART:${dtstart}`,
  `DTEND:${dtstart.replace('T15', 'T16')}`,
  `RRULE:${rrule}`,
  'SUMMARY:School pickup',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

const FROM = new Date('2026-11-01T00:00:00Z');
const TO = new Date('2026-12-01T00:00:00Z');

test('ics: a weekday series started in 2005 still has its November 2026 occurrences', async () => {
  const events = await parseIcsEvents(feed('20050103T150000Z', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), FROM, TO, 'UTC');
  assert.equal(events.length, 21); // the weekdays of November 2026
  assert.equal(events[0].start, '2026-11-02T15:00:00.000Z');
});

test('ics: a daily series started in 2010 still has its November 2026 occurrences', async () => {
  const events = await parseIcsEvents(feed('20100101T150000Z', 'FREQ=DAILY'), FROM, TO, 'UTC');
  assert.equal(events.length, 30);
});
