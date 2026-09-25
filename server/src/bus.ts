import type { KinwallDb } from './db.ts';
import type { Context } from 'hono';
import type { Env, WaitCtx } from './env.ts';
import { waitUntil } from './env.ts';
import { decrypt } from './crypto.ts';
import { isSafeOutboundUrl } from './outbound.ts';

export type BusEventType =
  | 'member.changed'
  | 'calendar.changed'
  | 'calendar.synced'
  | 'events.changed'
  | 'chore.changed'
  | 'chore.completed'
  | 'chore.uncompleted'
  | 'list.changed'
  | 'list.item.changed'
  | 'category.changed'
  | 'settings.changed'
  | 'sticker.changed'
  | 'display.paired';

type WebhookRow = { id: string; url: string; events: string; secret: string };

// Bumps rev and fetches enabled webhooks in a single D1 round trip: the increment is done
// entirely in SQL (no read-then-write) so it can sit in the same batch as the webhook lookup.
async function bumpRevAndListWebhooks(db: KinwallDb): Promise<WebhookRow[]> {
  const [, webhooks] = await db.batch<WebhookRow>([
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('rev', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1",
    ),
    db.prepare('SELECT id, url, events, secret FROM webhooks WHERE enabled = 1'),
  ]);
  return webhooks.results;
}

// SSRF guard for webhook targets lives in outbound.ts (shared with calendar feeds). Webhooks never
// honour ALLOW_PRIVATE_FEED_URLS.
export { isSafeOutboundUrl as isSafeWebhookUrl } from './outbound.ts';

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
    if (!isSafeOutboundUrl(hook.url)) {
      console.error(`webhook ${hook.id} skipped: url is not a public address`);
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
      await fetch(hook.url, {
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
// (cron / setInterval sync loop) as well as from route handlers.
export function publish(env: Env, execCtx: WaitCtx | undefined, type: BusEventType, data: unknown = {}): void {
  waitUntil(
    execCtx,
    (async () => {
      const webhooks = await bumpRevAndListWebhooks(env.DB);
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
