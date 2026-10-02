// SSRF by DNS: a public-looking name that resolves to a private address. On Node the host hands
// outbound.ts a fetch (OUTBOUND_FETCH) that checks the address it actually connects to.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LookupAddress } from 'node:dns';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedFetch, fetchRecipeImage, isPrivateAddress, isSafeOutboundUrl, type Fetch } from '../src/outbound.ts';
import { guardedLookup, nodeFetch } from '../src/outbound-node.ts';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { publish } from '../src/bus.ts';
import type { Env } from '../src/env.ts';
import { providerEnv } from '../src/providers/config.ts';

test('isPrivateAddress: v4, v6 and v4 embedded in v6', () => {
  for (const ip of [
    '0.0.0.0', '10.0.0.1', '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '100.64.0.1', '100.127.255.255', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:a00:1', '::7f00:1', '::127.0.0.1',
    '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b:1::1', '2002:c0a8:101::1', 'fc00::1', 'fd12:3456::1',
    'fe80::1', 'fe80::1%eth0', 'febf::1', 'fec0::1', 'ff02::1', 'not-an-address', '1::2::3',
  ]) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of [
    '8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.255.0.1', '192.169.0.1', '11.0.0.1',
    '2606:4700:4700::1111', '2001:db8::1', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1', '::8.8.8.8',
  ]) assert.equal(isPrivateAddress(ip), false, ip);
});

test('isSafeOutboundUrl: literal forms that normalize to a private address, and localhost variants', () => {
  for (const url of [
    'http://0/', 'http://0x7f.1/', 'http://017700000001/', 'http://127.1/', 'http://127.0.0.1./', 'http://localhost./', 'http://localhost../',
    'http://localhost%2e/', 'http://LOCALHOST/', 'http://ha.local./', 'http://[::ffff:7f00:1]/', 'http://[::ffff:a00:1]/', 'http://[64:ff9b::7f00:1]/',
    'http://[64:ff9b::127.0.0.1]/', 'http://[::7f00:1]/', 'http://[::]/', 'http://[2002:7f00:1::]/', 'http://[fec0::1]/', 'http://[ff02::1]/',
  ]) assert.equal(isSafeOutboundUrl(url), false, url);
  for (const url of ['https://example.com/', 'https://example.com./', 'http://[64:ff9b::808:808]/', 'http://[2606:4700::1111]/'])
    assert.equal(isSafeOutboundUrl(url), true, url);
});

// A real server on loopback, and a resolver that maps every *.test name to it.
let connections = 0;
let requests = 0;
const server = createServer((req, res) => {
  requests++;
  if (req.url === '/hop') { res.writeHead(302, { Location: '/feed.ics' }); res.end(); return; }
  if (req.url === '/empty') { res.writeHead(204); res.end(); return; }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/calendar', 'X-Echo-Method': req.method!, 'X-Echo-Auth': req.headers.authorization ?? '' });
    res.end(`BEGIN:VCALENDAR\n${body}END:VCALENDAR\n`);
  });
});
server.on('connection', () => connections++);
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
after(() => server.close());
const port = (server.address() as AddressInfo).port;

const resolved: string[] = [];
// Stands in for dns.lookup: every name is 127.0.0.1 (as 127.0.0.1.nip.io or a rebinding domain would be).
const fakeDns = (host: string, _opts: unknown, cb: (err: NodeJS.ErrnoException | null, addrs: LookupAddress[]) => void) => {
  resolved.push(host);
  cb(null, [{ address: host.includes(':') ? host : /^[\d.]+$/.test(host) ? host : '127.0.0.1', family: host.includes(':') ? 6 : 4 }]);
};
const guarded = nodeFetch(guardedLookup(fakeDns));
const unguarded = nodeFetch(guardedLookup(fakeDns, () => false));
const reset = () => { connections = 0; requests = 0; resolved.length = 0; };

test('nodeFetch: methods, headers, bodies, manual redirects and empty answers (address check off)', async () => {
  const res = await unguarded(`http://rebind.test:${port}/x`, { method: 'PROPFIND', headers: { Authorization: 'Basic abc' }, body: 'X\n', redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-echo-method'), 'PROPFIND');
  assert.equal(res.headers.get('x-echo-auth'), 'Basic abc');
  assert.equal(await res.text(), 'BEGIN:VCALENDAR\nX\nEND:VCALENDAR\n');
  const hop = await unguarded(`http://rebind.test:${port}/hop`, { redirect: 'manual' });
  assert.equal(hop.status, 302);
  assert.equal(hop.headers.get('location'), '/feed.ics');
  assert.equal((await unguarded(`http://rebind.test:${port}/empty`, { redirect: 'manual' })).status, 204);
  await assert.rejects(unguarded(`http://rebind.test:${port}/x`), /redirect/); // never follows on its own
});

test('guarded fetch: a name that resolves to loopback is refused before anything connects', async () => {
  reset();
  await assert.rejects(guarded(`http://rebind.test:${port}/x`, { redirect: 'manual' }), /private address/);
  await assert.rejects(guarded(`http://127.0.0.1:${port}/x`, { redirect: 'manual' }), /private address/); // literals too
  // dns.lookup({ all: true }) answers: one private record among public ones is enough to refuse.
  const mixed = nodeFetch(guardedLookup((_h, _o, cb) => cb(null, [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }])));
  await assert.rejects(mixed(`http://mixed.test:${port}/x`, { redirect: 'manual' }), /private address/);
  assert.deepEqual([connections, requests], [0, 0]);
});

const FEED = `http://rebind.test:${port}/feed.ics`;
const env = (extra: Partial<Env> = {}) => ({ OUTBOUND_FETCH: guarded, ...extra });

// "public.test" plays a public host that redirects into the family's network.
const redirector = (to: string): Fetch => async (input, init) =>
  new URL(input instanceof Request ? input.url : String(input)).hostname === 'public.test'
    ? new Response(null, { status: 302, headers: { Location: to } })
    : guarded(input, init);

test('feedFetch: refused through OUTBOUND_FETCH, directly and after a redirect; ALLOW_PRIVATE_FEED_URLS=1 skips it', async () => {
  reset();
  await assert.rejects(feedFetch(env(), FEED), /private address/);
  await assert.rejects(feedFetch({ OUTBOUND_FETCH: redirector(FEED) }, 'https://public.test/cal.ics'), /private address/);
  // The webhook opt-out doesn't open feeds.
  await assert.rejects(feedFetch(env({ ALLOW_PRIVATE_WEBHOOK_URLS: '1' }), FEED), /private address/);
  assert.deepEqual([connections, requests], [0, 0]);

  // The feed opt-out bypasses the hook (plain fetch, as before): a LAN feed is reached.
  const res = await feedFetch({ OUTBOUND_FETCH: () => Promise.reject(new Error('hook used')), ALLOW_PRIVATE_FEED_URLS: '1' }, `http://127.0.0.1:${port}/hop`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /VCALENDAR/);
  assert.equal(requests, 2);
});

test('fetchRecipeImage (and pages, PDFs, covers): refused through OUTBOUND_FETCH, directly and after a redirect', async () => {
  reset();
  const direct = await fetchRecipeImage(env(), `https://rebind.test:${port}/a.png`);
  assert.deepEqual(direct, { error: 'could not reach the recipe image', status: 502 });
  const hopped = await fetchRecipeImage({ OUTBOUND_FETCH: redirector(`https://rebind.test:${port}/a.png`) }, 'https://public.test/a.png');
  assert.deepEqual(hopped, { error: 'could not reach the recipe image', status: 502 });
  assert.deepEqual([connections, requests], [0, 0]);
  assert.ok(resolved.includes('rebind.test'));
});

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
async function fireWebhook(url: string, extra: Partial<Env>) {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const e: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', ...extra };
  const created = await createApp().request('/api/webhooks', { method: 'POST', headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url, events: [] }) }, e);
  assert.equal(created.status, 201);
  const pending: Promise<unknown>[] = [];
  publish(e, { waitUntil: (p) => pending.push(p) }, 'settings.changed');
  await Promise.all(pending);
}

test('webhooks: refused through OUTBOUND_FETCH; ALLOW_PRIVATE_WEBHOOK_URLS=1 skips it, the feed opt-out does not', async () => {
  reset();
  const errors = console.error;
  console.error = () => {};
  try {
    await fireWebhook(`http://rebind.test:${port}/hook`, { OUTBOUND_FETCH: guarded });
    await fireWebhook(`http://rebind.test:${port}/hook`, { OUTBOUND_FETCH: guarded, ALLOW_PRIVATE_FEED_URLS: '1' });
  } finally {
    console.error = errors;
  }
  assert.ok(resolved.includes('rebind.test'));
  assert.deepEqual([connections, requests], [0, 0]);

  await fireWebhook(`http://127.0.0.1:${port}/hook`, { OUTBOUND_FETCH: () => Promise.reject(new Error('hook used')), ALLOW_PRIVATE_WEBHOOK_URLS: '1' });
  assert.equal(requests, 1);
});

// CalDAV/ICS event sync gets its env from providerEnv (ctx.env), not the host's Env: the hook must survive the copy.
test('providerEnv carries OUTBOUND_FETCH to the calendar providers', async () => {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const penv = await providerEnv({ DB: db as unknown as D1Database, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', OUTBOUND_FETCH: guarded }, db as never);
  assert.equal(penv.OUTBOUND_FETCH, guarded);
});
