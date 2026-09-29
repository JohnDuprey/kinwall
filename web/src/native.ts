import type { Skin } from './skins.ts'
import type { CustomColors, ThemeMode } from './types.ts'

// Inside the Kinwall iPhone/iPad/Android app (kinwall-mobile repo: a native frame around this web
// app). The app injects window.kinwallNative before the page loads and adds "KinwallApp/<version>"
// to the user agent. Keep in sync with the bridge in src/WebShell.tsx there.
export const inNativeApp = (): boolean =>
  typeof window !== 'undefined' && (!!(window as Window & { kinwallNative?: unknown }).kinwallNative || /\bKinwallApp\//.test(navigator.userAgent))

/** Marks <html data-native> so styles can use the space the app gives them: the app hides the
 * status bar, so the header doesn't need the gap it keeps under it in the browser. */
export function markNativeApp() {
  if (inNativeApp()) document.documentElement.dataset.native = 'ios'
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
/** The look in effect, so the app paints its frame (and the next launch) in the page's colors
 * instead of flashing its own. Both variants go, so in 'auto' the app can follow the system on
 * its own. Sent only when something changed. No-op in a browser. */
export function tellAppAppearance(a: { mode: ThemeMode; dark: boolean; colors: { light: Surface; dark: Surface } }) {
  const json = JSON.stringify(a)
  if (json === lastAppearance) return
  const w = window as Window & { webkit?: { messageHandlers?: { kinwall?: { postMessage: (m: unknown) => void } } } }
  const app = w.webkit?.messageHandlers?.kinwall
  if (!app) return
  lastAppearance = json
  try { app.postMessage({ type: 'appearance', ...a }) } catch { /* not in the app */ }
}

export type AppActivityKind = 'cooking' | 'shopping' | 'leaveBy'
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

/** The Notifications section's line about them, or null where they don't apply. */
export function liveActivitiesLine(on: boolean | null): string | null {
  if (on === null) return null
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
