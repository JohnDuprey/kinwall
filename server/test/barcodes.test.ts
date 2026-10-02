// Scanning a product into a shopping list (routes/lists.ts GET /api/lists/{id}/barcodes/{code}): the
// family's own name for a barcode first (learned when a scanned item is added), else Open Food Facts.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const CHEERIOS = '0016000275287';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const send = async (method: string, p: string, body?: unknown, key = ADMIN_KEY) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  return { send, db };
}

function mockFetch(answer: (url: string) => Response) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return answer(url);
  }) as typeof fetch;
  return calls;
}

const offProduct = (product: Record<string, unknown>) => () => Response.json({ status: 1, product });
const offMissing = () => Response.json({ status: 0, status_verbose: 'product not found' });

test('barcodes: an unknown product comes from Open Food Facts; adding it teaches the family name', async () => {
  const { send } = setup();
  const list = (await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping' })).body;
  const calls = mockFetch(offProduct({ product_name: 'Honey Nut Cheerios', brands: 'General Mills,Cheerios', quantity: '10.8 oz' }));

  const found = await send('GET', `/api/lists/${list.id}/barcodes/${CHEERIOS}`);
  assert.equal(found.status, 200);
  assert.deepEqual(found.body, { title: 'Honey Nut Cheerios', source: 'openfoodfacts' });
  const url = new URL(calls[0]);
  assert.equal(url.host, 'world.openfoodfacts.org');
  assert.equal(url.pathname, `/api/v2/product/${CHEERIOS}.json`);

  // The family shortens the name when adding it; the next scan uses theirs without asking anyone else.
  const added = await send('POST', `/api/lists/${list.id}/items`, { title: 'Cheerios', barcode: CHEERIOS });
  assert.equal(added.status, 201);
  assert.equal(added.body[0].title, 'Cheerios');
  assert.equal(added.body[0].barcode, undefined, 'the barcode is memory, not part of the item');
  calls.length = 0;
  assert.deepEqual((await send('GET', `/api/lists/${list.id}/barcodes/${CHEERIOS}`)).body, { title: 'Cheerios', source: 'family' });
  assert.deepEqual(calls, [], 'no outside lookup for a product the family knows');
});

test('barcodes: not found anywhere is a 404, and typing a name teaches it for next time', async () => {
  const { send } = setup();
  const list = (await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping' })).body;
  mockFetch(offMissing);
  assert.equal((await send('GET', `/api/lists/${list.id}/barcodes/041250000000`)).status, 404);
  await send('POST', `/api/lists/${list.id}/items`, { title: 'Store brand oats', barcode: '041250000000' });
  assert.deepEqual((await send('GET', `/api/lists/${list.id}/barcodes/041250000000`)).body, { title: 'Store brand oats', source: 'family' });
});

test('barcodes: each list type keeps its own names; bad codes and failures answer plainly', async () => {
  const { send } = setup();
  const groceries = (await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping', catalog: 'groceries' })).body;
  const hardware = (await send('POST', '/api/lists', { name: 'Hardware store', kind: 'shopping', catalog: 'shopping' })).body;
  const todo = (await send('POST', '/api/lists', { name: 'Chores', kind: 'todo' })).body;
  mockFetch(offMissing);
  await send('POST', `/api/lists/${groceries.id}/items`, { title: 'Milk', barcode: '96385074' });
  assert.equal((await send('GET', `/api/lists/${hardware.id}/barcodes/96385074`)).status, 404, "groceries' names stay in groceries");
  assert.equal((await send('GET', `/api/lists/${todo.id}/barcodes/96385074`)).status, 400, 'only shopping lists scan');
  assert.equal((await send('GET', `/api/lists/${groceries.id}/barcodes/12-34`)).status, 400);
  assert.equal((await send('POST', `/api/lists/${groceries.id}/items`, { title: 'X', barcode: 'abc' })).status, 400);
  assert.equal((await send('GET', '/api/lists/nope/barcodes/96385074')).status, 404);
  mockFetch(() => new Response('down', { status: 503 }));
  assert.equal((await send('GET', `/api/lists/${groceries.id}/barcodes/0016000275287`)).status, 502);
});

test("barcodes: a kid's own device uses what's remembered but teaches nothing", async () => {
  const { send } = setup();
  const list = (await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping' })).body;
  await send('POST', '/api/members', { name: 'Alex', color: '#336699', grownUp: true });
  const maya = (await send('POST', '/api/members', { name: 'Maya', color: '#7ED9A6' })).body;
  const key = (await send('POST', '/api/keys', { name: "Maya's tablet", scope: 'display' })).body;
  const patched = await send('PATCH', `/api/keys/${key.id}`, { kind: 'kid', owner: maya.id });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  mockFetch(offMissing);
  assert.equal((await send('POST', `/api/lists/${list.id}/items`, { title: 'Gummy worms', barcode: '12345670' }, key.key)).status, 201);
  assert.equal((await send('GET', `/api/lists/${list.id}/barcodes/12345670`)).status, 404);
  // It can still look products up: scanning works on a kid's own device, the switch just isn't there.
  assert.equal((await send('GET', `/api/lists/${list.id}/barcodes/12345670`, undefined, key.key)).status, 404, 'reaches the lookup (nobody knows it)');
  await send('POST', `/api/lists/${list.id}/items`, { title: 'Gummy worms', barcode: '12345670' });
  assert.deepEqual((await send('GET', `/api/lists/${list.id}/barcodes/12345670`, undefined, key.key)).body, { title: 'Gummy worms', source: 'family' });
});

test('barcodes: kept in the family export and brought back by import', async () => {
  const { send, db } = setup();
  const list = (await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping' })).body;
  await send('POST', `/api/lists/${list.id}/items`, { title: 'Cheerios', barcode: CHEERIOS });
  const exported = (await send('GET', '/api/export')).body;
  assert.deepEqual(exported.itemBarcodes.map((b: any) => [b.catalog, b.barcode, b.title]), [['groceries', CHEERIOS, 'Cheerios']]);
  db.prepare('DELETE FROM item_barcodes').run();
  const imported = await send('POST', '/api/import', exported);
  assert.ok(imported.status < 300, JSON.stringify(imported.body));
  assert.deepEqual((await send('GET', `/api/lists/${list.id}/barcodes/${CHEERIOS}`)).body, { title: 'Cheerios', source: 'family' });
});

test('barcodes: renaming a catalog item carries its barcodes; forgetting it forgets them', async () => {
  const { send } = setup();
  const list = (await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping' })).body;
  mockFetch(offMissing);
  // Saved under the wrong name (Open Food Facts had it as mayo): fixed from the Catalog by renaming.
  await send('POST', `/api/lists/${list.id}/items`, { title: 'Light mayo', barcode: '012000001291' });
  const renamed = await send('PUT', '/api/lists/remembered/light mayo', { title: 'Water' });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.deepEqual((await send('GET', `/api/lists/${list.id}/barcodes/012000001291`)).body, { title: 'Water', source: 'family' });

  assert.equal((await send('DELETE', '/api/lists/remembered/water')).status, 200);
  assert.equal((await send('GET', `/api/lists/${list.id}/barcodes/012000001291`)).status, 404, 'forgotten with its item');
});

test('barcodes: the brand leads the name unless the name already has one of its brands', async () => {
  const { send } = setup();
  const list = (await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping' })).body;
  const cases: [Record<string, unknown>, string][] = [
    [{ product_name: 'Canadian White Bread', brands: 'JJ Nissen' }, 'JJ Nissen Canadian White Bread'],
    [{ product_name: 'Honey Nut Cheerios', brands: 'General Mills,Cheerios' }, 'Honey Nut Cheerios'],
    [{ product_name: 'Oreo Cookies', brands: 'oreo' }, 'Oreo Cookies'],
    [{ product_name: 'Spring Water' }, 'Spring Water'],
    [{ brands: 'Store Brand' }, 'Store Brand'],
  ];
  for (const [product, title] of cases) {
    mockFetch(offProduct(product));
    assert.deepEqual((await send('GET', `/api/lists/${list.id}/barcodes/012345678905`)).body, { title, source: 'openfoodfacts' }, JSON.stringify(product));
  }
});
