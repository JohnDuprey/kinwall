// Google Calendar provider: OAuth2 auth-code flow + Calendar v3 REST (plain fetch, no SDK).
import type {
  EventInput,
  NormalizedEvent,
  Provider,
  ProviderCtx,
  ProviderEnv,
  RemoteCalendar,
} from './types.ts';

const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly openid email';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';

type GoogleConfig = { access_token: string; refresh_token: string; expires_at: number };

export function authUrl(env: ProviderEnv, redirectUri: string, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'select_account consent', // account chooser every time, so a second Google account can be added
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCode(
  env: ProviderEnv,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<{ name: string; config: GoogleConfig }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`Google OAuth exchange failed (HTTP ${res.status})`);
  const tok = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const config: GoogleConfig = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Date.now() + tok.expires_in * 1000,
  };
  const who = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${config.access_token}` },
  });
  const info = who.ok ? ((await who.json()) as { email?: string }) : {};
  return { name: info.email ?? 'Google account', config };
}

// Best-effort revoke on account disconnect - never throws (caller deletes the account either way).
export async function revokeToken(config: GoogleConfig | undefined): Promise<void> {
  if (!config?.refresh_token && !config?.access_token) return;
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: config.refresh_token || config.access_token }),
    });
  } catch {
    // best-effort
  }
}

async function ensureToken(ctx: Omit<ProviderCtx, 'calendar'> | ProviderCtx): Promise<string> {
  const cfg = ctx.account?.config as GoogleConfig | undefined;
  if (!cfg) throw new Error('Google account is not connected');
  if (cfg.expires_at - 60_000 > Date.now()) return cfg.access_token;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ctx.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: ctx.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: cfg.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      throw new Error('Google token revoked — reconnect the account');
    }
    throw new Error(`Google token refresh failed (HTTP ${res.status})`);
  }
  const tok = (await res.json()) as { access_token: string; expires_in: number };
  const next: GoogleConfig = {
    access_token: tok.access_token,
    refresh_token: cfg.refresh_token,
    expires_at: Date.now() + tok.expires_in * 1000,
  };
  await ctx.saveAccountConfig(next);
  return next.access_token;
}

async function api(
  ctx: Omit<ProviderCtx, 'calendar'> | ProviderCtx,
  path: string,
  init: RequestInit = {},
): Promise<any> {
  const token = await ensureToken(ctx);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  if (res.status === 401) throw new Error('Google token revoked — reconnect the account');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google API error (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// item.reminders: {useDefault, overrides: [{method, minutes}]}. Only 'popup' reminders count
// (per SPEC - 'email' reminders aren't a push notification). useDefault falls back to the
// calendar's own defaultReminders (fetched once per sync in listEvents, passed in here).
function reminderMinutes(item: any, calendarDefaults: number[]): number[] | null {
  if (item.reminders?.useDefault) return calendarDefaults.length ? calendarDefaults : null;
  const overrides = item.reminders?.overrides as { method: string; minutes: number }[] | undefined;
  if (!overrides) return null;
  const minutes = overrides.filter((o) => o.method === 'popup').map((o) => o.minutes);
  return minutes.length ? minutes : null;
}

function toNormalized(item: any, calendarDefaults: number[] = []): NormalizedEvent {
  const allDay = !!item.start?.date;
  return {
    externalId: item.id,
    title: item.summary || '(untitled)',
    start: allDay ? item.start.date : new Date(item.start.dateTime).toISOString(),
    end: allDay ? item.end.date : new Date(item.end.dateTime).toISOString(),
    allDay,
    location: item.location || undefined,
    description: item.description || undefined,
    seriesId: item.recurringEventId || undefined,
    reminders: reminderMinutes(item, calendarDefaults),
  };
}

function fromInput(ev: Partial<EventInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (ev.title !== undefined) body.summary = ev.title;
  if (ev.location !== undefined) body.location = ev.location;
  if (ev.description !== undefined) body.description = ev.description;
  if (ev.start !== undefined || ev.end !== undefined || ev.allDay !== undefined) {
    if (ev.allDay) {
      if (ev.start !== undefined) body.start = { date: ev.start };
      if (ev.end !== undefined) body.end = { date: ev.end };
    } else {
      if (ev.start !== undefined) body.start = { dateTime: ev.start };
      if (ev.end !== undefined) body.end = { dateTime: ev.end };
    }
  }
  return body;
}

export const provider: Provider = {
  async listCalendars(ctx): Promise<RemoteCalendar[]> {
    const data = await api(ctx, '/users/me/calendarList');
    return (data.items ?? []).map((c: any) => ({
      remoteId: c.id,
      name: c.summary,
      color: c.backgroundColor,
      writable: c.accessRole === 'owner' || c.accessRole === 'writer',
    }));
  },

  async listEvents(ctx: ProviderCtx, from: Date, to: Date): Promise<NormalizedEvent[]> {
    const calId = encodeURIComponent(ctx.calendar.remoteId ?? '');
    // Cheap single lookup, reused for every item in this call - only needed for items with
    // reminders.useDefault: true.
    let calendarDefaults: number[] = [];
    try {
      const calInfo = await api(ctx, `/users/me/calendarList/${calId}`);
      calendarDefaults = ((calInfo.defaultReminders ?? []) as { method: string; minutes: number }[])
        .filter((r) => r.method === 'popup')
        .map((r) => r.minutes);
    } catch {
      // best-effort - events with useDefault just get no reminders instead
    }
    const events: NormalizedEvent[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        singleEvents: 'true',
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        maxResults: '2500',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await api(ctx, `/calendars/${calId}/events?${params}`);
      for (const item of data.items ?? []) {
        if (item.status === 'cancelled') continue;
        events.push(toNormalized(item, calendarDefaults));
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return events;
  },

  async createEvent(ctx: ProviderCtx, ev: EventInput): Promise<NormalizedEvent> {
    const calId = encodeURIComponent(ctx.calendar.remoteId ?? '');
    const item = await api(ctx, `/calendars/${calId}/events`, {
      method: 'POST',
      body: JSON.stringify(fromInput(ev)),
    });
    return toNormalized(item);
  },

  async updateEvent(ctx: ProviderCtx, externalId: string, ev: Partial<EventInput>): Promise<NormalizedEvent> {
    const calId = encodeURIComponent(ctx.calendar.remoteId ?? '');
    const item = await api(ctx, `/calendars/${calId}/events/${encodeURIComponent(externalId)}`, {
      method: 'PATCH',
      body: JSON.stringify(fromInput(ev)),
    });
    return toNormalized(item);
  },

  async deleteEvent(ctx: ProviderCtx, externalId: string): Promise<void> {
    const calId = encodeURIComponent(ctx.calendar.remoteId ?? '');
    await api(ctx, `/calendars/${calId}/events/${encodeURIComponent(externalId)}`, { method: 'DELETE' });
  },
};
