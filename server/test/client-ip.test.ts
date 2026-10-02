import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { clientIp, nodeClientIp } from '../src/ratelimit.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// An env wired like node.ts: a request's peer is stashed per Request, trust is a switch.
function nodeEnv(trustProxy: boolean, peer = '198.51.100.20') {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = {
    DB: db as unknown as D1Database,
    PUBLIC_URL: 'https://kinwall.example',
    ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    CLIENT_IP: (req) => nodeClientIp(peer, req.headers.get('x-forwarded-for'), trustProxy, false),
  };
  const app = createApp();
  const login = async (headers: Record<string, string>) =>
    app.request('/api/recovery/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ code: 'wrong-code' }) }, env);
  return { login };
}

// Recovery login allows 10 wrong codes per hour per address; the 11th is a 429.
async function burn(login: (h: Record<string, string>) => Promise<Response>, headers: (i: number) => Record<string, string>) {
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) statuses.push((await login(headers(i))).status);
  return statuses;
}

test('without TRUST_PROXY, rotating X-Forwarded-For or CF-Connecting-IP does not escape the limit', async () => {
  const { login } = nodeEnv(false);
  const statuses = await burn(login, (i) => ({ 'X-Forwarded-For': `203.0.113.${i}`, 'CF-Connecting-IP': `192.0.2.${i}` }));
  assert.ok(statuses.includes(429), `expected a 429, got ${statuses}`);
});

test('with TRUST_PROXY, each forwarded address gets its own bucket', async () => {
  const { login } = nodeEnv(true);
  const statuses = await burn(login, (i) => ({ 'X-Forwarded-For': `203.0.113.${i}` }));
  assert.ok(!statuses.includes(429), `unexpected 429 in ${statuses}`);
  const same = await burn(login, () => ({ 'X-Forwarded-For': '203.0.113.99' }));
  assert.ok(same.includes(429));
});

test('with TRUST_PROXY, a spoofed left-most entry does not change the bucket', async () => {
  const { login } = nodeEnv(true);
  const statuses = await burn(login, (i) => ({ 'X-Forwarded-For': `10.9.8.${i}, 203.0.113.50` }));
  assert.ok(statuses.includes(429), `expected a 429, got ${statuses}`);
});

test('nodeClientIp: peer by default, right-most entry when trusted, one address for ingress', () => {
  assert.equal(nodeClientIp('::ffff:198.51.100.7', '1.2.3.4', false, false), '198.51.100.7');
  assert.equal(nodeClientIp('172.18.0.2', '1.2.3.4, 203.0.113.5', true, false), '203.0.113.5');
  assert.equal(nodeClientIp('172.18.0.2', null, true, false), '172.18.0.2'); // proxy sent nothing: fall back to the peer
  assert.equal(nodeClientIp('172.30.32.2', '203.0.113.5', true, true), 'ingress');
  assert.equal(nodeClientIp(undefined, null, false, false), null);
});

test('without a host resolver (Cloudflare hosts), cf-connecting-ip is used and X-Forwarded-For is not', () => {
  const req = (h: Record<string, string>) => ({ req: { raw: new Request('http://x/', { headers: h }) }, env: {} });
  assert.equal(clientIp(req({ 'cf-connecting-ip': '203.0.113.1', 'x-forwarded-for': '9.9.9.9' })), '203.0.113.1');
  assert.equal(clientIp(req({ 'x-forwarded-for': '9.9.9.9' })), null);
});

// A request sent without Content-Length is read by the body limit (app.ts), which hands the routes
// a rebuilt Request. What the host knew about the original one has to follow it.
test('a chunked request keeps the address the host stashed for it', async () => {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const peers = new WeakMap<Request, string>();
  const env: Env = {
    DB: db as unknown as D1Database,
    PUBLIC_URL: 'https://kinwall.example',
    ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    CLIENT_IP: (req) => peers.get(req) ?? null,
    SAME_REQUEST: (from, to) => { const p = peers.get(from); if (p) peers.set(to, p); },
  };
  const app = createApp();
  const login = async (peer: string) => {
    const body = new ReadableStream<Uint8Array>({ start(ctrl) { ctrl.enqueue(new TextEncoder().encode(JSON.stringify({ code: 'wrong-code' }))); ctrl.close(); } });
    const req = new Request('http://localhost/api/recovery/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' } as RequestInit);
    peers.set(req, peer);
    return (await app.request(req, undefined, env)).status;
  };
  for (let i = 0; i < 11; i++) await login('198.51.100.1');
  assert.equal(await login('198.51.100.1'), 429);
  assert.equal(await login('198.51.100.2'), 401, 'another peer has its own bucket, not a shared unknown one');
});
