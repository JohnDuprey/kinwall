// SSRF guards for server-side fetches of person-supplied URLs (webhooks, ICS feeds, CalDAV,
// recipe pages, PDFs and images, book covers).
//
// Two layers. isSafeOutboundUrl checks the URL as written, everywhere. On Node the host also hands
// over OUTBOUND_FETCH (outbound-node.ts), a fetch that checks the address it actually connects to,
// so a public name that resolves to a private address (10.0.0.1.nip.io, DNS rebinding) is refused
// too. Workers leave it unset and keep the literal check only: they have no DNS API, and a Worker's
// fetch can't reach a family's private network anyway. The ALLOW_PRIVATE_* opt-outs skip both
// layers, each for its own fetches only.

// 0/8 this-net, 10/8, 127/8 loopback, 169.254/16 link-local, 172.16/12, 192.168/16, 100.64/10 CGNAT,
// 224/4 multicast and 240/4 reserved (incl. broadcast).
function privateV4(a: number, b: number): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// An IPv6 address as its 8 groups (a dotted v4 tail counts as two), or null if it isn't one.
function v6Groups(s: string): number[] | null {
  const tail = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (tail) {
    const [w, x, y, z] = tail.slice(2).map(Number);
    s = `${tail[1]}${((w << 8) | x).toString(16)}:${((y << 8) | z).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const [head, rest = []] = halves.map((h) => (h ? h.split(':') : []));
  const n = head.length + rest.length;
  if ([...head, ...rest].some((g) => !/^[0-9a-f]{1,4}$/i.test(g)) || (halves.length === 1 ? n !== 8 : n > 7)) return null;
  return [...head, ...Array(8 - n).fill('0'), ...rest].map((g) => parseInt(g, 16));
}

// Is this IP address (v4, or v6 with or without brackets or a %zone) one a person-supplied URL must
// not reach? Covers v4 inside v6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64
// (64:ff9b::/96; 64:ff9b:1::/48 is local-use) and 6to4 (2002::/16), plus fc00::/7 unique-local,
// fe80::/10 link-local, fec0::/10 site-local and ff00::/8 multicast. Anything unparsable counts as private.
export function isPrivateAddress(ip: string): boolean {
  const s = ip.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return privateV4(Number(v4[1]), Number(v4[2]));
  const g = v6Groups(s);
  if (!g) return true;
  const embedded = (hi: number) => privateV4(hi >> 8, hi & 255);
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 6)) return embedded(g[6]); // ::, ::1, ::a.b.c.d
  if (zero(0, 5) && g[5] === 0xffff) return embedded(g[6]);
  if (g[0] === 0x64 && g[1] === 0xff9b) return !zero(2, 6) || embedded(g[6]);
  if (g[0] === 0x2002) return embedded(g[1]);
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00;
}

// The URL as written: http(s) only, no localhost/.local/.internal names, no private IP literals.
// URL() already normalizes IPv4 shorthand (http://2130706433, 0x7f.1, 0) into dotted quads and
// IPv6 into its short form; trailing dots are dropped here (localhost. is localhost).
export function isSafeOutboundUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false;
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return !isPrivateAddress(host);
  return true;
}

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type OutboundEnv = { OUTBOUND_FETCH?: Fetch };

// The fetch for a person-supplied URL: the host's address-checking one, unless this kind of fetch
// is opted out (then plain fetch, as before). Looked up per call so tests can stub globalThis.fetch.
export function outboundFetch(env: OutboundEnv, allowPrivate: boolean): Fetch {
  return (!allowPrivate && env.OUTBOUND_FETCH) || ((input, init) => fetch(input, init));
}

export const isPublicHttpsUrl = (raw: string) => /^https:\/\//i.test(raw) && isSafeOutboundUrl(raw);

export type FeedEnv = OutboundEnv & { ALLOW_PRIVATE_FEED_URLS?: string };
export type WebhookEnv = OutboundEnv & { ALLOW_PRIVATE_WEBHOOK_URLS?: string };

export const WEBHOOK_URL_ERROR = 'Webhook URL must be a public https/http address (self-hosted: set ALLOW_PRIVATE_WEBHOOK_URLS=1 to reach a LAN receiver such as Home Assistant)';

// Webhook targets. ALLOW_PRIVATE_WEBHOOK_URLS=1 lets a self-hoster point webhooks at a LAN
// receiver - the Home Assistant add-on turns it on, since HA itself is the receiver there.
export function isSafeWebhookUrl(env: WebhookEnv, raw: string): boolean {
  if (env.ALLOW_PRIVATE_WEBHOOK_URLS === '1') { try { const u = new URL(raw); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } }
  return isSafeOutboundUrl(raw);
}

export const FEED_URL_ERROR = 'Calendar URL must be a public http(s) address (self-hosted: set ALLOW_PRIVATE_FEED_URLS=1 to reach a LAN server)';

// Calendar feeds (ICS, CalDAV). Same literal-host check as webhooks, run on the http(s) form of a
// webcal:// URL (feedFetch adds the connect-time address check on Node). ALLOW_PRIVATE_FEED_URLS=1 lets a self-hoster reach a LAN
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
// connects through OUTBOUND_FETCH (unless ALLOW_PRIVATE_FEED_URLS=1), then follows up to 3
// redirects itself, re-checking each Location (and its address, on Node) so a public URL can't
// 30x into private space. A caller that asks for redirect: 'manual' (tsdav's service discovery)
// gets the 3xx back and its next request is checked on the way in.
export async function feedFetch(env: FeedEnv, input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let req: RequestInit = { ...init, redirect: 'manual' };
  for (let hop = 0; ; hop++) {
    assertSafeFeedUrl(env, url);
    const res = await outboundFetch(env, env.ALLOW_PRIVATE_FEED_URLS === '1')(url, req);
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
// a LAN or http address), connected through OUTBOUND_FETCH, each redirect re-checked, 15 s,
// capped at `max` bytes, and the answer's content type must pass `typeOk`. Returns the bytes, or an error message for the client.
async function fetchRecordUrl(env: FeedEnv, raw: string, what: string, headers: Record<string, string>, max: number, typeOk: (type: string) => boolean): Promise<Fetched> {
  const allowed = (u: string) => env.ALLOW_PRIVATE_FEED_URLS === '1' ? /^https?:\/\//i.test(u) : /^https:\/\//i.test(u) && isSafeOutboundUrl(u);
  const signal = AbortSignal.timeout(15000);
  let url = raw;
  try {
    for (let hop = 0; ; hop++) {
      if (!allowed(url)) return { error: `${what} must be a public https address`, status: 400 };
      const res = await outboundFetch(env, env.ALLOW_PRIVATE_FEED_URLS === '1')(url, { redirect: 'manual', signal, headers });
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
