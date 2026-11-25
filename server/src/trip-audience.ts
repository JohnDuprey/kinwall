// Who may see a trip at all (a trip's audience): a trip for grown-ups only or only some people, a
// surprise, reads as missing to everyone else (trips, polls, away days).
import type { Context } from 'hono';
import type { Env } from './env.ts';
import { requestKey, isConnectedApp } from './auth.ts';

type C = Context<{ Bindings: Env }>;
/** A grown-up's own device or full access; never a wall, a kid's device or a connected app. */
export async function grownUpViewer(c: C): Promise<boolean> {
  if (await isConnectedApp(c)) return false;
  const k = await requestKey(c);
  if (k?.scope === 'admin') return true;
  if (!k?.owner || k.owner === 'shared') return false;
  return !!(
    await c.env.DB.prepare('SELECT grown_up FROM members WHERE id=?')
      .bind(k.owner)
      .first<{ grown_up: number }>()
  )?.grown_up;
}
type Audience = { audience?: string; audienceMemberIds?: string[]; connectedApps?: boolean };
/** Full access sees every trip; walls only everyone trips, connected apps also ones that allow them; a member's own
 * device sees grown-ups-only trips if they're a grown-up, and only-some-people trips if picked. */
async function canSee(c: C): Promise<(t: Audience) => boolean> {
  const open = (t: Audience) => !t.audience || t.audience === 'everyone';
  if (await isConnectedApp(c)) return (t) => open(t) || t.connectedApps === true;
  const k = await requestKey(c);
  if (k?.scope === 'admin') return () => true;
  if (!k?.owner || k.owner === 'shared') return open;
  const owner = k.owner, grownUp = await grownUpViewer(c);
  return (t) => open(t) || (t.audience === 'grownups' ? grownUp : !!t.audienceMemberIds?.includes(owner));
}
export async function tripVisible(c: C, t: Audience): Promise<boolean> {
  return (await canSee(c))(t);
}
/** Trip ids this request may not see at all. */
export async function hiddenTripIds(c: C): Promise<Set<string>> {
  const sees = await canSee(c);
  const rows = (await c.env.DB.prepare("SELECT id, data FROM trips WHERE json_extract(data,'$.audience') IN ('grownups','people')").all<{ id: string; data: string }>()).results;
  return new Set(rows.filter((r) => !sees(JSON.parse(r.data))).map((r) => r.id));
}
