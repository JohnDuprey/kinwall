import type { KinwallDb } from './db.ts';
import { apnsConfigured } from './apns.ts';
import type { NativePushEnv } from './native-push.ts';
import { seal, unseal } from './crypto.ts';
import { sha256Hex } from './auth.ts';
import { nativeEndpoint } from './push-delivery.ts';

type Env = NativePushEnv & { DB: KinwallDb };
type Sub = { id: string; endpoint: string; auth: string; prefs: string; member_ids: string; lang: string; gateway_credential?: string | null; delivery_owner?: string | null; delivery_scope?: string | null };
type Payload = { title: string; body: string; url?: string; tag?: string };
type Pending = { version: string; destination: string; payload: Payload; notBefore: number; expiresAt: number };
type Row = { id: string; subscription_id: string; payload: string; attempts: number };
const destination = (s: Sub) => sha256Hex(JSON.stringify([s.endpoint, s.auth, s.prefs, s.member_ids, s.lang, s.delivery_owner, s.delivery_scope]));
const aad = (id: string) => `push-retry:${id}`;

/** The scheduler's dose claim stays intact. Only a failed gateway destination gets a retry;
 * successful sibling devices and the household feed are never replayed. */
export async function enqueueMedicinePush(env: Env, sub: Sub, payload: Payload, version: string, now: number): Promise<void> {
  if (env.NATIVE_PUSH_SEND || apnsConfigured(env) || !nativeEndpoint(sub.endpoint) || !sub.gateway_credential) return;
  const id = await sha256Hex(JSON.stringify([sub.id, version, payload]));
  const pending: Pending = { version, destination: await destination(sub), payload, notBefore: now + 60000, expiresAt: now + 10 * 60000 };
  await env.DB.prepare('INSERT INTO push_retries(id,subscription_id,payload) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING')
    .bind(id, sub.id, await seal(env, JSON.stringify(pending), aad(id))).run();
}

/** A changed dose log, schedule, recipient or privacy preference cancels the pending text.
 * Two further attempts at most, within ten minutes. Ambiguous transport failures may duplicate
 * a provider-accepted message; APNs acceptance is never treated as device delivery. */
export async function retryMedicinePushes<T extends Sub>(env: Env, subs: T[], version: string, now: number,
  send: (sub: T, payload: Payload) => Promise<{ ok: boolean; gone?: boolean }>): Promise<void> {
  const { results } = await env.DB.prepare('SELECT * FROM push_retries ORDER BY rowid LIMIT 50').all<Row>();
  for (const row of results) {
    const discard = () => env.DB.prepare('DELETE FROM push_retries WHERE id=?').bind(row.id).run();
    let pending: Pending;
    try { pending = JSON.parse(await unseal(env, row.payload, aad(row.id))); }
    catch { await discard(); continue; }
    const sub = subs.find(s => s.id === row.subscription_id);
    if (!sub || pending.version !== version || pending.expiresAt <= now || row.attempts >= 2 || pending.destination !== await destination(sub)) {
      await discard(); continue;
    }
    if (pending.notBefore > now) continue;
    // Claim before the transport so concurrent ticks do not replay the same attempt.
    pending.notBefore = now + 60000;
    const claimed = await env.DB.prepare('UPDATE push_retries SET attempts=attempts+1,payload=? WHERE id=? AND attempts=? RETURNING id')
      .bind(await seal(env, JSON.stringify(pending), aad(row.id)),row.id, row.attempts).first();
    if (!claimed) continue;
    let result: { ok: boolean; gone?: boolean };
    try { result = await send(sub, pending.payload); }
    catch { result = { ok: false }; }
    if (result.ok || result.gone || row.attempts + 1 >= 2) await discard();
  }
}

/** Pending retry times remain sealed; a host can fold their earliest deadline into its alarm. */
export async function nextMedicinePushRetryAt(env: Env, now: number, before: number): Promise<number | null> {
  const { results } = await env.DB.prepare('SELECT * FROM push_retries ORDER BY rowid LIMIT 50').all<Row>();
  let next: number | null = null;
  for (const row of results) {
    if (row.attempts >= 2) continue;
    try {
      const pending: Pending = JSON.parse(await unseal(env, row.payload, aad(row.id)));
      if (pending.expiresAt <= now || !Number.isFinite(pending.notBefore)) continue;
      const at = Math.max(now,pending.notBefore);
      if (at <= before) next = Math.min(next ?? Infinity,at);
    } catch { /* a corrupt transient retry is discarded by the next delivery pass */ }
  }
  return next;
}
