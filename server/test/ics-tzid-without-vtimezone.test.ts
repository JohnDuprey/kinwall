// A feed that names an IANA zone (DTSTART;TZID=America/New_York:...) without a VTIMEZONE block
// for it: ical.js leaves such a time floating, and it was read in the household's zone instead
// of the one the feed named - an hour or more off for a family in another zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandICS, parseIcsEvents } from '../src/providers/ics.ts';

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:game',
  'DTSTART;TZID=America/New_York:20261110T090000',
  'DTEND;TZID=America/New_York:20261110T100000',
  'SUMMARY:Away game',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:practice',
  'DTSTART;TZID=America/New_York:20261030T170000',
  'DTEND;TZID=America/New_York:20261030T180000',
  'RRULE:FREQ=WEEKLY;COUNT=2',
  'SUMMARY:Practice',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:floating',
  'DTSTART:20261111T090000',
  'DTEND:20261111T100000',
  'SUMMARY:Floating',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:windows-zone',
  'DTSTART;TZID=Eastern Standard Time:20261112T090000',
  'DTEND;TZID=Eastern Standard Time:20261112T100000',
  'SUMMARY:Unknown zone name',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

const FROM = new Date('2026-10-01T00:00:00Z');
const TO = new Date('2026-12-01T00:00:00Z');

test('ics: a TZID with no VTIMEZONE is read in the zone it names', async () => {
  const events = await parseIcsEvents(ICS, FROM, TO, 'America/Chicago');
  const by = (title: string) => events.filter((e) => e.title === title).map((e) => [e.start, e.end]);
  assert.deepEqual(by('Away game'), [['2026-11-10T14:00:00.000Z', '2026-11-10T15:00:00.000Z']]); // 9 AM EST
  // Oct 30 is still daylight time in New York (UTC-4), Nov 6 is standard time (UTC-5).
  assert.deepEqual(by('Practice'), [
    ['2026-10-30T21:00:00.000Z', '2026-10-30T22:00:00.000Z'],
    ['2026-11-06T22:00:00.000Z', '2026-11-06T23:00:00.000Z'],
  ]);
  // No TZID: floating, the household's zone (9 AM CST).
  assert.deepEqual(by('Floating'), [['2026-11-11T15:00:00.000Z', '2026-11-11T16:00:00.000Z']]);
  // A zone name Intl doesn't know falls back to the household's zone too.
  assert.deepEqual(by('Unknown zone name'), [['2026-11-12T15:00:00.000Z', '2026-11-12T16:00:00.000Z']]);
});

test('caldav (expandICS): a TZID with no VTIMEZONE is read in the zone it names', async () => {
  const events = await expandICS(ICS, FROM, TO, 'Europe/London');
  assert.equal(events.find((e) => e.title === 'Away game')?.start, '2026-11-10T14:00:00.000Z');
});
