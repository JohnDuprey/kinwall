import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuration } from '../config.mjs';

test('configuration validates IDs, label mapping, and interval', () => {
  const env = { DISCORD_TOKEN: 'fake', GITHUB_TOKEN: 'fake', DISCORD_GUILD_ID: '1', DISCORD_FORUM_ID: '2', GITHUB_REPOSITORY: 'example/kinwall', SYNC_REDACT_TERMS: '["private-term"]' };
  const config = configuration(env);
  assert.equal(config.interval, 60000); assert.ok(!Object.hasOwn(config, 'terms')); // legacy filtering settings have no effect
  assert.throws(() => configuration({ ...env, SYNC_INTERVAL_SECONDS: '0' }), /interval/);
  assert.throws(() => configuration({ ...env, SYNC_TAG_MAP: '{"Tag": 3}' }), /map/);
  assert.throws(() => configuration({ ...env, DISCORD_FORUM_ID: 'bad' }), /Discord/);
  assert.doesNotThrow(() => configuration({ ...env, SYNC_REDACT_TERMS: '{}' }));
});
