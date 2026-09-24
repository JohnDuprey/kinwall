import { useEffect, useRef, useState } from 'react'
import { mock } from './mock.ts'
import type {
  Account, ApiKey, Appearance, CalendarEntry, Chore, ChoreDay, EventInstance, LeaderboardEntry, LeaderboardPeriod, Member,
  Me, Passkey, Providers, RemoteCalendar, Settings, Webhook,
} from './types.ts'

const MOCK = import.meta.env.VITE_MOCK === '1'
const KEY_STORAGE = 'kinwall.apiKey'
const ADMIN_KEY_STORAGE = 'kinwall.adminKey' // sessionStorage: { key, expiresAt } — cleared after 5 min
const ADMIN_TTL_MS = 5 * 60 * 1000

export function getKey(): string | null {
  return localStorage.getItem(KEY_STORAGE)
}
export function setKey(key: string) {
  localStorage.setItem(KEY_STORAGE, key)
}
export function clearKey() {
  localStorage.removeItem(KEY_STORAGE)
}

/** Temporary admin key used only for accounts/oauth/keys/webhooks/calendar-create-delete
 * when the stored key is display-scoped. Expires 5 min after it's set. */
export function getAdminKey(): string | null {
  try {
    const raw = sessionStorage.getItem(ADMIN_KEY_STORAGE)
    if (!raw) return null
    const { key, expiresAt } = JSON.parse(raw) as { key: string; expiresAt: number }
    if (Date.now() > expiresAt) { sessionStorage.removeItem(ADMIN_KEY_STORAGE); return null }
    return key
  } catch { return null }
}
export function setAdminKey(key: string) {
  try { sessionStorage.setItem(ADMIN_KEY_STORAGE, JSON.stringify({ key, expiresAt: Date.now() + ADMIN_TTL_MS })) } catch { /* ignore */ }
}
export function clearAdminKey() {
  try { sessionStorage.removeItem(ADMIN_KEY_STORAGE) } catch { /* ignore */ }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Server may be mounted under a sub-path (e.g. Home Assistant ingress); resolve API paths
// (no leading slash) against the page's own base rather than assuming the origin root.
function apiUrl(path: string): string {
  return new URL(path, document.baseURI).toString()
}

async function req<T>(path: string, opts: RequestInit & { useAdmin?: boolean } = {}): Promise<T> {
  const { useAdmin, ...init } = opts
  const key = useAdmin ? (getAdminKey() ?? getKey()) : getKey()
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) {
    let msg = res.statusText
    // Most routes send SPEC's { error: string }, but zod validation failures come back as
    // { error: { name, message } } — handle both so the UI never toasts "[object Object]".
    try {
      const err = (await res.json()).error
      msg = typeof err === 'string' ? err : err?.message ?? msg
    } catch { /* ignore */ }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const get = <T,>(path: string, useAdmin?: boolean) => req<T>(path, { useAdmin })
const post = <T,>(path: string, body?: unknown, useAdmin?: boolean) => req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), useAdmin })
const patch = <T,>(path: string, body: unknown, useAdmin?: boolean) => req<T>(path, { method: 'PATCH', body: JSON.stringify(body), useAdmin })
const put = <T,>(path: string, body: unknown, useAdmin?: boolean) => req<T>(path, { method: 'PUT', body: JSON.stringify(body), useAdmin })
const del = <T,>(path: string, useAdmin?: boolean) => req<T>(path, { method: 'DELETE', useAdmin })

export const api = {
  getRev: () => MOCK ? mock.getRev() : get<{ rev: number }>('api/rev'),

  // First-run setup (no auth). MOCK always reports claimed so the mock UI never shows the wizard.
  getSetup: (): Promise<{ claimed: boolean; oauth: { google: boolean; microsoft: boolean }; passkeys: boolean }> =>
    MOCK ? Promise.resolve({ claimed: true, oauth: { google: false, microsoft: false }, passkeys: false }) : get('api/setup'),
  claimSetup: (code: string, deviceRole: 'admin' | 'display', deviceName: string) =>
    post<{ adminKey: string; adminKeyId: string; displayKey?: string }>('api/setup/claim', { code, deviceRole, deviceName }),

  // Strict check (no fail-open) against the sessionStorage admin key — used by the
  // "Unlock with admin key" prompt to verify what was just typed in.
  checkAdminKey: (): Promise<Me> => MOCK ? Promise.resolve({ scope: 'admin', keyName: 'mock', kind: 'api' }) : get<Me>('api/me', true),
  // Strict check (no fail-open) against whatever key is currently stored — used by the QR-pairing
  // "confirm" screen and Settings (which must fail closed to the display view, not assume admin).
  meStrict: (): Promise<Me> => MOCK ? Promise.resolve({ scope: 'admin', keyName: 'mock', kind: 'api' }) : get<Me>('api/me'),

  getSettings: () => MOCK ? mock.getSettings() : get<Settings>('api/settings'),
  // useAdmin: the setup wizard saves household settings with the in-memory admin key when this
  // device only just claimed a display-scope key (settings PATCH isn't display-allowed).
  updateSettings: (body: Partial<Settings>, useAdmin?: boolean) => MOCK ? mock.updateSettings(body) : patch<Settings>('api/settings', body, useAdmin),
  // No-auth subset of Settings for the pre-pairing screen (useTheme.ts) — see GET /api/appearance.
  getAppearance: (): Promise<Appearance> => MOCK ? mock.getSettings() : get<Appearance>('api/appearance'),

  getMembers: () => MOCK ? mock.getMembers() : get<Member[]>('api/members'),
  // useAdmin: the setup wizard creates/removes members with the in-memory admin key when this
  // device only just claimed a display-scope key (member create/delete aren't display-allowed).
  createMember: (body: Partial<Member>, useAdmin?: boolean) => MOCK ? mock.createMember(body) : post<Member>('api/members', body, useAdmin),
  updateMember: (id: string, body: Partial<Member>) => MOCK ? mock.updateMember(id, body) : patch<Member>(`api/members/${id}`, body),
  deleteMember: (id: string, useAdmin?: boolean) => MOCK ? mock.deleteMember(id) : del(`api/members/${id}`, useAdmin),

  getCalendars: () => MOCK ? mock.getCalendars() : get<CalendarEntry[]>('api/calendars'),
  // create/delete are admin-only per SPEC's key scopes; patch/sync stay usable with a display key.
  createCalendar: (body: Partial<CalendarEntry> & { url?: string }) => MOCK ? mock.createCalendar(body) : post<CalendarEntry>('api/calendars', body, true),
  updateCalendar: (id: string, body: Partial<CalendarEntry>) => MOCK ? mock.updateCalendar(id, body) : patch<CalendarEntry>(`api/calendars/${id}`, body),
  deleteCalendar: (id: string) => MOCK ? mock.deleteCalendar(id) : del(`api/calendars/${id}`, true),
  syncCalendar: (id: string, useAdmin?: boolean) => MOCK ? mock.syncCalendar(id) : post<{ ok: boolean; count: number }>(`api/calendars/${id}/sync`, undefined, useAdmin),

  getProviders: () => MOCK ? mock.getProviders() : get<Providers>('api/providers', true),
  saveProvider: (kind: 'google' | 'microsoft', body: { clientId: string; clientSecret?: string; tenant?: string }) =>
    MOCK ? mock.saveProvider(kind, body) : put<Providers['google']>(`api/providers/${kind}`, body, true),
  deleteProvider: (kind: 'google' | 'microsoft') => MOCK ? mock.deleteProvider(kind) : del(`api/providers/${kind}`, true),
  savePublicUrl: (value: string) => MOCK ? mock.savePublicUrl(value) : put<{ value: string; warning?: string }>('api/providers/public-url', { value }, true),

  getAccounts: () => MOCK ? mock.getAccounts() : get<Account[]>('api/accounts', true),
  deleteAccount: (id: string) => MOCK ? mock.deleteAccount(id) : del(`api/accounts/${id}`, true),
  createCaldavAccount: (body: { name: string; serverUrl: string; username: string; password: string }) =>
    MOCK ? mock.createCaldavAccount(body) : post<Account>('api/accounts/caldav', body, true),
  getRemoteCalendars: (accountId: string) => MOCK ? mock.getRemoteCalendars(accountId) : get<RemoteCalendar[]>(`api/accounts/${accountId}/remote-calendars`, true),
  oauthStartUrl: (kind: 'google' | 'microsoft') => apiUrl(`api/oauth/${kind}/start?key=${encodeURIComponent(getAdminKey() ?? getKey() ?? '')}`),

  getEvents: (from: string, to: string, memberId?: string, calendarId?: string) => {
    if (MOCK) return mock.getEvents(from, to)
    const q = new URLSearchParams({ from, to })
    if (memberId) q.set('memberId', memberId)
    if (calendarId) q.set('calendarId', calendarId)
    return get<EventInstance[]>(`api/events?${q}`)
  },
  createEvent: (body: Partial<EventInstance>) => MOCK ? mock.createEvent(body) : post<EventInstance>('api/events', body),
  updateEvent: (id: string, body: Partial<EventInstance> & { scope?: 'occurrence' | 'series' }) =>
    MOCK ? mock.updateEvent(id, body) : patch<EventInstance>(`api/events/${id}`, body),
  deleteEvent: (id: string) => MOCK ? mock.deleteEvent(id) : del(`api/events/${id}`),

  getChoresDay: (date: string) => MOCK ? mock.getChoresDay(date) : get<ChoreDay[]>(`api/chores/day?date=${date}`),
  createChore: (body: Partial<Chore>) => MOCK ? mock.createChore(body) : post<Chore>('api/chores', body),
  updateChore: (id: string, body: Partial<Chore>) => MOCK ? mock.updateChore(id, body) : patch<Chore>(`api/chores/${id}`, body),
  deleteChore: (id: string) => MOCK ? mock.deleteChore(id) : del(`api/chores/${id}`),
  completeChore: (id: string, date: string, memberId?: string) =>
    MOCK ? mock.completeChore(id, date, memberId) : post(`api/chores/${id}/complete`, { date, memberId }),
  uncompleteChore: (id: string, date: string) =>
    MOCK ? mock.uncompleteChore(id, date) : del(`api/chores/${id}/complete?date=${date}`),

  getLeaderboard: (period: LeaderboardPeriod) =>
    MOCK ? mock.getLeaderboard(period) : get<LeaderboardEntry[]>(`api/leaderboard?period=${period}`),

  getKeys: () => MOCK ? mock.getKeys() : get<ApiKey[]>('api/keys', true),
  createKey: (name: string, scope: 'admin' | 'display' = 'display') =>
    MOCK ? mock.createKey(name) : post<{ id: string; name: string; key: string }>('api/keys', { name, scope }, true),
  deleteKey: (id: string) => MOCK ? mock.deleteKey(id) : del(`api/keys/${id}`, true),

  // Display pairing (device-flow style). Start/poll are unauthenticated on the server (no key
  // yet), so they're plain fetches — never gated by MOCK, since a not-yet-paired display is the
  // one screen mock mode has no stand-in for.
  pairStart: () => post<{ pairingId: string; code: string; pollToken: string; expiresAt: string }>('api/pair'),
  pairPoll: (pairingId: string, pollToken: string) =>
    post<{ status: 'pending' | 'approved'; key?: string }>('api/pair/poll', { pairingId, pollToken }),
  pairApprove: (code: string, name: string) => post<{ keyId: string; name: string }>('api/pair/approve', { code, name }, true),

  getWebhooks: () => MOCK ? mock.getWebhooks() : get<Webhook[]>('api/webhooks', true),
  createWebhook: (url: string, events: string[], secret?: string) =>
    MOCK ? mock.createWebhook(url, events) : post<Webhook>('api/webhooks', { url, events, secret }, true),
  updateWebhook: (id: string, body: Partial<Webhook>) => MOCK ? mock.updateWebhook(id, body) : patch<Webhook>(`api/webhooks/${id}`, body, true),
  deleteWebhook: (id: string) => MOCK ? mock.deleteWebhook(id) : del(`api/webhooks/${id}`, true),

  // Passkeys (WebAuthn). register/options+verify take `useAdmin` when called with the in-memory
  // setup-wizard admin key (see webauthn.ts's registerPasskey, called from Setup.tsx); a `token`
  // instead authorizes a not-yet-signed-in device (the QR "finish on your phone" flow), so those
  // two calls skip the bearer key entirely and go straight through `req`.
  passkeyRegisterOptions: (token?: string, useAdmin?: boolean) =>
    token ? post<Record<string, unknown>>('api/passkeys/register/options', { token }) : post<Record<string, unknown>>('api/passkeys/register/options', {}, useAdmin),
  passkeyRegisterVerify: (body: { token?: string; name: string; response: unknown }, useAdmin?: boolean) =>
    body.token ? post<{ id: string; name: string; session?: { key: string; expiresAt: string } }>('api/passkeys/register/verify', body)
      : post<{ id: string; name: string; session?: { key: string; expiresAt: string } }>('api/passkeys/register/verify', body, useAdmin),
  passkeyRegisterToken: () => post<{ token: string; expiresAt: string }>('api/passkeys/register-token', undefined, true),
  passkeyLoginOptions: () => post<Record<string, unknown>>('api/passkeys/login/options'),
  passkeyLoginVerify: (response: unknown) => post<{ key: string; expiresAt: string }>('api/passkeys/login/verify', { response }),
  getPasskeys: () => get<Passkey[]>('api/passkeys', true),
  renamePasskey: (id: string, name: string) => patch<Passkey>(`api/passkeys/${id}`, { name }, true),
  deletePasskey: (id: string) => del(`api/passkeys/${id}`, true),
  sessionLogout: () => post<{ ok: boolean }>('api/sessions/logout'),
}

/** Provider event descriptions are often HTML (Google/Outlook). Never render as HTML — this
 * strips tags via DOMParser (safe: result is only ever used as text/textContent, not innerHTML)
 * and keeps paragraph/line breaks as newlines for readability. */
export function stripHtmlToText(input: string): string {
  if (!/<[a-z][\s\S]*>/i.test(input)) return input // plain text already, skip parser overhead
  const withBreaks = input.replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, '\n')
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html')
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

/** Bumps a counter every `intervalMs` (default 15s) and on tab visibility change, by polling
 * /api/rev for changes. Also reports `unauthorized: true` on a 401 (e.g. this display's key was
 * revoked from another session) so App.tsx can drop back to the pairing/key-gate screen without
 * waiting for the next manual action. */
export function usePoll(intervalMs = 15000) {
  const [tick, setTick] = useState(0)
  const [unauthorized, setUnauthorized] = useState(false)
  const lastRev = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      if (!getKey()) return // no key yet (pairing screen) - nothing to poll, and a 401 here is meaningless
      try {
        const { rev } = await api.getRev()
        if (cancelled) return
        if (lastRev.current !== null && rev !== lastRev.current) setTick(t => t + 1)
        lastRev.current = rev
      } catch (e) {
        if (!cancelled && e instanceof ApiError && e.status === 401) setUnauthorized(true)
        // otherwise offline / transient — ignore, next poll will retry
      }
    }
    check()
    const id = setInterval(check, intervalMs)
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelled = true; clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [intervalMs])

  return { tick, unauthorized }
}
