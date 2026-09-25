import type { Context } from 'hono';
import type { Env, WaitCtx } from './env.ts';
import { waitUntil } from './env.ts';
import { decrypt } from './crypto.ts';

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
  | 'display.paired';

type WebhookRow = { id: string; url: string; events: string; secret: string };

// Bumps rev and fetches enabled webhooks in a single D1 round trip: the increment is done
// entirely in SQL (no read-then-write) so it can sit in the same batch as the webhook lookup.
async function bumpRevAndListWebhooks(db: D1Database): Promise<WebhookRow[]> {
  const [, webhooks] = await db.batch<WebhookRow>([
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('rev', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1",
    ),
    db.prepare('SELECT id, url, events, secret FROM webhooks WHERE enabled = 1'),
  ]);
  return webhooks.results;
}

// SSRF guard for webhook targets. Checks the literal host only: Workers can't resolve DNS, so a
// public name that resolves to a private address is not caught here. URL() already normalises
// IPv4 shorthand (http://2130706433, 0x7f.1) into dotted quads.
export function isSafeWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 || // this-net, private, loopback, multicast + reserved
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    // unspecified, loopback, v4-mapped, fc00::/7 unique-local, fe80::/10 link-local
    return !(v6 === '::' || v6 === '::1' || v6.startsWith('::ffff:') || /^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6));
  }
  return true;
}

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
    if (!isSafeWebhookUrl(hook.url)) {
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

export async function getRev(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'rev'").first<{ value: string }>();
  return Number(row?.value) || 0;
}
