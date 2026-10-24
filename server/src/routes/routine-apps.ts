import { createRoute, z } from '@hono/zod-openapi';
import { emit } from '../bus.ts';
import type { Context } from 'hono';
import type { Env } from '../env.ts';
import { createRouter } from '../router.ts';
import { deviceOwner, requestKey } from '../auth.ts';
import { encrypt, decrypt } from '../crypto.ts';
import { ErrorSchema } from '../schemas.ts';
import { stored } from '../i18n.ts';

export const routineAppsRoutes = createRouter();
const Params = z.object({ memberId: z.string() });
const Count = z.number().int().min(0).max(10000);
const Revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
const Metadata = z.object({ revision: Revision, selectedApps: Count, selectedCategories: Count, allowedApps: Count, updatedAt: z.string().nullable() });
// Apple tokens remain opaque. Never resolve app names, record them in logs, or return them in device metadata.
const Data = z.string().min(4).max(174764).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).refine(value => { try { return atob(value).length <= 131072; } catch { return false; } });
const Input = z.object({ expectedRevision: Revision, data: Data, selectedApps: Count, selectedCategories: Count, allowedApps: Count }).strict();
const Selection = Metadata.extend({ data: z.string().nullable() });
const Device = z.object({ id: z.string(), name: z.string(), enrolled: z.boolean(), enrollmentPending: z.boolean(), authorized: z.boolean(), appliedRevision: Revision, locked: z.boolean(), lastSeenAt: z.string() });
const Report = z.object({ authorized: z.boolean(), appliedRevision: Revision, locked: z.boolean(), enrollmentRevision: Revision.optional() }).strict();
const errorResponse = { description: 'Invalid or unauthorized routine app request', content: { 'application/json': { schema: ErrorSchema } } };
const errors = { 400: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse };
type Row = { data: string; revision: number; selected_apps: number; selected_categories: number; allowed_apps: number; updated_at: string };
const aad = (memberId: string) => `routine-apps:${memberId}`;
const metadata = (row: Row | null) => ({ revision: row?.revision ?? 0, selectedApps: row?.selected_apps ?? 0, selectedCategories: row?.selected_categories ?? 0, allowedApps: row?.allowed_apps ?? 0, updatedAt: row?.updated_at ?? null });
const selectionRow = (c: Context<{ Bindings: Env }>, memberId: string) => c.env.DB.prepare('SELECT * FROM routine_app_selections WHERE member_id = ?').bind(memberId).first<Row>();
async function canRead(c: Context<{ Bindings: Env }>, memberId: string) {
  return (await requestKey(c))?.scope === 'admin' || await deviceOwner(c) === memberId;
}
async function isChild(c: Context<{ Bindings: Env }>, memberId: string) {
  return !!await c.env.DB.prepare('SELECT id FROM members WHERE id = ? AND grown_up = 0').bind(memberId).first();
}

routineAppsRoutes.openapi(createRoute({ method: 'get', path: '/api/routine-mode/{memberId}/apps', tags: ['Chores'], summary: 'Parent or own child device: receive opaque Apple app choices', security: [{ Bearer: [] }], request: { params: Params }, responses: { 200: { description: 'App choices; revision zero means none saved', content: { 'application/json': { schema: Selection } } }, ...errors } }), async c => {
  const { memberId } = c.req.valid('param');
  if (!await canRead(c, memberId)) return c.json({ error: stored('error', 'This device can only read its own routine.') }, 403);
  if (!await isChild(c, memberId)) return c.json({ error: stored('error', 'Choose a child in your family.') }, 404);
  c.header('Cache-Control', 'no-store');
  const row = await selectionRow(c, memberId);
  return c.json({ ...metadata(row), data: row ? await decrypt(c.env, row.data, aad(memberId)) : null }, 200);
});

routineAppsRoutes.openapi(createRoute({ method: 'put', path: '/api/routine-mode/{memberId}/apps', tags: ['Chores'], summary: 'Parent: save encrypted Apple app choices for one child', security: [{ Bearer: [] }], request: { params: Params, body: { content: { 'application/json': { schema: Input } } } }, responses: { 200: { description: 'Saved revision and counts; no tokens', content: { 'application/json': { schema: Metadata } } }, ...errors } }), async c => {
  if ((await requestKey(c))?.scope !== 'admin') return c.json({ error: stored('error', 'A grown-up must change routine mode.') }, 403);
  const { memberId } = c.req.valid('param'), input = c.req.valid('json');
  if (!await isChild(c, memberId)) return c.json({ error: stored('error', 'Choose a child in your family.') }, 404);
  const row = await selectionRow(c, memberId);
  if ((row?.revision ?? 0) !== input.expectedRevision) return c.json({ error: stored('error', 'App choices changed on another device. Open the picker again.') }, 409);
  const data = await encrypt(c.env, input.data, aad(memberId)), at = new Date().toISOString();
  const result = await c.env.DB.prepare(`INSERT INTO routine_app_selections (member_id, data, revision, selected_apps, selected_categories, allowed_apps, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(member_id) DO UPDATE SET data = excluded.data, revision = routine_app_selections.revision + 1, selected_apps = excluded.selected_apps, selected_categories = excluded.selected_categories, allowed_apps = excluded.allowed_apps, updated_at = excluded.updated_at WHERE routine_app_selections.revision = ?`).bind(memberId, data, input.selectedApps, input.selectedCategories, input.allowedApps, at, input.expectedRevision).run();
  if (!result.meta.changes) return c.json({ error: stored('error', 'App choices changed on another device. Open the picker again.') }, 409);
  emit(c, 'settings.changed', { routineMemberId: memberId });
  c.header('Cache-Control', 'no-store');
  return c.json({ revision: input.expectedRevision + 1, selectedApps: input.selectedApps, selectedCategories: input.selectedCategories, allowedApps: input.allowedApps, updatedAt: at }, 200);
});

routineAppsRoutes.openapi(createRoute({ method: 'get', path: '/api/routine-mode/{memberId}/devices', tags: ['Chores'], summary: 'Parent or own child device: read app-choice delivery status without Apple tokens', security: [{ Bearer: [] }], request: { params: Params }, responses: { 200: { description: 'Saved selection metadata and the child devices reporting it', content: { 'application/json': { schema: z.object({ selection: Metadata.nullable(), devices: z.array(Device) }) } } }, ...errors } }), async c => {
  const { memberId } = c.req.valid('param');
  if (!await canRead(c, memberId)) return c.json({ error: stored('error', 'This device can only read its own routine.') }, 403);
  if (!await isChild(c, memberId)) return c.json({ error: stored('error', 'Choose a child in your family.') }, 404);
  const row = await selectionRow(c, memberId);
  const { results } = await c.env.DB.prepare(`SELECT d.*, k.name, COALESCE(e.enrolled, 1) AS enrolled, (COALESCE(e.revision, 0) != COALESCE(e.acknowledged_revision, 0)) AS enrollment_pending FROM routine_devices d JOIN api_keys k ON k.id = d.key_id LEFT JOIN routine_device_enrollments e ON e.key_id = d.key_id AND e.member_id = d.member_id WHERE d.member_id = ? AND k.owner = ? AND k.scope = 'display' ORDER BY d.last_seen_at DESC`).bind(memberId, memberId).all<{ key_id: string; name: string; enrolled: number; enrollment_pending: number; authorized: number; applied_revision: number; locked: number; last_seen_at: string }>();
  c.header('Cache-Control', 'no-store');
  return c.json({ selection: row ? metadata(row) : null, devices: results.map(d => ({ id: d.key_id, name: d.name, enrolled: !!d.enrolled, enrollmentPending: !!d.enrollment_pending, authorized: !!d.authorized, appliedRevision: d.applied_revision, locked: !!d.locked, lastSeenAt: d.last_seen_at })) }, 200);
});

routineAppsRoutes.openapi(createRoute({ method: 'put', path: '/api/routine-mode/{memberId}/device', tags: ['Chores'], summary: 'Child device: report Screen Time authorization and the app-choice revision applied', security: [{ Bearer: [] }], request: { params: Params, body: { content: { 'application/json': { schema: Report } } } }, responses: { 200: { description: 'Device report saved', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } }, ...errors } }), async c => {
  const { memberId } = c.req.valid('param'), key = await requestKey(c), report = c.req.valid('json');
  if (!key?.id || key.scope !== 'display' || await deviceOwner(c) !== memberId) return c.json({ error: stored('error', 'This device can only check its own routine.') }, 403);
  if (!await isChild(c, memberId)) return c.json({ error: stored('error', 'Choose a child in your family.') }, 404);
  const currentRevision = (await selectionRow(c, memberId))?.revision ?? 0;
  if (report.appliedRevision > currentRevision) return c.json({ error: stored('error', 'App choices have not been saved yet.') }, 400);
  await c.env.DB.prepare(`INSERT INTO routine_devices (key_id, member_id, authorized, applied_revision, locked, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key_id) DO UPDATE SET member_id = excluded.member_id, authorized = excluded.authorized, applied_revision = excluded.applied_revision, locked = excluded.locked, last_seen_at = excluded.last_seen_at`).bind(key.id, memberId, Number(report.authorized), report.appliedRevision, Number(report.locked), new Date().toISOString()).run();
  if (report.enrollmentRevision !== undefined) {
    await c.env.DB.prepare('UPDATE routine_device_enrollments SET acknowledged_revision = ? WHERE key_id = ? AND member_id = ? AND revision = ? AND (enrolled = 1 OR (? = 0 AND ? = 0))').bind(report.enrollmentRevision, key.id, memberId, report.enrollmentRevision, Number(report.authorized), Number(report.locked)).run();
  }
  return c.json({ ok: true }, 200);
});

const Enrollment = z.object({ enrolled: z.boolean() }).strict();
routineAppsRoutes.openapi(createRoute({ method: 'get', path: '/api/routine-mode/{memberId}/device', tags: ['Chores'], summary: 'Child device: read its parent-controlled routine enrollment', security: [{ Bearer: [] }], request: { params: Params }, responses: { 200: { description: 'This device enrollment; missing commands retain enrollment', content: { 'application/json': { schema: Enrollment } } }, ...errors } }), async c => {
  const { memberId } = c.req.valid('param'), key = await requestKey(c);
  if (!key?.id || key.scope !== 'display' || await deviceOwner(c) !== memberId) return c.json({ error: stored('error', 'This device can only check its own routine.') }, 403);
  if (!await isChild(c, memberId)) return c.json({ error: stored('error', 'Choose a child in your family.') }, 404);
  const row = await c.env.DB.prepare('SELECT enrolled FROM routine_device_enrollments WHERE key_id = ? AND member_id = ?').bind(key.id, memberId).first<{ enrolled: number }>();
  c.header('Cache-Control', 'no-store');
  return c.json({ enrolled: row?.enrolled !== 0 }, 200);
});
routineAppsRoutes.openapi(createRoute({ method: 'patch', path: '/api/routine-mode/{memberId}/devices/{deviceId}', tags: ['Chores'], summary: 'Parent: stop or restart routine management for one paired child device', security: [{ Bearer: [] }], request: { params: Params.extend({ deviceId: z.string() }), body: { content: { 'application/json': { schema: Enrollment } } } }, responses: { 200: { description: 'Parent command saved; device applies it on its next check-in', content: { 'application/json': { schema: Enrollment } } }, ...errors } }), async c => {
  if ((await requestKey(c))?.scope !== 'admin') return c.json({ error: stored('error', 'A grown-up must change routine mode.') }, 403);
  const { memberId, deviceId } = c.req.valid('param'), { enrolled } = c.req.valid('json');
  const device = await c.env.DB.prepare("SELECT id FROM api_keys WHERE id = ? AND owner = ? AND scope = 'display'").bind(deviceId, memberId).first();
  if (!device || !await isChild(c, memberId)) return c.json({ error: stored('error', 'Choose a child in your family.') }, 404);
  await c.env.DB.prepare('INSERT INTO routine_device_enrollments (key_id, member_id, enrolled, choices_after_revision) VALUES (?, ?, ?, (SELECT COALESCE(MAX(revision), 0) FROM routine_app_selections WHERE member_id = ?)) ON CONFLICT(key_id) DO UPDATE SET member_id = excluded.member_id, enrolled = excluded.enrolled, revision = routine_device_enrollments.revision + 1, choices_after_revision = CASE WHEN excluded.enrolled = 0 THEN excluded.choices_after_revision ELSE routine_device_enrollments.choices_after_revision END').bind(deviceId, memberId, Number(enrolled), memberId).run();
  emit(c, 'settings.changed', { routineMemberId: memberId });
  c.header('Cache-Control', 'no-store');
  return c.json({ enrolled }, 200);
});
