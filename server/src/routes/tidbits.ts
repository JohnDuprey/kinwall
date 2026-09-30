// Online tidbits for the Board's quote / fact card: Wikipedia's "On this day" and an Open Trivia DB
// question. Both are free and keyless, fetched by the server (never the displays) at most once a
// day each and kept in weather_cache, so the browser never talks to a third party and the CSP stays
// 'self'. Nothing about the household is sent. Only the sources a family (or a display that picked
// its own, via query params) turned on are fetched.
import type { KinwallDb } from '../db.ts';
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { hostTimezone } from '../env.ts';
import { ErrorSchema, TidbitSettingsSchema, TidbitsSchema } from '../schemas.ts';
import { readSettings } from './settings.ts';

export const tidbitRoutes = createRouter();
type Tidbits = z.infer<typeof TidbitsSchema>;
type TidbitSettings = z.infer<typeof TidbitSettingsSchema>;

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

type TriviaResponse = { response_code: number; results?: { category: string; difficulty?: string; question: string; correct_answer: string; incorrect_answers?: string[] }[] };

function triviaUrl(category: number, difficulty: string | null, amount = 10): string {
  const q = new URLSearchParams({ amount: String(amount), category: String(category), type: 'multiple', encode: 'url3986' });
  if (difficulty) q.set('difficulty', difficulty);
  return `https://opentdb.com/api.php?${q}`;
}

// Open Trivia DB answers one request per IP every 5 seconds (response_code 5). Several trivia cards
// fetching their categories at once would trip that, so wait it out once.
async function triviaGet(url: string): Promise<TriviaResponse> {
  const r = (await getJson(url)) as TriviaResponse;
  if (r.response_code !== 5) return r;
  await new Promise((ok) => setTimeout(ok, 5100));
  return (await getJson(url)) as TriviaResponse;
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

/** `choice`: a display's own sources and categories (validated), else the household's. */
export async function getTidbits(db: KinwallDb, now = new Date(), choice?: TidbitSettings): Promise<Tidbits> {
  const settings = await readSettings(db);
  const tz = settings.timezone ?? hostTimezone();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [, mm, dd] = date.split('-');
  const t = choice ?? settings.tidbits;
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
    const levels = t.triviaDifficulties;
    const res = await cachedJson<TriviaResponse>(db, `tidbits:trivia:${category}:${[...levels].sort().join('+')}:${date}`, now, async () => {
      // One level: ask for it. Two or three: one mixed batch, keeping the picked levels.
      let r = await triviaGet(levels.length === 1 ? triviaUrl(category, levels[0]) : triviaUrl(category, null, 30));
      if (levels.length > 1 && r.response_code === 0) {
        const kept = (r.results ?? []).filter((q) => levels.includes(q.difficulty as (typeof levels)[number])).slice(0, 10);
        r = kept.length ? { ...r, results: kept } : await triviaGet(triviaUrl(category, levels[0]));
      }
      if (r.response_code === 1) r = await triviaGet(triviaUrl(category, null)); // too few at that level: any level
      if (r.response_code !== 0) throw new Error(`Open Trivia DB response_code ${r.response_code}`);
      return r;
    });
    out.trivia = shapeTrivia(res);
  }
  return out;
}

// A display's own choice (Settings -> This display): comma-separated lists; each one given replaces
// the household's value for that field. Validated with the household schema, so only known sources,
// categories and levels get through, and the cache keys stay the same small set as before.
const list = (d: string) => z.string().optional().openapi({ description: d });
const TidbitsQuery = z.object({
  sources: list('Comma-separated: quotes, facts, tips, onthisday, trivia. Empty for none.'),
  onThisDay: list('Comma-separated: holidays, births, events.'),
  birthsAfter: list('A year, or "any".'),
  triviaCategories: list('Comma-separated Open Trivia DB category ids (9-32).'),
  triviaDifficulties: list('Comma-separated: easy, medium, hard.'),
});

export function displayChoice(household: TidbitSettings, q: z.infer<typeof TidbitsQuery>): { ok: true; choice?: TidbitSettings } | { ok: false; error: string } {
  const csv = (v?: string) => (v === undefined ? undefined : v.split(',').map((x) => x.trim()).filter(Boolean));
  const given = {
    sources: csv(q.sources),
    onThisDay: csv(q.onThisDay),
    birthsAfter: q.birthsAfter === undefined ? undefined : q.birthsAfter === 'any' ? null : Number(q.birthsAfter),
    triviaCategories: csv(q.triviaCategories)?.map(Number),
    triviaDifficulties: csv(q.triviaDifficulties),
  };
  const set = Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined));
  if (!Object.keys(set).length) return { ok: true };
  const parsed = TidbitSettingsSchema.safeParse({ ...household, ...set });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue?.path.join('.') || 'query'}: ${issue?.message ?? 'invalid'}` };
  }
  return { ok: true, choice: parsed.data };
}

tidbitRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/tidbits',
    tags: ['Snapshot'],
    summary: "Today's online tidbits for the Board's quote / fact cards (Wikipedia On this day, Open Trivia DB), per the household's Quotes & facts settings, or a display's own choice given as query params. Each source is fetched at most once a day; turned-off sources come back empty.",
    security: [{ Bearer: [] }],
    request: { query: TidbitsQuery },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: TidbitsSchema } } },
      400: { description: 'An unknown source, category or level', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const r = displayChoice((await readSettings(c.env.DB)).tidbits, c.req.valid('query'));
    if (!r.ok) return c.json({ error: r.error }, 400);
    return c.json(await getTidbits(c.env.DB, new Date(), r.choice), 200);
  },
);
