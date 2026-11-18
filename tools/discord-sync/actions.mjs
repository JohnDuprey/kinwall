#!/usr/bin/env node
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { Github, Discord } from './api.mjs';
import { ReleaseStorage, ReleaseAssets } from './release.mjs';
import { Bridge } from './bridge.mjs';
import { configuration } from './config.mjs';

/** Finite reconciliation with remote write-ahead checkpoints, for ephemeral runners. */
export async function runActions({ config, github, discord, apply = false, initialize = false, retryOperation }) {
  if (retryOperation && !apply) throw new Error('Retry requires explicit write mode');
  const [, forum] = await Promise.all([github.init(), discord.init()]);
  config.tags = forum.available_tags || [];
  if (Object.keys(config.tagMap).some(name => !config.tags.some(t => t.name === name))) throw new Error('Configured forum tag is missing');
  if (config.defaultTag && !config.tags.some(t => t.id === config.defaultTag)) throw new Error('Default tag is missing');
  if ((forum.flags & 16) && !config.defaultTag) throw new Error('Forum requires DISCORD_DEFAULT_TAG');
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(config.dataDir, 'run-'));
  const remote = new ReleaseStorage(github, config.releaseTag || 'discord-sync-data');
  let store, heartbeat, checkpointFailed = false;
  const owner = randomUUID();
  let finalResult;
  try {
    await remote.init(apply, initialize);
    const statePath = join(directory, 'state.sqlite');
    await remote.restore(statePath);
    store = new Store(statePath, JSON.stringify([config.repo.toLowerCase(), config.guildId, config.forumId]));
    const checkpoint = async () => {
      if (checkpointFailed) throw new Error('Remote checkpoint failed; all destination writes are paused');
      try { await remote.checkpoint(store, directory); }
      catch { checkpointFailed = true; throw new Error('Remote checkpoint failed; all destination writes are paused'); }
    };
    const guard = () => { if (checkpointFailed) throw new Error('Remote state unavailable'); store.assertLease(owner); };
    if (apply) {
      store.acquire(owner);
      heartbeat = setInterval(() => { try { store.assertLease(owner); store.acquire(owner); } catch { checkpointFailed = true; } }, 10000);
      heartbeat.unref();
      if (retryOperation) {
        if (!store.operation(retryOperation) || store.operation(retryOperation).status === 'done') throw new Error('No pending operation matches the requested retry');
        store.reset(retryOperation);
      }
      // Establish a remote checkpoint even before the first target write on a new installation.
      await checkpoint();
      for (const label of new Set([config.label, ...Object.values(config.tagMap)])) { guard(); await github.ensureLabel(label); }
    }
    const assets = new ReleaseAssets(join(directory, 'assets'), store, remote, { guard });
    const bridge = new Bridge({ config, store, github, discord, assets, apply, guard, checkpoint });
    try {
      finalResult = await bridge.run();
      if (checkpointFailed) throw new Error('State checkpoint failed');
      if (apply) store.set('lastRun', { at: new Date().toISOString(), warnings: finalResult.warnings.length });
      return finalResult;
    } finally {
      clearInterval(heartbeat);
      if (apply && !checkpointFailed) {
        store.release(owner);
        await checkpoint();
        // Delete only obsolete state snapshots, never screenshots. At least three checkpoints remain.
        await remote.prune();
      }
    }
  } finally {
    clearInterval(heartbeat);
    store?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  process.umask(0o077);
  const { values } = parseArgs({ options: { apply: { type: 'boolean' }, initialize: { type: 'boolean' }, 'retry-operation': { type: 'string' }, 'confirm-absent': { type: 'boolean' } } });
  if (values['retry-operation'] && !values['confirm-absent']) throw new Error('Retry requires --confirm-absent after checking the destination');
  if (!process.env.GITHUB_TOKEN || !process.env.DISCORD_TOKEN) throw new Error('GitHub and Discord tokens are required');
  const config = configuration();
  config.releaseTag = process.env.SYNC_RELEASE_TAG || 'discord-sync-data';
  const github = new Github(process.env.GITHUB_TOKEN, config.repo, { actorLogin: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions[bot]' : undefined });
  const discord = new Discord(process.env.DISCORD_TOKEN, config.guildId, config.forumId);
  const result = await runActions({ config, github, discord, apply: values.apply, initialize: values.initialize, retryOperation: values['retry-operation'] });
  await writeFile(join(config.dataDir, 'last-plan.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ mode: values.apply ? 'apply' : 'plan', actions: result.actions.map(({ type, key }) => ({ type, key })), warnings: result.warnings, pending: result.pending }));
  if (result.warnings.length || result.pending.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Workflow sync stopped. Check credentials, repository permissions, and the latest storage checkpoint. No uncertain destination writes will be retried automatically.'); process.exitCode = 1; });
}
