// When the web app asks the server for this sign-in's media token (api.ts mediaUrl): none kept for
// this key, or the kept one not yet checked since the app loaded. A token made before the server's
// tokens changed (a new media secret, the v1 to v2 switch) would otherwise be sent forever, and
// every image 401s; checking once per load replaces it.
export function mediaTokenStale(saved: { of: string } | null, key: string, checkedThisLoad: boolean): boolean {
  return saved?.of !== key.slice(-12) || !checkedThisLoad
}
