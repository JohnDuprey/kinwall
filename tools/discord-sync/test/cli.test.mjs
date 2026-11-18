import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));

test('continuous sync requires the explicit apply flag before accessing credentials', () => {
  const result = spawnSync(process.execPath, [cli, 'run'], { encoding: 'utf8', env: {} });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /require.*--apply/);
});

test('local status works without bot or GitHub credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discord-cli-'));
  try {
    const result = spawnSync(process.execPath, [cli, 'status'], { encoding: 'utf8', env: { DISCORD_GUILD_ID: '1', DISCORD_FORUM_ID: '2', GITHUB_REPOSITORY: 'example/kinwall', SYNC_DATA_DIR: dir } });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).linkedThreads, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
