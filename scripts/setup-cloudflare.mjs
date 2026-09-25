#!/usr/bin/env node
// One-command Cloudflare Workers deploy for a fresh clone. Safe to re-run: every step checks what
// already exists first. Uses the repo's pinned wrangler (server/node_modules) for all Cloudflare work.
//
//   node scripts/setup-cloudflare.mjs            interactive, with defaults
//   node scripts/setup-cloudflare.mjs --yes      no prompts; overrides from env: KINWALL_DOMAIN,
//                                                KINWALL_D1_LOCATION, KINWALL_ENCRYPTION_KEY, KINWALL_ADMIN_API_KEY
//   node scripts/setup-cloudflare.mjs --dry-run  print what would run, change nothing
//
// Steps: log in to wrangler -> find or create the D1 database "kinwall" -> write its id (and an
// optional custom domain) into wrangler.toml -> deploy (builds the UI) -> set the ENCRYPTION_KEY,
// ADMIN_API_KEY and PUBLIC_URL secrets -> hit /api/health, which makes the Worker apply its own
// migrations (server/src/migrate.ts). Secrets are piped to wrangler on stdin, never written to disk.
import { spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOML = join(ROOT, 'wrangler.toml');
const WRANGLER = ['npx', '--prefix', 'server', 'wrangler']; // cwd stays the repo root, version stays pinned
const YES = process.argv.includes('--yes');
const DRY = process.argv.includes('--dry-run');
const LOCATIONS = ['enam', 'wnam', 'weur', 'eeur', 'apac', 'oc'];

/** Sets the D1 id and/or custom domain in wrangler.toml text, the same edits scripts/cloudflare-config.sh
 * makes, but replacing earlier values so re-runs don't duplicate lines. Comments and other keys are kept. */
export function editToml(text, { databaseId, domain } = {}) {
  let lines = text.split('\n');
  const insertAfter = (re, add) => {
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) throw new Error(`wrangler.toml: no line matching ${re}`);
    lines.splice(i + 1, 0, ...add);
  };
  if (databaseId) {
    lines = lines.filter((l) => !/^database_(name|id)\s*=/.test(l));
    insertAfter(/^binding = "DB"$/, ['database_name = "kinwall"', `database_id = "${databaseId}"`]);
  }
  if (domain) {
    // Top-level keys must come before the first [table], so they go right after compatibility_flags.
    lines = lines.filter((l) => !/^(routes|workers_dev|preview_urls)\s*=/.test(l));
    insertAfter(/^compatibility_flags/, [`routes = [{ pattern = "${domain}", custom_domain = true }]`, 'workers_dev = false', 'preview_urls = false']);
  }
  return lines.join('\n');
}

export function guessLocation(tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '') {
  if (/^America\/(Los_Angeles|Vancouver|Tijuana|Denver|Phoenix|Boise|Edmonton|Anchorage|Juneau|Whitehorse|Hermosillo|Mazatlan)|^Pacific\/Honolulu/.test(tz)) return 'wnam';
  if (/^(America|Atlantic)\//.test(tz)) return 'enam';
  if (/^Europe\/(Helsinki|Kiev|Kyiv|Riga|Tallinn|Vilnius|Warsaw|Bucharest|Sofia|Athens|Istanbul|Moscow|Minsk|Chisinau|Budapest|Belgrade)/.test(tz)) return 'eeur';
  if (/^(Europe|Africa)\//.test(tz)) return 'weur';
  if (/^(Australia|Pacific)\//.test(tz)) return 'oc';
  if (/^(Asia|Indian)\//.test(tz)) return 'apac';
  return 'enam';
}

// ---- process helpers ----
const say = (msg = '') => console.log(msg);
const step = (msg) => say(`\n== ${msg}`);
const fail = (msg) => { console.error(`\nError: ${msg}`); process.exit(1); };
const show = (args) => say(`  $ ${args.join(' ')}`);

/** Runs wrangler with the terminal attached (login and account prompts work). `input` is piped to stdin. */
function wrangler(args, { input, env } = {}) {
  const cmd = [...WRANGLER, ...args];
  if (DRY) return show(cmd);
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: [input == null ? 'inherit' : 'pipe', 'inherit', 'inherit'], input, env: { ...process.env, ...env } });
  if (r.signal) process.exit(130);
  if (r.status !== 0) fail(`\`wrangler ${args.join(' ')}\` failed (exit ${r.status}).`);
}

/** Runs a read-only wrangler command and parses its JSON stdout; null if it fails. */
function wranglerJson(args, dryValue = null) {
  if (DRY) { show([...WRANGLER, ...args]); return dryValue; }
  try {
    return JSON.parse(execFileSync(WRANGLER[0], [...WRANGLER.slice(1), ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch {
    return null;
  }
}

// On a terminal: a fresh readline per question, closed straight after, so wrangler gets the terminal
// to itself. Piped answers: one shared line reader (separate readers would drop buffered lines).
let piped;
async function ask(question, fallback = '') {
  if (YES) return fallback;
  if (!process.stdin.isTTY) {
    process.stdout.write(`${question}${fallback ? ` [${fallback}]` : ''}: `);
    piped ??= createInterface({ input: process.stdin })[Symbol.asyncIterator]();
    const { value = '' } = await piped.next();
    say(value);
    return value.trim() || fallback;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => { say('\nCancelled.'); process.exit(130); });
  try {
    return (await rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `)).trim() || fallback;
  } finally {
    rl.close();
  }
}
async function confirm(question, fallback) {
  const a = await ask(`${question} (${fallback ? 'Y/n' : 'y/N'})`, '');
  return a ? /^y/i.test(a) : fallback;
}

// ---- steps ----
async function main() {
  if (DRY) say('Dry run: nothing will be changed; wrangler commands are printed instead of run.');

  step('Preflight');
  if (Number(process.versions.node.split('.')[0]) < 24) fail(`Node 24+ is required (this is ${process.version}).`);
  if (!existsSync(join(ROOT, 'server/node_modules/.bin/wrangler'))) {
    say('Installing server dependencies (includes wrangler)...');
    if (DRY) show(['npm', 'ci', '--prefix', 'server']);
    else if (spawnSync('npm', ['ci', '--prefix', 'server'], { cwd: ROOT, stdio: 'inherit' }).status !== 0) fail('npm ci --prefix server failed.');
  }
  wrangler(['--version']);
  let me = wranglerJson(['whoami', '--json'], { accounts: [{ name: '(dry run)', id: '-' }] });
  if (!me?.loggedIn && !DRY) {
    if (YES) fail('Not logged in to Cloudflare. Run `npx --prefix server wrangler login`, or set CLOUDFLARE_API_TOKEN.');
    say('Not logged in to Cloudflare yet; opening the browser to log in.');
    wrangler(['login']);
    me = wranglerJson(['whoami', '--json']);
    if (!me?.loggedIn) fail('Still not logged in.');
  }
  let account = me.accounts?.find((a) => a.id === process.env.CLOUDFLARE_ACCOUNT_ID) ?? me.accounts?.[0];
  if (!process.env.CLOUDFLARE_ACCOUNT_ID && me.accounts?.length > 1) {
    me.accounts.forEach((a, i) => say(`  ${i + 1}. ${a.name} (${a.id})`));
    account = me.accounts[Number(await ask('Which account?', '1')) - 1] ?? fail('No such account.');
  }
  if (account?.id && account.id !== '-') process.env.CLOUDFLARE_ACCOUNT_ID = account.id; // so wrangler never has to ask
  say(`Cloudflare account: ${account?.name ?? 'unknown'}`);

  step('D1 database');
  let toml = readFileSync(TOML, 'utf8');
  const current = toml.match(/^database_id\s*=\s*"([^"]+)"/m)?.[1];
  let dbs = wranglerJson(['d1', 'list', '--json'], []) ?? fail('Could not list D1 databases.');
  let db = dbs.find((d) => d.uuid === current);
  if (db) say(`wrangler.toml already uses "${db.name}" (${db.uuid}).`);
  else {
    if (current) say(`wrangler.toml has database_id ${current}, which isn't in this account.`);
    db = dbs.find((d) => d.name === 'kinwall');
    if (db) say(`Found database "kinwall" (${db.uuid}).`);
    else {
      say('Pick the location nearest you; every query travels there. ' + LOCATIONS.join(' / '));
      const loc = await ask('Location', process.env.KINWALL_D1_LOCATION || guessLocation());
      if (!LOCATIONS.includes(loc)) fail(`Unknown location "${loc}".`);
      wrangler(['d1', 'create', 'kinwall', '--location', loc]);
      dbs = wranglerJson(['d1', 'list', '--json'], [{ name: 'kinwall', uuid: '<new-database-id>' }]) ?? [];
      db = dbs.find((d) => d.name === 'kinwall') ?? fail('Created the database but could not find its id in `wrangler d1 list`.');
    }
    if (current && !(await confirm(`Replace database_id ${current} with ${db.uuid}?`, true))) fail('Leaving wrangler.toml unchanged.');
  }

  step('Domain');
  const existingDomain = toml.match(/^routes\s*=\s*\[\{\s*pattern\s*=\s*"([^"]+)"/m)?.[1];
  say('Optional: a hostname on a zone in this Cloudflare account, e.g. kinwall.example.com. Blank = workers.dev.');
  const domain = (await ask('Custom domain', process.env.KINWALL_DOMAIN || existingDomain || '')).replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  const next = editToml(toml, { databaseId: db.uuid, domain: domain || undefined });
  if (next === toml) say('wrangler.toml is already up to date.');
  else if (DRY) say(`Would set in wrangler.toml:\n${next.split('\n').filter((l) => !toml.split('\n').includes(l)).map((l) => `  ${l}`).join('\n')}`);
  else { writeFileSync(TOML, next); toml = next; say('Updated wrangler.toml (account-specific; keep it out of commits to the shared repo).'); }

  step('Deploy');
  // wrangler writes machine-readable results here; the deploy entry lists the URLs it published to.
  const outFile = join(tmpdir(), `kinwall-deploy-${process.pid}.ndjson`);
  wrangler(['deploy'], { env: { WRANGLER_OUTPUT_FILE_PATH: outFile } });
  const targets = existsSync(outFile)
    ? readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'deploy')?.targets ?? []
    : [];
  rmSync(outFile, { force: true });
  const devUrl = targets.join(' ').match(/https:\/\/\S+\.workers\.dev/)?.[0];
  const url = domain ? `https://${domain}` : devUrl ?? (DRY ? 'https://kinwall.<subdomain>.workers.dev' : fail('Deployed, but could not find the workers.dev URL in the deploy output.'));

  step('Secrets');
  const existing = new Set((wranglerJson(['secret', 'list', '--format', 'json'], []) ?? []).map((s) => s.name));
  const put = (name, value) => wrangler(['secret', 'put', name], { input: value });

  if (existing.has('ENCRYPTION_KEY') && !(await confirm('ENCRYPTION_KEY is set. Replace it? Connected calendar accounts would have to be re-added', false))) say('ENCRYPTION_KEY: keeping the existing one.');
  else {
    say('ENCRYPTION_KEY encrypts calendar credentials. Keep a copy: losing it means re-connecting every calendar account.');
    const key = process.env.KINWALL_ENCRYPTION_KEY || (await ask('Paste an existing key, or press Enter to generate one')) || randomBytes(32).toString('base64');
    if (Buffer.from(key, 'base64').length !== 32) fail('ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).');
    put('ENCRYPTION_KEY', key);
  }

  let adminKey;
  if (existing.has('ADMIN_API_KEY') && !(await confirm('ADMIN_API_KEY is set. Replace it?', false))) say('ADMIN_API_KEY: keeping the existing one.');
  else if (await confirm('Create an ADMIN_API_KEY? It is a permanent admin key and also works as the first-run setup code', true)) {
    adminKey = process.env.KINWALL_ADMIN_API_KEY || `kw_${randomBytes(16).toString('hex')}`;
    put('ADMIN_API_KEY', adminKey);
  }

  // A secret rather than [vars]: it's still env.PUBLIC_URL to the app, and survives later deploys and
  // dashboard git builds without living in wrangler.toml. Not sensitive, so it's re-set on every run.
  put('PUBLIC_URL', url);

  step('Health check');
  // The first request makes the Worker apply server/migrations to D1 (worker.ts -> runMigrations).
  let healthy = false;
  if (DRY) say(`  GET ${url}/api/health`);
  else for (let i = 0; i < 20 && !healthy; i++) {
    healthy = await fetch(`${url}/api/health`).then((r) => r.ok, () => false);
    if (!healthy) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!DRY) say(healthy ? 'Kinwall is up and its database is migrated.' : `No healthy answer from ${url} yet. A new custom domain can take a few minutes; the Worker migrates on the first request that gets through.`);

  say(`\nDone. Kinwall is at ${url}`);
  if (adminKey) say(`\nADMIN_API_KEY (shown once, not saved anywhere; store it in a password manager):\n  ${adminKey}`);
  say('\nNext:');
  say(adminKey || existing.has('ADMIN_API_KEY')
    ? `  1. Open ${url} and enter the ADMIN_API_KEY as the setup code.`
    : `  1. Run \`npx --prefix server wrangler tail\`, then open ${url}: the setup code is printed in the tail on the first visit.`);
  say('  2. Add a passkey when prompted, so you can sign in without the key.');
  say('  3. Settings -> Calendars: connect Google, Microsoft, CalDAV or ICS calendars.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.on('SIGINT', () => { say('\nCancelled.'); process.exit(130); });
  main().then(() => process.exit(0), (err) => fail(err?.message ?? String(err)));
}
