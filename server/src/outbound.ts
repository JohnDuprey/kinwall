// SSRF guards for server-side fetches of user-supplied URLs (webhooks, ICS feeds, CalDAV).

// Checks the literal host only: Workers can't resolve DNS, so a public name that resolves to a
// private address is not caught here. URL() already normalises IPv4 shorthand (http://2130706433,
// 0x7f.1) into dotted quads.
export function isSafeOutboundUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 || // this-net, private, loopback, multicast + reserved
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    // unspecified, loopback, v4-mapped, fc00::/7 unique-local, fe80::/10 link-local
    return !(v6 === '::' || v6 === '::1' || v6.startsWith('::ffff:') || /^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6));
  }
  return true;
}

export type FeedEnv = { ALLOW_PRIVATE_FEED_URLS?: string };

export const FEED_URL_ERROR = 'Calendar URL must be a public http(s) address (self-hosted: set ALLOW_PRIVATE_FEED_URLS=1 to reach a LAN server)';

// Calendar feeds (ICS, CalDAV). Same literal-host check as webhooks (on Workers DNS can't be
// resolved, so a public name pointing at a private address isn't caught), run on the http(s)
// form of a webcal:// URL. ALLOW_PRIVATE_FEED_URLS=1 lets a self-hoster reach a LAN
// Radicale/Baikal - feeds only, never webhooks. Redirects are checked per hop by feedFetch below.
export function isSafeFeedUrl(env: FeedEnv, raw: string): boolean {
  if (env.ALLOW_PRIVATE_FEED_URLS === '1') return true;
  return isSafeOutboundUrl(raw.replace(/^webcal:\/\//i, 'https://'));
}

export function assertSafeFeedUrl(env: FeedEnv, raw: string): void {
  if (!isSafeFeedUrl(env, raw)) throw new Error(FEED_URL_ERROR);
}

const MAX_FEED_REDIRECTS = 3;

// fetch() for calendar feeds (ICS directly, CalDAV via tsdav's `fetch` option): checks the URL,
// then follows up to 3 redirects itself, re-checking each Location so a public URL can't 30x
// into private space. A caller that asks for redirect: 'manual' (tsdav's service discovery)
// gets the 3xx back and its next request is checked on the way in.
export async function feedFetch(env: FeedEnv, input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let req: RequestInit = { ...init, redirect: 'manual' };
  for (let hop = 0; ; hop++) {
    assertSafeFeedUrl(env, url);
    const res = await fetch(url, req);
    const location = res.headers.get('location');
    if (init.redirect === 'manual' || res.status < 300 || res.status > 399 || res.status === 304 || !location) return res;
    if (hop === MAX_FEED_REDIRECTS) throw new Error(`Calendar URL redirected more than ${MAX_FEED_REDIRECTS} times`);
    const next = new URL(location, url);
    if (!isSafeFeedUrl(env, next.href)) throw new Error(`Calendar URL redirected to a blocked address (${next.host}) - ${FEED_URL_ERROR}`);
    // Same rules as fetch's own redirect handling: 303 (and 301/302 after a POST) become a
    // body-less GET, and credentials never follow the request to another origin.
    const method = (req.method ?? 'GET').toUpperCase();
    if (res.status === 303 ? method !== 'GET' && method !== 'HEAD' : (res.status === 301 || res.status === 302) && method === 'POST') {
      req = { ...req, method: 'GET', body: undefined };
    }
    if (next.origin !== new URL(url).origin) {
      const headers = new Headers(req.headers);
      headers.delete('authorization');
      headers.delete('cookie');
      req = { ...req, headers };
    }
    url = next.href;
  }
}
