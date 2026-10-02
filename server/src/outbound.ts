// SSRF guards for server-side fetches of user-supplied URLs (webhooks, ICS feeds, CalDAV).

// Checks the literal host only: Workers can't resolve DNS, so a public name that resolves to a
// private address is not caught here. URL() already normalizes IPv4 shorthand (http://2130706433,
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

export const isPublicHttpsUrl = (raw: string) => /^https:\/\//i.test(raw) && isSafeOutboundUrl(raw);

export type FeedEnv = { ALLOW_PRIVATE_FEED_URLS?: string };
export type WebhookEnv = { ALLOW_PRIVATE_WEBHOOK_URLS?: string };

export const WEBHOOK_URL_ERROR = 'Webhook URL must be a public https/http address (self-hosted: set ALLOW_PRIVATE_WEBHOOK_URLS=1 to reach a LAN receiver such as Home Assistant)';

// Webhook targets. ALLOW_PRIVATE_WEBHOOK_URLS=1 lets a self-hoster point webhooks at a LAN
// receiver - the Home Assistant add-on turns it on, since HA itself is the receiver there.
export function isSafeWebhookUrl(env: WebhookEnv, raw: string): boolean {
  if (env.ALLOW_PRIVATE_WEBHOOK_URLS === '1') { try { const u = new URL(raw); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } }
  return isSafeOutboundUrl(raw);
}

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

export const MAX_RECIPE_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_RECIPE_IMAGE_BYTES = 8 * 1024 * 1024;

type Fetched = { bytes: Uint8Array<ArrayBuffer>; type: string; etag: string | null; url: string } | { error: string; status: 400 | 502 };

// A record's own stored URL (a recipe's sourceUrl or imageUrl), or a recipe page an admin asked to import. https
// only and public hosts only (ALLOW_PRIVATE_FEED_URLS=1 also lets a self-hoster or a local test reach
// a LAN or http address), each redirect re-checked, 15 s, capped at `max` bytes, and the answer's
// content type must pass `typeOk`. Returns the bytes, or an error message for the client.
async function fetchRecordUrl(env: FeedEnv, raw: string, what: string, headers: Record<string, string>, max: number, typeOk: (type: string) => boolean): Promise<Fetched> {
  const allowed = (u: string) => env.ALLOW_PRIVATE_FEED_URLS === '1' ? /^https?:\/\//i.test(u) : /^https:\/\//i.test(u) && isSafeOutboundUrl(u);
  const signal = AbortSignal.timeout(15000);
  let url = raw;
  try {
    for (let hop = 0; ; hop++) {
      if (!allowed(url)) return { error: `${what} must be a public https address`, status: 400 };
      const res = await fetch(url, { redirect: 'manual', signal, headers });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status <= 399 && location) {
        await res.body?.cancel();
        if (hop === MAX_FEED_REDIRECTS) return { error: `${what} redirected too many times`, status: 502 };
        url = new URL(location, url).href;
        continue;
      }
      if (!res.ok || !res.body) { await res.body?.cancel(); return { error: `${what} answered ${res.status}`, status: 502 }; }
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!typeOk(type)) { await res.body.cancel(); return { error: `${what} is the wrong kind of file`, status: 502 }; }
      if (Number(res.headers.get('content-length')) > max) { await res.body.cancel(); return { error: `${what} is too large`, status: 502 }; }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = res.body.getReader();
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        size += r.value.byteLength;
        if (size > max) { await reader.cancel(); return { error: `${what} is too large`, status: 502 }; }
        chunks.push(r.value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
      return { bytes, type, etag: res.headers.get('etag'), url };
    }
  } catch {
    return { error: `could not reach the ${what}`, status: 502 };
  }
}

// The in-app recipe-card viewer: 15 MB, and it must actually be a PDF.
export async function fetchRecipePdf(env: FeedEnv, raw: string): Promise<{ pdf: Uint8Array<ArrayBuffer> } | { error: string; status: 400 | 502 }> {
  const r = await fetchRecordUrl(env, raw, 'recipe source', { Accept: 'application/pdf' }, MAX_RECIPE_PDF_BYTES, (t) => t === 'application/pdf' || t === 'application/octet-stream');
  if ('error' in r) return r;
  const pdf = r.bytes;
  // octet-stream is common for file hosts: then the bytes must start "%PDF".
  if (r.type !== 'application/pdf' && (pdf[0] !== 0x25 || pdf[1] !== 0x50 || pdf[2] !== 0x44 || pdf[3] !== 0x46)) return { error: 'recipe source is not a PDF', status: 502 };
  return { pdf };
}

// What the bytes are, whatever the header said: only these four are ever served (never SVG).
export function sniffImage(b: Uint8Array): string | null {
  const ascii = (at: number, s: string) => [...s].every((ch, i) => b[at + i] === ch.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 'PNG\r\n\x1a\n')) return 'image/png';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return null;
}

// A recipe's photo (its imageUrl), or a book cover: 8 MB, JPEG/PNG/WebP/GIF by header and by magic bytes.
export async function fetchRecipeImage(env: FeedEnv, raw: string, what = 'recipe image'): Promise<{ image: Uint8Array<ArrayBuffer>; type: string; etag: string | null } | { error: string; status: 400 | 502 }> {
  const r = await fetchRecordUrl(env, raw, what, { Accept: 'image/webp,image/jpeg,image/png,image/gif' }, MAX_RECIPE_IMAGE_BYTES, (t) => /^image\/(jpeg|png|webp|gif)$/.test(t) || t === 'application/octet-stream');
  if ('error' in r) return r;
  const type = sniffImage(r.bytes);
  if (!type) return { error: `${what} is not a JPEG, PNG, WebP or GIF`, status: 502 };
  return { image: r.bytes, type, etag: r.etag };
}

export const MAX_RECIPE_PAGE_BYTES = 3 * 1024 * 1024;
const PAGE_HEADERS = {
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', 'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (compatible; KinwallRecipeImport/1.0; +https://github.com/JohnDuprey/kinwall)',
};

// A recipe page an admin pasted (POST /api/recipes/import-url): 3 MB of HTML, same address rules.
// Returns the page and where it ended up after redirects.
export async function fetchRecipePage(env: FeedEnv, raw: string): Promise<{ html: string; url: string } | { error: string; status: 400 | 502 }> {
  const r = await fetchRecordUrl(env, raw, 'recipe page', PAGE_HEADERS, MAX_RECIPE_PAGE_BYTES, (t) => t === 'text/html' || t === 'application/xhtml+xml');
  if ('error' in r) return r;
  // ponytail: always UTF-8 (nearly every recipe site); honor <meta charset> if a Latin-1 page turns up.
  return { html: new TextDecoder().decode(r.bytes), url: r.url };
}
