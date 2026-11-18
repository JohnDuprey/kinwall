// The quick-capture inbox: a parent jots a thought down, then sorts it into a task, an event or a
// note on the family board (routes/inbox.ts). Parents only; no health data belongs here.
import { z } from '@hono/zod-openapi';
import type { KinwallDb } from './db.ts';
import { EventInputSchema } from './schemas.ts';

export const InboxTargetSchema = z.object({
  kind: z.enum(['task', 'event', 'note']),
  id: z.string().nullable().openapi({ description: 'The list item, event or announcement; null only if saving it was interrupted' }),
  listId: z.string().optional(),
  label: z.string().optional().openapi({ description: "Tasks: the list's name when it was added" }),
  at: z.string().optional().openapi({ description: "Events: the event's start" }),
}).openapi('InboxTarget');
export const InboxItemSchema = z.object({
  id: z.string(),
  text: z.string().openapi({ description: 'Exactly what was jotted down, kept whatever it becomes' }),
  status: z.enum(['open', 'sorted', 'cleared']),
  target: InboxTargetSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  doneAt: z.string().nullable(),
}).openapi('InboxItem');
export const InboxSchema = z.object({ items: z.array(InboxItemSchema) }).openapi('Inbox');
export const InboxInputSchema = z.object({
  id: z.string().uuid().optional().openapi({ description: 'Client-made: a retried capture adds it once' }),
  text: z.string().trim().min(1).max(200),
}).openapi('InboxInput');
export const InboxPatchSchema = z.object({ status: z.enum(['open', 'cleared']).openapi({ description: 'cleared: not needed (from open); open: put back (from cleared)' }) }).openapi('InboxPatch');
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const InboxSortSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('task'), listId: z.string(), title: z.string().trim().min(1).max(500), dueDate: Day.nullable().optional() }),
  z.object({ kind: z.literal('event'), event: EventInputSchema }),
  z.object({ kind: z.literal('note'), title: z.string().trim().min(1).max(160), details: z.string().trim().max(2000).default(''), expiresAt: z.string().datetime({ offset: true }) }),
]).openapi('InboxSort');

export type InboxItem = z.infer<typeof InboxItemSchema>;
export type InboxRow = { id: string; text: string; status: InboxItem['status']; target: string | null; created_at: string; updated_at: string; done_at: string | null };
export const inboxApi = (r: InboxRow): InboxItem => ({ id: r.id, text: r.text, status: r.status, target: r.target ? JSON.parse(r.target) : null, createdAt: r.created_at, updatedAt: r.updated_at, doneAt: r.done_at });

// ponytail: sorted and cleared rows are kept (tiny); prune past a few months if a family's ever add up.
/** Every open thought, newest first, then the 20 most recently sorted or cleared. */
export async function readInbox(db: KinwallDb, all = false) {
  const open = await db.prepare("SELECT * FROM inbox_items WHERE status = 'open' ORDER BY created_at DESC, id").all<InboxRow>();
  const done = await db.prepare("SELECT * FROM inbox_items WHERE status != 'open' ORDER BY done_at DESC, id LIMIT ?").bind(all ? -1 : 20).all<InboxRow>(); // -1: no limit
  return { items: [...open.results, ...done.results].map(inboxApi) };
}
