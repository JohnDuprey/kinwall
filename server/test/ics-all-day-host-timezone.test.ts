// An all-day ICS event (DTSTART;VALUE=DATE) keeps its date whatever timezone the server process
// runs in. Docker hosts set TZ to their own zone (docs/self-hosting/configuration.md); east of UTC
// (Europe, Asia, Australia) every all-day event used to land a day early.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandICS, parseIcsEvents } from '../src/providers/ics.ts';

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:holiday',
  'DTSTART;VALUE=DATE:20261110',
  'DTEND;VALUE=DATE:20261111',
  'SUMMARY:Teacher planning day',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:weekly',
  'DTSTART;VALUE=DATE:20261112',
  'DTEND;VALUE=DATE:20261113',
  'RRULE:FREQ=WEEKLY;COUNT=2',
  'SUMMARY:Library day',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

const FROM = new Date('2026-11-01T00:00:00Z');
const TO = new Date('2026-12-01T00:00:00Z');

async function inProcessTz<T>(tz: string, fn: () => Promise<T>): Promise<T> {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

for (const hostTz of ['Europe/Berlin', 'Australia/Sydney', 'America/New_York', 'UTC']) {
  test(`ics: all-day events keep their dates on a server running in ${hostTz}`, async () => {
    const events = await inProcessTz(hostTz, () => parseIcsEvents(ICS, FROM, TO, 'Europe/Berlin'));
    assert.deepEqual(
      events.map((e) => [e.title, e.start, e.end, e.allDay]),
      [
        ['Teacher planning day', '2026-11-10', '2026-11-11', true],
        ['Library day', '2026-11-12', '2026-11-13', true],
        ['Library day', '2026-11-19', '2026-11-20', true],
      ],
    );
  });
}

test('caldav (expandICS): all-day dates are not shifted by the host timezone', async () => {
  const events = await inProcessTz('Asia/Tokyo', () => expandICS(ICS, FROM, TO, 'Asia/Tokyo'));
  assert.deepEqual(events.map((e) => e.start), ['2026-11-10', '2026-11-12', '2026-11-19']);
});
