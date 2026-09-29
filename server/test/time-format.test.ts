// Clock times in what the server writes (push text, reminders): the family's setting, else by country.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, hour12For, TWELVE_HOUR_COUNTRIES } from '../src/timeFormat.ts';

test('hour12For: the family setting wins, then the location country, then 12-hour', () => {
  assert.equal(hour12For('24', 'US'), false);
  assert.equal(hour12For('12', 'DE'), true);
  for (const cc of ['US', 'CA', 'AU', 'PH', 'IN', 'us']) assert.equal(hour12For('auto', cc), true, cc);
  for (const cc of ['GB', 'DE', 'FR', 'JP', 'BR']) assert.equal(hour12For('auto', cc), false, cc);
  assert.equal(hour12For('auto', undefined), true, 'unknown: 12-hour, as before');
  assert.equal(hour12For(undefined, undefined), true);
  assert.ok(TWELVE_HOUR_COUNTRIES.includes('US'));
});

test('formatTime: HH:MM and instants, midnight and noon, in both formats', () => {
  assert.equal(formatTime('00:05', { h12: true }), '12:05 AM');
  assert.equal(formatTime('12:00', { h12: true }), '12:00 PM');
  assert.equal(formatTime('15:40', { h12: true }), '3:40 PM');
  assert.equal(formatTime('00:05', { h12: false }), '00:05');
  assert.equal(formatTime('9:05', { h12: false }), '09:05');
  assert.equal(formatTime('15:40', { h12: false }), '15:40');
  const iso = '2030-03-04T15:30:00Z';
  assert.equal(formatTime(iso, { h12: true, tz: 'UTC' }), '3:30 PM');
  assert.equal(formatTime(iso, { h12: false, tz: 'UTC' }), '15:30');
  assert.equal(formatTime(new Date(iso), { h12: false, tz: 'America/New_York' }), '10:30');
  assert.equal(formatTime('2030-03-04T00:00:00Z', { h12: false, tz: 'UTC' }), '00:00');
  assert.equal(formatTime('20:00', { h12: true, hourOnly: true }), '8 PM');
  assert.equal(formatTime('20:00', { h12: false, hourOnly: true }), '20:00');
});
