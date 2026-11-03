import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { requestKey } from '../auth.ts';
import { emit } from '../bus.ts';
import { ErrorSchema } from '../schemas.ts';
import { readFeatures } from './settings.ts';
import { AnnouncementInputSchema, AnnouncementPatchSchema, AnnouncementSchema, AnnouncementsSchema, announcementApi, readAnnouncements, type AnnouncementRow } from '../announcements.ts';

export const announcementsRoutes = createRouter();
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const errors = {
  400: { description: 'Invalid title, timestamp or visibility window', ...json(ErrorSchema) },
  403: { description: 'Parents only', ...json(ErrorSchema) },
  404: { description: 'Not found or announcements are turned off', ...json(ErrorSchema) },
};
announcementsRoutes.use('/api/announcements*', async (c, next) => {
  if (!(await readFeatures(c.env.DB)).announcements) return c.json({ error: 'Announcements are turned off in Settings → General → Features.' }, 404);
  await next();
});
announcementsRoutes.openapi(createRoute({
  method: 'get', path: '/api/announcements', tags: ['Announcements'], summary: 'Active Board announcements and the next visibility boundary. Parents may request status=all for scheduled and expired messages.', security: [{ Bearer: [] }],
  request: { query: z.object({ status: z.enum(['active', 'all']).default('active') }) },
  responses: { 200: { description: 'Announcements', ...json(AnnouncementsSchema) }, ...errors },
}), async c => {
  const all = c.req.valid('query').status === 'all';
  if (all && (await requestKey(c))?.scope === 'display') return c.json({ error: 'Only a grown-up can read scheduled and expired announcements.' }, 403);
  return c.json(await readAnnouncements(c.env.DB, all), 200);
});
announcementsRoutes.openapi(createRoute({
  method: 'post', path: '/api/announcements', tags: ['Announcements'], summary: 'Create a scheduled family announcement (parents). Timestamps require UTC or an explicit offset; expiresAt must be after startsAt.', security: [{ Bearer: [] }],
  request: { body: json(AnnouncementInputSchema) }, responses: { 201: { description: 'Created', ...json(AnnouncementSchema) }, ...errors },
}), async c => {
  const input = c.req.valid('json');
  const b = { ...input, startsAt: new Date(input.startsAt).toISOString(), expiresAt: new Date(input.expiresAt).toISOString() };
  if (b.expiresAt <= b.startsAt) return c.json({ error: 'Choose an expiration after the announcement starts.' }, 400);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await c.env.DB.prepare('INSERT INTO announcements (id, title, details, starts_at, expires_at, priority, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, b.title, b.details, b.startsAt, b.expiresAt, b.priority, now, now).run();
  emit(c, 'announcement.changed', { id });
  return c.json({ ...b, id, createdAt: now, updatedAt: now }, 201);
});
announcementsRoutes.openapi(createRoute({
  method: 'patch', path: '/api/announcements/{id}', tags: ['Announcements'], summary: 'Edit a family announcement (parents). The resulting visibility window must be valid.', security: [{ Bearer: [] }],
  request: { params: z.object({ id: z.string() }), body: json(AnnouncementPatchSchema) }, responses: { 200: { description: 'Updated', ...json(AnnouncementSchema) }, ...errors },
}), async c => {
  const id = c.req.valid('param').id;
  const row = await c.env.DB.prepare('SELECT * FROM announcements WHERE id = ?').bind(id).first<AnnouncementRow>();
  if (!row) return c.json({ error: 'Announcement not found.' }, 404);
  const b = { ...announcementApi(row), ...c.req.valid('json'), updatedAt: new Date().toISOString() };
  b.startsAt = new Date(b.startsAt).toISOString();
  b.expiresAt = new Date(b.expiresAt).toISOString();
  if (b.expiresAt <= b.startsAt) return c.json({ error: 'Choose an expiration after the announcement starts.' }, 400);
  await c.env.DB.prepare('UPDATE announcements SET title=?, details=?, starts_at=?, expires_at=?, priority=?, updated_at=? WHERE id=?').bind(b.title, b.details, b.startsAt, b.expiresAt, b.priority, b.updatedAt, id).run();
  emit(c, 'announcement.changed', { id });
  return c.json(b, 200);
});
announcementsRoutes.openapi(createRoute({
  method: 'delete', path: '/api/announcements/{id}', tags: ['Announcements'], summary: 'Delete a family announcement (parents)', security: [{ Bearer: [] }],
  request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Deleted', ...json(z.object({ ok: z.boolean() })) }, ...errors },
}), async c => {
  const id = c.req.valid('param').id;
  const existing = await c.env.DB.prepare('SELECT id FROM announcements WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Announcement not found.' }, 404);
  await c.env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
  emit(c, 'announcement.changed', { id });
  return c.json({ ok: true }, 200);
});
