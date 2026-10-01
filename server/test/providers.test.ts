import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { expandICS, provider as icsProvider } from '../src/providers/ics.ts';
import { provider as googleProvider } from '../src/providers/google.ts';
import { provider as msProvider } from '../src/providers/microsoft.ts';
import type { ProviderCtx } from '../src/providers/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.join(__dirname, 'fixtures/sample.ics'), 'utf-8');

const FROM = new Date('2026-01-01T00:00:00Z');
const TO = new Date('2026-04-01T00:00:00Z');

test('ics: weekly RRULE honors EXDATE and a RECURRENCE-ID override', async () => {
  const all = await expandICS(fixture, FROM, TO);
  const weekly = all.filter((e) => e.externalId.startsWith('weekly-1@familycal.test'));
  assert.equal(weekly.length, 5, 'Jan19 excluded by EXDATE, 6 - 1 = 5');
  assert.ok(!weekly.some((e) => e.start === '2026-01-19T15:00:00.000Z'));
  const moved = weekly.find((e) => e.title === 'Weekly Standup (moved)');
  assert.ok(moved, 'override instance present with its own title');
  assert.equal(moved!.start, '2026-01-26T16:30:00.000Z');
  assert.equal(moved!.end, '2026-01-26T17:30:00.000Z');
  // unmodified instances keep the original title
  assert.equal(weekly.filter((e) => e.title === 'Weekly Standup').length, 4);
});

test('ics: all-day event uses YYYY-MM-DD with exclusive end', async () => {
  const all = await expandICS(fixture, FROM, TO);
  const allday = all.find((e) => e.externalId.startsWith('allday-1@familycal.test'));
  assert.ok(allday);
  assert.equal(allday!.allDay, true);
  assert.equal(allday!.start, '2026-02-15');
  assert.equal(allday!.end, '2026-02-16');
});

test('ics: TZID event expands correctly across a DST change', async () => {
  const all = await expandICS(fixture, FROM, TO);
  const dst = all
    .filter((e) => e.externalId.startsWith('dst-1@familycal.test'))
    .sort((a, b) => a.start.localeCompare(b.start));
  assert.equal(dst.length, 10);
  // Mar 5 2026 09:00 America/New_York is still EST (UTC-5) -> 14:00Z
  assert.equal(dst[0].start, '2026-03-05T14:00:00.000Z');
  // Mar 10 2026 09:00 America/New_York is EDT (UTC-4, clocks sprang forward Mar 8) -> 13:00Z
  const mar10 = dst.find((e) => e.start.startsWith('2026-03-10'));
  assert.equal(mar10!.start, '2026-03-10T13:00:00.000Z');
});

test('ics: canceled events are skipped', async () => {
  const all = await expandICS(fixture, FROM, TO);
  assert.ok(!all.some((e) => e.externalId.startsWith('canceled-1@familycal.test')));
});

test('ics provider: listEvents fetches the url (webcal -> https) and parses it', async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return new Response(fixture, { status: 200 });
  }) as typeof fetch;
  try {
    const ctx = {
      env: {},
      calendar: { id: 'c1', remoteId: null, config: { url: 'webcal://example.com/cal.ics' } },
      saveAccountConfig: async () => {},
    } as ProviderCtx;
    const events = await icsProvider.listEvents(ctx, FROM, TO);
    assert.ok(events.length > 0);
    assert.equal(calls[0], 'https://example.com/cal.ics');
  } finally {
    globalThis.fetch = realFetch;
  }
});

function stubFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  const realFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    for (const [match, handler] of Object.entries(handlers)) {
      if (u.includes(match)) return handler(init);
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = realFetch) };
}

test('google: refreshes an expired token, saves it, and maps events (timed + all-day)', async () => {
  const { calls, restore } = stubFetch({
    'oauth2.googleapis.com/token': () =>
      Response.json({ access_token: 'new-token', expires_in: 3600 }),
    '/events?': (init) => {
      const auth = (init?.headers as Record<string, string>)?.authorization;
      assert.equal(auth, 'Bearer new-token');
      return Response.json({
        items: [
          {
            id: 'evt1',
            summary: 'Dentist',
            start: { dateTime: '2026-01-05T15:00:00Z' },
            end: { dateTime: '2026-01-05T16:00:00Z' },
          },
          {
            id: 'evt2',
            summary: 'Vacation',
            start: { date: '2026-02-01' },
            end: { date: '2026-02-05' },
          },
          { id: 'evt3', summary: 'Ghost', status: 'cancelled' },
        ],
      });
    },
  });
  try {
    let saved: any;
    const ctx = {
      env: { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' },
      account: { id: 'a1', config: { access_token: 'old', refresh_token: 'r1', expires_at: 0 } },
      calendar: { id: 'c1', remoteId: 'primary', config: {} },
      saveAccountConfig: async (config: any) => {
        saved = config;
      },
    } as ProviderCtx;
    const events = await googleProvider.listEvents(ctx, FROM, TO);
    assert.equal(events.length, 2, 'canceled event excluded');
    assert.deepEqual(events[0], {
      externalId: 'evt1',
      title: 'Dentist',
      start: '2026-01-05T15:00:00.000Z',
      end: '2026-01-05T16:00:00.000Z',
      allDay: false,
      location: undefined,
      description: undefined,
      seriesId: undefined,
      reminders: null,
      busy: true,
    });
    assert.equal(events[1].allDay, true);
    assert.equal(events[1].start, '2026-02-01');
    assert.equal(events[1].end, '2026-02-05');
    assert.deepEqual(saved, { access_token: 'new-token', refresh_token: 'r1', expires_at: saved.expires_at });
    assert.ok(calls.some((c) => c.url.includes('oauth2.googleapis.com/token')));
  } finally {
    restore();
  }
});

test('google: a revoked refresh token produces a human-readable error', async () => {
  const { restore } = stubFetch({
    'oauth2.googleapis.com/token': () => new Response('{"error":"invalid_grant"}', { status: 400 }),
  });
  try {
    const ctx = {
      env: {},
      account: { id: 'a1', config: { access_token: 'old', refresh_token: 'r1', expires_at: 0 } },
      calendar: { id: 'c1', remoteId: 'primary', config: {} },
      saveAccountConfig: async () => {},
    } as ProviderCtx;
    await assert.rejects(() => googleProvider.listEvents(ctx, FROM, TO), /Google token revoked/);
  } finally {
    restore();
  }
});

test('microsoft: refreshes an expired token and maps events, converting all-day midnight dates', async () => {
  const { calls, restore } = stubFetch({
    'login.microsoftonline.com': () =>
      Response.json({ access_token: 'ms-new-token', refresh_token: 'r2', expires_in: 3600 }),
    calendarView: (init) => {
      const auth = (init?.headers as Record<string, string>)?.authorization;
      assert.equal(auth, 'Bearer ms-new-token');
      return Response.json({
        value: [
          {
            id: 'ev1',
            subject: 'Team Sync',
            isAllDay: false,
            start: { dateTime: '2026-01-05T15:00:00.0000000' },
            end: { dateTime: '2026-01-05T16:00:00.0000000' },
          },
          {
            id: 'ev2',
            subject: 'Holiday',
            isAllDay: true,
            start: { dateTime: '2026-02-01T00:00:00.0000000' },
            end: { dateTime: '2026-02-02T00:00:00.0000000' },
          },
        ],
      });
    },
  });
  try {
    let saved: any;
    const ctx = {
      env: { MS_CLIENT_ID: 'id', MS_CLIENT_SECRET: 'secret', MS_TENANT: 'common' },
      account: { id: 'a1', config: { access_token: 'old', refresh_token: 'r1', expires_at: 0 } },
      calendar: { id: 'c1', remoteId: 'cal1', config: {} },
      saveAccountConfig: async (config: any) => {
        saved = config;
      },
    } as ProviderCtx;
    const events = await msProvider.listEvents(ctx, FROM, TO);
    assert.equal(events.length, 2);
    assert.equal(events[0].start, '2026-01-05T15:00:00.000Z');
    assert.equal(events[0].allDay, false);
    assert.equal(events[1].allDay, true);
    assert.equal(events[1].start, '2026-02-01');
    assert.equal(events[1].end, '2026-02-02');
    assert.equal(saved.refresh_token, 'r2');
    assert.ok(calls.some((c) => c.url.includes('login.microsoftonline.com')));
  } finally {
    restore();
  }
});

test('microsoft: a revoked refresh token produces a human-readable error', async () => {
  const { restore } = stubFetch({
    'login.microsoftonline.com': () => new Response('{"error":"invalid_grant"}', { status: 401 }),
  });
  try {
    const ctx = {
      env: {},
      account: { id: 'a1', config: { access_token: 'old', refresh_token: 'r1', expires_at: 0 } },
      calendar: { id: 'c1', remoteId: 'cal1', config: {} },
      saveAccountConfig: async () => {},
    } as ProviderCtx;
    await assert.rejects(() => msProvider.listEvents(ctx, FROM, TO), /Microsoft token revoked/);
  } finally {
    restore();
  }
});

test('microsoft: isReminderOn + reminderMinutesBeforeStart map to reminders; off means none', async () => {
  const { restore } = stubFetch({
    'login.microsoftonline.com': () => Response.json({ access_token: 'tok', refresh_token: 'r2', expires_in: 3600 }),
    calendarView: () =>
      Response.json({
        value: [
          { id: 'ev1', subject: 'On', isAllDay: false, isReminderOn: true, reminderMinutesBeforeStart: 15, start: { dateTime: '2026-01-05T15:00:00.0000000' }, end: { dateTime: '2026-01-05T16:00:00.0000000' } },
          { id: 'ev2', subject: 'Off', isAllDay: false, isReminderOn: false, reminderMinutesBeforeStart: 15, start: { dateTime: '2026-01-05T15:00:00.0000000' }, end: { dateTime: '2026-01-05T16:00:00.0000000' } },
        ],
      }),
  });
  try {
    const ctx = {
      env: { MS_TENANT: 'common' },
      account: { id: 'a1', config: { access_token: 'old', refresh_token: 'r1', expires_at: 0 } },
      calendar: { id: 'c1', remoteId: 'cal1', config: {} },
      saveAccountConfig: async () => {},
    } as ProviderCtx;
    const events = await msProvider.listEvents(ctx, FROM, TO);
    assert.deepEqual(events[0].reminders, [15]);
    assert.deepEqual(events[1].reminders, []); // off = explicitly none, not the household default
  } finally {
    restore();
  }
});

test('ics: a VALARM with a relative TRIGGER maps to reminders (DISPLAY/AUDIO only, absolute/positive triggers ignored)', async () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:alarm1@test',
    'DTSTART:20260115T150000Z',
    'DTEND:20260115T160000Z',
    'SUMMARY:With alarm',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT15M',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:EMAIL',
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:noalarm@test',
    'DTSTART:20260116T150000Z',
    'DTEND:20260116T160000Z',
    'SUMMARY:No alarm',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  const events = await expandICS(ics, FROM, TO);
  const withAlarm = events.find((e) => e.externalId.startsWith('alarm1'))!;
  const noAlarm = events.find((e) => e.externalId.startsWith('noalarm'))!;
  assert.deepEqual(withAlarm.reminders, [15]); // only the DISPLAY alarm counts, not the EMAIL one
  assert.equal(noAlarm.reminders, null);
});

test('google: writing reminders sends popup overrides, null uses the calendar default, [] turns them off', async () => {
  const bodies: any[] = [];
  const { restore } = stubFetch({
    'oauth2.googleapis.com': () => Response.json({ access_token: 'tok', expires_in: 3600 }),
    '/events/': (init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ id: 'ev1', summary: 'x', start: { dateTime: '2030-01-01T10:00:00Z' }, end: { dateTime: '2030-01-01T11:00:00Z' }, reminders: JSON.parse(String(init?.body)).reminders }); },
  });
  try {
    const ctx = { env: {}, account: { id: 'a1', config: { access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600e3 } }, calendar: { id: 'c1', remoteId: 'cal1', config: {} }, saveAccountConfig: async () => {} } as unknown as ProviderCtx;
    const updated = await googleProvider.updateEvent!(ctx, 'ev1', { reminders: [10, 1440] });
    assert.deepEqual(bodies[0].reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }, { method: 'popup', minutes: 1440 }] });
    assert.deepEqual(updated.reminders, [10, 1440]);
    await googleProvider.updateEvent!(ctx, 'ev1', { reminders: null });
    assert.deepEqual(bodies[1].reminders, { useDefault: true });
    await googleProvider.updateEvent!(ctx, 'ev1', { reminders: [] });
    assert.deepEqual(bodies[2].reminders, { useDefault: false, overrides: [] });
  } finally {
    restore();
  }
});

test('google: useDefault with unknown calendar defaults is null (default applies), not "no reminders"', async () => {
  const { restore } = stubFetch({
    'oauth2.googleapis.com': () => Response.json({ access_token: 'tok', expires_in: 3600 }),
    '/events/': () => Response.json({ id: 'ev1', summary: 'x', start: { dateTime: '2030-01-01T10:00:00Z' }, end: { dateTime: '2030-01-01T11:00:00Z' }, reminders: { useDefault: true } }),
  });
  try {
    const ctx = { env: {}, account: { id: 'a1', config: { access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600e3 } }, calendar: { id: 'c1', remoteId: 'cal1', config: {} }, saveAccountConfig: async () => {} } as unknown as ProviderCtx;
    const updated = await googleProvider.updateEvent!(ctx, 'ev1', { reminders: null });
    assert.equal(updated.reminders, null);
  } finally {
    restore();
  }
});

// ---------- Free/busy ("Show as") ----------

test('google: transparency transparent is free, opaque or missing is busy; writes send transparency', async () => {
  const bodies: any[] = [];
  const { restore } = stubFetch({
    'oauth2.googleapis.com': () => Response.json({ access_token: 'tok', expires_in: 3600 }),
    '/events?': () => Response.json({ items: [
      { id: 'a', summary: 'Delivery', transparency: 'transparent', start: { dateTime: '2026-01-05T13:00:00Z' }, end: { dateTime: '2026-01-06T01:00:00Z' } },
      { id: 'b', summary: 'Dentist', transparency: 'opaque', start: { dateTime: '2026-01-05T15:00:00Z' }, end: { dateTime: '2026-01-05T16:00:00Z' } },
      { id: 'c', summary: 'Soccer', start: { dateTime: '2026-01-05T17:00:00Z' }, end: { dateTime: '2026-01-05T18:00:00Z' } },
      { id: 'd', summary: 'Holiday', transparency: 'transparent', start: { date: '2026-01-06' }, end: { date: '2026-01-07' } },
    ] }),
    '/events/': (init?: RequestInit) => { const b = JSON.parse(String(init?.body)); bodies.push(b); return Response.json({ id: 'a', summary: 'x', transparency: b.transparency, start: { dateTime: '2030-01-01T10:00:00Z' }, end: { dateTime: '2030-01-01T11:00:00Z' } }); },
    '/events': (init?: RequestInit) => { const b = JSON.parse(String(init?.body)); bodies.push(b); return Response.json({ id: 'n', summary: 'x', transparency: b.transparency, start: { dateTime: '2030-01-01T10:00:00Z' }, end: { dateTime: '2030-01-01T11:00:00Z' } }); },
  });
  try {
    const ctx = { env: {}, account: { id: 'a1', config: { access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600e3 } }, calendar: { id: 'c1', remoteId: 'cal1', config: {} }, saveAccountConfig: async () => {} } as unknown as ProviderCtx;
    const events = await googleProvider.listEvents(ctx, FROM, TO);
    assert.deepEqual(events.map((e) => [e.externalId, e.busy]), [['a', false], ['b', true], ['c', true], ['d', false]]);
    assert.equal((await googleProvider.updateEvent!(ctx, 'a', { busy: false })).busy, false);
    assert.equal(bodies[0].transparency, 'transparent');
    await googleProvider.updateEvent!(ctx, 'a', { busy: true });
    assert.equal(bodies[1].transparency, 'opaque');
    await googleProvider.updateEvent!(ctx, 'a', { title: 'Only the title' });
    assert.equal('transparency' in bodies[2], false, 'untouched unless asked');
    await googleProvider.createEvent!(ctx, { title: 'Delivery', start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z', allDay: false, busy: false });
    assert.equal(bodies[3].transparency, 'transparent');
  } finally {
    restore();
  }
});

test('microsoft: showAs free is free; tentative, busy, oof and workingElsewhere are busy; writes send showAs', async () => {
  const bodies: any[] = [];
  const urls: string[] = [];
  const ev = (id: string, showAs?: string) => ({ id, subject: id, isAllDay: false, ...(showAs ? { showAs } : {}), start: { dateTime: '2026-01-05T15:00:00.0000000' }, end: { dateTime: '2026-01-05T16:00:00.0000000' } });
  const { restore } = stubFetch({
    'login.microsoftonline.com': () => Response.json({ access_token: 'tok', refresh_token: 'r2', expires_in: 3600 }),
    calendarView: () => Response.json({ value: [ev('free', 'free'), ev('tentative', 'tentative'), ev('busy', 'busy'), ev('oof', 'oof'), ev('workingElsewhere', 'workingElsewhere'), ev('unknown')] }),
    '/me/events/': (init?: RequestInit) => { const b = JSON.parse(String(init?.body)); bodies.push(b); return Response.json({ ...ev('x', b.showAs) }); },
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: RequestInit) => { urls.push(String(url)); return realFetch(url, init); }) as typeof fetch;
  try {
    const ctx = { env: { MS_TENANT: 'common' }, account: { id: 'a1', config: { access_token: 'tok', refresh_token: 'r1', expires_at: Date.now() + 3600e3 } }, calendar: { id: 'c1', remoteId: 'cal1', config: {} }, saveAccountConfig: async () => {} } as ProviderCtx;
    const events = await msProvider.listEvents(ctx, FROM, TO);
    assert.deepEqual(events.map((e) => [e.externalId, e.busy]), [['free', false], ['tentative', true], ['busy', true], ['oof', true], ['workingElsewhere', true], ['unknown', true]]);
    assert.ok(decodeURIComponent(urls.find((u) => u.includes('calendarView'))!).includes('showAs'), 'showAs is selected');
    assert.equal((await msProvider.updateEvent!(ctx, 'x', { busy: false })).busy, false);
    assert.equal(bodies[0].showAs, 'free');
    await msProvider.updateEvent!(ctx, 'x', { busy: true });
    assert.equal(bodies[1].showAs, 'busy');
    await msProvider.updateEvent!(ctx, 'x', { title: 'Only the title' });
    assert.equal('showAs' in bodies[2], false, 'a tentative event stays tentative unless asked');
  } finally {
    globalThis.fetch = realFetch;
    restore();
  }
});

test('ics: TRANSP:TRANSPARENT is free, OPAQUE or none is busy (repeats too); CalDAV writes TRANSP', async () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:free@test', 'DTSTART:20260115T130000Z', 'DTEND:20260116T010000Z', 'SUMMARY:Delivery', 'TRANSP:TRANSPARENT', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:busy@test', 'DTSTART:20260115T150000Z', 'DTEND:20260115T160000Z', 'SUMMARY:Dentist', 'TRANSP:OPAQUE', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:none@test', 'DTSTART;VALUE=DATE:20260116', 'DTEND;VALUE=DATE:20260117', 'SUMMARY:Fair', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:weekly@test', 'DTSTART:20260105T150000Z', 'DTEND:20260105T160000Z', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:Office hours', 'TRANSP:TRANSPARENT', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');
  const events = await expandICS(ics, FROM, TO);
  const busy = (uid: string) => events.filter((e) => e.externalId.startsWith(uid)).map((e) => e.busy);
  assert.deepEqual(busy('free'), [false]);
  assert.deepEqual(busy('busy'), [true]);
  assert.deepEqual(busy('none'), [true], 'RFC 5545 default: opaque');
  assert.deepEqual(busy('weekly'), [false, false]);

  const { buildVevent } = await import('../src/providers/caldav.ts');
  const base = { title: 'Delivery', start: '2030-01-01T10:00:00.000Z', end: '2030-01-01T11:00:00.000Z', allDay: false };
  assert.match(buildVevent('u1', { ...base, busy: false }), /\r\nTRANSP:TRANSPARENT\r\n/);
  assert.match(buildVevent('u1', base), /\r\nTRANSP:OPAQUE\r\n/);
  const roundTrip = await expandICS(buildVevent('u1', { ...base, busy: false }), new Date('2029-12-01'), new Date('2030-02-01'));
  assert.equal(roundTrip[0].busy, false, 'what Kinwall writes reads back the same');
});

test('notes: Google HTML and Outlook bodies arrive as plain text with line breaks; writes send text', async () => {
  const bodies: any[] = [];
  const urls: string[] = [];
  const prefers: string[] = [];
  const at = { start: { dateTime: '2026-01-05T15:00:00Z' }, end: { dateTime: '2026-01-05T16:00:00Z' } };
  const msAt = { isAllDay: false, start: { dateTime: '2026-01-05T15:00:00.0000000' }, end: { dateTime: '2026-01-05T16:00:00.0000000' } };
  const long = 'Bring shin guards. '.repeat(30).trim();
  const { restore } = stubFetch({
    'oauth2.googleapis.com': () => Response.json({ access_token: 'tok', expires_in: 3600 }),
    '/events?': () => Response.json({ items: [
      { id: 'html', summary: 'Soccer', description: '<b>Bring</b> shin guards<br>Snack &amp; water', ...at },
      { id: 'plain', summary: 'Piano', description: 'Book 2\nPage 14', ...at },
      { id: 'none', summary: 'Swim', ...at },
    ] }),
    'www.googleapis.com/calendar/v3/calendars/cal1/events/g': (init?: RequestInit) => { const b = JSON.parse(String(init?.body)); bodies.push(b); return Response.json({ id: 'g', summary: 'x', description: b.description, ...at }); },
    calendarView: (init?: RequestInit) => {
      prefers.push(String((init?.headers as Record<string, string>)?.prefer));
      return Response.json({ value: [
        { id: 'm1', subject: 'Dentist', bodyPreview: long.slice(0, 255), body: { contentType: 'text', content: `${long}\r\nRoom 2` }, ...msAt },
        { id: 'm2', subject: 'Dinner', body: { contentType: 'html', content: '<html><body><p>Bring salad</p><p>7 PM</p></body></html>' }, ...msAt },
      ] });
    },
    '/me/events/': (init?: RequestInit) => { const b = JSON.parse(String(init?.body)); bodies.push(b); return Response.json({ id: 'm', subject: 'x', body: b.body ?? { contentType: 'text', content: '' }, ...msAt }); },
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: RequestInit) => { urls.push(String(url)); return realFetch(url, init); }) as typeof fetch;
  try {
    const g = { env: {}, account: { id: 'a1', config: { access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600e3 } }, calendar: { id: 'c1', remoteId: 'cal1', config: {} }, saveAccountConfig: async () => {} } as unknown as ProviderCtx;
    const gEvents = await googleProvider.listEvents(g, FROM, TO);
    assert.deepEqual(gEvents.map((e) => e.description), ['Bring shin guards\nSnack & water', 'Book 2\nPage 14', undefined]);
    await googleProvider.updateEvent!(g, 'g', { description: 'Line 1\nLine 2' });
    assert.equal(bodies[0].description, 'Line 1\nLine 2');
    await googleProvider.updateEvent!(g, 'g', { description: '' });
    assert.equal(bodies[1].description, '', 'clearing writes an empty description');

    const ms = { env: { MS_TENANT: 'common' }, account: { id: 'a1', config: { access_token: 'tok', refresh_token: 'r1', expires_at: Date.now() + 3600e3 } }, calendar: { id: 'c1', remoteId: 'cal1', config: {} }, saveAccountConfig: async () => {} } as ProviderCtx;
    const msEvents = await msProvider.listEvents(ms, FROM, TO);
    assert.deepEqual(msEvents.map((e) => e.description), [`${long}\nRoom 2`, 'Bring salad\n7 PM'], 'the whole body, not the 255-character preview');
    assert.ok(decodeURIComponent(urls.find((u) => u.includes('calendarView'))!).includes('body,'), 'body is selected');
    assert.match(prefers[0], /outlook\.body-content-type="text"/);
    await msProvider.updateEvent!(ms, 'm', { description: 'Line 1\nLine 2' });
    assert.deepEqual(bodies[2].body, { contentType: 'text', content: 'Line 1\nLine 2' });
  } finally {
    globalThis.fetch = realFetch;
    restore();
  }
});

test('notes: ICS DESCRIPTION is unescaped, HTML in it stripped; CalDAV writes DESCRIPTION that reads back the same', async () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:plain@test', 'DTSTART:20260115T150000Z', 'DTEND:20260115T160000Z', 'SUMMARY:Field trip', 'DESCRIPTION:Bring lunch\\, water\\nPermission slip due', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:html@test', 'DTSTART:20260115T150000Z', 'DTEND:20260115T160000Z', 'SUMMARY:Concert', 'DESCRIPTION:<p>Doors at 6</p><p>Wear black</p>', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');
  const events = await expandICS(ics, FROM, TO);
  const notes = (uid: string) => events.find((e) => e.externalId.startsWith(uid))?.description;
  assert.equal(notes('plain'), 'Bring lunch, water\nPermission slip due');
  assert.equal(notes('html'), 'Doors at 6\nWear black');

  const { buildVevent } = await import('../src/providers/caldav.ts');
  const ev = { title: 'Trip', start: '2030-01-01T10:00:00.000Z', end: '2030-01-01T11:00:00.000Z', allDay: false, description: 'Lunch; water, hat\nBus at 8\\9' };
  assert.match(buildVevent('u1', ev), /\r\nDESCRIPTION:Lunch\\; water\\, hat\\nBus at 8\\\\9\r\n/);
  const back = await expandICS(buildVevent('u1', ev), new Date('2029-12-01'), new Date('2030-02-01'));
  assert.equal(back[0].description, ev.description);
});
