import { useEffect, useRef, useState } from 'react'
import { tellAppSignedIn, tellAppSignedOut } from './native.ts'
import { mock, mockPlugins } from './mock.ts'
import { applyChoreOps, applyListOps, cacheGet, cachePut, clearOffline, enqueue, flush, onOutboxChange, outboxReady, pendingOps, type Dropped, type Op } from './outbox.ts'
import type { CustomScheme } from './skins.ts'
import type { PasskeyAuthenticator } from './webauthn.ts'
import type { Meal, MealInput, Recipe, RecipeInput, ShoppingProjection } from './meal-types.ts'
import type { ActivityChoreProgress, OnlineTidbits, Plugin, PluginCatalogEntry,
  StickerPack, StickerPatch, StickerPlacement, Photo, PhotoQuota, Reward, Redemption,
  Account, ApiKey, AppNotification, Appearance, CalendarEntry, Category, Chore, ChoreDay, PendingApproval, EventInstance, LeaderboardEntry, LeaderboardPeriod, List,
  GeocodeResult, HostEvent, ImportResult, ListDetail, ListGroup, ListItem, ListItemInput, ListItemPatch, Member, Me, Note, NoteTarget, Passkey, TrackerEntry, TrackerInput, TrackerKind, Providers, PushSubscription, PushSubscriptionPrefs, RemoteCalendar, Settings, Snapshot, Board, Webhook, WebhookWithSecret,
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
  syncNow() // changes queued before a rejected key was replaced
}
/** `rejected`: the server refused the key (revoked, or an app's short-lived key lapsed);
 * `signOut`: the person chose to sign out or unpair. */
export function clearKey(reason: 'signOut' | 'rejected' = 'signOut'): Promise<void> {
  localStorage.removeItem(KEY_STORAGE)
  tellAppSignedOut(reason)
  // Offline copies go with the key (and at start-up with no key: see below). A rejected key
  // (revoked, or the app's sign-in lapsed) keeps its queued changes: the same household signs in
  // again on this device and they go then. Await it before reloading.
  return Promise.all([
    clearOffline(reason === 'rejected'),
    reason === 'signOut' && 'caches' in window ? caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))) : null,
  ]).then(() => {}, () => {})
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

// ---- offline --------------------------------------------------------------------------------
// Reads: the GETs below keep their last good answer (IndexedDB, per server) and fall back to it
// when the network fails or dawdles. Writes: list item and chore ticks go through a persistent
// outbox (outbox.ts) and replay when the connection returns; every other write says it needs one.

export const OFFLINE_MESSAGE = "You're offline. This will work when you're back online."
// What an ordinary view reads. Not admin-only data (trackers, keys, accounts, webhooks) and never
// with the temporary admin key.
const CACHEABLE = /^api\/(me|settings|appearance|members|categories|lists|board|snapshot|events|chores|meals|recipes|notes|notifications|leaderboard)([/?]|$)/
const SLOW_MS = 4000 // one bar in a grocery store: show the last copy rather than a spinner

let offline = typeof navigator !== 'undefined' && navigator.onLine === false
const offlineListeners = new Set<() => void>()
function setOffline(v: boolean) {
  if (v === offline) return
  offline = v
  offlineListeners.forEach(l => l())
  if (!v) syncNow()
}
const outboxTag = () => apiUrl('api/')

/** { offline, pending }: offline once a request fails for want of a network (or the browser says
 * so) until one gets through; pending = queued changes not yet on the server. */
export function useOffline(): { offline: boolean; pending: number } {
  const [, rerender] = useState(0)
  useEffect(() => {
    const on = () => rerender(n => n + 1)
    offlineListeners.add(on)
    const off = onOutboxChange(on)
    return () => { offlineListeners.delete(on); off() }
  }, [])
  return { offline, pending: MOCK ? 0 : pendingOps(outboxTag()).length }
}

async function cachedGet<T>(path: string): Promise<T> {
  const k = apiUrl(path)
  const fresh = send<T>(path, {})
  fresh.then(v => cachePut(k, v)).catch(() => {})
  const stale = cacheGet<T>(k)
  return new Promise<T>((resolve, reject) => {
    const fallback = (e: unknown) => stale.then(v => (v !== undefined ? resolve(v) : reject(e)), () => reject(e))
    fresh.then(resolve, e => (e instanceof ApiError && e.status === 0 ? fallback(e) : reject(e)))
    setTimeout(() => stale.then(v => { if (v !== undefined) resolve(v) }, () => {}), SLOW_MS)
  })
}

type SyncResult = { sent: number; dropped: Dropped[] }
const syncListeners = new Set<(r: SyncResult) => void>()
/** Called after a replay sent or dropped something: refresh views, and say what was dropped. */
export const onSynced = (l: (r: SyncResult) => void) => { syncListeners.add(l); return () => { syncListeners.delete(l) } }

/** Replay queued changes now (no-op in the demo, signed out, or known offline). */
export function syncNow() {
  if (MOCK || !getKey() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
  flush(outboxTag(), op => {
    const init = { method: op.method, body: op.body === undefined ? undefined : JSON.stringify(op.body) }
    return offline ? send(op.path, init) : trackSave(send(op.path, init)) // no "Saving…" flashes while retrying offline
  }).then(r => { if (r.sent || r.dropped.length) syncListeners.forEach(l => l(r)) }, () => {})
}

/** Queues a change (shown at once, sent in order, kept across reloads) and starts sending it. */
function queue(method: Op['method'], path: string, body?: unknown): Op {
  const op: Op = { tag: outboxTag(), method, path, body }
  enqueue(op).then(syncNow, syncNow)
  return op
}

if (!MOCK && typeof window !== 'undefined') {
  window.addEventListener('online', () => { setOffline(false); syncNow() })
  window.addEventListener('offline', () => setOffline(true))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow() })
  setInterval(() => { if (pendingOps(outboxTag()).length) syncNow() }, 15000)
  if (getKey()) outboxReady().then(syncNow)
  else clearOffline().catch(() => {}) // signed out (however it happened): nothing kept for the next person
}

async function req<T>(path: string, opts: RequestInit & { useAdmin?: boolean } = {}): Promise<T> {
  const isChange = !!opts.method && opts.method !== 'GET' && path !== 'api/pair/poll'
  return isChange ? trackSave(send<T>(path, opts)) : send<T>(path, opts)
}

async function send<T>(path: string, opts: RequestInit & { useAdmin?: boolean }): Promise<T> {
  if (MOCK && /^api\/(meals|recipes)([/?]|$)/.test(path)) {
    const { mockMealRequest } = await import('./mock-meals.ts')
    return mockMealRequest(path, opts) as Promise<T>
  }
  const { useAdmin, ...init } = opts
  const key = useAdmin ? (getAdminKey() ?? getKey()) : getKey()
  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    // No response at all: no network (or the server is unreachable). Status 0 tells callers apart.
    setOffline(true)
    throw new ApiError(0, OFFLINE_MESSAGE)
  }
  setOffline(false)
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

const get = <T,>(path: string, useAdmin?: boolean) => (!useAdmin && getKey() && CACHEABLE.test(path) ? cachedGet<T>(path) : req<T>(path, { useAdmin }))
const post = <T,>(path: string, body?: unknown, useAdmin?: boolean) => req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), useAdmin })
const patch = <T,>(path: string, body: unknown, useAdmin?: boolean) => req<T>(path, { method: 'PATCH', body: JSON.stringify(body), useAdmin })
const put = <T,>(path: string, body: unknown, useAdmin?: boolean) => req<T>(path, { method: 'PUT', body: JSON.stringify(body), useAdmin })
const del = <T,>(path: string, useAdmin?: boolean) => req<T>(path, { method: 'DELETE', useAdmin })

export const api = {
  getRecipes: (archived = false) => get<Recipe[]>(`api/recipes?archived=${archived}`),
  createRecipe: (body: RecipeInput) => post<Recipe>('api/recipes', body),
  updateRecipe: (id: string, body: Partial<RecipeInput>) => patch<Recipe>(`api/recipes/${encodeURIComponent(id)}`, body),
  deleteRecipe: (id: string) => del(`api/recipes/${encodeURIComponent(id)}`),
  getMeals: (from: string, to: string) => get<Meal[]>(`api/meals?${new URLSearchParams({ from, to })}`),
  createMeal: (body: MealInput) => post<Meal>('api/meals', body),
  updateMeal: (id: string, body: Partial<MealInput> & { refreshRecipe?: boolean }) => patch<Meal>(`api/meals/${encodeURIComponent(id)}`, body),
  deleteMeal: (id: string) => del(`api/meals/${encodeURIComponent(id)}`),
  linkMealCalendar: (id: string, eventId: string) => post<Meal>(`api/meals/${encodeURIComponent(id)}/calendar-link`, { eventId }),
  unlinkMealCalendar: (id: string) => del<Meal>(`api/meals/${encodeURIComponent(id)}/calendar-link`),
  createMealCalendarEvent: (id: string, body: { calendarId?: string; durationMinutes?: number }) => post<Meal>(`api/meals/${encodeURIComponent(id)}/calendar-event`, body),
  getMealProjection: (from: string, to: string, listId?: string) => get<ShoppingProjection>(`api/meals/projection?${new URLSearchParams({ from, to, ...(listId ? { listId } : {}) })}`),
  applyMealProjection: (body: { from: string; to: string; listId: string; omitKeys: string[]; includeNotes: boolean; includeKitItems?: boolean }) => post<{ added: number; itemIds: string[]; projection: ShoppingProjection }>('api/meals/projection/apply', body),

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
  meStrict: (): Promise<Me> => MOCK ? Promise.resolve({ scope: 'admin', keyName: 'mock', kind: 'api', locked: false }) : get<Me>('api/me'),

  getSettings: (useAdmin?: boolean) => MOCK ? mock.getSettings() : get<Settings>('api/settings', useAdmin),
  // useAdmin: the setup wizard saves household settings with the in-memory admin key when this
  // device only just claimed a display-scope key (settings PATCH isn't display-allowed).
  addColorScheme: (scheme: CustomScheme) => MOCK ? mock.updateSettings({}) : post<Settings>('api/settings/color-schemes', scheme),
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
    MOCK ? Promise.all([mock.getSnapshot(memberId, range), import('./mock-meals.ts')]).then(([s, { mockMeals }]) =>
      ({ ...s, meals: mockMeals(s.from, s.to), tomorrow: s.tomorrow && { ...s.tomorrow, meals: mockMeals(s.tomorrow.date, s.tomorrow.date) } }))
    : get<Snapshot>(`api/snapshot?member=${encodeURIComponent(memberId)}&range=${range}`),
  // Server-side lookup (Open-Meteo): the browser never talks to the geocoder itself.
  getBoard: (days = 7) => MOCK ? Promise.all([mock.getBoard(days), import('./mock-meals.ts')]).then(([b, { mockMeals }]) => ({ ...b, meals: mockMeals(b.today, b.to) })) : get<Board>(`api/board?days=${days}`),
  getTidbits: () => MOCK ? mock.getTidbits() : get<OnlineTidbits>('api/tidbits'),

  // Activity plugins. The demo serves the reviewed ones baked into its build (mock.ts mockPlugins).
  getPluginCatalog: () => MOCK ? mockPlugins.catalog() : get<{ catalogOnly: boolean; plugins: PluginCatalogEntry[] }>('api/plugins/catalog'),
  getPlugins: () => MOCK ? mockPlugins.list() : get<Plugin[]>('api/plugins'),
  installPlugin: (url: string) => MOCK ? mockPlugins.install(url) : post<Plugin>('api/plugins', { url }, true),
  uploadPlugin: (zip: File) => req<Plugin>('api/plugins', { method: 'POST', body: zip, useAdmin: true, headers: { 'Content-Type': 'application/zip' } }),
  updatePlugin: (id: string) => MOCK ? mockPlugins.list().then(l => l.find(p => p.id === id)!) : post<Plugin>(`api/plugins/${id}/update`, undefined, true),
  setPluginEnabled: (id: string, enabled: boolean) => MOCK ? mockPlugins.setEnabled(id, enabled) : patch<Plugin>(`api/plugins/${id}`, { enabled }, true),
  deletePlugin: (id: string) => MOCK ? mockPlugins.remove(id) : del(`api/plugins/${id}`, true),
  getPluginData: (id: string, member: string) => MOCK ? mockPlugins.load(id, member) : get<Record<string, unknown>>(`api/plugins/${id}/data?member=${encodeURIComponent(member)}`),
  savePluginData: (id: string, member: string, key: string, value: unknown) => MOCK ? mockPlugins.save(id, member, key, value) : put<void>(`api/plugins/${id}/data`, { member, key, value }),
  // Not a tracked save: a background heartbeat shouldn't flash "Saving…". keepalive lets the last one
  // go out as the page closes.
  sendPlaytime: (id: string, member: string, seconds: number) => MOCK ? Promise.resolve([] as ActivityChoreProgress[])
    : send<ActivityChoreProgress[]>(`api/plugins/${id}/playtime`, { method: 'POST', body: JSON.stringify({ member, seconds }), keepalive: true }),
  pluginUrl: (p: Pick<Plugin, 'url'>) => apiUrl(p.url.replace(/^\//, '')),

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

  getChoresDay: (date: string) => MOCK ? mock.getChoresDay(date)
    : Promise.all([get<ChoreDay[]>(`api/chores/day?date=${date}`), outboxReady()]).then(([c]) => applyChoreOps(c, date, pendingOps(outboxTag()))),
  createChore: (body: Partial<Chore>) => MOCK ? mock.createChore(body) : post<Chore>('api/chores', body),
  updateChore: (id: string, body: Partial<Chore>) => MOCK ? mock.updateChore(id, body) : patch<Chore>(`api/chores/${id}`, body),
  deleteChore: (id: string) => MOCK ? mock.deleteChore(id) : del(`api/chores/${id}`),
  completeChore: (id: string, date: string, memberId?: string) =>
    MOCK ? mock.completeChore(id, date, memberId) : post(`api/chores/${id}/complete`, { date, memberId }),
  uncompleteChore: (id: string, date: string) =>
    MOCK ? mock.uncompleteChore(id, date) : del(`api/chores/${id}/complete?date=${date}`),
  // Parent approval (parent devices only).
  getPendingApprovals: () => MOCK ? Promise.resolve([] as PendingApproval[]) : get<PendingApproval[]>('api/chores/pending'),
  approveChore: (id: string, date: string) => post<{ ok: boolean; points: number }>(`api/chores/${id}/approve`, { date }),
  rejectChore: (id: string, date: string, note?: string) => post<{ ok: boolean }>(`api/chores/${id}/reject`, { date, note }),

  getLeaderboard: (period: LeaderboardPeriod) =>
    MOCK ? mock.getLeaderboard(period) : get<LeaderboardEntry[]>(`api/leaderboard?period=${period}`),

  getStickerPacks: (memberId: string) => MOCK ? mock.getStickerPacks(memberId) : get<StickerPack[]>(`api/stickers/packs?memberId=${encodeURIComponent(memberId)}`),
  buyStickerPack: (packId: string, memberId: string) =>
    MOCK ? mock.buyStickerPack(packId, memberId) : post<{ pack: StickerPack; balance: number }>(`api/stickers/packs/${packId}/buy`, { memberId }),
  // Rewards: anyone lists and redeems (a member's own device only for them); parents manage and decide.
  getRewards: (opts: { memberId?: string; archived?: boolean } = {}) => MOCK ? mock.getRewards(opts)
    : get<Reward[]>(`api/rewards?${new URLSearchParams({ ...(opts.memberId ? { memberId: opts.memberId } : {}), ...(opts.archived ? { archived: 'true' } : {}) })}`),
  createReward: (body: Partial<Reward>) => MOCK ? mock.createReward(body) : post<Reward>('api/rewards', body),
  updateReward: (id: string, body: Partial<Reward>) => MOCK ? mock.updateReward(id, body) : patch<Reward>(`api/rewards/${id}`, body),
  deleteReward: (id: string) => MOCK ? mock.deleteReward(id) : del(`api/rewards/${id}`),
  redeemReward: (id: string, memberId: string) =>
    MOCK ? mock.redeemReward(id, memberId) : post<{ redemption: Redemption; balance: number }>(`api/rewards/${id}/redeem`, { memberId }),
  getRedemptions: (opts: { memberId?: string; status?: string; limit?: number } = {}) => MOCK ? mock.getRedemptions(opts)
    : get<Redemption[]>(`api/rewards/redemptions?${new URLSearchParams(Object.entries(opts).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`),
  decideRedemption: (id: string, action: 'approve' | 'decline' | 'given', note?: string) =>
    MOCK ? mock.decideRedemption(id, action, note) : post<Redemption>(`api/rewards/redemptions/${id}/${action}`, action === 'decline' ? { note } : undefined),
  setRewardGoal: (memberId: string, rewardId: string | null) =>
    MOCK ? mock.setRewardGoal(memberId, rewardId) : put<{ rewardId: string | null }>(`api/members/${memberId}/reward-goal`, { rewardId }),
  getScrapbook: (memberId: string) => MOCK ? mock.getScrapbook(memberId) : get<StickerPlacement[]>(`api/stickers/scrapbook/${memberId}`),
  placeSticker: (memberId: string, body: StickerPatch & { sticker: string }) =>
    MOCK ? mock.placeSticker(memberId, body) : post<StickerPlacement>(`api/stickers/scrapbook/${memberId}`, body),
  updateSticker: (memberId: string, id: string, body: StickerPatch) =>
    MOCK ? mock.updateSticker(memberId, id, body) : patch<StickerPlacement>(`api/stickers/scrapbook/${memberId}/${id}`, body),
  // Photos: anyone can look, only admin keys change them (the admin key is used when unlocked).
  getPhotos: () => MOCK ? mock.getPhotos() : get<Photo[]>('api/photos'),
  getPhotoQuota: () => MOCK ? mock.getPhotoQuota() : get<PhotoQuota>('api/photos/quota'),
  /** family false: a memory's own photo, kept out of the family photos (attach it to the memory). */
  uploadPhoto: (blob: Blob, width: number, height: number, caption?: string, family = true) => MOCK ? mock.uploadPhoto(blob, width, height, caption, family)
    : req<Photo>(`api/photos?${new URLSearchParams({ ...(caption ? { caption } : {}), ...(family ? {} : { family: '0' }) })}`, {
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
  /** The same by id alone, for a memory's photo (its own photo isn't in getPhotos). */
  photoImageUrlById: (id: string) => MOCK ? mock.photoUrl(id) : apiUrl(`api/photos/${id}/image?key=${encodeURIComponent(getKey() ?? '')}`),
  removeSticker: (memberId: string, id: string) => MOCK ? mock.removeSticker(memberId, id) : del(`api/stickers/scrapbook/${memberId}/${id}`),

  getLists: (archived?: boolean) => MOCK ? mock.getLists(archived) : get<List[]>(`api/lists${archived ? '?archived=true' : ''}`),
  createList: (body: Partial<List>) => MOCK ? mock.createList(body) : post<List>('api/lists', body),
  // Queued changes show on top of what the server (or the offline copy) says.
  getList: (id: string) => MOCK ? mock.getList(id) : Promise.all([get<ListDetail>(`api/lists/${id}`), outboxReady()]).then(([d]) => applyListOps(d, pendingOps(outboxTag()))),
  updateList: (id: string, body: Partial<List>) => MOCK ? mock.updateList(id, body) : patch<List>(`api/lists/${id}`, body),
  deleteList: (id: string) => MOCK ? mock.deleteList(id) : del(`api/lists/${id}`),
  addListItems: (listId: string, items: ListItemInput | ListItemInput[]) =>
    MOCK ? mock.addListItems(listId, items) : post<ListItem[]>(`api/lists/${listId}/items`, items),
  updateListItem: (listId: string, itemId: string, body: ListItemPatch) =>
    MOCK ? mock.updateListItem(listId, itemId, body) : patch<ListItem>(`api/lists/${listId}/items/${itemId}`, body),
  getEventItems: (eventId: string) =>
    MOCK ? mock.getEventItems(eventId) : get<(ListItem & { listName: string })[]>(`api/events/${encodeURIComponent(eventId)}/items`),
  getTrackers: (kind: TrackerKind) => MOCK ? mock.getTrackers(kind) : get<TrackerEntry[]>(`api/trackers?kind=${kind}`),
  addTracker: (body: TrackerInput & { kind: TrackerKind }) => MOCK ? mock.addTracker(body) : post<TrackerEntry>('api/trackers', body),
  updateTracker: (id: string, body: TrackerInput) => MOCK ? mock.updateTracker(id, body) : patch<TrackerEntry>(`api/trackers/${id}`, body),
  deleteTracker: (id: string) => MOCK ? mock.deleteTracker(id) : del(`api/trackers/${id}`),
  getNotes: (target: NoteTarget) => MOCK ? mock.getNotes(target) : get<Note[]>(`api/notes?target=${encodeURIComponent(target)}`),
  addNote: (target: NoteTarget, body: string, memberId: string | null) => MOCK ? mock.addNote(target, body, memberId) : post<Note>('api/notes', { target, body, memberId }),
  updateNote: (id: string, body: string) => MOCK ? mock.updateNote(id, body) : patch<Note>(`api/notes/${id}`, { body }),
  deleteNote: (id: string) => MOCK ? mock.deleteNote(id) : del(`api/notes/${id}`),
  deleteListItem: (listId: string, itemId: string) => MOCK ? mock.deleteListItem(listId, itemId) : del(`api/lists/${listId}/items/${itemId}`),
  // Offline-capable versions for the Lists and Chores tabs: each resolves at once with the queued
  // change (apply it with applyListOps for an instant UI); the demo runs its mock and gets null.
  // Idempotent on replay: a client-made id for a new item, "done: true/false" rather than a toggle.
  queueAddListItem: async (listId: string, input: ListItemInput): Promise<Op | null> =>
    MOCK ? (await mock.addListItems(listId, input), null) : queue('POST', `api/lists/${listId}/items`, { ...input, id: crypto.randomUUID() }),
  queueUpdateListItem: async (listId: string, itemId: string, body: ListItemPatch): Promise<Op | null> =>
    MOCK ? (await mock.updateListItem(listId, itemId, body), null) : queue('PATCH', `api/lists/${listId}/items/${itemId}`, body),
  queueDeleteListItem: async (listId: string, itemId: string): Promise<Op | null> =>
    MOCK ? (await mock.deleteListItem(listId, itemId), null) : queue('DELETE', `api/lists/${listId}/items/${itemId}`),
  queueCompleteChore: async (id: string, date: string, memberId?: string): Promise<unknown> =>
    MOCK ? mock.completeChore(id, date, memberId) : queue('POST', `api/chores/${id}/complete`, { date, memberId }),
  queueUncompleteChore: async (id: string, date: string): Promise<unknown> =>
    MOCK ? mock.uncompleteChore(id, date) : queue('DELETE', `api/chores/${id}/complete?date=${date}`),
  // Checkout / Reset: only itemIds (still checked) when given, so a tick made meanwhile isn't swept up.
  // store: Checkout at the end of a shopping trip - remembered as where these were last bought.
  clearListCompleted: (listId: string, itemIds?: string[], store?: string) => MOCK ? mock.clearListCompleted(listId, itemIds, store) : post<{ deleted: number }>(`api/lists/${listId}/clear-completed`, itemIds ? { itemIds, ...(store ? { store } : {}) } : undefined),
  resetList: (listId: string, itemIds?: string[]) => MOCK ? mock.resetList(listId, itemIds) : post<{ reset: number }>(`api/lists/${listId}/reset`, itemIds ? { itemIds } : undefined),
  // Stores & departments: rename (to) or remove (to: null) a value everywhere; a store's aisle order.
  renameListValue: (body: { field: 'store' | 'category' | 'aisle'; from: string; to: string | null; store?: string | null }) =>
    MOCK ? mock.renameListValue(body) : post<{ updated: number }>('api/lists/values', body),
  // Stop suggesting a remembered item name (and forget where it goes).
  forgetItemName: (key: string) => MOCK ? mock.forgetItemName(key) : del<{ ok: boolean }>(`api/lists/remembered/${encodeURIComponent(key)}`),
  setStoreAisles: (store: string | null, aisles: string[]) =>
    MOCK ? mock.setStoreAisles(store, aisles) : put<{ store: string | null; aisles: string[] }>('api/lists/aisles', { store, aisles }),
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
  authorizationRequest: (qs: string) => get<{ clientName: string; redirectHost: string; requestedScope: 'admin' | 'display'; deviceApp?: boolean }>(`api/authorizations/request?${qs}`, true),
  decideAuthorization: (body: Record<string, string | undefined>) => post<{ redirect: string }>('api/authorizations/approve', body, true),
  getAuthorizations: () => MOCK ? Promise.resolve([]) : get<{ id: string; clientName: string; scope: 'admin' | 'display'; approvedBy: string | null; createdAt: string; lastUsedAt: string | null; owner: string | null; deviceApp: boolean; current?: boolean }[]>('api/authorizations'),
  setAuthorizationOwner: (id: string, owner: string) => patch<{ ok: boolean; owner: string }>(`api/authorizations/${id}`, { owner }),
  revokeAuthorization: (id: string) => del(`api/authorizations/${id}`),

  getWebhooks: () => MOCK ? mock.getWebhooks() : get<Webhook[]>('api/webhooks', true),
  // Raw JSON file (not parsed): the caller hands the Blob straight to a download link.
  exportData: async (): Promise<Blob> => {
    const key = getAdminKey() ?? getKey()
    const res = await fetch(apiUrl('api/export'), { headers: key ? { Authorization: `Bearer ${key}` } : {} })
    if (!res.ok) throw new ApiError(res.status, res.statusText || 'Export failed')
    return res.blob()
  },
  // A recipe card PDF the server fetched from that recipe's or meal's own sourceUrl.
  recipeCardPdf: async (path: string): Promise<ArrayBuffer> => {
    const key = getKey()
    const res = await fetch(apiUrl(path), { headers: key ? { Authorization: `Bearer ${key}` } : {} })
    if (!res.ok) {
      let msg = res.statusText
      try { msg = (await res.json()).error ?? msg } catch { /* not JSON */ }
      throw new ApiError(res.status, msg)
    }
    return res.arrayBuffer()
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
