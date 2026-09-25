import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { isSafeWebhookUrl, publish } from '../src/bus.ts';
import { createHmac } from 'node:crypto';
import { feedFetch, isSafeFeedUrl } from '../src/outbound.ts';
import { syncCalendar } from '../src/sync.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeApp(extra: Partial<Env> = {}) {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', ...extra };
  const app = createApp();
  const request = (p: string, init: RequestInit = {}) =>
    app.request(p, { ...init, headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' } }, env);
  return Object.assign(request, { env });
}

test('webhooks: private/loopback targets are refused on create and update; public ones are accepted', async () => {
  const request = makeApp();
  const create = (url: string) => request('/api/webhooks', { method: 'POST', body: JSON.stringify({ url, events: [] }) });

  const bad = await create('http://169.254.169.254/latest/meta-data');
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as any).error, /public https\/http address/);

  const ok = await create('https://hooks.example.com/kinwall');
  assert.equal(ok.status, 201);
  const { id } = (await ok.json()) as any;
  assert.equal((await request(`/api/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify({ url: 'http://localhost:8123/api/webhook' }) })).status, 400);
});

test('webhooks: secret is returned once on create and rotate, never on list; rotate re-keys the signature', async () => {
  const request = makeApp();
  const created = await request('/api/webhooks', { method: 'POST', body: JSON.stringify({ url: 'https://hooks.example.com/k', events: [] }) });
  assert.equal(created.status, 201);
  const hook = (await created.json()) as any;
  assert.equal(typeof hook.secret, 'string');
  assert.ok(hook.secret.length >= 32);

  const list = (await (await request('/api/webhooks')).json()) as any[];
  assert.equal(list.length, 1);
  assert.equal('secret' in list[0], false);

  const realFetch = globalThis.fetch;
  const sent: { body: string; sig: string }[] = [];
  globalThis.fetch = (async (_url: any, init: RequestInit = {}) => {
    sent.push({ body: String(init.body), sig: new Headers(init.headers).get('x-kinwall-signature')! });
    return new Response('ok');
  }) as typeof fetch;
  const fire = async () => {
    const pending: Promise<unknown>[] = [];
    publish(request.env, { waitUntil: (p) => pending.push(p) }, 'settings.changed');
    await Promise.all(pending);
    return sent.at(-1)!;
  };
  const verify = (secret: string, d: { body: string; sig: string }) => d.sig === `sha256=${createHmac('sha256', secret).update(d.body).digest('hex')}`;
  try {
    assert.equal(verify(hook.secret, await fire()), true);

    const rotated = await request(`/api/webhooks/${hook.id}/rotate`, { method: 'POST' });
    assert.equal(rotated.status, 200);
    const { secret: next } = (await rotated.json()) as any;
    assert.notEqual(next, hook.secret);
    const d = await fire();
    assert.equal(verify(hook.secret, d), false);
    assert.equal(verify(next, d), true);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal((await request('/api/webhooks/nope/rotate', { method: 'POST' })).status, 404);
});

test('isSafeWebhookUrl', () => {
  for (const url of [
    'ftp://example.com/', 'http://localhost/', 'http://ha.localhost/', 'http://homeassistant.local/', 'http://svc.internal/',
    'http://127.0.0.1/', 'http://2130706433/', 'http://10.0.0.5/', 'http://172.16.0.1/', 'http://192.168.1.10:8123/',
    'http://0.0.0.0/', 'http://224.0.0.1/', 'http://100.64.0.1/', 'http://[::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/', 'not a url',
  ]) assert.equal(isSafeWebhookUrl(url), false, url);
  for (const url of ['https://example.com/hook', 'http://8.8.8.8/', 'http://172.32.0.1/', 'http://[2001:db8::1]/'])
    assert.equal(isSafeWebhookUrl(url), true, url);
});

// Calendar feeds share the webhook guard (outbound.ts), with a self-hosted LAN opt-out.
function stubFetch() {
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    urls.push(String(url));
    return new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', { status: 200 });
  }) as typeof fetch;
  return { urls, restore: () => (globalThis.fetch = realFetch) };
}

test('calendar feeds: private ICS/CalDAV URLs are refused on create; public ones are accepted', async () => {
  const f = stubFetch();
  try {
    const request = makeApp();
    const ics = (url: string) => request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url }) });
    const bad = await ics('http://169.254.169.254/x.ics');
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as any).error, /ALLOW_PRIVATE_FEED_URLS/);
    assert.equal((await ics('webcal://127.0.0.1/x.ics')).status, 400);
    assert.equal((await ics('https://calendar.example.com/feed.ics')).status, 201);

    const caldav = await request('/api/accounts/caldav', { method: 'POST', body: JSON.stringify({ name: 'LAN', serverUrl: 'http://localhost:5232', username: 'u', password: 'p' }) });
    assert.equal(caldav.status, 400);
    assert.equal(f.urls.some((u) => u.includes('localhost') || u.includes('169.254')), false);
  } finally {
    f.restore();
  }
});

test('calendar feeds: ALLOW_PRIVATE_FEED_URLS=1 permits LAN feeds; a stored private URL fails at sync time without it', async () => {
  const f = stubFetch();
  try {
    const lan = makeApp({ ALLOW_PRIVATE_FEED_URLS: '1' });
    const res = await lan('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'LAN', url: 'http://192.168.1.10:5232/cal.ics' }) });
    assert.equal(res.status, 201);
    const { id } = (await res.json()) as any;
    assert.equal((await syncCalendar(lan.env, id)).ok, true);

    // Same row, guard back on (e.g. the env var was removed): fetch is skipped, error surfaced.
    f.urls.length = 0;
    const strict = { ...lan.env, ALLOW_PRIVATE_FEED_URLS: undefined };
    const result = await syncCalendar(strict, id);
    assert.equal(result.ok, false);
    assert.deepEqual(f.urls, []);
    const row = await strict.DB.prepare('SELECT last_error FROM calendars WHERE id = ?').bind(id).first<{ last_error: string }>();
    assert.match(row!.last_error, /public http\(s\) address/);
  } finally {
    f.restore();
  }
  // Webhooks never honour the flag.
  const hooks = makeApp({ ALLOW_PRIVATE_FEED_URLS: '1' });
  assert.equal((await hooks('/api/webhooks', { method: 'POST', body: JSON.stringify({ url: 'http://192.168.1.10/hook', events: [] }) })).status, 400);
});

test('isSafeFeedUrl', () => {
  for (const url of ['webcal://localhost/cal.ics', 'webcal://10.0.0.2/cal.ics', 'http://169.254.169.254/x.ics', 'http://localhost:5232/', 'http://nas.local/radicale/', 'file:///etc/passwd'])
    assert.equal(isSafeFeedUrl({}, url), false, url);
  for (const url of ['webcal://p01-calendars.icloud.com/published/2/abc', 'https://calendar.google.com/calendar/ical/x/basic.ics', 'https://caldav.fastmail.com/'])
    assert.equal(isSafeFeedUrl({}, url), true, url);
  assert.equal(isSafeFeedUrl({ ALLOW_PRIVATE_FEED_URLS: '1' }, 'http://192.168.1.10:5232/'), true);
});

// Redirects are followed by hand so each Location gets the same guard as the original URL.
function redirectingFetch(to: string) {
  const realFetch = globalThis.fetch;
  const calls: { url: string; auth: string | null }[] = [];
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => {
    calls.push({ url: String(url), auth: new Headers(init.headers).get('authorization') });
    assert.equal(init.redirect, 'manual');
    if (String(url) === 'https://calendar.example.com/feed.ics') return new Response(null, { status: 302, headers: { Location: to } });
    return new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = realFetch) };
}

test('calendar feeds: a redirect into private space is refused and surfaced in last_error', async () => {
  const request = makeApp();
  const f = redirectingFetch('http://169.254.169.254/latest/meta-data');
  try {
    const { id } = (await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url: 'https://calendar.example.com/feed.ics' }) })).json()) as any;
    const result = await syncCalendar(request.env, id);
    assert.equal(result.ok, false);
    assert.equal(f.calls.some((c) => c.url.includes('169.254')), false);
    const row = await request.env.DB.prepare('SELECT last_error FROM calendars WHERE id = ?').bind(id).first<{ last_error: string }>();
    assert.match(row!.last_error, /redirected to a blocked address \(169\.254\.169\.254\)/);
  } finally {
    f.restore();
  }
});

test('calendar feeds: a redirect to a public https URL is followed', async () => {
  const request = makeApp();
  const f = redirectingFetch('https://cdn.example.org/real.ics');
  try {
    const { id } = (await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url: 'https://calendar.example.com/feed.ics' }) })).json()) as any;
    assert.equal((await syncCalendar(request.env, id)).ok, true);
    assert.deepEqual(f.calls.map((c) => c.url).slice(-2), ['https://calendar.example.com/feed.ics', 'https://cdn.example.org/real.ics']);
  } finally {
    f.restore();
  }
});

test('feedFetch: credentials are dropped on a cross-origin hop; more than 3 hops fail', async () => {
  const f = redirectingFetch('https://cdn.example.org/real.ics');
  try {
    await feedFetch({}, 'https://calendar.example.com/feed.ics', { headers: { Authorization: 'Basic abc' } });
    assert.deepEqual(f.calls.map((c) => c.auth), ['Basic abc', null]);
  } finally {
    f.restore();
  }
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async () => new Response(null, { status: 301, headers: { Location: `https://example.com/${++n}` } })) as typeof fetch;
  try {
    await assert.rejects(feedFetch({}, 'https://example.com/0'), /more than 3 times/);
    assert.equal(n, 4);
  } finally {
    globalThis.fetch = realFetch;
  }
});
