// Adding a restaurant from what a phone shares (POST /api/restaurants/import, the Apple Shortcut): a
// place's details off its web page (schema.org Restaurant JSON-LD), an Apple Maps link's name, lenient
// prices, and the "Name: …" lines an AI step writes above a menu. No DOM (Workers has none).
import { clean, httpUrl, isType, jsonLdNodes } from './recipe-web.ts';
import { fetchRecipePage, outboundFetch, type FeedEnv } from './outbound.ts';
import { PAGE_LINE } from './menu-text.ts';

export type PlaceDetails = { name: string | null; cuisine: string | null; phone: string | null; address: string | null; website: string | null; menuUrl: string | null };
const EMPTY: PlaceDetails = { name: null, cuisine: null, phone: null, address: null, website: null, menuUrl: null };

const FOOD = ['Restaurant', 'FastFoodRestaurant', 'CafeOrCoffeeShop', 'Bakery', 'BarOrPub', 'IceCreamShop', 'Brewery', 'Winery', 'Distillery', 'FoodEstablishment'];
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

function address(v: unknown): string | null {
  const first = list(v)[0];
  const a = obj(first);
  const text = a ? [clean(a.streetAddress), clean(a.addressLocality), [clean(a.addressRegion), clean(a.postalCode)].filter(Boolean).join(' ')].filter(Boolean).join(', ') : clean(first);
  return text.slice(0, 500) || null;
}

/** The restaurant a page describes in its JSON-LD (a FoodEstablishment type first, else a
 * LocalBusiness), or null when there's none. */
export function parseRestaurantHtml(html: string, pageUrl: string): PlaceDetails | null {
  const nodes = jsonLdNodes(html);
  const n = nodes.find((x) => FOOD.some((t) => isType(x, t))) ?? nodes.find((x) => isType(x, 'LocalBusiness'));
  if (!n) return null;
  const menu = list(n.hasMenu ?? n.menu).map((m) => httpUrl(obj(m)?.url ?? m, pageUrl)).find(Boolean) ?? null;
  return {
    name: clean(n.name).slice(0, 200) || null,
    cuisine: list(n.servesCuisine).map((c) => clean(c)).filter(Boolean).join(', ').slice(0, 200) || null,
    phone: clean(list(n.telephone)[0]).slice(0, 50) || null,
    address: address(n.address),
    website: httpUrl(n.url, pageUrl),
    menuUrl: menu,
  };
}

/** A Maps link's place name and address, read off the link itself; null when it isn't a Maps link.
 * Apple Maps: name= (else q=) and address=. Google Maps: /maps/place/<name>/, else q= or query=
 * ("Name, address"). Short links (maps.apple/p/…, maps.app.goo.gl/…, goo.gl/maps/…) carry neither. */
export function mapsPlace(raw: string): { name: string | null; address: string | null } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const p = (k: string) => u.searchParams.get(k)?.trim() || null;
  if (host === 'maps.apple.com' || host === 'maps.apple') return { name: (p('name') ?? p('q'))?.slice(0, 200) ?? null, address: p('address')?.slice(0, 500) ?? null };
  if (googleShort(u)) return { name: null, address: null };
  const google = /^(www\.)?google\.[a-z.]+$/.test(host) && u.pathname.startsWith('/maps') || /^maps\.google\.[a-z.]+$/.test(host);
  if (!google) return null;
  const place = /^\/maps\/place\/([^/]+)/.exec(u.pathname)?.[1];
  let words = place ? decodeURIComponent(place.replace(/\+/g, ' ')) : p('q') ?? p('query');
  if (words && /^-?[\d.]+,\s*-?[\d.]+$/.test(words)) words = null; // just coordinates
  if (!words) return { name: null, address: null };
  const comma = words.indexOf(', ');
  return comma > 0 ? { name: words.slice(0, comma).slice(0, 200), address: words.slice(comma + 2).slice(0, 500) } : { name: words.slice(0, 200), address: null };
}

/** A Google Maps short link (maps.app.goo.gl/…, goo.gl/maps/…), which only says where it leads. */
const googleShort = (u: URL) => u.hostname.toLowerCase() === 'maps.app.goo.gl' || (u.hostname.toLowerCase() === 'goo.gl' && u.pathname.startsWith('/maps'));

/** A link as typed or shared: "example.com" gets https://; anything that isn't http(s) is dropped. */
export function normalizeLink(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  return httpUrl(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`, 'https://invalid.example/');
}

/** What a link says about a place: a Maps link's name and address, or the page's JSON-LD. A page
 * that can't be fetched or has no data gives nothing (null), never an error. */
export async function linkDetails(env: FeedEnv, raw: string): Promise<PlaceDetails | null> {
  const link = normalizeLink(raw);
  if (!link) return null;
  const maps = mapsPlace(link);
  // A Google short link is followed once to the long link it leads to, which has the name.
  if (maps && !maps.name && googleShort(new URL(link))) {
    let to: string | null = null;
    try {
      const res = await outboundFetch(env, false)(link, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      await res.body?.cancel();
      to = res.headers.get('location');
    } catch { /* unreachable: no name */ }
    return { ...EMPTY, ...((to && mapsPlace(new URL(to, link).href)) || maps) };
  }
  if (maps) return { ...EMPTY, ...maps };
  // https only (an http:// link is tried as https), unless a self-hoster allows private addresses.
  const page = await fetchRecipePage(env, env.ALLOW_PRIVATE_FEED_URLS === '1' ? link : link.replace(/^http:/i, 'https:'));
  return 'error' in page ? null : parseRestaurantHtml(page.html, page.url);
}

/** "$12.99", "12.99", "12", "3,25" or 12.5 as cents; null when it isn't a price. */
export function parsePrice(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= 10000 ? Math.round(v * 100) : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[$\s]/g, '');
  s = s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.');
  return /^\d{1,5}(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : null;
}

export type HeaderFields = Partial<Record<'name' | 'cuisine' | 'phone' | 'address' | 'website' | 'orderUrl' | 'menuUrl' | 'qr', string>>;
const HEADER = /^(name|restaurant|cuisine|phone|address|website|order online|menu link|qr code)\s*:\s*(.*)$/i;
// The phones' lines for a QR code on the menu (what the words around it say it's for).
const LINK_LABEL: Record<string, keyof HeaderFields> = { restaurant: 'name', 'order online': 'orderUrl', 'menu link': 'menuUrl', 'qr code': 'qr' };
const NOTHING = /^(unknown|none|n\/?a|not (found|listed|available|visible|shown)|-+)\.?$/i;
/** "Name: …", "Cuisine: …", "Phone: …", "Address: …", "Website: …" lines at the top of menu text (an
 * AI step's answer), then an optional "Menu:" line, then the menu. The phones add a QR code's link
 * read off the photo as "Order online: …", "Menu link: …" or "Website: …" when the words beside it
 * say what it's for, else "QR code: …" (shown, never saved). Plain photo text has no header.
 * Several photos come joined by page lines ("--- Page 2 ---"); a page may start with its own header
 * (tidied page by page), which fills only what the pages before it left empty. */
export function splitMenuHeader(text: string): { fields: HeaderFields; menuText: string } {
  const fields: HeaderFields = {};
  const menus: string[] = [];
  let page: string[] = [], pageLine = '';
  const end = () => {
    let i = 0;
    for (; i < page.length; i++) {
      const line = page[i].replace(/^[-•\s]+/, '').trim();
      if (!line) continue;
      const m = HEADER.exec(line);
      if (!m) { if (/^menu\s*:?$/i.test(line)) i++; break; }
      const key = LINK_LABEL[m[1].toLowerCase()] ?? m[1].toLowerCase() as keyof HeaderFields;
      if (m[2].trim() && !NOTHING.test(m[2].trim())) fields[key] ??= m[2].trim();
    }
    const menu = page.slice(i).join('\n').trim();
    if (menu) menus.push(pageLine ? `${pageLine}\n${menu}` : menu); // the menu parser skips page lines
  };
  for (const line of text.replace(/\r/g, '').replace(/\*\*/g, '').split('\n')) {
    if (PAGE_LINE.test(line.trim())) { end(); page = []; pageLine = line.trim(); } else page.push(line);
  }
  end();
  return { fields, menuText: menus.join('\n') };
}

/** A name for matching: case, accents, spaces and punctuation ignored ("Corner Slice!" = "corner slice"). */
export const nameKey = (s: string | null | undefined) => (s ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
