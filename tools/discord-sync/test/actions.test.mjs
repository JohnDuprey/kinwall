import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runActions } from '../actions.mjs';
import { fixture, fakeGithub } from './fakes.mjs';

test('two finite runs on fresh runners restore the same mappings without duplicate issues or replies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'actions-sync-'));
  const f = fixture();
  try {
    const github = Object.assign(f.github, fakeGithub(), { init: async () => ({}), ensureLabel: async () => {} });
    f.discord.init = async () => ({ available_tags: [] });
    const config = { ...f.config, dataDir: dir };
    const first = await runActions({ config, github, discord: f.discord, apply: true });
    assert.deepEqual(first.warnings, []);
    const second = await runActions({ config, github, discord: f.discord, apply: true });
    assert.deepEqual(second.warnings, []);
    assert.equal(f.issues.length, 1);
    assert.equal(f.comments.get(f.issues[0].number).length, 1);
    assert.equal(github.files.filter(f => f.name.startsWith('state-')).length, 3);
  } finally { f.store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('failed remote intent checkpoint prevents all destination writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'actions-sync-'));
  const f = fixture();
  try {
    const github = Object.assign(f.github, fakeGithub(), { init: async () => ({}), ensureLabel: async () => {} });
    f.discord.init = async () => ({ available_tags: [] });
    const upload = github.uploadAsset;
    let calls = 0;
    github.uploadAsset = async (...args) => { if (++calls === 2) throw new Error('checkpoint unavailable'); return upload(...args); };
    await assert.rejects(runActions({ config: { ...f.config, dataDir: dir }, github, discord: f.discord, apply: true }), /checkpoint/);
    assert.equal(f.writes.length, 0);
  } finally { f.store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Actions preview never creates a release or changes either platform', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'actions-sync-'));
  const f = fixture();
  try {
    const github = Object.assign(f.github, fakeGithub(), { init: async () => ({}), ensureLabel: async () => {} });
    f.discord.init = async () => ({ available_tags: [] });
    const result = await runActions({ config: { ...f.config, dataDir: dir }, github, discord: f.discord });
    assert.equal(await github.release(), undefined);
    assert.equal(f.writes.length, 0);
    assert.ok(result.actions.some(a => a.type === 'create-issue'));
  } finally { f.store.close(); await rm(dir, { recursive: true, force: true }); }
});
