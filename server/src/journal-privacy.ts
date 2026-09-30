// Private journals (routes/journal.ts "Private journals"): who a journal is private for, and which
// member's private entries a request may read. Kept apart so temp-check.ts and data.ts share it.
import type { Context } from 'hono';
import type { Env } from './env.ts';
import { requestKey } from './auth.ts';
import { isConnectedApp } from './routes/mcp-oauth.ts';

export type PrivacyRow = { name: string; grown_up: number | null; journal_private: number | null; journal_private_allowed: number | null };

/** Whether new entries are private: a grown-up's unless they turned it off; a kid's only when a
 * parent allows it and they turned it on. */
export const privateNow = (m: Omit<PrivacyRow, 'name'>) => (m.grown_up ? m.journal_private !== 0 : !!m.journal_private_allowed && m.journal_private === 1);
/** The Member API's privateJournal. */
export const privacyOf = (m: Omit<PrivacyRow, 'name'>) => ({ on: privateNow(m), allowed: !!m.grown_up || !!m.journal_private_allowed });

/** The member whose private entries this request may read: the owner of its key, when that's a
 * person (not 'shared') and the key isn't a connected app's. A full-access key opens only a
 * grown-up's; an everyday-access key (a paired device, a kid's sign-in) only a kid's, never a
 * grown-up's, even one paired as theirs before that was refused (migration 0066). */
export async function journalOwner(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const key = await requestKey(c);
  if (!key?.owner || key.owner === 'shared' || (await isConnectedApp(c))) return null;
  const m = await c.env.DB.prepare('SELECT grown_up FROM members WHERE id = ?').bind(key.owner).first<{ grown_up: number }>();
  if (!m) return null;
  return (key.scope === 'display') === !m.grown_up ? key.owner : null;
}
