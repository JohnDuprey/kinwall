// Microsoft 365 / Outlook.com provider: OAuth2 auth-code flow + Graph v1.0 REST (plain fetch).
import type {
  EventInput,
  NormalizedEvent,
  Provider,
  ProviderCtx,
  ProviderEnv,
  RemoteCalendar,
} from './types.ts';

const SCOPES = 'offline_access Calendars.ReadWrite User.Read openid email';
const GRAPH = 'https://graph.microsoft.com/v1.0';

type MsConfig = { access_token: string; refresh_token: string; expires_at: number };

function tenant(env: ProviderEnv): string {
  return env.MS_TENANT || 'common';
}

export function authUrl(env: ProviderEnv, redirectUri: string, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: env.MS_CLIENT_ID ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: SCOPES,
    prompt: 'select_account', // otherwise Microsoft silently reuses whoever is signed in
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://login.microsoftonline.com/${tenant(env)}/oauth2/v2.0/authorize?${params}`;
}

export async function exchangeCode(
  env: ProviderEnv,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<{ name: string; config: MsConfig }> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant(env)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID ?? '',
      client_secret: env.MS_CLIENT_SECRET ?? '',
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: SCOPES,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`Microsoft OAuth exchange failed (HTTP ${res.status})`);
  const tok = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const config: MsConfig = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Date.now() + tok.expires_in * 1000,
  };
  const who = await fetch(`${GRAPH}/me`, {
    headers: { authorization: `Bearer ${config.access_token}` },
  });
  const info = who.ok ? ((await who.json()) as { mail?: string; userPrincipalName?: string }) : {};
  return { name: info.mail ?? info.userPrincipalName ?? 'Microsoft account', config };
}

async function ensureToken(ctx: Omit<ProviderCtx, 'calendar'> | ProviderCtx): Promise<string> {
  const cfg = ctx.account?.config as MsConfig | undefined;
  if (!cfg) throw new Error('Microsoft account is not connected');
  if (cfg.expires_at - 60_000 > Date.now()) return cfg.access_token;

  const res = await fetch(`https://login.microsoftonline.com/${tenant(ctx.env)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ctx.env.MS_CLIENT_ID ?? '',
      client_secret: ctx.env.MS_CLIENT_SECRET ?? '',
      refresh_token: cfg.refresh_token,
      grant_type: 'refresh_token',
      scope: SCOPES,
    }),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      throw new Error('Microsoft token revoked — reconnect the account');
    }
    throw new Error(`Microsoft token refresh failed (HTTP ${res.status})`);
  }
  const tok = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const next: MsConfig = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? cfg.refresh_token,
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
  const res = await fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      prefer: 'outlook.timezone="UTC"',
    },
  });
  if (res.status === 401) throw new Error('Microsoft token revoked — reconnect the account');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Microsoft Graph error (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Graph returns all-day start/end as midnight datetimes (already exclusive on end) - just
// take the date part. Timed values come back without an offset because of the UTC Prefer
// header above, so append Z before normalizing.
function toNormalized(item: any): NormalizedEvent {
  const allDay = !!item.isAllDay;
  return {
    externalId: item.id,
    title: item.subject || '(untitled)',
    start: allDay ? item.start.dateTime.slice(0, 10) : new Date(`${item.start.dateTime}Z`).toISOString(),
    end: allDay ? item.end.dateTime.slice(0, 10) : new Date(`${item.end.dateTime}Z`).toISOString(),
    allDay,
    location: item.location?.displayName || undefined,
    description: item.bodyPreview || undefined,
    seriesId: item.seriesMasterId || undefined,
    reminders: item.isReminderOn && typeof item.reminderMinutesBeforeStart === 'number' ? [item.reminderMinutesBeforeStart] : null,
  };
}

function fromInput(ev: Partial<EventInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (ev.title !== undefined) body.subject = ev.title;
  if (ev.location !== undefined) body.location = { displayName: ev.location };
  if (ev.description !== undefined) body.body = { contentType: 'text', content: ev.description };
  if (ev.allDay !== undefined) body.isAllDay = ev.allDay;
  if (ev.start !== undefined) body.start = { dateTime: normalizeForGraph(ev.start, ev.allDay), timeZone: 'UTC' };
  if (ev.end !== undefined) body.end = { dateTime: normalizeForGraph(ev.end, ev.allDay), timeZone: 'UTC' };
  return body;
}

function normalizeForGraph(value: string, allDay?: boolean): string {
  if (allDay) return `${value}T00:00:00`;
  return value.replace('Z', '');
}

export const provider: Provider = {
  async listCalendars(ctx): Promise<RemoteCalendar[]> {
    const data = await api(ctx, '/me/calendars?$select=id,name,canEdit,hexColor');
    return (data.value ?? []).map((c: any) => ({
      remoteId: c.id,
      name: c.name,
      color: c.hexColor || undefined,
      writable: !!c.canEdit,
    }));
  },

  async listEvents(ctx: ProviderCtx, from: Date, to: Date): Promise<NormalizedEvent[]> {
    const events: NormalizedEvent[] = [];
    const params = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $top: '500',
      $select: 'id,subject,start,end,isAllDay,location,bodyPreview,seriesMasterId,isReminderOn,reminderMinutesBeforeStart',
    });
    let url: string | undefined =
      `${GRAPH}/me/calendars/${encodeURIComponent(ctx.calendar.remoteId ?? '')}/calendarView?${params}`;
    while (url) {
      const data = await api(ctx, url);
      for (const item of data.value ?? []) events.push(toNormalized(item));
      url = data['@odata.nextLink'];
    }
    return events;
  },

  async createEvent(ctx: ProviderCtx, ev: EventInput): Promise<NormalizedEvent> {
    const calId = encodeURIComponent(ctx.calendar.remoteId ?? '');
    const item = await api(ctx, `/me/calendars/${calId}/events`, {
      method: 'POST',
      body: JSON.stringify(fromInput(ev)),
    });
    return toNormalized(item);
  },

  async updateEvent(ctx: ProviderCtx, externalId: string, ev: Partial<EventInput>): Promise<NormalizedEvent> {
    const item = await api(ctx, `/me/events/${encodeURIComponent(externalId)}`, {
      method: 'PATCH',
      body: JSON.stringify(fromInput(ev)),
    });
    return toNormalized(item);
  },

  async deleteEvent(ctx: ProviderCtx, externalId: string): Promise<void> {
    await api(ctx, `/me/events/${encodeURIComponent(externalId)}`, { method: 'DELETE' });
  },
};
