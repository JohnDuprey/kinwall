// Inside the Kinwall iPhone/iPad app (kinwall-apple repo: a native frame around this web app).
// The app injects window.kinwallNative before the page loads and adds "KinwallApp/<version>" to
// the user agent. Keep in sync with KinwallWebView.bridgeScript there.
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
