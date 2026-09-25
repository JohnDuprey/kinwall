// Contract between the core API (sync.ts, routes/events.ts) and calendar providers.
// Stored time format: timed = UTC ISO ('2026-09-24T14:00:00.000Z'); all-day = 'YYYY-MM-DD', end exclusive.

export type NormalizedEvent = {
  externalId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  // Set only for occurrences of a recurring event - see providers/{google,microsoft,caldav,ics}.ts
  // for how each provider derives it. Used to apply a series-wide member tag to every occurrence.
  seriesId?: string;
  // Minutes-before reminders, from the provider's own alarm/reminder config. Undefined/null means
  // "the provider gave none" - notify.ts falls back to the household default in that case.
  reminders?: number[] | null;
};

export type EventInput = Omit<NormalizedEvent, 'externalId'>;

export type RemoteCalendar = { remoteId: string; name: string; color?: string; writable: boolean };

// Config values providers need (subset of Env). TIMEZONE is the household timezone
// (settings.timezone), threaded in so ics.ts/caldav.ts can interpret floating (no TZID, no Z)
// ICS times correctly instead of defaulting to UTC.
export type ProviderEnv = {
  PUBLIC_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  MS_TENANT?: string;
  TIMEZONE?: string;
  ALLOW_PRIVATE_FEED_URLS?: string;
};

export type ProviderCtx = {
  env: ProviderEnv;
  account?: { id: string; config: any };
  calendar: { id: string; remoteId: string | null; config: any };
  saveAccountConfig: (config: any) => Promise<void>; // persist refreshed OAuth tokens
};

export interface Provider {
  listCalendars?(ctx: Omit<ProviderCtx, 'calendar'>): Promise<RemoteCalendar[]>;
  listEvents(ctx: ProviderCtx, from: Date, to: Date): Promise<NormalizedEvent[]>; // recurrence expanded
  createEvent?(ctx: ProviderCtx, ev: EventInput): Promise<NormalizedEvent>;
  updateEvent?(ctx: ProviderCtx, externalId: string, ev: Partial<EventInput>): Promise<NormalizedEvent>;
  deleteEvent?(ctx: ProviderCtx, externalId: string): Promise<void>;
}

// google.ts and microsoft.ts additionally export (PKCE, S256):
//   authUrl(env: ProviderEnv, redirectUri: string, state: string, codeChallenge: string): string
//   exchangeCode(env: ProviderEnv, code: string, redirectUri: string, codeVerifier: string): Promise<{ name: string; config: any }>
// caldav.ts additionally exports:
//   verifyAccount(serverUrl, username, password): Promise<{ name: string; config: any }>
