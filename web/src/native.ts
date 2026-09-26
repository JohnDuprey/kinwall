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
