// Activity plugins. A plugin is a small web page (HTML/JS/CSS/images) that shows up under Activities.
//
// Packages, not source: a plugin's GitHub repo builds a `kinwall-plugin.zip` (with
// kinwall-plugin.json at its root) and attaches it to a release; Kinwall installs the latest
// release's package, or one an admin uploads. The files are stored here, so screens never
// contact GitHub.
//
// Trust: the catalog lists reviewed plugins, each pinned to a version and the SHA-256 of its
// package. kinwall.family's admins keep it in their console; self-hosted servers fetch it hourly
// from DEFAULT_CATALOG_URL (or PLUGIN_CATALOG_URL), and a host can hand it over as PLUGIN_CATALOG. A catalog plugin always installs
// and updates to exactly that package, so a repo's new release changes nothing until the catalog is
// bumped. With PLUGINS_CATALOG_ONLY=1 (hosted), nothing else can be installed.
//
// Isolation: files are served from /plugins/<id>/ with their own CSP: `sandbox allow-scripts`
// (an opaque origin: no access to Kinwall's storage, cookies or key), scripts and styles only from
// that plugin's own folder, and connect-src 'none' (no network at all). The web app shows them in
// a sandboxed iframe and answers a small postMessage API (web/src/Plugins.tsx): who's playing,
// the theme, and per-person saved data through the routes below.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import { emit } from '../bus.ts';
import { ErrorSchema } from '../schemas.ts';
import type { KinwallDb } from '../db.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import { todayInTz } from './members.ts';
import { completeChore, DEFAULT_ACTIVITY_MINUTES, dueOnDate, type ChoreRow } from './chores.ts';
import { readZip } from '../zip.ts';
import { blobBytes } from './photos.ts';

export const pluginsRoutes = createRouter();

// Sizes are checked as unpacked bytes, so a small zip can't expand into a big install (a zip bomb),
// and summed per family so plugins can't crowd out photos and the rest of the household's storage.
export const PLUGIN_LIMITS = {
  maxZipBytes: 5 * 1024 * 1024, // the package as downloaded or uploaded
  maxEntries: 1000, // entries in the zip, looked at before anything is unpacked
  maxFiles: 200, // files kept (served types only)
  maxFileBytes: 2 * 1024 * 1024, // one file, unpacked
  maxPluginBytes: 10 * 1024 * 1024, // one plugin's files, unpacked
  maxTotalBytes: 50 * 1024 * 1024, // every plugin's files together, per family
  maxPlugins: 20,
  maxValueBytes: 16 * 1024, // one saved value
  maxKeys: 100, // saved values per person, per plugin
  maxDataBytes: 1024 * 1024, // everything one plugin saves, for everyone together
  maxPlaytimeCall: 60, // seconds one playtime heartbeat can add (the player sends ~30)
  maxPlaytimeDay: 4 * 60 * 60, // seconds counted per person, plugin and day
};
const MANIFEST = 'kinwall-plugin.json';
const PACKAGE_ASSET = 'kinwall-plugin.zip';
export const DEFAULT_CATALOG_URL = 'https://app.kinwall.family/plugins/catalog.json';
const CATALOG_TTL_MS = 60 * 60 * 1000;
const USER_AGENT = 'Kinwall/1.0 (https://kinwall.family; self-hosted family calendar)';

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  json: 'application/json', txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', woff2: 'font/woff2', woff: 'font/woff',
};

export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'id: 2-40 lowercase letters, digits and dashes'),
  name: z.string().trim().min(1).max(40),
  version: z.string().trim().min(1).max(20),
  description: z.string().trim().max(300).default(''),
  entry: z.string().regex(/^[\w./-]+\.html$/, 'entry must be an .html file in the package').default('index.html'),
  emoji: z.string().trim().max(8).default('🧩'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  categories: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
  ages: z.object({ min: z.number().int().min(0).max(18), max: z.number().int().min(0).max(18).optional() }).optional(),
  author: z.string().trim().max(60).optional(),
  homepage: z.string().url().max(200).regex(/^https:\/\//, 'homepage must be an https:// link').optional(),
});
type Manifest = z.infer<typeof PluginManifestSchema>;

const PluginSchema = PluginManifestSchema.extend({
  source: z.string().nullable(), // 'owner/repo' on GitHub, or null for an uploaded package
  enabled: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  url: z.string(), // where the web app loads it: /plugins/<id>/<entry>
}).openapi('Plugin');

export const CatalogEntrySchema = z.object({
  id: z.string(),
  repo: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
  version: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string(),
  description: z.string().default(''),
  emoji: z.string().default('🧩'),
  color: z.string().optional(),
  ages: z.object({ min: z.number(), max: z.number().optional() }).optional(),
  categories: z.array(z.string()).default([]),
}).openapi('PluginCatalogEntry');
type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
const CatalogFileSchema = z.object({ plugins: z.array(z.unknown()) });

const parseEntries = (list: unknown[]) => list.flatMap((p) => { // a bad entry is skipped, not the whole list
  const e = CatalogEntrySchema.safeParse(p);
  return e.success ? [e.data] : [];
});

/** The trusted list: from the host, or fetched and cached for an hour (the last good copy is used while the source is unreachable). */
async function loadCatalog(env: Env): Promise<CatalogEntry[]> {
  if (env.PLUGIN_CATALOG) return parseEntries(await env.PLUGIN_CATALOG());
  const db = env.DB;
  const key = 'plugins:catalog';
  const row = await db.prepare('SELECT fetched_at, body FROM weather_cache WHERE key = ?').bind(key).first<{ fetched_at: string; body: string }>();
  const cached = row ? (JSON.parse(row.body) as CatalogEntry[]) : [];
  if (row && Date.now() - Date.parse(row.fetched_at) < CATALOG_TTL_MS) return cached;
  let fresh: CatalogEntry[];
  try {
    const res = await fetch(env.PLUGIN_CATALOG_URL || DEFAULT_CATALOG_URL, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`catalog answered ${res.status}`);
    fresh = parseEntries(CatalogFileSchema.parse(await res.json()).plugins);
  } catch (err) {
    console.error('plugin catalog fetch failed', err instanceof Error ? err.message : err);
    // Keep the last good copy and try again in an hour; with none yet, store nothing and retry next time.
    if (row) await db.prepare('UPDATE weather_cache SET fetched_at = ? WHERE key = ?').bind(new Date().toISOString(), key).run();
    return cached;
  }
  await db
    .prepare('INSERT INTO weather_cache (key, fetched_at, body) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, body = excluded.body')
    .bind(key, new Date().toISOString(), JSON.stringify(fresh))
    .run();
  return fresh;
}

const catalogOnly = (env: Env) => env.PLUGINS_CATALOG_ONLY === '1';
const inCatalog = (catalog: CatalogEntry[], repo: string) => catalog.find((e) => e.repo.toLowerCase() === repo.toLowerCase());

export async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The package for a repo: a catalog plugin's pinned release (checked against its hash), else the latest. */
async function packageFor(env: Env, repo: string): Promise<{ zip: Uint8Array; entry?: CatalogEntry }> {
  const entry = inCatalog(await loadCatalog(env), repo);
  if (!entry) {
    if (catalogOnly(env)) throw new NotInCatalogError();
    return { zip: await fetchPackage(repo) };
  }
  const zip = await fetchPackage(entry.repo, `v${entry.version}`);
  if ((await sha256(zip)) !== entry.sha256) throw new PackageError(`${entry.name} v${entry.version} on GitHub doesn't match the reviewed package, so it wasn't installed.`);
  return { zip, entry };
}

type Row = { id: string; manifest: string; source: string | null; enabled: number; installed_at: string; updated_at: string };
const toApi = (r: Row): z.infer<typeof PluginSchema> => {
  const m = JSON.parse(r.manifest) as Manifest;
  return { ...m, source: r.source, enabled: !!r.enabled, installedAt: r.installed_at, updatedAt: r.updated_at, url: `/plugins/${r.id}/${m.entry}` };
};

export class PackageError extends Error {}
const NOT_IN_CATALOG = 'Only activities from the Kinwall catalog can be added here.';
class NotInCatalogError extends PackageError { constructor() { super(NOT_IN_CATALOG); } }

/** Unpacks and checks a plugin package; files keyed by their path inside the plugin. Exported for hosts' review consoles. */
export async function unpack(zip: Uint8Array): Promise<{ manifest: Manifest; files: { path: string; mime: string; data: Uint8Array }[] }> {
  if (zip.byteLength > PLUGIN_LIMITS.maxZipBytes) throw new PackageError(`The package can be at most ${PLUGIN_LIMITS.maxZipBytes / 1048576} MB`);
  let entries;
  try {
    entries = readZip(zip, PLUGIN_LIMITS.maxFileBytes);
  } catch (e) {
    throw new PackageError(e instanceof Error ? e.message : 'Not a zip file');
  }
  if (entries.length > PLUGIN_LIMITS.maxEntries) throw new PackageError(`A package can hold at most ${PLUGIN_LIMITS.maxEntries} entries`);
  entries = entries.filter((e) => !e.name.endsWith('/') && !e.name.startsWith('__MACOSX/') && !/(^|\/)\.[^/]*$/.test(e.name));
  // A package zipped with its folder ("sight-words/kinwall-plugin.json") works too.
  const top = entries.every((e) => e.name.includes('/')) && new Set(entries.map((e) => e.name.split('/')[0])).size === 1 ? `${entries[0].name.split('/')[0]}/` : '';
  const files: { path: string; mime: string; data: Uint8Array }[] = [];
  let manifestBytes: Uint8Array | null = null;
  let total = 0;
  for (const e of entries) {
    const path = e.name.slice(top.length);
    if (!path || path.split('/').some((p) => p === '..' || p === '') || path.startsWith('/')) throw new PackageError(`Unsafe path in the package: ${e.name}`);
    const mime = MIME[path.split('.').pop()!.toLowerCase()];
    if (!mime) continue; // READMEs, licenses and source maps aren't served, so they aren't even unpacked
    // Unpacking stops at the cap (the sizes a zip declares can lie).
    const cap = Math.min(PLUGIN_LIMITS.maxFileBytes, PLUGIN_LIMITS.maxPluginBytes - total);
    const data = await e.read(cap);
    if (!data) throw new PackageError(cap < PLUGIN_LIMITS.maxFileBytes
      ? `A plugin's files can add up to at most ${PLUGIN_LIMITS.maxPluginBytes / 1048576} MB unpacked`
      : `${path} is larger than ${PLUGIN_LIMITS.maxFileBytes / 1048576} MB unpacked`);
    total += data.length;
    if (path === MANIFEST) manifestBytes = data;
    files.push({ path, mime, data });
    if (files.length > PLUGIN_LIMITS.maxFiles) throw new PackageError(`A package can hold at most ${PLUGIN_LIMITS.maxFiles} files`);
  }
  if (!manifestBytes) throw new PackageError(`The package has no ${MANIFEST} at its top level`);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new PackageError(`${MANIFEST} isn't valid JSON`);
  }
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) throw new PackageError(`${MANIFEST}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'manifest'} ${i.message}`).join('; ')}`);
  if (!files.some((f) => f.path === parsed.data.entry)) throw new PackageError(`The entry page ${parsed.data.entry} isn't in the package`);
  return { manifest: parsed.data, files };
}

async function install(db: KinwallDb, zip: Uint8Array, source: string | null, entry?: CatalogEntry): Promise<Row> {
  const { manifest, files } = await unpack(zip);
  if (entry && (manifest.id !== entry.id || manifest.version !== entry.version)) throw new PackageError(`The package is ${manifest.id} v${manifest.version}, not the catalog's ${entry.id} v${entry.version}`);
  const existing = await db.prepare('SELECT source FROM plugins WHERE id = ?').bind(manifest.id).first<{ source: string | null }>();
  if (!existing) {
    const count = (await db.prepare('SELECT COUNT(*) AS n FROM plugins').first<{ n: number }>())?.n ?? 0;
    if (count >= PLUGIN_LIMITS.maxPlugins) throw new PackageError(`A family can have at most ${PLUGIN_LIMITS.maxPlugins} plugins`);
  }
  // The family's total, not counting the files this install replaces.
  const others = (await db.prepare('SELECT COALESCE(SUM(LENGTH(data)), 0) AS n FROM plugin_files WHERE plugin_id != ?').bind(manifest.id).first<{ n: number }>())?.n ?? 0;
  if (others + files.reduce((n, f) => n + f.data.length, 0) > PLUGIN_LIMITS.maxTotalBytes)
    throw new PackageError(`All plugins together can take at most ${PLUGIN_LIMITS.maxTotalBytes / 1048576} MB. Remove one to make room.`);
  const now = new Date().toISOString();
  // Updating keeps its on/off state and everyone's saved data; the files are replaced wholesale.
  await db.batch([
    db
      .prepare(
        `INSERT INTO plugins (id, name, version, manifest, source, enabled, installed_at, updated_at) VALUES (?,?,?,?,?,1,?,?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version, manifest = excluded.manifest, source = COALESCE(excluded.source, plugins.source), updated_at = excluded.updated_at`,
      )
      .bind(manifest.id, manifest.name, manifest.version, JSON.stringify(manifest), source, now, now),
    db.prepare('DELETE FROM plugin_files WHERE plugin_id = ?').bind(manifest.id),
    ...files.map((f) => db.prepare('INSERT INTO plugin_files (plugin_id, path, mime, data) VALUES (?,?,?,?)').bind(manifest.id, f.path, f.mime, f.data)),
  ]);
  return (await db.prepare('SELECT * FROM plugins WHERE id = ?').bind(manifest.id).first<Row>())!;
}

/** 'owner/repo' from a GitHub URL ("https://github.com/owner/repo", with or without /releases etc.). */
export function githubRepo(url: string): string | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:\/.*)?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The kinwall-plugin.zip of a repo's latest release, or of the release tagged `tag`. */
export async function fetchPackage(repo: string, tag?: string): Promise<Uint8Array> {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' };
  const rel = await fetch(`https://api.github.com/repos/${repo}/releases/${tag ? `tags/${encodeURIComponent(tag)}` : 'latest'}`, { headers, signal: AbortSignal.timeout(10000) });
  if (rel.status === 404) throw new PackageError(tag ? `${repo} has no ${tag} release.` : `${repo} has no releases yet. Its GitHub release needs a ${PACKAGE_ASSET} attached.`);
  if (!rel.ok) throw new PackageError(`GitHub answered ${rel.status} for ${repo}`);
  const body = (await rel.json()) as { assets?: { name: string; size: number; browser_download_url: string }[] };
  const asset = body.assets?.find((a) => a.name === PACKAGE_ASSET);
  if (!asset) throw new PackageError(`The latest release of ${repo} has no ${PACKAGE_ASSET}. Plugins are installed from a built package, not source.`);
  if (asset.size > PLUGIN_LIMITS.maxZipBytes) throw new PackageError(`The package can be at most ${PLUGIN_LIMITS.maxZipBytes / 1048576} MB`);
  // Only GitHub's own download link (it redirects to GitHub's file storage), never another host.
  if (!asset.browser_download_url.toLowerCase().startsWith(`https://github.com/${repo}/releases/download/`.toLowerCase())) throw new PackageError(`Unexpected download link for ${PACKAGE_ASSET}`);
  const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
  if (!res.ok || !res.body) throw new PackageError(`Downloading ${PACKAGE_ASSET} failed (${res.status})`);
  // Stop at the limit while downloading, whatever size the release listed.
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const part of res.body) {
    size += part.length;
    if (size > PLUGIN_LIMITS.maxZipBytes) throw new PackageError(`The package can be at most ${PLUGIN_LIMITS.maxZipBytes / 1048576} MB`);
    parts.push(part);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const errors = { 400: { description: 'bad package', content: json(ErrorSchema) }, 403: { description: 'not in the catalog (PLUGINS_CATALOG_ONLY)', content: json(ErrorSchema) }, 404: { description: 'not found', content: json(ErrorSchema) } };
const IdParam = z.object({ id: z.string() });

pluginsRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/plugins/catalog', tags: ['Plugins'], security: [{ Bearer: [] }],
    summary: 'The trusted plugins this server offers, each pinned to a reviewed version, and whether only these can be installed. Admin only.',
    responses: { 200: { description: 'ok', content: json(z.object({ catalogOnly: z.boolean(), plugins: z.array(CatalogEntrySchema) })) } },
  }),
  async (c) => c.json({ catalogOnly: catalogOnly(c.env), plugins: await loadCatalog(c.env) }, 200),
);

pluginsRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/plugins', tags: ['Plugins'], security: [{ Bearer: [] }],
    summary: 'Installed activity plugins, with whether each is on (the app lists only the ones that are on under Activities).',
    responses: { 200: { description: 'ok', content: json(z.array(PluginSchema)) } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM plugins ORDER BY name COLLATE NOCASE').all<Row>();
    return c.json(results.map(toApi), 200);
  },
);

pluginsRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/plugins', tags: ['Plugins'], security: [{ Bearer: [] }],
    summary: `Install (or update) a plugin: JSON { url } for a GitHub repo, or the package itself as application/zip. A catalog plugin installs its reviewed version; any other repo its latest release's ${PACKAGE_ASSET}. With PLUGINS_CATALOG_ONLY, only catalog plugins (403 otherwise). Admin only.`,
    // The body is either JSON or a zip, so it's parsed by hand below rather than declared here
    // (a declared JSON schema would be checked against the zip too).
    responses: { 201: { description: 'installed', content: json(PluginSchema) }, ...errors },
  }),
  async (c) => {
    const type = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    try {
      let row: Row;
      if (type === 'application/zip' || type === 'application/x-zip-compressed') {
        if (catalogOnly(c.env)) throw new NotInCatalogError();
        if (Number(c.req.header('Content-Length')) > PLUGIN_LIMITS.maxZipBytes) throw new PackageError(`The package can be at most ${PLUGIN_LIMITS.maxZipBytes / 1048576} MB`);
        row = await install(c.env.DB, new Uint8Array(await c.req.arrayBuffer()), null);
      } else {
        const { url } = (await c.req.json().catch(() => ({}))) as { url?: string };
        const repo = typeof url === 'string' ? githubRepo(url) : null;
        if (!repo) return c.json({ error: 'Paste a GitHub repository link, like https://github.com/owner/kinwall-plugin-name' }, 400);
        const { zip, entry } = await packageFor(c.env, repo);
        row = await install(c.env.DB, zip, entry?.repo ?? repo, entry);
      }
      emit(c, 'settings.changed', {});
      return c.json(toApi(row), 201);
    } catch (e) {
      if (e instanceof NotInCatalogError) return c.json({ error: e.message }, 403);
      if (e instanceof PackageError) return c.json({ error: e.message }, 400);
      throw e;
    }
  },
);

pluginsRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/plugins/{id}/update', tags: ['Plugins'], security: [{ Bearer: [] }],
    summary: "Reinstall a plugin from GitHub (its saved data is kept): a catalog plugin's reviewed version, else the latest release. Admin only.",
    request: { params: IdParam },
    responses: { 200: { description: 'updated', content: json(PluginSchema) }, ...errors },
  }),
  async (c) => {
    const row = await c.env.DB.prepare('SELECT * FROM plugins WHERE id = ?').bind(c.req.valid('param').id).first<Row>();
    if (!row) return c.json({ error: 'plugin not found' }, 404);
    if (!row.source) return c.json({ error: 'This plugin was uploaded; upload the new package to update it.' }, 400);
    try {
      const { zip, entry } = await packageFor(c.env, row.source);
      const next = await install(c.env.DB, zip, row.source, entry);
      if (next.id !== row.id) return c.json({ error: `The package's id changed to ${next.id}` }, 400);
      emit(c, 'settings.changed', {});
      return c.json(toApi(next), 200);
    } catch (e) {
      if (e instanceof NotInCatalogError) return c.json({ error: e.message }, 403);
      if (e instanceof PackageError) return c.json({ error: e.message }, 400);
      throw e;
    }
  },
);

pluginsRoutes.openapi(
  createRoute({
    method: 'patch', path: '/api/plugins/{id}', tags: ['Plugins'], security: [{ Bearer: [] }],
    summary: 'Turn a plugin on or off (off hides it from Activities; nothing is deleted). Admin only.',
    request: { params: IdParam, body: { required: true, content: { 'application/json': { schema: z.object({ enabled: z.boolean() }) } } } },
    responses: { 200: { description: 'ok', content: json(PluginSchema) }, 404: errors[404] },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await c.env.DB.prepare('UPDATE plugins SET enabled = ? WHERE id = ?').bind(c.req.valid('json').enabled ? 1 : 0, id).run();
    const row = await c.env.DB.prepare('SELECT * FROM plugins WHERE id = ?').bind(id).first<Row>();
    if (!row) return c.json({ error: 'plugin not found' }, 404);
    emit(c, 'settings.changed', {});
    return c.json(toApi(row), 200);
  },
);

pluginsRoutes.openapi(
  createRoute({
    method: 'delete', path: '/api/plugins/{id}', tags: ['Plugins'], security: [{ Bearer: [] }],
    summary: 'Remove a plugin, its files and everything it saved. Admin only.',
    request: { params: IdParam },
    responses: { 204: { description: 'removed' }, 404: errors[404] },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.env.DB;
    if (!(await db.prepare('SELECT 1 FROM plugins WHERE id = ?').bind(id).first())) return c.json({ error: 'plugin not found' }, 404);
    await db.batch([
      db.prepare('DELETE FROM plugin_data WHERE plugin_id = ?').bind(id),
      db.prepare('DELETE FROM plugin_playtime WHERE plugin_id = ?').bind(id),
      db.prepare('DELETE FROM plugin_files WHERE plugin_id = ?').bind(id),
      db.prepare('DELETE FROM plugins WHERE id = ?').bind(id),
    ]);
    emit(c, 'settings.changed', {});
    return c.body(null, 204);
  },
);

// Per-person saved data. The web app calls these on a plugin's behalf (plugins have no key and no
// network); `member` '' is the family's shared data.
const DataQuery = z.object({ member: z.string().default('') });
pluginsRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/plugins/{id}/data', tags: ['Plugins'], security: [{ Bearer: [] }],
    summary: "Everything a plugin saved for one person (member='' = shared), as { key: value }.",
    request: { params: IdParam, query: DataQuery },
    responses: { 200: { description: 'ok', content: json(z.record(z.string(), z.unknown())) } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT key, value FROM plugin_data WHERE plugin_id = ? AND member_id = ?')
      .bind(c.req.valid('param').id, c.req.valid('query').member)
      .all<{ key: string; value: string }>();
    return c.json(Object.fromEntries(results.map((r) => [r.key, JSON.parse(r.value)])), 200);
  },
);

pluginsRoutes.openapi(
  createRoute({
    method: 'put', path: '/api/plugins/{id}/data', tags: ['Plugins'], security: [{ Bearer: [] }],
    summary: `Save one value for a plugin (per person, or shared with member ''); value null deletes it. At most ${PLUGIN_LIMITS.maxKeys} keys per person and ${PLUGIN_LIMITS.maxValueBytes / 1024} KB per value.`,
    request: { params: IdParam, body: { required: true, content: { 'application/json': { schema: z.object({ member: z.string().default(''), key: z.string().min(1).max(64), value: z.unknown() }) } } } },
    responses: { 204: { description: 'saved' }, 400: errors[400], 404: errors[404] },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { member, key, value } = c.req.valid('json');
    const db = c.env.DB;
    if (!(await db.prepare('SELECT 1 FROM plugins WHERE id = ?').bind(id).first())) return c.json({ error: 'plugin not found' }, 404);
    if (member && !(await db.prepare('SELECT 1 FROM members WHERE id = ?').bind(member).first())) return c.json({ error: 'member not found' }, 404);
    if (value === null || value === undefined) {
      await db.prepare('DELETE FROM plugin_data WHERE plugin_id = ? AND member_id = ? AND key = ?').bind(id, member, key).run();
      return c.body(null, 204);
    }
    const text = JSON.stringify(value);
    if (text.length > PLUGIN_LIMITS.maxValueBytes) return c.json({ error: `A saved value can be at most ${PLUGIN_LIMITS.maxValueBytes / 1024} KB` }, 400);
    const count = (await db.prepare('SELECT COUNT(*) AS n FROM plugin_data WHERE plugin_id = ? AND member_id = ? AND key != ?').bind(id, member, key).first<{ n: number }>())?.n ?? 0;
    if (count >= PLUGIN_LIMITS.maxKeys) return c.json({ error: `A plugin can save at most ${PLUGIN_LIMITS.maxKeys} values per person` }, 400);
    const used = (await db.prepare('SELECT COALESCE(SUM(LENGTH(value)), 0) AS n FROM plugin_data WHERE plugin_id = ? AND NOT (member_id = ? AND key = ?)').bind(id, member, key).first<{ n: number }>())?.n ?? 0;
    if (used + text.length > PLUGIN_LIMITS.maxDataBytes) return c.json({ error: `A plugin can save at most ${PLUGIN_LIMITS.maxDataBytes / 1048576} MB for the whole family` }, 400);
    await db
      .prepare('INSERT INTO plugin_data (plugin_id, member_id, key, value, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(plugin_id, member_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .bind(id, member, key, text, new Date().toISOString())
      .run();
    return c.body(null, 204);
  },
);

// Activity chores ("5 min of Sight words"). Kinwall times play, not the plugin: the player counts
// seconds while its page is visible and the plugin saved progress in the last two minutes, and sends
// them here every ~30 s. The day's total (household timezone) completes that person's linked chores
// due today, through the same path as a tick, once each.
const ActivityChoreProgressSchema = z.object({
  choreId: z.string(),
  title: z.string(),
  emoji: z.string().nullable(),
  needSeconds: z.number(),
  doneSeconds: z.number(),
  completed: z.boolean(),
  justCompleted: z.boolean().openapi({ description: 'This call completed it.' }),
}).openapi('ActivityChoreProgress');
pluginsRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/plugins/{id}/playtime', tags: ['Plugins'], security: [{ Bearer: [] }],
    summary: `Add seconds of active play for one person (at most ${PLUGIN_LIMITS.maxPlaytimeCall} per call, ${PLUGIN_LIMITS.maxPlaytimeDay / 3600} hours a day) and complete their chores linked to this plugin that are due today once the day's play reaches them. seconds 0 just reads the progress. Returns that person's linked chores due today.`,
    request: { params: IdParam, body: { required: true, content: { 'application/json': { schema: z.object({ member: z.string().min(1), seconds: z.number().min(0) }) } } } },
    responses: { 200: { description: 'ok', content: json(z.array(ActivityChoreProgressSchema)) }, 404: errors[404] },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { member, seconds } = c.req.valid('json');
    const db = c.env.DB;
    const [pluginRes, memberRes, tzRes] = await db.batch<unknown>([
      db.prepare('SELECT 1 FROM plugins WHERE id = ? AND enabled = 1').bind(id),
      db.prepare('SELECT 1 FROM members WHERE id = ?').bind(member),
      db.prepare("SELECT value FROM settings WHERE key = 'timezone'"),
    ]);
    if (!pluginRes.results.length) return c.json({ error: 'plugin not found' }, 404);
    if (!memberRes.results.length) return c.json({ error: 'member not found' }, 404);
    const tz = (tzRes.results[0] as { value: string } | undefined)?.value ?? hostTimezone();
    const today = todayInTz(tz);
    const add = Math.min(Math.floor(seconds), PLUGIN_LIMITS.maxPlaytimeCall);
    if (add > 0) {
      await db
        .prepare('INSERT INTO plugin_playtime (date, member_id, plugin_id, seconds) VALUES (?,?,?,?) ON CONFLICT(date, member_id, plugin_id) DO UPDATE SET seconds = MIN(plugin_playtime.seconds + excluded.seconds, ?)')
        .bind(today, member, id, add, PLUGIN_LIMITS.maxPlaytimeDay)
        .run();
    }
    const [playRes, choresRes, doneRes] = await db.batch<unknown>([
      db.prepare('SELECT seconds FROM plugin_playtime WHERE date = ? AND member_id = ? AND plugin_id = ?').bind(today, member, id),
      // Theirs, and Anyone chores (whoever gets there first earns those).
      db.prepare('SELECT * FROM chores WHERE active = 1 AND plugin_id = ? AND (member_id = ? OR member_id IS NULL) ORDER BY sort, created_at').bind(id, member),
      db.prepare('SELECT chore_id FROM chore_completions WHERE date = ?').bind(today),
    ]);
    const total = Number((playRes.results[0] as { seconds: number } | undefined)?.seconds ?? 0);
    const done = new Set((doneRes.results as { chore_id: string }[]).map((r) => r.chore_id));
    const out: z.infer<typeof ActivityChoreProgressSchema>[] = [];
    for (const ch of (choresRes.results as unknown as ChoreRow[]).filter((r) => dueOnDate(r, today, tz))) {
      const needSeconds = (ch.plugin_minutes ?? DEFAULT_ACTIVITY_MINUTES) * 60;
      let completed = done.has(ch.id);
      let justCompleted = false;
      if (!completed && total >= needSeconds) {
        // onlyIfNew: a completion that landed meanwhile (a tick, another heartbeat) stays as it is.
        const r = await completeChore(c, ch.id, today, member, true);
        justCompleted = r === true;
        completed = r === true || r === false; // a number = its checklist isn't finished yet
      }
      out.push({ choreId: ch.id, title: ch.title, emoji: ch.emoji, needSeconds, doneSeconds: Math.min(total, needSeconds), completed, justCompleted });
    }
    return c.json(out, 200);
  },
);

/** The CSP a plugin's files are served with (see the top of this file). */
export function pluginCsp(origin: string, id: string): string {
  const own = `${origin}/plugins/${id}/`;
  return [
    'sandbox allow-scripts',
    "default-src 'none'",
    `script-src ${own} 'unsafe-inline'`, // inline is harmless here: the page is sandboxed and offline
    `style-src ${own} 'unsafe-inline'`,
    `img-src ${own} data: blob:`,
    `media-src ${own} data: blob:`,
    `font-src ${own} data:`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${origin}`, // not 'self': in the sandbox that's the page's own opaque origin, which no parent matches
  ].join('; ');
}

/** GET /plugins/<id>/<path>: a plugin's files (no key: iframes can't send one, and packages are public code). */
export async function servePluginFile(c: Context<{ Bindings: Env }>): Promise<Response> {
  const m = /^\/plugins\/([a-z0-9-]+)\/(.+)$/.exec(c.req.path);
  if (!m) return c.notFound();
  const [, id, raw] = m;
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return c.notFound(); // a malformed %-escape
  }
  const row = await c.env.DB.prepare(
    'SELECT f.mime, f.data FROM plugin_files f JOIN plugins p ON p.id = f.plugin_id WHERE f.plugin_id = ? AND f.path = ? AND p.enabled = 1',
  )
    .bind(id, path)
    .first<{ mime: string; data: unknown }>();
  if (!row) return c.notFound();
  return new Response(blobBytes(row.data), {
    headers: {
      'Content-Type': row.mime,
      'Content-Security-Policy': pluginCsp(new URL(c.req.url).origin, id),
      'Cache-Control': 'no-cache', // an update replaces the files under the same names
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      // No Cross-Origin-Resource-Policy: the sandboxed page's own requests for its files come from an
      // opaque origin, so 'same-origin' would block them.
    },
  });
}
