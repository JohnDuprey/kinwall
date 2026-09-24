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
  | 'settings.changed'
  | 'display.paired';

async function bumpRev(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'rev'").first<{ value: string }>();
  const next = (Number(row?.value) || 0) + 1;
  await db
    .prepare("INSERT INTO settings (key, value) VALUES ('rev', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(String(next))
    .run();
  return next;
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fireWebhooks(env: Env, type: BusEventType, data: unknown): Promise<void> {
  const { results } = await env.DB
    .prepare('SELECT id, url, events, secret FROM webhooks WHERE enabled = 1')
    .all<{ id: string; url: string; events: string; secret: string }>();
  const payload = JSON.stringify({ type, data, at: new Date().toISOString() });
  for (const hook of results) {
    let events: string[] = [];
    try {
      events = JSON.parse(hook.events);
    } catch {
      // ignore malformed events list
    }
    if (events.length > 0 && !events.includes(type)) continue;
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
      await bumpRev(env.DB);
      await fireWebhooks(env, type, data);
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
