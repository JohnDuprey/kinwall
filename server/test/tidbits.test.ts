import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const req = (p: string, method = 'GET', body?: unknown) =>
    app.request(p, { method, headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  return req;
}

const FEED = {
  holidays: [
    { text: 'Christian feast days:\nCosmas and Damian' },
    { text: 'European Day of Languages (European Union)' },
  ],
  births: [{ text: 'Serena Williams, American tennis player', year: 1981 }, { text: 'T. S. Eliot, American-English poet (died 1965)', year: 1888 }],
  selected: [{ text: 'A war begins somewhere.', year: 1900 }, { text: 'The first bridge opens.', year: 1950 }],
  events: [],
};
const TRIVIA = { response_code: 0, results: [{ category: 'Animals', difficulty: 'easy', question: 'Wombats%20are%20native%20to%20which%20country%3F', correct_answer: 'Australia', incorrect_answers: ['Palau', 'Chile', 'Peru'] }] };

test('tidbits: online sources are off by default and fetch nothing', async () => {
  const req = setup();
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response('{}'); }) as typeof fetch;
  try {
    const s = (await (await req('/api/settings')).json()) as any;
    assert.deepEqual(s.tidbits.sources, ['quotes', 'facts']);
    const t = (await (await req('/api/tidbits')).json()) as any;
    assert.deepEqual(t.onThisDay, []);
    assert.deepEqual(t.trivia, []);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('tidbits: On this day filters feast days and grim events; trivia decodes with choices; each fetched once a day', async () => {
  const req = setup();
  const realFetch = globalThis.fetch;
  const hosts: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    const u = new URL(String(url));
    hosts.push(u.host);
    return new Response(JSON.stringify(u.host === 'opentdb.com' ? TRIVIA : FEED), { status: 200 });
  }) as typeof fetch;
  try {
    const patch = await req('/api/settings', 'PATCH', { tidbits: { sources: ['quotes', 'onthisday', 'trivia'], factCategories: [], onThisDay: ['holidays', 'births', 'events'], birthsAfter: 1900, triviaCategories: [27], triviaDifficulties: ['easy'] } });
    assert.equal(patch.status, 200);
    const t = (await (await req('/api/tidbits')).json()) as any;
    assert.deepEqual(t.onThisDay.filter((x: any) => x.kind === 'holidays').map((x: any) => x.text), ['European Day of Languages (European Union)']);
    assert.deepEqual(t.onThisDay.filter((x: any) => x.kind === 'births').map((x: any) => x.text), ['Serena Williams, American tennis player']); // T. S. Eliot (1888) is before birthsAfter
    assert.deepEqual(t.onThisDay.filter((x: any) => x.kind === 'events').map((x: any) => x.text), ['The first bridge opens.']);
    assert.equal(t.trivia[0].question, 'Wombats are native to which country?');
    assert.equal(t.trivia[0].answer, 'Australia');
    assert.equal(t.trivia[0].choices.length, 4);
    assert.ok(t.trivia[0].choices.includes('Australia'));
    await req('/api/tidbits'); // cached: no new requests
    assert.deepEqual(hosts.sort(), ['api.wikimedia.org', 'opentdb.com']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('tidbits: settings reject unknown sources and empty trivia categories', async () => {
  const req = setup();
  const bad = [
    { sources: ['horoscopes'], factCategories: [], onThisDay: ['holidays'], birthsAfter: null, triviaCategories: [9], triviaDifficulties: ['easy'] },
    { sources: ['trivia'], factCategories: [], onThisDay: ['holidays'], birthsAfter: null, triviaCategories: [], triviaDifficulties: ['easy'] },
  ];
  for (const tidbits of bad) assert.equal((await req('/api/settings', 'PATCH', { tidbits })).status, 400);
});

test('tidbits: a saved single difficulty carries over; several levels fetch one mixed batch and keep only those', async () => {
  const req = setup();
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  const mixed = { response_code: 0, results: ['easy', 'medium', 'hard'].map((d) => ({ category: 'Animals', difficulty: d, question: `A%20${d}%20one%3F`, correct_answer: 'Yes', incorrect_answers: ['No', 'Maybe', 'Never'] })) };
  globalThis.fetch = (async (url: unknown) => { urls.push(String(url)); return new Response(JSON.stringify(mixed), { status: 200 }); }) as typeof fetch;
  try {
    await req('/api/settings', 'PATCH', { tidbits: { sources: ['trivia'], factCategories: [], onThisDay: ['holidays'], birthsAfter: null, triviaCategories: [27], triviaDifficulties: ['easy', 'hard'] } });
    const t = (await (await req('/api/tidbits')).json()) as any;
    assert.deepEqual(t.trivia.map((q: any) => q.question), ['A easy one?', 'A hard one?']);
    assert.equal(urls.length, 1);
    assert.ok(!urls[0].includes('difficulty='));
    // A single level round-trips as a one-item list.
    const s = (await (await req('/api/settings', 'PATCH', { tidbits: { sources: ['trivia'], factCategories: [], onThisDay: ['holidays'], birthsAfter: null, triviaCategories: [27], triviaDifficulties: ['medium'] } })).json()) as any;
    assert.deepEqual(s.tidbits.triviaDifficulties, ['medium']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

