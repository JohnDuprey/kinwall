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

test('ics: cancelled events are skipped', async () => {
  const all = await expandICS(fixture, FROM, TO);
  assert.ok(!all.some((e) => e.externalId.startsWith('cancelled-1@familycal.test')));
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
    assert.equal(events.length, 2, 'cancelled event excluded');
    assert.deepEqual(events[0], {
      externalId: 'evt1',
      title: 'Dentist',
      start: '2026-01-05T15:00:00.000Z',
      end: '2026-01-05T16:00:00.000Z',
      allDay: false,
      location: undefined,
      description: undefined,
      seriesId: undefined,
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
