import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api, Discord, Github } from '../api.mjs';

test('429 retries honor server delay and API errors never print authorization or response bodies', async () => {
  let calls = 0;
  const waits = [];
  const api = new Api('https://discord.com/api/v10', { Authorization: 'Bot obvious-fake' }, { sleep: async ms => waits.push(ms), fetcher: async () => ++calls === 1 ? new Response(JSON.stringify({ retry_after: 0.01 }), { status: 429 }) : new Response('{"id":"1"}') });
  assert.equal((await api.request('GET', '/users/@me')).id, '1');
  assert.equal(calls, 2); assert.deepEqual(waits, [10]);
  api.fetcher = async () => new Response('secret-response-body', { status: 403 });
  await assert.rejects(api.request('GET', '/test'), error => !error.message.includes('secret') && !error.message.includes('obvious-fake') && error.status === 403);
});

test('uncertain POST failures are not retried automatically', async () => {
  let calls = 0;
  const api = new Api('https://api.github.com', {}, { fetcher: async () => { calls++; throw new Error('socket closed'); } });
  await assert.rejects(api.request('POST', '/repos/example/test/issues', {}), /network/);
  assert.equal(calls, 1);
});

test('GitHub pagination loads every page and excludes pull requests', async () => {
  const github = new Github('fake', 'example/test');
  const calls = [];
  github.api.request = async (_, route) => { calls.push(route); return new URL(route, 'https://example.com').searchParams.get('page') === '1' ? Array.from({ length: 100 }, (_, i) => ({ number: i + 1 })) : [{ number: 101 }, { number: 102, pull_request: {} }]; };
  const issues = await github.issues();
  assert.equal(issues.length, 101); assert.equal(calls.length, 2);
});

test('Discord discovers active AND archived threads and rejects an unrelated forum', async () => {
  const discord = new Discord('fake', '1', '2');
  discord.api.request = async (_, route) => {
    if (route === '/channels/2') return { type: 15, guild_id: '1', available_tags: [] };
    if (route.includes('/threads/active')) return { threads: [{ id: '3', parent_id: '2' }, { id: '4', parent_id: 'other' }] };
    if (route.includes('/threads/archived')) return { threads: [{ id: '5', parent_id: '2' }], has_more: false };
    return { id: 'bot' };
  };
  await discord.init();
  assert.deepEqual((await discord.threads()).map(t => t.id), ['3', '5']);
  discord.api.request = async () => ({ type: 0, guild_id: 'other' });
  await assert.rejects(discord.init(), /forum/);
});

test('Actions authentication resolves the bot without the user-token-only endpoint', async () => {
  const github = new Github('fake-installation-token', 'example/test', { actorLogin: 'github-actions[bot]' });
  const paths = [];
  github.api.request = async (_, path) => { paths.push(path); return path.startsWith('/users/') ? { id: 99 } : { has_issues: true }; };
  await github.init();
  assert.equal(github.actor.id, 99);
  assert.ok(!paths.includes('/user'));
});

test('binary release uploads preserve bytes and download redirects never forward credentials', async () => {
  const github = new Github('obvious-fake-token', 'example/test');
  const bytes = Buffer.from([0, 1, 255]);
  const calls = [];
  github.api.fetcher = async (url, options) => {
    calls.push({ url, ...options });
    if (url.startsWith('https://uploads.github.com')) { assert.deepEqual(options.body, bytes); assert.equal(options.headers['Content-Type'], 'image/png'); return new Response('{"state":"uploaded"}'); }
    if (url.startsWith('https://api.github.com')) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/example' } });
    assert.deepEqual(options.headers, {}); return new Response(bytes);
  };
  await github.uploadAsset(1, 'image.png', bytes, 'image/png');
  assert.deepEqual(await github.downloadAsset(2), bytes);
  assert.equal(calls.length, 3);
});
