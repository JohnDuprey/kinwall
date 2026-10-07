import type { KinwallDb } from './db.ts';
import type { Context } from 'hono';
import type { Env, WaitCtx } from './env.ts';
import { waitUntil } from './env.ts';
import { decrypt } from './crypto.ts';
import { isSafeWebhookUrl, outboundFetch } from './outbound.ts';

export type BusEventType =
  | 'contact.changed'
  | 'contact.category.changed'
  | 'recipe.changed'
  | 'meal.changed'
  | 'restaurant.changed'
  | 'member.changed'
  | 'calendar.changed'
  | 'calendar.synced'
  | 'events.changed'
  | 'chore.changed'
  | 'chore.completed'
  | 'chore.uncompleted'
  | 'chore.pending'
  | 'chore.rejected'
  | 'chore.library.changed'
  | 'checkin.completed'
  | 'tempcheck.changed'
  | 'journal.changed'
  | 'list.changed'
  | 'list.item.changed'
  | 'category.changed'
  | 'settings.changed'
  | 'plugin.action'
  | 'sticker.changed'
  | 'reward.changed'
  | 'reward.redeemed'
  | 'reward.approved'
  | 'reward.declined'
  | 'reward.given'
  | 'points.awarded'
  | 'points.removed'
  | 'photo.changed'
  | 'tracker.changed'
  | 'newscast.posted'
  | 'newscast.changed'
  | 'display.paired'
  | 'display.night_screen';

type WebhookRow = { id: string; url: string; events: string; secret: string };

type RevArea = 'events' | 'lists' | 'chores';
// Changes that can't touch events, calendars, members, lists or chores bump no area.
const NO_AREA = new Set<BusEventType>(['contact.changed', 'contact.category.changed', 'recipe.changed', 'restaurant.changed', 'journal.changed', 'tracker.changed', 'photo.changed', 'newscast.posted', 'newscast.changed', 'plugin.action']);

/** Which per-area rev (GET /api/rev `revs`) a change bumps, so a sync client refetches only that
 * part. 'events' is everything else that isn't lists or chores (calendars, members, settings, meals). */
export function revArea(type: BusEventType): RevArea | null {
  if (type.startsWith('list.')) return 'lists';
  if (type.startsWith('chore.') || type.startsWith('reward.') || type.startsWith('points.')) return 'chores'; // points change with all three
  return NO_AREA.has(type) ? null : 'events';
}

const BUMP_REV = "INSERT INTO settings (key, value) VALUES ('rev', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1";
// The area revs share one JSON row ('revs'), so every /api/rev poll reads one more row, not three.
const BUMP_AREA =
  "INSERT INTO settings (key, value) VALUES ('revs', json_object(?1, 1)) ON CONFLICT(key) DO UPDATE SET value = json_set(value, '$.' || ?1, coalesce(json_extract(value, '$.' || ?1), 0) + 1)";

// Bumps rev (and the change's area rev) and fetches enabled webhooks in a single D1 round trip: the
// increments are done entirely in SQL (no read-then-write) so they sit in the same batch as the lookup.
async function bumpRevAndListWebhooks(db: KinwallDb, type: BusEventType, bumpRev: boolean): Promise<WebhookRow[]> {
  const list = db.prepare('SELECT id, url, events, secret FROM webhooks WHERE enabled = 1');
  if (!bumpRev) return (await list.all<WebhookRow>()).results;
  const area = revArea(type);
  const results = await db.batch<WebhookRow>([db.prepare(BUMP_REV), ...(area ? [db.prepare(BUMP_AREA).bind(area)] : []), list]);
  return results[results.length - 1].results;
}

// SSRF guard for webhook targets lives in outbound.ts (shared with calendar feeds). Webhooks never
// honor ALLOW_PRIVATE_FEED_URLS.

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deliverWebhooks(env: Env, type: BusEventType, data: unknown, webhooks: WebhookRow[]): Promise<void> {
  const payload = JSON.stringify({ type, data, at: new Date().toISOString() });
  for (const hook of webhooks) {
    let events: string[] = [];
    try {
      events = JSON.parse(hook.events);
    } catch {
      // ignore malformed events list
    }
    if (events.length > 0 && !events.includes(type)) continue;
    if (!isSafeWebhookUrl(env, hook.url)) {
      console.error(`webhook ${hook.id} skipped: url is not a public address (ALLOW_PRIVATE_WEBHOOK_URLS=1 permits LAN receivers)`);
      continue;
    }
    let secret: string;
    try {
      secret = await decrypt(env, hook.secret, hook.id);
    } catch (err) {
      console.error(`webhook ${hook.id} secret decrypt failed`, err);
      continue;
    }
    const signature = `sha256=${await hmacHex(secret, payload)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      // On Node, OUTBOUND_FETCH also refuses a name that resolves to a private address (outbound.ts).
      await outboundFetch(env, env.ALLOW_PRIVATE_WEBHOOK_URLS === '1')(hook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kinwall-Signature': signature },
        body: payload,
        redirect: 'manual', // a redirect must not bounce the POST into private address space
        signal: controller.signal,
      });
    } catch (err) {
      console.error(`webhook ${hook.id} failed`, err);
    } finally {
      clearTimeout(timeout);
    }
  }
}

// Bumps rev and fires webhooks (in background via waitUntil). Usable outside a request
// (cron / setInterval sync loop) as well as from route handlers. bumpRev = false fires the
// webhooks only, for events that change nothing clients show (a sync tick with no new data).
export function publish(env: Env, execCtx: WaitCtx | undefined, type: BusEventType, data: unknown = {}, bumpRev = true): void {
  waitUntil(
    execCtx,
    (async () => {
      const webhooks = await bumpRevAndListWebhooks(env.DB, type, bumpRev);
      await deliverWebhooks(env, type, data, webhooks);
    })(),
  );
}

// Convenience wrapper for route handlers: pulls db/executionCtx off the Hono context.
export function emit(c: Context<{ Bindings: Env }>, type: BusEventType, data: unknown = {}): void {
  let ctx: WaitCtx | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined; // Node: no ExecutionContext
  }
  publish(c.env, ctx, type, data);
}

export async function getRev(db: KinwallDb): Promise<number> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'rev'").first<{ value: string }>();
  return Number(row?.value) || 0;
}
