import type { Env } from './env.ts';
import type { KinwallDb, KinwallStatement } from './db.ts';
import { decrypt } from './crypto.ts';
import { nativeEndpoint } from './push-delivery.ts';
import { sendNativeBackground } from './native-push.ts';

const changes = new Set(['chore.changed', 'chore.completed', 'chore.uncompleted', 'chore.pending', 'chore.rejected', 'settings.changed', 'member.changed']);
export type RoutineRefreshSub = { id: string; auth: string; endpoint: string };

/** Best-effort hint only. Resolve ownership at send time, never from subscription preferences.
 * Disabled policies are included so a parent's Off change can remove an existing restriction. */
export function routineRefreshQuery(db: KinwallDb, type: string, data: unknown): KinwallStatement | null {
  if (!changes.has(type)) return null;
  const target = data && typeof data === 'object' && 'routineMemberId' in data && typeof data.routineMemberId === 'string' ? data.routineMemberId : null;
  return db.prepare(`SELECT s.id,s.auth,s.endpoint FROM push_subscriptions s
    JOIN api_keys k ON k.id=s.api_key_id JOIN members m ON m.id=k.owner
    JOIN routine_mode r ON r.member_id=m.id
    WHERE k.scope='display' AND m.grown_up=0 AND s.endpoint LIKE 'apns:%'
      AND (k.expires_at IS NULL OR k.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND (? IS NULL OR m.id=?)`).bind(target, target);
}

export async function refreshRoutineDevices(env: Env, subscriptions: RoutineRefreshSub[]): Promise<void> {
  await Promise.all(subscriptions.map(async sub => {
    if (!nativeEndpoint(sub.endpoint)) return;
    try {
      const token = await decrypt(env, sub.auth, sub.id);
      if (!/^[a-f0-9]{16,400}$/i.test(token)) return;
      const result = await sendNativeBackground(env, token);
      if (result.gone) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=? AND auth=?').bind(sub.id, sub.auth).run();
    } catch { /* Keep registrations on outages; no token, policy or provider text in logs. */ }
  }));
}
