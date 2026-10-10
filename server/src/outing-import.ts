// Outings from what's shared (POST /api/share kind outing, docs/using/outings.md#adding-from-the-share-sheet):
// a page's schema.org Event (MusicEvent, Festival…) or a place to visit (Park, Museum, Zoo…) read off
// its JSON-LD, and a flyer's text (share-text.ts parseOutingText) as the fields an outing is saved
// with. Pure, so test/outing-import.test.ts covers it.
import { clean, httpUrl, isType, jsonLdNodes } from './recipe-web.ts';
import { postalAddress, parsePrice } from './restaurant-import.ts';
import { zonedTimeToUtc } from './recurrence.ts';
import type { OutingText } from './share-text.ts';

type Audience = 'kids' | 'family' | 'grownups';
/** What an import fills in on an outing (the OutingInput fields; empty ones are null). */
export type OutingDraft = {
  title: string; kind: 'upcoming' | 'place'; categoryId: string | null;
  startsOn: string | null; endsOn: string | null; startTime: string | null; endTime: string | null;
  placeName: string | null; address: string | null; priceCents: number | null; priceNote: string | null;
  audience: Audience[]; ageMin: number | null; ageMax: number | null;
  url: string | null; ticketsUrl: string | null; ticketsOnSaleAt: string | null; buyBy: string | null; notes: string | null;
};
const EMPTY: Omit<OutingDraft, 'title' | 'kind'> = {
  categoryId: null, startsOn: null, endsOn: null, startTime: null, endTime: null, placeName: null, address: null, priceCents: null, priceNote: null,
  audience: [], ageMin: null, ageMax: null, url: null, ticketsUrl: null, ticketsOnSaleAt: null, buyBy: null, notes: null,
};

// schema.org Event types and the default category (migration 0111's ids) each suggests.
const EVENTS: [string, string | null][] = [
  ['MusicEvent', 'oc-music'], ['ScreeningEvent', 'oc-movies'], ['Festival', 'oc-fairs'], ['TheaterEvent', 'oc-shows'], ['ComedyEvent', 'oc-shows'],
  ['DanceEvent', 'oc-shows'], ['ExhibitionEvent', 'oc-art'], ['VisualArtsEvent', 'oc-art'], ['FoodEvent', 'oc-food'], ['SportsEvent', 'oc-sports'],
  ['EducationEvent', 'oc-classes'], ['LiteraryEvent', 'oc-library'], ['ChildrensEvent', null], ['SocialEvent', null], ['SaleEvent', 'oc-markets'], ['Event', null],
];
// Places to visit (any time) and their category.
const PLACES: [string, string | null][] = [
  ['Park', 'oc-outdoors'], ['Playground', 'oc-outdoors'], ['Campground', 'oc-outdoors'], ['NaturalFeature', 'oc-outdoors'], ['Zoo', 'oc-outdoors'],
  ['Beach', 'oc-water'], ['Aquarium', 'oc-water'], ['PublicSwimmingPool', 'oc-water'], ['Museum', 'oc-art'], ['ArtGallery', 'oc-art'],
  ['Library', 'oc-library'], ['MovieTheater', 'oc-movies'], ['PerformingArtsTheater', 'oc-shows'], ['StadiumOrArena', 'oc-sports'],
  ['AmusementPark', null], ['TouristAttraction', null], ['LandmarksOrHistoricalBuildings', null],
];
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** A schema.org date or date-time as the household's day and clock: written with an offset (the
 * venue's own time, as event pages do) it's taken as written; in UTC ("Z") it's moved to `tz`. */
export function wallClock(v: unknown, tz: string): { date: string; time: string | null } | null {
  const s = clean(list(v)[0]);
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?(.*)$/.exec(s);
  if (!m) return null;
  if (!m[2]) return { date: m[1], time: null };
  if (/^(:\d{2}(\.\d+)?)?Z$/i.test(m[4])) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(s)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  }
  return { date: m[1], time: `${m[2]}:${m[3]}` };
}

/** A day (and time) on the household's clock as an ISO time ("tickets on sale" moments). */
export function householdIso(date: string, time: string | null, tz: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time ?? '00:00').split(':').map(Number);
  return zonedTimeToUtc({ y, mo: mo - 1, d, h, mi, s: 0 }, tz).toISOString();
}

/** "7-10", "7–10", "21+", "18 and up": an age range's ends. */
function ageRange(v: unknown): { min: number | null; max: number | null } {
  const s = clean(v);
  const r = /(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})/.exec(s);
  if (r && +r[1] <= +r[2]) return { min: +r[1], max: +r[2] };
  const p = /(\d{1,2})\s*(?:\+|and\s+(?:up|over|older))/i.exec(s);
  return { min: p ? +p[1] : null, max: null };
}
const audienceFor = (min: number | null, max: number | null): Audience[] => (max != null && max <= 17 ? ['kids'] : min != null && min >= 18 ? ['grownups'] : []);

/** What the page's JSON-LD says about an event or a place to visit, as an outing; null when it
 * has neither. An Event's dates on different days make a run; offers give the lowest price (0 when
 * free), when tickets go on sale (validFrom, only when that's still to come), the last day to buy
 * (validThrough, before the start) and the ticket link. */
export function outingFromHtml(html: string, pageUrl: string, tz: string, today: string): OutingDraft | null {
  const nodes = jsonLdNodes(html);
  for (const [type, cat] of EVENTS) {
    const n = nodes.find((x) => isType(x, type) && clean(x.name));
    if (!n) continue;
    const start = wallClock(n.startDate, tz), end = wallClock(n.endDate, tz);
    const run = !!(start && end && end.date > start.date);
    const loc = list(n.location).map(obj).find((l) => l && !isType(l, 'VirtualLocation')) ?? null;
    const locText = list(n.location).find((l) => typeof l === 'string');
    const offers = list(n.offers).map(obj).filter((o): o is Record<string, unknown> => !!o);
    const prices = offers.flatMap((o) => [o.price, o.lowPrice].map((p) => (typeof p === 'string' && /^\s*free\s*$/i.test(p) ? 0 : parsePrice(p)))).filter((p): p is number => p !== null);
    const free = n.isAccessibleForFree === true || n.isAccessibleForFree === 'true' || n.isAccessibleForFree === 'True';
    const onSale = offers.map((o) => wallClock(o.validFrom, tz)).find((d) => d && d.date >= today) ?? null;
    const buyBy = offers.map((o) => wallClock(o.validThrough, tz)?.date).find((d) => d && start && d < start.date) ?? null;
    const aud = obj(list(n.audience)[0]);
    const ages = aud?.suggestedMinAge != null || aud?.suggestedMaxAge != null
      ? { min: Number(aud.suggestedMinAge) || null, max: Number(aud.suggestedMaxAge) || null }
      : ageRange(n.typicalAgeRange ?? aud?.audienceType);
    const kids = type === 'ChildrensEvent' || /\b(kids?|children|family|families)\b/i.test(clean(aud?.audienceType));
    const notes = clean(n.description).slice(0, 1000) || null;
    return {
      ...EMPTY, kind: 'upcoming', title: clean(n.name).slice(0, 200), categoryId: cat,
      startsOn: start?.date ?? null, endsOn: run ? end!.date : null, startTime: start?.time ?? null, endTime: end?.time && (run || !start?.time || end.time > start.time) ? end.time : null,
      placeName: clean(loc?.name).slice(0, 200) || clean(locText).slice(0, 200) || null, address: loc ? postalAddress(loc.address) : null,
      priceCents: prices.length ? Math.min(...prices) : free ? 0 : null,
      audience: kids && !audienceFor(ages.min, ages.max).length ? ['kids'] : audienceFor(ages.min, ages.max), ageMin: ages.min, ageMax: ages.max,
      url: httpUrl(n.url, pageUrl) ?? pageUrl, ticketsUrl: offers.map((o) => httpUrl(o.url, pageUrl)).find(Boolean) ?? null,
      ticketsOnSaleAt: onSale ? householdIso(onSale.date, onSale.time, tz) : null, buyBy, notes,
    };
  }
  for (const [type, cat] of PLACES) {
    const n = nodes.find((x) => isType(x, type) && clean(x.name));
    if (!n) continue;
    const free = n.isAccessibleForFree === true || n.isAccessibleForFree === 'true';
    return {
      ...EMPTY, kind: 'place', title: clean(n.name).slice(0, 200), categoryId: cat, address: postalAddress(n.address),
      priceCents: free ? 0 : null, url: httpUrl(n.url, pageUrl) ?? pageUrl, notes: clean(n.description).slice(0, 1000) || null,
    };
  }
  return null;
}

/** A flyer's outing (parseOutingText) as the fields to save: the place goes in address when it has a
 * street, else in placeName; "21+" makes it for grown-ups, an age range under 18 for kids. */
export function outingFromText(t: OutingText, tz: string): Omit<OutingDraft, 'title'> & { title: string | null } {
  const street = !!t.place && /\d/.test(t.place);
  return {
    ...EMPTY, kind: 'upcoming', title: t.title, startsOn: t.date, endsOn: t.endsOn, startTime: t.time, endTime: t.end,
    placeName: t.place && !street ? t.place.slice(0, 200) : null, address: street ? t.place : null,
    priceCents: t.priceCents, priceNote: t.priceNote, audience: t.grownUps ? ['grownups'] : audienceFor(t.ageMin, t.ageMax), ageMin: t.ageMin, ageMax: t.ageMax,
    ticketsOnSaleAt: t.onSale ? householdIso(t.onSale.date, t.onSale.time, tz) : null, buyBy: t.buyBy, notes: t.notes,
  };
}
