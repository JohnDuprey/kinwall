-- Daily/weekly snapshot. A member's birthday: YYYY-MM-DD, or --MM-DD when the year isn't known.
ALTER TABLE members ADD COLUMN birthday TEXT;

-- Open-Meteo forecast cache (routes/weather.ts), one row per location + unit + timezone, so a
-- wall polling every 15 s reaches Open-Meteo at most once an hour.
CREATE TABLE weather_cache (
  key TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  body TEXT NOT NULL
);
