// Weather for the snapshot, and the location search in Settings -> General. Both go through the
// server (Open-Meteo, free and keyless) so the browser never talks to a third party and the CSP
// stays 'self'. Only the household's saved coordinates / the typed place name are sent.
import type { KinwallDb } from '../db.ts';
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { hostTimezone } from '../env.ts';
import { checkRate } from '../ratelimit.ts';
import { ErrorSchema, GeocodeResultSchema, WeatherSchema } from '../schemas.ts';
import { readSettings } from './settings.ts';

export const weatherRoutes = createRouter();

const CACHE_MS = 60 * 60 * 1000; // a wall polling every 15 s still reaches Open-Meteo at most hourly
const RETRY_MS = 10 * 60 * 1000; // after a failed fetch
const TIMEOUT_MS = 8000;

// WMO weather interpretation codes (Open-Meteo's weather_code).
const WMO: Record<number, [string, string]> = {
  0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Cloudy'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Freezing fog'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌦️', 'Heavy drizzle'], 56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'],
  61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'], 66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'],
  71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['🌧️', 'Heavy showers'], 85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Heavy snow showers'],
  95: ['⛈️', 'Thunderstorms'], 96: ['⛈️', 'Thunderstorms, hail'], 99: ['⛈️', 'Thunderstorms, hail'],
};
export function describeWeather(code: number): { emoji: string; text: string } {
  const [emoji, text] = WMO[code] ?? ['🌡️', 'Unknown'];
  return { emoji, text };
}

type OpenMeteo = {
  daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] };
  hourly?: { time: string[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability: (number | null)[] };
};
export type Weather = z.infer<typeof WeatherSchema>;

function shape(raw: OpenMeteo, location: string, unit: Weather['unit'], tz: string, now: Date): Weather {
  const d = raw.daily;
  const days = (d?.time ?? []).map((date, i) => ({
    date,
    code: d!.weather_code[i],
    ...describeWeather(d!.weather_code[i]),
    high: Math.round(d!.temperature_2m_max[i]),
    low: Math.round(d!.temperature_2m_min[i]),
    rainChance: d!.precipitation_probability_max[i] ?? null,
  }));
  // Hourly times are household-local ("2026-09-25T08:00") since we pass timezone=.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  const h = raw.hourly;
  const i = h?.time.indexOf(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00`) ?? -1;
  const current = h && i >= 0 ? { temp: Math.round(h.temperature_2m[i]), code: h.weather_code[i], ...describeWeather(h.weather_code[i]), rainChance: h.precipitation_probability[i] ?? null } : null;
  return { location, unit, now: current, days };
}

/** The household's 7-day forecast (null when no location is set, or nothing could be fetched). */
export async function getWeather(db: KinwallDb, now = new Date()): Promise<Weather | null> {
  const settings = await readSettings(db);
  const loc = settings.location;
  if (!loc) return null;
  const tz = settings.timezone ?? hostTimezone();
  const unit = settings.temperatureUnit;
  const key = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)},${unit},${tz}`;
  const cached = await db.prepare('SELECT fetched_at, body FROM weather_cache WHERE key = ?').bind(key).first<{ fetched_at: string; body: string }>();
  let body = cached?.body ?? 'null';
  if (!cached || now.getTime() - Date.parse(cached.fetched_at) >= CACHE_MS) {
    let fetchedAt = now;
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({
        latitude: String(loc.lat),
        longitude: String(loc.lon),
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
        hourly: 'temperature_2m,weather_code,precipitation_probability',
        timezone: tz,
        forecast_days: '7',
        temperature_unit: unit,
      }).toString();
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
      body = JSON.stringify(await res.json());
    } catch (err) {
      console.error('weather fetch failed', err instanceof Error ? err.message : err);
      fetchedAt = new Date(now.getTime() - CACHE_MS + RETRY_MS); // keep the stale forecast, retry in 10 min
    }
    await db.batch([
      db.prepare('DELETE FROM weather_cache WHERE fetched_at < ?').bind(new Date(now.getTime() - 24 * CACHE_MS).toISOString()), // old locations
      db
        .prepare('INSERT INTO weather_cache (key, fetched_at, body) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, body = excluded.body')
        .bind(key, fetchedAt.toISOString(), body),
    ]);
  }
  const raw = JSON.parse(body) as OpenMeteo | null;
  return raw?.daily ? shape(raw, loc.name, unit, tz, now) : null;
}

weatherRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/weather',
    tags: ['Snapshot'],
    summary: "The household location's 7-day forecast (Open-Meteo, cached for an hour). null when no location is set.",
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: WeatherSchema.nullable() } } } },
  }),
  async (c) => c.json(await getWeather(c.env.DB), 200),
);

weatherRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/geocode',
    tags: ['Snapshot'],
    summary: 'Look up a town or city for the household location (Open-Meteo geocoding, server-side).',
    security: [{ Bearer: [] }],
    request: { query: z.object({ q: z.string().trim().min(2).max(100) }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.array(GeocodeResultSchema) } } },
      429: { description: 'too many lookups', content: { 'application/json': { schema: ErrorSchema } } },
      502: { description: 'lookup failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { q } = c.req.valid('query');
    if (!(await checkRate(c.env.DB, 'geocode', 30, 60_000))) return c.json({ error: 'Too many searches - try again in a minute' }, 429);
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: '5', format: 'json' })}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
      const { results = [] } = (await res.json()) as { results?: { name: string; admin1?: string; country?: string; country_code?: string; latitude: number; longitude: number }[] };
      return c.json(
        results.map((r) => ({
          name: r.name,
          label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
          lat: r.latitude,
          lon: r.longitude,
          ...(r.country_code ? { countryCode: r.country_code.toUpperCase() } : {}),
        })),
        200,
      );
    } catch (err) {
      console.error('geocode failed', err instanceof Error ? err.message : err);
      return c.json({ error: 'Location search is unavailable right now' }, 502);
    }
  },
);
