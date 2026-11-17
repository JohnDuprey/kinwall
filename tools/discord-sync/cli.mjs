#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';
import { Store } from './store.mjs';
import { Github, Discord } from './api.mjs';
import { Assets, assetServer } from './assets.mjs';
import { Bridge } from './bridge.mjs';
import { configuration } from './config.mjs';

process.umask(0o077);
const { positionals, values } = parseArgs({ allowPositionals: true, options: { apply: { type: 'boolean' }, 'github-from-gh': { type: 'boolean' }, output: { type: 'string' }, operation: { type: 'string' }, 'confirm-absent': { type: 'boolean' }, help: { type: 'boolean' } } });
const command = positionals[0] || 'plan';
if (values.help) {
  console.log('Usage: node --env-file=/private/bot.env tools/discord-sync/cli.mjs [plan|run|status|retry] [--apply] [--github-from-gh] [--output=/private/plan.json]\nplan is read-only. run requires --apply. retry requires --operation=KEY --confirm-absent.');
} else {
  main().catch(() => { console.error('Bridge stopped. Check configuration, permissions, connectivity, and private plan output. Credentials and remote response bodies are never printed.'); process.exitCode = 1; });
}
async function main() {
  if (!['plan', 'run', 'status', 'retry'].includes(command)) throw new Error('Unknown command');
  if (positionals.length > 1) throw new Error('Unexpected positional argument');
  if (command === 'run' && !values.apply) { console.error('run requires explicit --apply; use plan to preview'); process.exitCode = 1; return; }
  if (command === 'plan' && values.apply) throw new Error('plan refuses --apply');
  const config = configuration();
  const scope = JSON.stringify([config.repo.toLowerCase(), config.guildId, config.forumId]);
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const store = new Store(join(config.dataDir, 'state.db'), scope);
  const owner = randomUUID();
  let heartbeat, server;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (command === 'status') { console.log(JSON.stringify({ linkedThreads: store.entries('thread:').length, pending: store.pending(), lastRun: store.get('lastRun') }, null, 2)); return; }
    if (command === 'retry') {
      if (!values.operation || !values['confirm-absent']) throw new Error('retry requires --operation and --confirm-absent after checking the destination');
      store.acquire(owner); store.reset(values.operation);
      console.log('Pending operation reset; the next reconciliation will check the destination before retrying.'); return;
    }
    const apply = command !== 'plan';
    if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN is missing');
    let githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken && values['github-from-gh']) {
      try { githubToken = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
      catch { throw new Error('GitHub CLI authentication unavailable'); }
    }
    if (!githubToken) { console.error('Set GITHUB_TOKEN, or use --github-from-gh with an authenticated GitHub CLI.'); process.exitCode = 1; return; }
    const github = new Github(githubToken, config.repo);
    const discord = new Discord(process.env.DISCORD_TOKEN, config.guildId, config.forumId);
    const [, forum] = await Promise.all([github.init(), discord.init()]);
    config.tags = forum.available_tags || [];
    if (Object.keys(config.tagMap).some(name => !config.tags.some(t => t.name === name))) throw new Error('SYNC_TAG_MAP includes a tag that does not exist in the forum');
    if (config.defaultTag && !config.tags.some(t => t.id === config.defaultTag)) throw new Error('DISCORD_DEFAULT_TAG is not a tag in this forum');
    if ((forum.flags & 16) && !config.defaultTag) throw new Error('Forum requires a tag: set DISCORD_DEFAULT_TAG to an available tag ID');
    const assets = new Assets(join(config.dataDir, 'assets'), config.assetBase, store);
    if (apply && !config.assetBase) { console.error('Set PUBLIC_ASSET_BASE_URL=https://your-host/assets and deploy the asset endpoint before enabling writes.'); process.exitCode = 1; return; }
    let health = { status: 'warming', lastSuccess: null, warnings: 0 };
    if (apply) {
      store.acquire(owner);
      heartbeat = setInterval(() => { try { store.assertLease(owner); store.acquire(owner); } catch { controller.abort(); } }, 10000);
      heartbeat.unref();
      server = assetServer(assets, () => {
        const stale = health.lastSuccess && Date.now() - Date.parse(health.lastSuccess) > Math.max(180000, config.interval * 3);
        return stale ? { ...health, status: 'stale' } : health;
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
      await assets.verifyPublic();
      for (const label of new Set([config.label, ...Object.values(config.tagMap)])) { store.assertLease(owner); await github.ensureLabel(label); }
    }
    const guard = () => { if (controller.signal.aborted) throw new Error('Bridge is shutting down'); store.assertLease(owner); };
    const bridge = new Bridge({ config, store, github, discord, assets, apply, guard });
    do {
      try {
        const result = await bridge.run();
        const report = { mode: apply ? 'apply' : 'plan', repository: config.repo, forum: config.forumId, at: new Date().toISOString(), ...result };
        const output = values.output ? resolve(values.output) : join(config.dataDir, 'last-plan.json');
        await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
        health = { status: result.warnings.length ? 'degraded' : 'ok', lastSuccess: result.warnings.length ? health.lastSuccess : report.at, warnings: result.warnings.length };
        if (apply) store.set('lastRun', health);
        console.log(JSON.stringify({ mode: report.mode, actions: result.actions.map(({ type, key }) => ({ type, key })), warnings: result.warnings, pending: result.pending }));
        if (command !== 'run' && result.warnings.length) process.exitCode = 1;
      } catch {
        health = { ...health, status: 'degraded' };
        console.error('Reconciliation failed; no uncertain create requests will be retried automatically.');
        if (command !== 'run') { process.exitCode = 1; break; }
      }
      if (command !== 'run' || controller.signal.aborted) break;
      await pause(config.interval, undefined, { signal: controller.signal }).catch(() => {});
    } while (!controller.signal.aborted);
  } finally {
    clearInterval(heartbeat);
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    store.release(owner); store.close();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
