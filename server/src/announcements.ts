// Scheduled Board messages are separate from the Newscast feed and calendar events.
import { z } from '@hono/zod-openapi';
import type { KinwallDb } from './db.ts';

const Timestamp = z.string().datetime({ offset: true });
export const AnnouncementInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  details: z.string().trim().max(2000).default(''),
  startsAt: Timestamp,
  expiresAt: Timestamp,
  priority: z.enum(['normal', 'important']).default('normal'),
}).openapi('AnnouncementInput');
export const AnnouncementPatchSchema = AnnouncementInputSchema.extend({ details: z.string().trim().max(2000), priority: z.enum(['normal', 'important']) }).partial().openapi('AnnouncementPatch');
export const AnnouncementSchema = AnnouncementInputSchema.extend({ id: z.string(), createdAt: z.string(), updatedAt: z.string() }).openapi('Announcement');
export const AnnouncementsSchema = z.object({ announcements: z.array(AnnouncementSchema), nextChangeAt: z.string().nullable() }).openapi('Announcements');
export type Announcement = z.infer<typeof AnnouncementSchema>;
export type AnnouncementRow = { id: string; title: string; details: string; starts_at: string; expires_at: string; priority: Announcement['priority']; created_at: string; updated_at: string };
export const announcementApi = (r: AnnouncementRow): Announcement => ({ id: r.id, title: r.title, details: r.details, startsAt: r.starts_at, expiresAt: r.expires_at, priority: r.priority, createdAt: r.created_at, updatedAt: r.updated_at });

const ORDER = "ORDER BY priority = 'important' DESC, starts_at DESC, id";
/** Not yet expired: everything the Board shows or will show. An expired one changes nothing ahead
 * (it started and ended before now), so nextChangeAt is the same as from every row. */
export const CURRENT_ANNOUNCEMENTS_SQL = `SELECT * FROM announcements WHERE expires_at > ? ${ORDER}`;
export async function readAnnouncements(db: KinwallDb, all = false, now = new Date().toISOString()) {
  const query = all ? db.prepare(`SELECT * FROM announcements ${ORDER}`) : db.prepare(CURRENT_ANNOUNCEMENTS_SQL).bind(now);
  const rows = (await query.all<AnnouncementRow>()).results.map(announcementApi);
  const changes = rows.flatMap(a => [a.startsAt, a.expiresAt]).filter(at => at > now).sort();
  return { announcements: all ? rows : rows.filter(a => a.startsAt <= now && now < a.expiresAt), nextChangeAt: changes[0] ?? null };
}
