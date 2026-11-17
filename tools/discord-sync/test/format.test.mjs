import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunks, marker, discordBody, githubBody, hash, sourceHash } from '../format.mjs';

test('long replies preserve every character within the Discord UTF-16 limit', () => {
  const text = '🐻hello\n'.repeat(900);
  const parts = chunks(text, 'bridge:abc');
  assert.ok(parts.length > 1);
  assert.ok(parts.every(p => p.length <= 2000));
  assert.equal(parts.map(p => p.slice(0, p.lastIndexOf('\n-# '))).join(''), text);
  assert.ok(parts.every(p => !p.endsWith('\ud83d')));
});

test('origin markers and source fingerprints ignore expiring attachment query parameters', () => {
  const message = { id: '123', content: 'Details', attachments: [{ id: '4', filename: 'image.png', url: 'https://cdn.discordapp.com/a?expires=1' }] };
  assert.equal(sourceHash(message), sourceHash({ ...message, attachments: [{ ...message.attachments[0], url: 'https://cdn.discordapp.com/a?expires=2' }] }));
  assert.notEqual(sourceHash(message), sourceHash({ ...message, content: 'Edited' }));
  assert.equal(marker('discord', '123'), '<!-- kinwall-discord-sync:discord:123 -->');
});

test('attribution neutralizes mentions and preserves source links', () => {
  const body = githubBody({ id: '3', author: { username: 'Sam', id: '4' }, content: '@everyone <@123> hello', timestamp: '2026-01-01' }, 'https://discord.com/channels/1/2/3', []);
  assert.ok(body.includes('Sam'));
  assert.ok(body.includes(marker('discord', '3')));
  assert.ok(!body.includes('@everyone'));
  assert.ok(discordBody({ user: { login: 'Alex' }, body: 'reply', html_url: 'https://github.com/example/repo/issues/1#issuecomment-2' }).includes('Alex'));
  assert.equal(hash('same'), hash('same'));
});

test('community wording is preserved even when a legacy filter is supplied', () => {
  const body = githubBody({ id: '3', author: { username: 'Sam' }, content: 'I use another calendar.', timestamp: '2026-11-17T03:45:09.454000+00:00' }, 'https://discord.com/channels/1/2/3', [], ['calendar']);
  assert.ok(body.includes('I use another calendar.'));
  assert.ok(!body.includes('[redacted]'));
});

test('timestamps use a readable UTC date and minute, without fractional seconds', () => {
  const body = githubBody({ id: '3', author: { username: 'Sam' }, content: 'Activities', timestamp: '2026-11-17T03:45:09.454000+00:00' }, 'https://discord.com/channels/1/2/3');
  assert.match(body, /^\*\*Sam\*\* · Nov 17, 2026 at 3:45 AM UTC\n/);
  assert.ok(!body.includes('454000'));
  assert.ok(!body.includes('+00:00'));
});

test('missing or invalid timestamps are omitted instead of showing raw data', () => {
  for (const timestamp of [undefined, 'not-a-date']) {
    const body = githubBody({ id: '3', author: { username: 'Sam' }, content: 'Activities', timestamp }, 'https://discord.com/channels/1/2/3');
    assert.match(body, /^\*\*Sam\*\*\n/);
    assert.ok(!body.includes('undefined'));
    assert.ok(!body.includes('not-a-date'));
  }
});
