import { useEffect, useRef, useState } from 'react'
import { tellAppSignedIn, tellAppSignedOut } from './native.ts'
import { mock } from './mock.ts'
import type { PasskeyAuthenticator } from './webauthn.ts'
import type { OnlineTidbits,
  StickerPack, StickerPatch, StickerPlacement, Photo, PhotoQuota,
  Account, ApiKey, AppNotification, Appearance, CalendarEntry, Category, Chore, ChoreDay, EventInstance, LeaderboardEntry, LeaderboardPeriod, List,
  GeocodeResult, HostEvent, ImportResult, ListDetail, ListGroup, ListItem, ListItemInput, Member, Me, Note, NoteTarget, Passkey, Providers, PushSubscription, PushSubscriptionPrefs, RemoteCalendar, Settings, Snapshot, Board, Webhook, WebhookWithSecret,
} from './types.ts'

/** Demo build: every call is served from mock.ts in memory - no server, nothing persists. */
export const MOCK = import.meta.env.VITE_MOCK === '1'
const KEY_STORAGE = 'kinwall.apiKey'
const ADMIN_KEY_STORAGE = 'kinwall.adminKey' // sessionStorage: { key, expiresAt } — cleared after 5 min
const ADMIN_TTL_MS = 5 * 60 * 1000

export function getKey(): string | null {
  return localStorage.getItem(KEY_STORAGE)
}
export function setKey(key: string) {
  localStorage.setItem(KEY_STORAGE, key)
  tellAppSignedIn()
}
/** `rejected`: the server refused the key (revoked, or an app's short-lived key lapsed);
 * `signOut`: the person chose to sign out or unpair. */
export function clearKey(reason: 'signOut' | 'rejected' = 'signOut') {
  localStorage.removeItem(KEY_STORAGE)
  tellAppSignedOut(reason)
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

// In-flight changes (non-GET requests) drive the "Saving… / Saved" indicator. Background polling
// is all GET, and the pairing screen's poll isn't a change, so neither shows as saving.
let savesInFlight = 0
let lastSavedAt = 0
const saveListeners = new Set<() => void>()
const notifySaves = () => saveListeners.forEach(l => l())
function trackSave<T>(p: Promise<T>): Promise<T> {
  savesInFlight++
  notifySaves()
  return p.then(v => { lastSavedAt = Date.now(); return v }).finally(() => { savesInFlight--; notifySaves() })
}

/** 'saving' while any change is in flight, then 'saved' for a moment after a successful one. */
export function useSaveState(): 'idle' | 'saving' | 'saved' {
  const [, rerender] = useState(0)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onChange = () => {
      rerender(n => n + 1)
      clearTimeout(timer)
      if (savesInFlight === 0 && Date.now() - lastSavedAt < 100) timer = setTimeout(() => rerender(n => n + 1), 1500)
    }
    saveListeners.add(onChange)
    return () => { saveListeners.delete(onChange); clearTimeout(timer) }
  }, [])
  if (savesInFlight > 0) return 'saving'
  return Date.now() - lastSavedAt < 1500 ? 'saved' : 'idle'
}

async function req<T>(path: string, opts: RequestInit & { useAdmin?: boolean } = {}): Promise<T> {
  const isChange = !!opts.method && opts.method !== 'GET' && path !== 'api/pair/poll'
  return isChange ? trackSave(send<T>(path, opts)) : send<T>(path, opts)
}

async function send<T>(path: string, opts: RequestInit & { useAdmin?: boolean }): Promise<T> {
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
  getSetup: (): Promise<{ claimed: boolean; oauth: { google: boolean; microsoft: boolean }; passkeys: boolean; passkeyRequired: boolean; hasPasskey: boolean }> =>
    MOCK ? Promise.resolve({ claimed: true, oauth: { google: false, microsoft: false }, passkeys: false, passkeyRequired: false, hasPasskey: false }) : get('api/setup'),
  claimSetup: (code: string, deviceRole: 'admin' | 'display', deviceName: string) =>
    post<{ adminKey: string; adminKeyId: string; displayKey?: string }>('api/setup/claim', { code, deviceRole, deviceName }),

  // Strict check (no fail-open) against the sessionStorage admin key — used by the
  // "Unlock with admin key" prompt to verify what was just typed in.
  checkAdminKey: (): Promise<Me> => MOCK ? Promise.resolve({ scope: 'admin', keyName: 'mock', kind: 'api' }) : get<Me>('api/me', true),
  // Strict check (no fail-open) against whatever key is currently stored — used by the QR-pairing
  // "confirm" screen and Settings (which must fail closed to the display view, not assume admin).
  meStrict: (): Promise<Me> => MOCK ? Promise.resolve({ scope: 'admin', keyName: 'mock', kind: 'api' }) : get<Me>('api/me'),

  getSettings: (useAdmin?: boolean) => MOCK ? mock.getSettings() : get<Settings>('api/settings', useAdmin),
  // useAdmin: the setup wizard saves household settings with the in-memory admin key when this
  // device only just claimed a display-scope key (settings PATCH isn't display-allowed).
  updateSettings: (body: Partial<Settings>, useAdmin?: boolean) => MOCK ? mock.updateSettings(body) : patch<Settings>('api/settings', body, useAdmin),
  // No-auth subset of Settings for the pre-pairing screen (useTheme.ts) — see GET /api/appearance.
  getAppearance: (): Promise<Appearance> => MOCK ? mock.getSettings() : get<Appearance>('api/appearance'),

  getMembers: (useAdmin?: boolean) => MOCK ? mock.getMembers() : get<Member[]>('api/members', useAdmin),
  // useAdmin: the setup wizard creates/removes members with the in-memory admin key when this
  // device only just claimed a display-scope key (member create/delete aren't display-allowed).
  createMember: (body: Partial<Member>, useAdmin?: boolean) => MOCK ? mock.createMember(body) : post<Member>('api/members', body, useAdmin),
  updateMember: (id: string, body: Partial<Member>) => MOCK ? mock.updateMember(id, body) : patch<Member>(`api/members/${id}`, body),
  deleteMember: (id: string, useAdmin?: boolean) => MOCK ? mock.deleteMember(id) : del(`api/members/${id}`, useAdmin),

  getSnapshot: (memberId: string, range: 'day' | 'week') =>
    MOCK ? mock.getSnapshot(memberId, range) : get<Snapshot>(`api/snapshot?member=${encodeURIComponent(memberId)}&range=${range}`),
  // Server-side lookup (Open-Meteo): the browser never talks to the geocoder itself.
  getBoard: (days = 7) => MOCK ? mock.getBoard(days) : get<Board>(`api/board?days=${days}`),
  getTidbits: () => MOCK ? mock.getTidbits() : get<OnlineTidbits>('api/tidbits'),

  geocode: (q: string) => MOCK ? mock.geocode(q) : get<GeocodeResult[]>(`api/geocode?q=${encodeURIComponent(q)}`),

  getCalendars: () => MOCK ? mock.getCalendars() : get<CalendarEntry[]>('api/calendars'),
  // create/delete are admin-only per SPEC's key scopes; patch/sync stay usable with a display key.
  createCalendar: (body: Partial<CalendarEntry> & { url?: string }) => MOCK ? mock.createCalendar(body) : post<CalendarEntry>('api/calendars', body, true),
  updateCalendar: (id: string, body: Partial<CalendarEntry> & { url?: string }) => MOCK ? mock.updateCalendar(id, body) : patch<CalendarEntry>(`api/calendars/${id}`, body),
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

  getStickerPacks: (memberId: string) => MOCK ? mock.getStickerPacks(memberId) : get<StickerPack[]>(`api/stickers/packs?memberId=${encodeURIComponent(memberId)}`),
  buyStickerPack: (packId: string, memberId: string) =>
    MOCK ? mock.buyStickerPack(packId, memberId) : post<{ pack: StickerPack; balance: number }>(`api/stickers/packs/${packId}/buy`, { memberId }),
  getScrapbook: (memberId: string) => MOCK ? mock.getScrapbook(memberId) : get<StickerPlacement[]>(`api/stickers/scrapbook/${memberId}`),
  placeSticker: (memberId: string, body: StickerPatch & { sticker: string }) =>
    MOCK ? mock.placeSticker(memberId, body) : post<StickerPlacement>(`api/stickers/scrapbook/${memberId}`, body),
  updateSticker: (memberId: string, id: string, body: StickerPatch) =>
    MOCK ? mock.updateSticker(memberId, id, body) : patch<StickerPlacement>(`api/stickers/scrapbook/${memberId}/${id}`, body),
  // Photos: anyone can look, only admin keys change them (the admin key is used when unlocked).
  getPhotos: () => MOCK ? mock.getPhotos() : get<Photo[]>('api/photos'),
  getPhotoQuota: () => MOCK ? mock.getPhotoQuota() : get<PhotoQuota>('api/photos/quota'),
  uploadPhoto: (blob: Blob, width: number, height: number, caption?: string) => MOCK ? mock.uploadPhoto(blob, width, height, caption)
    : req<Photo>(`api/photos${caption ? `?caption=${encodeURIComponent(caption)}` : ''}`, {
      method: 'POST', body: blob, useAdmin: true,
      headers: { 'Content-Type': blob.type, 'X-Photo-Width': String(width), 'X-Photo-Height': String(height) },
    }),
  updatePhoto: (id: string, body: { caption?: string | null; memberId?: string | null }) => MOCK ? mock.updatePhoto(id, body) : patch<Photo>(`api/photos/${id}`, body, true),
  deletePhoto: (id: string) => MOCK ? mock.deletePhoto(id) : del(`api/photos/${id}`, true),
  /** An <img src> for a photo: it can't send the Bearer header, so the key rides as ?key= (the server
   * accepts that on this one route). The demo's photos are plain public URLs. */
  // Zip backup of every photo (admin). A plain download link, so the key rides as ?key= like the OAuth start.
  photoExportUrl: () => apiUrl(`api/photos/export.zip?key=${encodeURIComponent(getAdminKey() ?? getKey() ?? '')}`),
  importPhotos: (zip: File) => MOCK ? mock.importPhotos() : req<{ imported: number; skipped: number }>('api/photos/import', {
    method: 'POST', body: zip, useAdmin: true, headers: { 'Content-Type': 'application/zip' },
  }),
  photoImageUrl: (p: Pick<Photo, 'id' | 'url'>) => MOCK ? p.url : apiUrl(`api/photos/${p.id}/image?key=${encodeURIComponent(getKey() ?? '')}`),
  removeSticker: (memberId: string, id: string) => MOCK ? mock.removeSticker(memberId, id) : del(`api/stickers/scrapbook/${memberId}/${id}`),

  getLists: (archived?: boolean) => MOCK ? mock.getLists(archived) : get<List[]>(`api/lists${archived ? '?archived=true' : ''}`),
  createList: (body: Partial<List>) => MOCK ? mock.createList(body) : post<List>('api/lists', body),
  getList: (id: string) => MOCK ? mock.getList(id) : get<ListDetail>(`api/lists/${id}`),
  updateList: (id: string, body: Partial<List>) => MOCK ? mock.updateList(id, body) : patch<List>(`api/lists/${id}`, body),
  deleteList: (id: string) => MOCK ? mock.deleteList(id) : del(`api/lists/${id}`),
  addListItems: (listId: string, items: ListItemInput | ListItemInput[]) =>
    MOCK ? mock.addListItems(listId, items) : post<ListItem[]>(`api/lists/${listId}/items`, items),
  updateListItem: (listId: string, itemId: string, body: Partial<ListItem>) =>
    MOCK ? mock.updateListItem(listId, itemId, body) : patch<ListItem>(`api/lists/${listId}/items/${itemId}`, body),
  getEventItems: (eventId: string) =>
    MOCK ? mock.getEventItems(eventId) : get<(ListItem & { listName: string })[]>(`api/events/${encodeURIComponent(eventId)}/items`),
  getNotes: (target: NoteTarget) => MOCK ? mock.getNotes(target) : get<Note[]>(`api/notes?target=${encodeURIComponent(target)}`),
  addNote: (target: NoteTarget, body: string, memberId: string | null) => MOCK ? mock.addNote(target, body, memberId) : post<Note>('api/notes', { target, body, memberId }),
  updateNote: (id: string, body: string) => MOCK ? mock.updateNote(id, body) : patch<Note>(`api/notes/${id}`, { body }),
  deleteNote: (id: string) => MOCK ? mock.deleteNote(id) : del(`api/notes/${id}`),
  deleteListItem: (listId: string, itemId: string) => MOCK ? mock.deleteListItem(listId, itemId) : del(`api/lists/${listId}/items/${itemId}`),
  clearListCompleted: (listId: string) => MOCK ? mock.clearListCompleted(listId) : post<{ deleted: number }>(`api/lists/${listId}/clear-completed`),
  resetList: (listId: string) => MOCK ? mock.resetList(listId) : post<{ reset: number }>(`api/lists/${listId}/reset`),
  // Step routes answer with the whole updated item (it may have auto-completed or re-opened).
  addListItemStep: (listId: string, itemId: string, title: string) =>
    MOCK ? mock.addListItemStep(listId, itemId, title) : post<ListItem>(`api/lists/${listId}/items/${itemId}/steps`, { title }),
  updateListItemStep: (listId: string, itemId: string, stepId: string, body: { title?: string; done?: boolean }) =>
    MOCK ? mock.updateListItemStep(listId, itemId, stepId, body) : patch<ListItem>(`api/lists/${listId}/items/${itemId}/steps/${stepId}`, body),
  deleteListItemStep: (listId: string, itemId: string, stepId: string) =>
    MOCK ? mock.deleteListItemStep(listId, itemId, stepId) : del<ListItem>(`api/lists/${listId}/items/${itemId}/steps/${stepId}`),
  reorderListItemSteps: (listId: string, itemId: string, stepIds: string[]) =>
    MOCK ? mock.reorderListItemSteps(listId, itemId, stepIds) : post<ListItem>(`api/lists/${listId}/items/${itemId}/steps/reorder`, { stepIds }),
  reorderListItems: (listId: string, itemIds: string[]) =>
    MOCK ? mock.reorderListItems(listId, itemIds) : post<{ ok: boolean }>(`api/lists/${listId}/reorder`, { itemIds }),
  setListGroups: (listId: string, groups: { kind: 'store' | 'category'; name: string }[]) =>
    MOCK ? mock.setListGroups(listId, groups) : put<ListGroup[]>(`api/lists/${listId}/groups`, { groups }),

  getCategories: () => MOCK ? mock.getCategories() : get<Category[]>('api/categories'),
  createCategory: (body: Partial<Category>) => MOCK ? mock.createCategory(body) : post<Category>('api/categories', body),
  updateCategory: (id: string, body: Partial<Category>) => MOCK ? mock.updateCategory(id, body) : patch<Category>(`api/categories/${id}`, body),
  deleteCategory: (id: string) => MOCK ? mock.deleteCategory(id) : del(`api/categories/${id}`),
  reorderCategories: (ids: string[]) => MOCK ? mock.reorderCategories(ids) : post<{ ok: boolean }>('api/categories/reorder', { ids }),

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
  pairApprove: (code: string, name: string, owner: string) => post<{ keyId: string; name: string }>('api/pair/approve', { code, name, owner }, true),
  setKeyOwner: (id: string, owner: string) => patch<ApiKey>(`api/keys/${id}`, { owner }, true),
  // OAuth consent (#/authorize) and Settings → Access → Connected apps.
  authorizationRequest: (qs: string) => get<{ clientName: string; redirectHost: string; requestedScope: 'admin' | 'display' }>(`api/authorizations/request?${qs}`, true),
  decideAuthorization: (body: Record<string, string | undefined>) => post<{ redirect: string }>('api/authorizations/approve', body, true),
  getAuthorizations: () => MOCK ? Promise.resolve([]) : get<{ id: string; clientName: string; scope: 'admin' | 'display'; approvedBy: string | null; createdAt: string; lastUsedAt: string | null }[]>('api/authorizations'),
  revokeAuthorization: (id: string) => del(`api/authorizations/${id}`),

  getWebhooks: () => MOCK ? mock.getWebhooks() : get<Webhook[]>('api/webhooks', true),
  // Raw JSON file (not parsed): the caller hands the Blob straight to a download link.
  exportData: async (): Promise<Blob> => {
    const key = getAdminKey() ?? getKey()
    const res = await fetch(apiUrl('api/export'), { headers: key ? { Authorization: `Bearer ${key}` } : {} })
    if (!res.ok) throw new ApiError(res.status, res.statusText || 'Export failed')
    return res.blob()
  },
  importData: (file: unknown) => post<ImportResult>('api/import', file, true),
  getHostEvents: () => MOCK ? Promise.resolve([]) : get<HostEvent[]>('api/host-events', true),
  createWebhook: (url: string, events: string[], secret?: string) =>
    MOCK ? mock.createWebhook(url, events) : post<WebhookWithSecret>('api/webhooks', { url, events, secret }, true),
  rotateWebhookSecret: (id: string) => MOCK ? mock.rotateWebhookSecret(id) : post<WebhookWithSecret>(`api/webhooks/${id}/rotate`, {}, true),
  updateWebhook: (id: string, body: Partial<Webhook>) => MOCK ? mock.updateWebhook(id, body) : patch<Webhook>(`api/webhooks/${id}`, body, true),
  deleteWebhook: (id: string) => MOCK ? mock.deleteWebhook(id) : del(`api/webhooks/${id}`, true),

  // Passkeys (WebAuthn). register/options+verify take `useAdmin` when called with the in-memory
  // setup-wizard admin key (see webauthn.ts's registerPasskey, called from Setup.tsx); a `token`
  // instead authorizes a not-yet-signed-in device (the QR "finish on your phone" flow), so those
  // two calls skip the bearer key entirely and go straight through `req`.
  passkeyRegisterOptions: (token?: string, useAdmin?: boolean, authenticator?: PasskeyAuthenticator) =>
    token ? post<Record<string, unknown>>('api/passkeys/register/options', { token, authenticator })
      : post<Record<string, unknown>>('api/passkeys/register/options', { authenticator }, useAdmin),
  passkeyRegisterVerify: (body: { token?: string; name: string; response: unknown }, useAdmin?: boolean) =>
    body.token ? post<{ id: string; name: string; session?: { key: string; expiresAt: string } }>('api/passkeys/register/verify', body)
      : post<{ id: string; name: string; session?: { key: string; expiresAt: string } }>('api/passkeys/register/verify', body, useAdmin),
  passkeyRegisterToken: () => post<{ token: string; expiresAt: string }>('api/passkeys/register-token', undefined, true),
  passkeyLoginOptions: () => post<Record<string, unknown>>('api/passkeys/login/options'),
  passkeyLoginVerify: (response: unknown) => post<{ key: string; expiresAt: string }>('api/passkeys/login/verify', { response }),
  getPasskeys: () => get<Passkey[]>('api/passkeys', true),
  renamePasskey: (id: string, name: string) => patch<Passkey>(`api/passkeys/${id}`, { name }, true),
  deletePasskey: (id: string) => del(`api/passkeys/${id}`, true),
  generateRecoveryCodes: () => post<{ codes: string[] }>('api/recovery-codes', undefined, true),
  getRecoveryCodes: () => MOCK ? Promise.resolve({ total: 0, remaining: 0, createdAt: null }) : get<{ total: number; remaining: number; createdAt: string | null }>('api/recovery-codes', true),
  recoveryLogin: (code: string) => post<{ key: string; expiresAt: string; remaining: number }>('api/recovery/login', { code }),
  sessionLogout: () => post<{ ok: boolean }>('api/sessions/logout'),

  // Web Push. MOCK has no service worker / push manager to stand in for, so these skip the
  // mock-mode branch other calls use - the Settings UI itself checks `pushSupported()` first.
  getVapidPublicKey: () => get<{ publicKey: string }>('api/push/vapid-public-key'),
  subscribePush: (body: { subscription: PushSubscriptionJSON; deviceName: string; memberIds?: string[]; prefs?: Partial<PushSubscriptionPrefs> }) =>
    post<PushSubscription>('api/push/subscriptions', body),
  updatePushSubscription: (id: string, body: { deviceName?: string; memberIds?: string[]; prefs?: Partial<PushSubscriptionPrefs> }) =>
    patch<PushSubscription>(`api/push/subscriptions/${id}`, body),
  deletePushSubscription: (id: string) => del<{ ok: boolean }>(`api/push/subscriptions/${id}`),
  getPushSubscriptions: () => get<PushSubscription[]>('api/push/subscriptions', true),
  testPush: (id: string) => post<{ ok: boolean }>(`api/push/test/${id}`),
  sendNotification: (body: { title: string; body: string; memberIds?: string[]; url?: string }) =>
    MOCK ? mock.sendNotification(body) : post<{ ok: boolean; sent: number }>('api/notify', body, true),
  getNotifications: (limit = 50) => MOCK ? mock.getNotifications() : get<AppNotification[]>(`api/notifications?limit=${limit}`),
  deleteNotification: (id: string) => MOCK ? mock.deleteNotification(id) : del(`api/notifications/${id}`, true),
  clearNotifications: () => MOCK ? mock.clearNotifications() : del<{ ok: true; deleted: number }>('api/notifications', true),
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
export function usePoll(intervalMs = 30000) {
  const [tick, setTick] = useState(0)
  const [unauthorized, setUnauthorized] = useState(false)
  const lastRev = useRef<number | null>(null)

  useEffect(() => {
    let canceled = false
    const check = async () => {
      if (!getKey()) return // no key yet (pairing screen) - nothing to poll, and a 401 here is meaningless
      try {
        const { rev } = await api.getRev()
        if (canceled) return
        if (lastRev.current !== null && rev !== lastRev.current) setTick(t => t + 1)
        lastRev.current = rev
      } catch (e) {
        if (!canceled && e instanceof ApiError && e.status === 401) setUnauthorized(true)
        // otherwise offline / transient — ignore, next poll will retry
      }
    }
    check()
    const id = setInterval(check, intervalMs)
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    return () => { canceled = true; clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [intervalMs])

  return { tick, unauthorized }
}
