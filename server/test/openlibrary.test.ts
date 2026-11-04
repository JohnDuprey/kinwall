import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenLibraryClient } from '../src/openlibrary.ts';

function fixture(contact = '') {
  let now = 0;
  const starts: number[] = [];
  const headers: Headers[] = [];
  let answer = () => Response.json({ docs: [] });
  const client = new OpenLibraryClient({ contact, now: () => now, sleep: async ms => { now += ms; },
    fetch: async (_url, init) => { starts.push(now); headers.push(new Headers(init?.headers)); return answer(); } });
  return { client, starts, headers, advance: (ms: number) => { now += ms; }, answer: (f: () => Response) => { answer = f; } };
}

test('paces actual requests, deduplicates concurrent requests, and caches empty searches', async () => {
  const f = fixture();
  await Promise.all([f.client.json('/search.json?q=a'), f.client.json('/search.json?q=a'), f.client.json('/works/OL1W.json')]);
  assert.deepEqual(f.starts, [0, 1000]);
  await f.client.json('/search.json?q=a');
  assert.equal(f.starts.length, 2);
  f.advance(3_600_001);
  await f.client.json('/search.json?q=a');
  assert.equal(f.starts.length, 3);
});

test('identified requests include contact details and remain below three per second', async () => {
  const f = fixture('books@example.org');
  await Promise.all([f.client.json('/search.json?q=a'), f.client.json('/search.json?q=b'), f.client.json('/works/OL1W.json')]);
  assert.deepEqual(f.starts, [0, 334, 668]);
  assert.match(f.headers[0].get('User-Agent')!, /Kinwall.*books@example.org/);
});

test('521 cooldown blocks queued calls, grows after repeated failures, and recovers', async () => {
  const f = fixture();
  f.answer(() => new Response('down', { status: 521 }));
  const result = await Promise.allSettled([f.client.json('/search.json?q=a'), f.client.json('/search.json?q=b')]);
  assert.ok(result.every(r => r.status === 'rejected'));
  assert.equal(f.starts.length, 1);
  f.advance(30_000);
  await assert.rejects(f.client.json('/search.json?q=a'), /521/);
  f.advance(30_000);
  await assert.rejects(f.client.json('/search.json?q=a'), /unavailable/);
  f.advance(30_000);
  f.answer(() => Response.json({ docs: [{ title: 'Recovered' }] }));
  assert.deepEqual(await f.client.json('/search.json?q=a'), { docs: [{ title: 'Recovered' }] });
});

test('honors Retry-After seconds and dates; errors are never cached as empty results', async () => {
  for (const retry of ['120', new Date(120_000).toUTCString()]) {
    const f = fixture();
    f.answer(() => new Response('', { status: 429, headers: { 'Retry-After': retry } }));
    await assert.rejects(f.client.json('/search.json?q=a'), /429/);
    f.advance(119_000);
    await assert.rejects(f.client.json('/search.json?q=a'));
    assert.equal(f.starts.length, 1);
    f.advance(1000);
    f.answer(() => Response.json({ docs: [] }));
    await f.client.json('/search.json?q=a');
    assert.equal(f.starts.length, 2);
  }
});

test('rejects non-API paths and bounds pending requests', async () => {
  const f = fixture();
  await assert.rejects(f.client.json('//evil.example/search.json'));
  await assert.rejects(f.client.json('/authors/OL1A.json'));
  const requests = Array.from({ length: 10 }, (_, i) => f.client.json(`/search.json?q=${i}`));
  await assert.rejects(f.client.json('/search.json?q=overflow'), /busy/);
  const results = await Promise.allSettled(requests);
  assert.ok(results.some(r => r.status === 'rejected'), 'queue wait is bounded');
});

test('persists cooldown across client recreation and caps oversized responses', async () => {
  let saved = { next: 0, until: 0, failures: 0 };
  const first = new OpenLibraryClient({ now: () => 1000, save: async state => { saved = state; }, fetch: async () => { throw new Error('offline'); } });
  await assert.rejects(first.json('/search.json?q=a'), /offline/);
  let called = false;
  const restarted = new OpenLibraryClient({ state: saved, now: () => 2000, fetch: async () => { called = true; return Response.json({}); } });
  await assert.rejects(restarted.json('/search.json?q=b'), /unavailable/);
  assert.equal(called, false);
  const oversized = new OpenLibraryClient({ fetch: async () => new Response('x'.repeat(1024 * 1024 + 1)) });
  await assert.rejects(oversized.json('/works/OL1W.json'), /too large/);
});

test('cached results are isolated from caller mutations; work cache expires after one day', async () => {
  const f = fixture();
  f.answer(() => Response.json({ description: { value: 'Original' } }));
  const first = await f.client.json('/works/OL1W.json') as { description: { value: string } };
  first.description.value = 'Changed';
  assert.deepEqual(await f.client.json('/works/OL1W.json'), { description: { value: 'Original' } });
  f.advance(86_400_001);
  await f.client.json('/works/OL1W.json');
  assert.equal(f.starts.length, 2);
});

test('a missing work does not trigger a service-wide outage cooldown', async () => {
  const f = fixture();
  f.answer(() => new Response('', { status: 404 }));
  await assert.rejects(f.client.json('/works/OL1W.json'), /404/);
  f.answer(() => Response.json({ docs: [] }));
  await f.client.json('/search.json?q=a');
  assert.deepEqual(f.starts, [0, 1000]);
});

test('Kinwall defaults to the approved support contact and identified pacing', async () => {
  let now = 0;
  const starts: number[] = [];
  const client = new OpenLibraryClient({ now: () => now, sleep: async ms => { now += ms; }, fetch: async (_url, init) => {
    starts.push(now);
    assert.match(new Headers(init?.headers).get('User-Agent')!, /support@kinwall\.family/);
    return Response.json({ docs: [] });
  } });
  await client.json('/search.json?q=a');
  await client.json('/search.json?q=b');
  assert.deepEqual(starts, [0, 334]);
});
