import type { Skin } from './skins.ts'
import type { CustomColors, ThemeMode } from './types.ts'

// Inside the Kinwall iPhone/iPad/Android app (kinwall-mobile repo: a native frame around this web
// app). The app injects window.kinwallNative before the page loads and adds "KinwallApp/<version>"
// to the user agent. Keep in sync with the bridge in src/WebShell.tsx there.
export const inNativeApp = (): boolean =>
  typeof window !== 'undefined' && (!!(window as Window & { kinwallNative?: unknown }).kinwallNative || /\bKinwallApp\//.test(navigator.userAgent))

/** Which app: window.kinwallNative.platform ('ios' or 'android'); an older app without it is the
 * iPhone app. null in a browser. */
export function appPlatform(): 'ios' | 'android' | null {
  if (!inNativeApp()) return null
  return (window as Window & { kinwallNative?: { platform?: unknown } }).kinwallNative?.platform === 'android' ? 'android' : 'ios'
}

/** Marks <html data-native="ios|android"> so styles can use the space the app gives them: the
 * iPhone app hides the status bar, so the header doesn't need the gap it keeps under it in the
 * browser (Android keeps its status bar, so those rules are iOS-only). */
export function markNativeApp() {
  const p = appPlatform()
  if (p) document.documentElement.dataset.native = p
}

/** Tells the app the page signed out (Unpair, or its key stopped working), so it can refresh an
 * expired sign-in or return to its own sign-in screen. No-op in a browser. */
/** Tells the app the page now has a key (paired or signed in), so it can set up its widgets. */
export function tellAppSignedIn() {
  const w = window as Window & { webkit?: { messageHandlers?: { kinwall?: { postMessage: (m: unknown) => void } } } }
  try { w.webkit?.messageHandlers?.kinwall?.postMessage({ type: 'signedIn' }) } catch { /* not in the app */ }
}

export function tellAppSignedOut(reason: 'signOut' | 'rejected') {
  const w = window as Window & { webkit?: { messageHandlers?: { kinwall?: { postMessage: (m: unknown) => void } } } }
  try { w.webkit?.messageHandlers?.kinwall?.postMessage({ type: 'signedOut', reason }) } catch { /* not in the app */ }
}

/** Shopping mode is showing: asks the app to keep the screen on (a phone otherwise sleeps). The
 * browser's own Screen Wake Lock is held by main.tsx. No-op in a browser. */
export function tellAppKeepAwake(on: boolean) {
  const w = window as Window & { webkit?: { messageHandlers?: { kinwall?: { postMessage: (m: unknown) => void } } } }
  try { w.webkit?.messageHandlers?.kinwall?.postMessage({ type: 'keepAwake', on }) } catch { /* not in the app */ }
}

/** The demo inside the app: "Leave demo" in the demo bar asks the app to go back to its first screen. */
export function tellAppLeaveDemo() {
  const w = window as Window & { webkit?: { messageHandlers?: { kinwall?: { postMessage: (m: unknown) => void } } } }
  try { w.webkit?.messageHandlers?.kinwall?.postMessage({ type: 'leaveDemo' }) } catch { /* not in the app */ }
}

type Surface = { bg: string; card: string }

/** The page's background and card colors in light and dark: custom colors over the scheme's. */
export function surfaces(skin: Skin, custom: CustomColors): { light: Surface; dark: Surface } {
  const pick = (t: Skin['light']) => ({ bg: custom.bg || t.bg, card: custom.card || t.card })
  return { light: pick(skin.light), dark: pick(skin.dark) }
}

let lastAppearance = ''
let realLook: Parameters<typeof tellAppAppearance>[0] | null = null
let nightOn = false
const NIGHT_BG = '#050403' // .quiet-overlay's background
/** The look in effect, so the app paints its frame (and the next launch) in the page's colors
 * instead of flashing its own. Both variants go, so in 'auto' the app can follow the system on
 * its own. Sent only when something changed. No-op in a browser. */
export function tellAppAppearance(a: { mode: ThemeMode; dark: boolean; colors: { light: Surface; dark: Surface } }) {
  realLook = a
  if (!nightOn) postAppearance(a)
}

/** The Night screen covers the page, not the app's frame (the status bar strip): paint the frame
 * the Night screen's black while it shows, and the page's look again after. In a browser, the
 * theme-color does the same for the PWA's and Safari's bars. */
export function tellAppNight(on: boolean) {
  if (on === nightOn) return
  nightOn = on
  if (on) document.documentElement.dataset.night = '1'; else delete document.documentElement.dataset.night
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
  for (const m of metas) {
    if (on) { m.dataset.day = m.content; m.content = NIGHT_BG } else if (m.dataset.day) m.content = m.dataset.day
  }
  const night = { bg: NIGHT_BG, card: NIGHT_BG }
  if (on) postAppearance({ mode: 'dark', dark: true, colors: { light: night, dark: night } })
  else if (realLook) postAppearance(realLook)
}

function postAppearance(a: { mode: ThemeMode; dark: boolean; colors: { light: Surface; dark: Surface } }) {
  const json = JSON.stringify(a)
  if (json === lastAppearance) return
  const w = window as Window & { webkit?: { messageHandlers?: { kinwall?: { postMessage: (m: unknown) => void } } } }
  const app = w.webkit?.messageHandlers?.kinwall
  if (!app) return
  lastAppearance = json
  try { app.postMessage({ type: 'appearance', ...a }) } catch { /* not in the app */ }
}

export type AppActivityKind = 'cooking' | 'shopping' | 'leaveBy' | 'medication'
// undefined: not told since this page loaded (so the first end always goes, in case the app still
// shows one from before a reload); '': ended.
const lastActivity: Partial<Record<AppActivityKind, string>> = {}

/** Starts or updates the app's Live Activity of this kind (liveActivity.ts builds the payload).
 * Sent only when it changed. No-op in a browser. */
export function tellAppActivity(kind: AppActivityKind, payload: object) {
  const json = JSON.stringify(payload)
  if (lastActivity[kind] === json) return
  const w = window as Window & { webkit?: { messageHandlers?: { kinwall?: { postMessage: (m: unknown) => void } } } }
  const app = w.webkit?.messageHandlers?.kinwall
  if (!app) return
  lastActivity[kind] = json
  try { app.postMessage({ type: 'activity', kind, payload }) } catch { /* not in the app */ }
}

/** Ends the app's Live Activity of this kind. No-op in a browser, or when it's already ended. */
export function endAppActivity(kind: AppActivityKind) {
  if (lastActivity[kind] === '') return
  const w = window as Window & { webkit?: { messageHandlers?: { kinwall?: { postMessage: (m: unknown) => void } } } }
  const app = w.webkit?.messageHandlers?.kinwall
  if (!app) return
  lastActivity[kind] = ''
  try { app.postMessage({ type: 'activityEnd', kind }) } catch { /* not in the app */ }
}

/** Whether the iPhone app may show Live Activities (iPhone Settings → Kinwall → Live Activities),
 * as the app last said; null outside the iPhone app (a browser, Android, an older app). */
export function appLiveActivities(): boolean | null {
  if (typeof window === 'undefined') return null
  const v = (window as Window & { kinwallNative?: { liveActivities?: unknown } }).kinwallNative?.liveActivities
  return typeof v === 'boolean' ? v : null
}

/** The Notifications section's line about them, or null where they don't apply. On Android they're
 * ongoing notifications. */
export function liveActivitiesLine(on: boolean | null, platform: 'ios' | 'android' = 'ios'): string | null {
  if (on === null) return null
  if (platform === 'android') return on
    ? 'Countdowns show as ongoing notifications. Turn them off in Android Settings → Apps → Kinwall → Notifications.'
    : 'Countdowns as ongoing notifications: Off in Android Settings. Turn them on in Android Settings → Apps → Kinwall → Notifications.'
  return on
    ? 'Countdowns and timers show on the Lock Screen. Turn them off in iPhone Settings → Kinwall → Live Activities.'
    : 'Countdowns and timers on the Lock Screen: Off in iPhone Settings. Turn them on in iPhone Settings → Kinwall → Live Activities.'
}

let lastLeaveByPush: boolean | undefined
/** Whether this device's person gets transition reminders, so the app registers for the server's
 * leave-by push (a Live Activity while the app is closed) only when they would. Sent on change. */
export function tellAppLeaveByPush(on: boolean) {
  if (lastLeaveByPush === on) return
  const w = window as Window & { webkit?: { messageHandlers?: { kinwall?: { postMessage: (m: unknown) => void } } } }
  const app = w.webkit?.messageHandlers?.kinwall
  if (!app) return
  lastLeaveByPush = on
  try { app.postMessage({ type: 'leaveByPush', on }) } catch { /* not in the app */ }
}

// "Show medicine names" for this device inside the app, which has no web push subscription to keep
// it on (Settings → Notifications). Off by default: the medicine countdown says "Leo's medicine".
const MED_NAMES_KEY = 'kinwall.appMedicationNames'
export const MED_NAMES_EVENT = 'kinwallmednames'
export function appMedicineNames(): boolean {
  try { return localStorage.getItem(MED_NAMES_KEY) === '1' } catch { return false }
}
export function setAppMedicineNames(on: boolean) {
  try { if (on) localStorage.setItem(MED_NAMES_KEY, '1'); else localStorage.removeItem(MED_NAMES_KEY) } catch { /* not kept */ }
  window.dispatchEvent(new Event(MED_NAMES_EVENT))
}

const nativeFlag = (key: 'notificationSettings' | 'quickSettingsTiles'): boolean =>
  typeof window !== 'undefined' && (window as Window & { kinwallNative?: Record<string, unknown> }).kinwallNative?.[key] === true

/** The Android app can open one of its notification channels in Android Settings. */
export const appNotificationSettings = () => nativeFlag('notificationSettings')
/** The Android app can offer its Quick Settings tiles (Android 13 and later). */
export const appQuickSettingsTiles = () => nativeFlag('quickSettingsTiles')

/** Opens a notification channel's page in Android Settings, e.g. 'medicine' for Override Do Not
 * Disturb. No-op in a browser. */
export function openAppNotificationSettings(channel: 'medicine') {
  const w = window as Window & { webkit?: { messageHandlers?: { kinwall?: { postMessage: (m: unknown) => void } } } }
  try { w.webkit?.messageHandlers?.kinwall?.postMessage({ type: 'notificationSettings', channel }) } catch { /* not in the app */ }
}

/** Asks Android to add one of the app's Quick Settings tiles; Android asks the person. No-op in a browser. */
export function addAppTile(tile: 'groceries' | 'night') {
  const w = window as Window & { webkit?: { messageHandlers?: { kinwall?: { postMessage: (m: unknown) => void } } } }
  try { w.webkit?.messageHandlers?.kinwall?.postMessage({ type: 'addTile', tile }) } catch { /* not in the app */ }
}

// A contact shared into the app (Android's share sheet: kinwall-mobile src/WebShell.tsx). The app
// fires IMPORT_CONTACTS_EVENT with the vCard text; main.tsx hands it to receiveSharedContacts,
// which keeps it and opens Contacts, whose Import sheet takes it (parent devices only).
export const IMPORT_CONTACTS_EVENT = 'kinwall:import-contacts'
export const CONTACTS_SHARED_EVENT = 'kinwall:contacts-shared'
let sharedVcard: string | null = null
/** Keeps a shared vCard (up to 2 MB, like a chosen file) and opens Contacts; false if it isn't one. */
export function receiveSharedContacts(vcard: unknown): boolean {
  if (typeof vcard !== 'string' || vcard.length > 2_000_000 || !/BEGIN:VCARD/i.test(vcard)) return false
  sharedVcard = vcard
  location.hash = '#/contacts'
  window.dispatchEvent(new Event(CONTACTS_SHARED_EVENT))
  return true
}
/** The shared vCard, once. */
export function takeSharedContacts(): string | null {
  const v = sharedVcard
  sharedVcard = null
  return v
}
