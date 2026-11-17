import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.mjs';
import { Bridge } from '../bridge.mjs';
import { marker } from '../format.mjs';

import { fixture } from './fakes.mjs';

test('imports existing threads and replies exactly once across repeated scans', async () => {
  const f = fixture();
  try {
    await f.bridge.run(); await f.bridge.run();
    assert.equal(f.issues.length, 1);
    assert.equal(f.comments.get(f.issues[0].number).length, 1);
    assert.ok(f.issues[0].body.includes(marker('discord', '100')));
    assert.equal(f.store.get('thread:100').issue, f.issues[0].number);
  } finally { f.store.close(); }
});

test('GitHub-origin topics survive restart and only explicitly labeled issues become forum posts', async () => {
  const f = fixture();
  try {
    f.threads.length = 0; f.messages.clear();
    f.issues.push({ number: 7, title: 'Request', body: 'Details', labels: [{ name: 'discord' }], user: { id: 22, login: 'Alex' }, state: 'open', html_url: 'https://github.com/example/repo/issues/7' }, { number: 8, title: 'Private work', body: 'Internal', labels: [], user: { id: 22 }, state: 'open' });
    f.comments.set(7, []);
    await f.bridge.run();
    const restarted = new Bridge({ config: f.config, store: f.store, discord: f.discord, github: f.github, assets: {}, apply: true });
    await restarted.run();
    assert.equal(f.threads.length, 1);
    assert.equal(f.store.get(`thread:${f.threads[0].id}`).issue, 7);
  } finally { f.store.close(); }
});

test('Discord archive and deletion never close or delete GitHub issues', async () => {
  const f = fixture();
  try {
    await f.bridge.run();
    f.writes.length = 0;
    f.threads[0].thread_metadata.archived = true;
    await f.bridge.run();
    f.threads.length = 0;
    await f.bridge.run();
    assert.equal(f.issues[0].state, 'open');
    assert.ok(!f.writes.some(w => w[0] === 'edit-issue' && 'state' in w[2]));
    assert.equal(f.issues.length, 1);
  } finally { f.store.close(); }
});

test('human comments and edits synchronize both ways without echoing bridge comments', async () => {
  const f = fixture();
  try {
    await f.bridge.run();
    const issue = f.issues[0];
    f.messages.get('100')[1].content = 'Edited Discord reply';
    f.comments.get(issue.number).push({ id: 50, body: 'GitHub reply', user: { id: 20, login: 'Alex' }, html_url: 'https://github.com/example/repo/issues/1#issuecomment-50' });
    await f.bridge.run();
    assert.ok(f.comments.get(issue.number)[0].body.includes('Edited Discord reply'));
    assert.equal(f.messages.get('100').filter(m => m.author.bot).length, 2); // link/status card + one reply
    f.comments.get(issue.number).find(c => c.id === 50).body = 'Edited GitHub reply';
    await f.bridge.run();
    assert.ok(f.messages.get('100').some(m => m.content.includes('Edited GitHub reply')));
    assert.equal(f.comments.get(issue.number).length, 2);
  } finally { f.store.close(); }
});

test('lost create response is recovered from remote marker without duplicate issue', async () => {
  const f = fixture();
  try {
    const original = f.github.createIssue;
    f.github.createIssue = async payload => { await original(payload); throw new Error('connection lost after write'); };
    await f.bridge.run();
    assert.equal(f.issues.length, 1);
    f.github.createIssue = original;
    await f.bridge.run();
    assert.equal(f.issues.length, 1);
    assert.equal(f.store.get('thread:100').issue, f.issues[0].number);
  } finally { f.store.close(); }
});

test('ambiguous writes without a remote copy pause instead of blindly retrying', async () => {
  const f = fixture();
  try {
    let calls = 0;
    f.github.createIssue = async () => { calls++; throw new Error('network unavailable'); };
    await f.bridge.run(); await f.bridge.run();
    assert.equal(calls, 1);
    assert.equal(f.store.pending().length, 1);
  } finally { f.store.close(); }
});

test('dry-run reports the complete import without remote writes or persistent mutations', async () => {
  const f = fixture();
  try {
    const plan = new Bridge({ config: f.config, store: f.store, discord: f.discord, github: f.github, assets: { copy: async a => a }, apply: false });
    const result = await plan.run();
    assert.equal(f.writes.length, 0);
    assert.equal(f.store.entries('thread:').length, 0);
    assert.ok(result.actions.some(a => a.type === 'create-issue'));
    assert.ok(result.actions.some(a => a.type === 'create-comment'));
  } finally { f.store.close(); }
});

test('GitHub closure updates a managed status card without archiving the forum', async () => {
  const f = fixture();
  try {
    await f.bridge.run(); f.issues[0].state = 'closed';
    await f.bridge.run();
    assert.ok(f.messages.get('100').some(m => m.content.includes('Closed')));
    assert.equal(f.threads[0].thread_metadata.archived, false);
  } finally { f.store.close(); }
});

test('an incomplete Discord snapshot aborts before any remote writes', async () => {
  const f = fixture();
  try {
    f.discord.messages = async () => { throw new Error('forbidden'); };
    await assert.rejects(f.bridge.run(), /Cannot read thread/);
    assert.equal(f.writes.length, 0);
  } finally { f.store.close(); }
});

test('independent GitHub body edits are retained when the Discord source changes too', async () => {
  const f = fixture();
  try {
    await f.bridge.run();
    f.issues[0].body = 'Maintainer edited this';
    f.messages.get('100')[0].content = 'User edited this';
    const result = await f.bridge.run();
    assert.equal(f.issues[0].body, 'Maintainer edited this');
    assert.ok(result.warnings.some(w => w.message.includes('Both source')));
  } finally { f.store.close(); }
});

test('new GitHub replies recover from a lost Discord send response without duplication', async () => {
  const f = fixture();
  try {
    await f.bridge.run();
    f.comments.get(f.issues[0].number).push({ id: 60, body: 'New reply', user: { id: 20, login: 'Alex' }, html_url: 'https://github.com/example/repo/issues/1#issuecomment-60' });
    const original = f.discord.createMessage;
    f.discord.createMessage = async (...args) => { await original(...args); throw new Error('response lost'); };
    await f.bridge.run();
    f.discord.createMessage = original;
    await f.bridge.run();
    assert.equal(f.messages.get('100').filter(m => m.content.includes('New reply')).length, 1);
    assert.equal(f.store.pending().length, 0);
  } finally { f.store.close(); }
});

test('deleted mirrored replies are preserved as detached mappings instead of recreated', async () => {
  const f = fixture();
  try {
    await f.bridge.run();
    f.comments.get(f.issues[0].number).length = 0;
    f.messages.get('100')[1].content = 'Edited after destination deletion';
    const result = await f.bridge.run();
    assert.equal(f.comments.get(f.issues[0].number).length, 0);
    assert.ok(result.warnings.some(w => w.message.includes('deleted')));
  } finally { f.store.close(); }
});

test('tag edits preserve unrelated issue labels, and GitHub-origin labels map to forum tags', async () => {
  const f = fixture();
  try {
    f.config.tags = [{ id: '80', name: 'Feature' }]; f.config.tagMap = { Feature: 'enhancement' };
    f.threads[0].applied_tags = ['80'];
    await f.bridge.run();
    assert.ok(f.issues[0].labels.includes('enhancement'));
    f.issues[0].labels.push({ name: 'triaged' });
    f.threads[0].applied_tags = [];
    await f.bridge.run();
    assert.ok(f.issues[0].labels.includes('triaged'));
    assert.ok(!f.issues[0].labels.includes('enhancement'));
    f.store.set('thread:100', { ...f.store.get('thread:100'), origin: 'github' });
    f.issues[0].labels.push({ name: 'enhancement' });
    await f.bridge.run();
    assert.deepEqual(f.threads[0].applied_tags, ['80']);
  } finally { f.store.close(); }
});

test('GitHub-origin long descriptions and replies are complete, and shorter edits retain no stale continuation', async () => {
  const f = fixture();
  try {
    f.threads.length = 0; f.messages.clear();
    f.issues.push({ number: 7, title: 'Long request', body: 'Details '.repeat(800), labels: [{ name: 'discord' }], user: { id: 22, login: 'Alex' }, state: 'open', html_url: 'https://github.com/example/repo/issues/7' });
    f.comments.set(7, [{ id: 8, body: 'Reply '.repeat(800), user: { id: 22, login: 'Alex' }, html_url: 'https://github.com/example/repo/issues/7#issuecomment-8' }]);
    await f.bridge.run();
    assert.equal(f.threads.length, 1);
    assert.ok(f.messages.get(f.threads[0].id).length >= 6);
    f.comments.get(7)[0].body = 'Short reply';
    await f.bridge.run();
    assert.ok(f.messages.get(f.threads[0].id).some(m => m.content.includes('Short reply')));
    assert.ok(f.messages.get(f.threads[0].id).some(m => m.content.includes('continuation was removed')));
  } finally { f.store.close(); }
});

test('lost GitHub-origin thread creation is recovered without a second forum post', async () => {
  const f = fixture();
  try {
    f.threads.length = 0; f.messages.clear();
    f.issues.push({ number: 7, title: 'Request', body: 'Details', labels: [{ name: 'discord' }], user: { id: 22, login: 'Alex' }, state: 'open', html_url: 'https://github.com/example/repo/issues/7' }); f.comments.set(7, []);
    const original = f.discord.createThread;
    f.discord.createThread = async payload => { await original(payload); throw new Error('connection lost'); };
    await f.bridge.run();
    assert.equal(f.store.pending().length, 1);
    f.discord.createThread = original;
    await f.bridge.run();
    assert.equal(f.threads.length, 1);
    assert.equal(f.store.pending().length, 0);
  } finally { f.store.close(); }
});

test('conflicts resume after an operator aligns the destination with the proposed body', async () => {
  const f = fixture();
  try {
    await f.bridge.run();
    f.issues[0].body = 'Maintainer changed it'; f.messages.get('100')[0].content = 'Source changed too';
    const report = await f.bridge.run();
    const conflict = report.actions.find(a => a.type === 'conflict');
    assert.ok(conflict);
    f.issues[0].body = conflict.body;
    const next = await f.bridge.run();
    assert.ok(!next.warnings.some(w => w.message.includes('Both source')));
  } finally { f.store.close(); }
});

test('a quoted origin marker in source text cannot steal the actual source identity', async () => {
  const f = fixture();
  try {
    f.messages.get('100')[0].content = 'Quoting ' + marker('discord', '999');
    await f.bridge.run();
    // Simulate losing only the local thread mapping after remote issue creation.
    f.store.db.prepare('DELETE FROM kv WHERE key=?').run('thread:100');
    await f.bridge.run();
    assert.equal(f.issues.length, 1);
    assert.equal(f.store.get('thread:100').issue, f.issues[0].number);
  } finally { f.store.close(); }
});

test('the pending intent is remotely checkpointed before creating a destination', async () => {
  const f = fixture();
  try {
    const order = [];
    const original = f.github.createIssue;
    f.github.createIssue = async body => { order.push('write'); return original(body); };
    const bridge = new Bridge({ config: f.config, store: f.store, discord: f.discord, github: f.github, assets: {}, apply: true, checkpoint: async () => { if (f.store.pending().length) order.push('checkpoint-pending'); } });
    await bridge.run();
    assert.equal(order[0], 'checkpoint-pending');
    assert.ok(order.indexOf('write') > order.indexOf('checkpoint-pending'));
  } finally { f.store.close(); }
});
