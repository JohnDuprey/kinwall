// Online tidbits for the Board's quote / fact card: Wikipedia's "On this day" and an Open Trivia DB
// question. Both are free and keyless, fetched by the server (never the displays) at most once a
// day each and kept in weather_cache, so the browser never talks to a third party and the CSP stays
// 'self'. Nothing about the household is sent. Only the sources a family turned on are fetched.
import type { KinwallDb } from '../db.ts';
import { createRoute, type z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { hostTimezone } from '../env.ts';
import { TidbitsSchema } from '../schemas.ts';
import { readSettings } from './settings.ts';

export const tidbitRoutes = createRouter();
type Tidbits = z.infer<typeof TidbitsSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000; // after a failed fetch
const TIMEOUT_MS = 8000;
// Wikimedia asks API clients to identify themselves.
const USER_AGENT = 'Kinwall/1.0 (https://kinwall.family; self-hosted family calendar)';

/** A day-scoped fetch through weather_cache (key, fetched_at, body). A failure keeps the old body
 *  and tries again in an hour; weather's own cleanup drops rows older than a day. */
async function cachedJson<T>(db: KinwallDb, key: string, now: Date, fetcher: () => Promise<T>): Promise<T | null> {
  const row = await db.prepare('SELECT fetched_at, body FROM weather_cache WHERE key = ?').bind(key).first<{ fetched_at: string; body: string }>();
  if (row && now.getTime() - Date.parse(row.fetched_at) < DAY_MS) return JSON.parse(row.body) as T | null;
  let body = row?.body ?? 'null';
  let fetchedAt = now;
  try {
    body = JSON.stringify(await fetcher());
  } catch (err) {
    console.error(`tidbit fetch failed (${key})`, err instanceof Error ? err.message : err);
    fetchedAt = new Date(now.getTime() - DAY_MS + RETRY_MS);
  }
  await db
    .prepare('INSERT INTO weather_cache (key, fetched_at, body) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, body = excluded.body')
    .bind(key, fetchedAt.toISOString(), body)
    .run();
  return JSON.parse(body) as T | null;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

// MARK: On this day

type OtdItem = { text?: string; year?: number };
type OtdFeed = { holidays?: OtdItem[]; births?: OtdItem[]; events?: OtdItem[]; selected?: OtdItem[] };

// It's a family wall: history's grim side stays off it. Holidays that are saints' feast days and
// liturgical calendars are dropped too; there are dozens every day and they read as noise.
const GRIM = /\b(?:kill(?:s|ed|ing)?|dead|deaths?|dies|died|murder\w*|massacres?|wars?|battles?|bomb(?:s|ed|ing|ings)?|attacks?|shot|shootings?|assassinat\w*|executed|executions?|genocide|terror\w*|crash(?:es|ed)?|disasters?|earthquakes?|tsunamis?|hurricanes?|famine|plague|epidemic|pandemic|riots?|invasions?|invade[sd]?|slave\w*|holocaust|nazis?|hanged|sinks|sank|explosions?|kidnap\w*|hostages?|hijack\w*|abduct\w*|coup|overthrow\w*|arrested|prison|torture\w*)\b/i;
const FEAST = /feast day|liturgical|commemoration/i;
const MAX_LEN = 220;

export function shapeOnThisDay(feed: OtdFeed | null, kinds: readonly string[], birthsAfter: number | null = null): Tidbits['onThisDay'] {
  if (!feed) return [];
  const pick = (kind: 'holidays' | 'births' | 'events', items: OtdItem[] | undefined) => {
    const ok = (items ?? [])
      .filter((i): i is OtdItem & { text: string } => typeof i.text === 'string' && !i.text.includes('\n') && i.text.length <= MAX_LEN)
      .map((i) => ({ ...i, text: i.text.replace(/\s*\((?:died|d\.) [^)]*\)\s*$/, '') })) // "(died 1978)" on births: not needed, and it's no fun on a wall
      .filter((i) => !GRIM.test(i.text) && (kind !== 'holidays' || !FEAST.test(i.text)))
      .filter((i) => kind !== 'births' || birthsAfter === null || (typeof i.year === 'number' && i.year >= birthsAfter));
    // Births run to hundreds: take 12 spread evenly through the list rather than the newest 12.
    const step = Math.max(1, ok.length / 12);
    const chosen = Array.from({ length: Math.min(12, ok.length) }, (_, n) => ok[Math.floor(n * step)]);
    return chosen.map((i) => ({ kind, text: i.text.trim(), year: typeof i.year === 'number' ? i.year : null }));
  };
  return [
    ...(kinds.includes('holidays') ? pick('holidays', feed.holidays) : []),
    ...(kinds.includes('births') ? pick('births', feed.births) : []),
    ...(kinds.includes('events') ? pick('events', [...(feed.selected ?? []), ...(feed.events ?? [])]) : []),
  ];
}

// MARK: Trivia

type TriviaResponse = { response_code: number; results?: { category: string; question: string; correct_answer: string; incorrect_answers?: string[] }[] };

function triviaUrl(category: number, difficulty: string): string {
  const q = new URLSearchParams({ amount: '10', category: String(category), type: 'multiple', encode: 'url3986' });
  if (difficulty !== 'any') q.set('difficulty', difficulty);
  return `https://opentdb.com/api.php?${q}`;
}

export function shapeTrivia(res: TriviaResponse | null): Tidbits['trivia'] {
  if (!res || res.response_code !== 0) return [];
  const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } };
  return (res.results ?? []).map((r, n) => {
    const answer = decode(r.correct_answer);
    const choices = [...(r.incorrect_answers ?? []).map(decode)];
    choices.splice((n * 7 + answer.length) % (choices.length + 1), 0, answer); // the answer's place varies but stays put across reloads
    return { question: decode(r.question), answer, choices, category: decode(r.category).replace(/^Entertainment: |^Science: /, '') };
  });
}

// MARK: Route

export async function getTidbits(db: KinwallDb, now = new Date()): Promise<Tidbits> {
  const settings = await readSettings(db);
  const tz = settings.timezone ?? hostTimezone();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [, mm, dd] = date.split('-');
  const t = settings.tidbits;
  const out: Tidbits = { date, onThisDay: [], trivia: [] };

  if (t.sources.includes('onthisday')) {
    const feed = await cachedJson<OtdFeed>(db, `tidbits:otd:en:${mm}-${dd}`, now, async () => {
      const f = (await getJson(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/${mm}/${dd}`)) as OtdFeed;
      const slim = (l?: OtdItem[]) => (l ?? []).map((i) => ({ text: i.text, year: i.year })); // pages carry a lot we don't keep
      return { holidays: slim(f.holidays), births: slim(f.births), events: slim(f.events), selected: slim(f.selected) };
    });
    out.onThisDay = shapeOnThisDay(feed, t.onThisDay, t.birthsAfter);
  }

  if (t.sources.includes('trivia')) {
    // One category a day, taking turns through the family's picks (one request a day, gentle on a free API).
    const dayIndex = Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
    const category = t.triviaCategories[dayIndex % t.triviaCategories.length];
    const res = await cachedJson<TriviaResponse>(db, `tidbits:trivia:${category}:${t.triviaDifficulty}:${date}`, now, async () => {
      let r = (await getJson(triviaUrl(category, t.triviaDifficulty))) as TriviaResponse;
      if (r.response_code === 1 && t.triviaDifficulty !== 'any') r = (await getJson(triviaUrl(category, 'any'))) as TriviaResponse; // too few at that level
      if (r.response_code !== 0) throw new Error(`Open Trivia DB response_code ${r.response_code}`);
      return r;
    });
    out.trivia = shapeTrivia(res);
  }
  return out;
}

tidbitRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/tidbits',
    tags: ['Snapshot'],
    summary: "Today's online tidbits for the Board's quote / fact card (Wikipedia On this day, Open Trivia DB), per the household's Quotes & facts settings. Each source is fetched at most once a day; turned-off sources come back empty.",
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: TidbitsSchema } } } },
  }),
  async (c) => c.json(await getTidbits(c.env.DB), 200),
);
