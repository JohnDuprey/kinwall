import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/d1-sqlite.ts';
import { createKinwall } from '../src/entry.ts';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .map((name) => ({ name, sql: readFileSync(path.join(dir, name), 'utf8') }));

const ADMIN_KEY = 'kw_test_admin_key';

test('createKinwall: lazy migrations, public + authed fetch, scheduled tick', async () => {
  // Fresh, unmigrated DB: the first call must migrate it (the Worker / embedded path).
  const kinwall = createKinwall(
    { DB: openDb(':memory:'), ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    { migrations },
  );

  const health = await kinwall.fetch(new Request('http://x/api/health'));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  assert.equal((await kinwall.fetch(new Request('http://x/api/members'))).status, 401);
  const members = await kinwall.fetch(new Request('http://x/api/members', { headers: { Authorization: `Bearer ${ADMIN_KEY}` } }));
  assert.equal(members.status, 200);
  assert.deepEqual(await members.json(), []);

  // No assets binding: non-API paths are a plain 404, not a crash.
  assert.equal((await kinwall.fetch(new Request('http://x/some/page'))).status, 404);

  await kinwall.scheduled(new Date());
});
