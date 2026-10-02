// Workers-compatible. Env shape shared by worker.ts and node.ts (Node passes process.env + adapted DB).
import type { KinwallDb } from './db.ts';
import type { ApnsEnv } from './apns.ts';
// APNS_*: Apple push for the iPhone app's Live Activities (apns.ts); off unless all are set.
export type Env = ApnsEnv & {
  DB: KinwallDb;
  PUBLIC_URL?: string;
  ADMIN_API_KEY?: string;
  SYNC_INTERVAL_MINUTES?: string;
  CORS_ORIGINS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_PHOTOS_ENABLED?: string; // '1' to offer Google Photos at all (tabled: needs Google's Photos partner program)
  GOOGLE_PHOTOS_CLIENT_ID?: string; // Google Photos (Ambient API): its own "TVs and Limited Input devices" OAuth client; see routes/google-photos.ts
  GOOGLE_PHOTOS_CLIENT_SECRET?: string;
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  MS_TENANT?: string;
  OAUTH_REDIRECT_URI?: string; // shared-app hosts: fixed Google/MS redirect_uri on the host's domain; see routes/oauth.ts
  ENCRYPTION_KEY?: string;
  VAPID_SUBJECT?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  WEBAUTHN_RP_ID?: string; // passkey rpID shared by subdomains (multi-tenant hosts); see webauthn.ts
  HA_INGRESS?: (req: Request) => boolean; // Home Assistant app: did the Supervisor's ingress proxy send this request? (node.ts; webauthn.ts)
  ALLOW_PRIVATE_FEED_URLS?: string; // '1' lets ICS/CalDAV reach LAN hosts (see outbound.ts)
  ALLOW_PRIVATE_WEBHOOK_URLS?: string; // '1' lets webhooks target LAN receivers (Home Assistant add-on sets it)
  REQUIRE_PASSKEY_SETUP?: string; // '1': setup wizard can't skip the passkey (hosts with no other way back in); see routes/setup.ts
  HOST_PORTAL_URL?: string;
  PLUGIN_CATALOG_URL?: string; // the list of trusted activity plugins (default: the one kinwall.family's admins keep); see routes/plugins.ts
  PLUGIN_CATALOG?: () => Promise<unknown[]>; // hosts that keep the list themselves hand it over directly instead (hosted reads its registry)
  PLUGINS_CATALOG_ONLY?: string; // '1': only catalog plugins can be installed (no other repos, no uploads). Hosted sets it. // host-run page for managing/deleting this family; linked from Settings -> Access (via /api/me)
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
  // Caught either way: an unhandled rejection under waitUntil fails the invocation that started it
  // (a Durable Object alarm then reports scriptThrewException) for work that was best effort.
  const caught = p.catch((err) => console.error('background task failed', err));
  if (ctx?.waitUntil) ctx.waitUntil(caught);
}
