// Sign-in links: `#key=…` (or the older `?key=…`) hands this browser a key or a setup code. A
// link can come from anyone, and opening one used to sign the browser in on the spot: someone
// could send their own family's link, and what you then added would land in their family. So
// the key leaves the address at once and is stored only after asking (App.tsx KeyLinkGate),
// unless this same browser's own sign-in on the hosted sign-in page made the link a moment ago.
//
// That proof (hosted only, kinwall-cloud's app.<root>): with the redirect, the sign-in page sets
// `__Secure-kinwall_signin=<random>` for the whole root domain (60 seconds, not HttpOnly so this
// page can read it) and puts the SHA-256 of that value in the link as `&from=<hex>`. Only this
// browser has the cookie, and the link carries only its hash, so a link sent from elsewhere
// can't match it. Self-hosted servers never set it: every link there asks.

export const SIGNIN_COOKIE = '__Secure-kinwall_signin'

export type KeyLink = { key: string; from: string | null; url: string }

/** The key a link hands over, and this address without it (`url`, to put in place right away).
 * `#key=` drops the whole fragment (nothing else rides with it); `?key=` drops only itself. */
export function takeKeyLink(href: string): KeyLink | null {
  const url = new URL(href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const fromHash = hash.get('key')
  const key = fromHash || url.searchParams.get('key')
  if (!key) return null
  url.searchParams.delete('key')
  if (fromHash) url.hash = ''
  return { key, from: fromHash ? hash.get('from') : null, url: url.pathname + url.search + url.hash }
}

/** Whether the browser takes the link's key: without asking when it already has that key
 * (nothing changes) or the link carries this browser's own sign-in marker; otherwise `ask`.
 * Stores nothing itself: on false the browser stays exactly as it was. */
export async function resolveKeyLink(link: KeyLink, { current, cookies, ask }: { current: string | null; cookies: string; ask: () => Promise<boolean> }): Promise<boolean> {
  if (link.key === current) return true
  const marker = cookieValue(cookies, SIGNIN_COOKIE)
  if (link.from && marker && (await sha256Hex(marker)) === link.from) return true
  return ask()
}

/** Ends the marker once a link has used it: set expired with the Domain and Path it was set
 * with. Family hosts are `<slug>.<root>`, so the root is this host without its first label (on
 * any other host the browser just ignores it). */
export function expireSigninCookie(hostname: string): string {
  return `${SIGNIN_COOKIE}=; Domain=${hostname.slice(hostname.indexOf('.') + 1)}; Path=/; Max-Age=0; Secure; SameSite=Lax`
}

function cookieValue(cookies: string, name: string): string | null {
  for (const c of cookies.split(';')) {
    const [k, ...v] = c.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

async function sha256Hex(v: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}
