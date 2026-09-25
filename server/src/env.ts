// Workers-compatible. Env shape shared by worker.ts and node.ts (Node passes process.env + adapted DB).
import type { KinwallDb } from './db.ts';
export type Env = {
  DB: KinwallDb;
  PUBLIC_URL?: string;
  ADMIN_API_KEY?: string;
  SYNC_INTERVAL_MINUTES?: string;
  CORS_ORIGINS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  MS_TENANT?: string;
  OAUTH_REDIRECT_URI?: string; // shared-app hosts: fixed Google/MS redirect_uri on the host's domain; see routes/oauth.ts
  ENCRYPTION_KEY?: string;
  VAPID_SUBJECT?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  WEBAUTHN_RP_ID?: string; // passkey rpID shared by subdomains (multi-tenant hosts); see webauthn.ts
  ALLOW_PRIVATE_FEED_URLS?: string; // '1' lets ICS/CalDAV reach LAN hosts (see outbound.ts)
  ALLOW_PRIVATE_WEBHOOK_URLS?: string; // '1' lets webhooks target LAN receivers (Home Assistant add-on sets it)
  REQUIRE_PASSKEY_SETUP?: string; // '1': setup wizard can't skip the passkey (hosts with no other way back in); see routes/setup.ts
  HOST_PORTAL_URL?: string; // host-run page for managing/deleting this family; linked from Settings -> Access (via /api/me)
};

export function syncIntervalMinutes(env: Env): number {
  const n = Number(env.SYNC_INTERVAL_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

// Fallback timezone when the household hasn't set settings.timezone yet. On Node, Intl resolves
// the host's TZ env / system timezone (the HA add-on already seeds settings.timezone from its
// options before this ever runs). On Workers there's no host tz, so Intl resolves to 'UTC'.
export function hostTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// Minimal structural subset of ExecutionContext (Workers' and Hono's own type both satisfy this)
// so callers don't have to reconcile the two distinct ExecutionContext types.
export type WaitCtx = { waitUntil(promise: Promise<unknown>): void };

export function waitUntil(ctx: WaitCtx | undefined, p: Promise<unknown>): void {
  if (ctx?.waitUntil) {
    ctx.waitUntil(p);
  } else {
    p.catch((err) => console.error('background task failed', err));
  }
}
