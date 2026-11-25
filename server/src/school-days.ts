// School days (docs/using/school.md#days-off-and-early-release): for each kid in School, whether a day
// is a school day, a half day (early release), no school, a weekend (not one of their schoolDays) or
// summer (after their last day of school, until the next school year starts).
//
// Their school calendars say so through the family's day rules: an event whose title holds a rule's
// words ("No School", "Early Release", "Last Day of School") makes each day it covers a day off, a
// half day or the last day. Words match whole words, any case, so "Break" is Winter Break but not
// Breakfast. A grown-up's mark for one kid's day (school_day_marks) wins over the calendars, and a
// kid's lastDay wins over a "last day" event. classifyDay is pure, so test/school-days.test.ts
// covers it; loadSchoolDays reads what it needs.
import type { KinwallDb } from './db.ts';
import type { z } from '@hono/zod-openapi';
import { SchoolSettingsSchema } from './schemas.ts';
import { eventInstances } from './routes/events.ts';
import { todayInTz } from './routes/members.ts';
import { hostTimezone } from './env.ts';
import { isLang, words, type Lang } from './i18n.ts';
import { loadAway,type AwayContext } from './away.ts';

export type DayKind = 'school' | 'half' | 'off' | 'weekend' | 'summer';
export type RuleKind = 'off' | 'half' | 'last';
export type DayRule = { words: string; kind: RuleKind };
export type SchoolSettings = z.infer<typeof SchoolSettingsSchema>;
export type SchoolDay = { date: string; kind: DayKind; reason: string | null; last: boolean; marked: boolean };

/** The day rules a family starts with, in the words its school calendars likely use (its language). */
export function defaultDayRules(lang: Lang = 'en'): DayRule[] {
  const { t } = words(lang);
  return [
    ...[t('No School'), t('No Classes'), t('Schools Closed'), t('Holiday'), t('Recess'), t('Break'), t('Vacation'), t('In-Service'), t('Inservice'), t('Professional Development'), t('Teacher Workday')].map(w => ({ words: w, kind: 'off' as const })),
    ...[t('Early Release'), t('Early Dismissal'), t('Half Day'), t('Noon Dismissal')].map(w => ({ words: w, kind: 'half' as const })),
    ...[t('Last Day of School'), t('Last Day for Students')].map(w => ({ words: w, kind: 'last' as const })),
  ];
}
export const DEFAULT_DAY_RULES = defaultDayRules();

/** The settings row 'school', filled in from the defaults (the day rules in the family's language). */
export function parseSchoolSettings(raw: string | null | undefined, lang: Lang = 'en'): SchoolSettings {
  const defaults: SchoolSettings = { rules: defaultDayRules(lang), busMinutes: 10, pickupMinutes: 15 };
  try {
    const parsed = SchoolSettingsSchema.safeParse({ ...defaults, ...JSON.parse(raw || '{}') });
    return parsed.success ? parsed.data : defaults;
  } catch { return defaults; }
}

// Numeric fractions use the family's existing "Half Day" rule, including saved/customized lists.
const norm = (s: string) => ` ${s.toLowerCase().normalize('NFKD').replace(/\b1\s*[/⁄]\s*2\b/g, 'half').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
/** Which rules an event title meets. */
export function matchRules(title: string, rules: DayRule[]): Set<RuleKind> {
  const t = norm(title);
  return new Set(rules.filter(r => norm(r.words).trim() && t.includes(norm(r.words))).map(r => r.kind));
}

export type DayEvent = { title: string; start: string; end: string; allDay: boolean };
const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
/** The days (household time) an event covers: an all-day one up to its (exclusive) end, a timed one its first day. */
export function eventDays(e: DayEvent, tz: string): string[] {
  if (!e.allDay) return [todayInTz(tz, new Date(e.start))];
  const out: string[] = [];
  for (let d = e.start.slice(0, 10), end = e.end.slice(0, 10); (d < end || !out.length) && out.length < 366; d = nextDay(d)) out.push(d);
  return out;
}

export type KidDays = { schoolDays: number[]; yearStart: string; lastDay: string | null; events: DayEvent[]; marks: Record<string, 'school' | 'half' | 'off'> };
type Found = { off?: string; half?: string; last?: string };
const found = new WeakMap<KidDays, Map<string, Found>>();
/** Each day's matching events, worked out once per kid. */
function index(kid: KidDays, rules: DayRule[], tz: string) {
  let map = found.get(kid);
  if (map) return map;
  map = new Map();
  for (const e of kid.events) {
    const kinds = matchRules(e.title, rules);
    if (!kinds.size) continue;
    for (const d of eventDays(e, tz)) {
      const f = map.get(d) ?? {};
      for (const k of kinds) f[k] ??= e.title;
      map.set(d, f);
    }
  }
  found.set(kid, map);
  return map;
}

/** The school year a day is in, as [first day, the next year's first day). */
export function schoolYearSpan(day: string, yearStart: string): [string, string] {
  const y = Number(day.slice(0, 4)) - (day.slice(5) < yearStart ? 1 : 0);
  return [`${y}-${yearStart}`, `${y + 1}-${yearStart}`];
}

/** The last day of the school year `day` is in: the kid's own, else the last "last day" event that year. */
export function lastDayOf(kid: KidDays, day: string, rules: DayRule[], tz: string): string | null {
  const [from, to] = schoolYearSpan(day, kid.yearStart);
  if (kid.lastDay && kid.lastDay >= from && kid.lastDay < to) return kid.lastDay;
  let last: string | null = null;
  for (const [d, f] of index(kid, rules, tz)) if (f.last && d >= from && d < to && (!last || d > last)) last = d;
  return last;
}

export function classifyDay(kid: KidDays, date: string, rules: DayRule[], tz: string): SchoolDay {
  const lastDay = lastDayOf(kid, date, rules, tz);
  const f = index(kid, rules, tz).get(date) ?? {};
  const base = { date, last: date === lastDay };
  const mark = kid.marks[date];
  if (mark) return { ...base, kind: mark, reason: null, marked: true };
  if (lastDay && date > lastDay) return { ...base, kind: 'summer', reason: null, marked: false };
  if (!kid.schoolDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) return { ...base, kind: 'weekend', reason: null, marked: false };
  // Early release is more specific than closure words, even across the kid's calendars.
  if (f.half) return { ...base, kind: 'half', reason: f.half, marked: false };
  if (f.off) return { ...base, kind: 'off', reason: f.off, marked: false };
  return { ...base, kind: 'school', reason: null, marked: false };
}

/** School days (and half days) from `today` through the last day of school, or null when it isn't known. */
export function schoolDaysLeft(kid: KidDays, today: string, rules: DayRule[], tz: string): { lastDay: string; left: number } | null {
  const lastDay = lastDayOf(kid, today, rules, tz);
  if (!lastDay || lastDay < today) return null;
  let left = 0;
  for (let d = today; d <= lastDay; d = nextDay(d)) { const k = classifyDay(kid, d, rules, tz).kind; if (k === 'school' || k === 'half') left++; }
  return { lastDay, left };
}

type KidRow = { member_id: string; school_days: string; year_start: string | null; last_day: string | null; calendar_ids: string };
const parse = <T>(s: string | null, fallback: T): T => { try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; } };

/** Each kid's days data for [from, to]: their calendars' events those days, and the "last day" events
 * of the school years they fall in (one small query on the titles), so the last day and summer are known. */
export async function loadSchoolDays(db: KinwallDb, from: string, to: string, memberIds?: string[]): Promise<{ kids: Map<string, KidDays>; settings: SchoolSettings; tz: string }> {
  const [kidsRes, marksRes, settingsRes] = await db.batch<unknown>([
    db.prepare('SELECT member_id, school_days, year_start, last_day, calendar_ids FROM school_kids'),
    db.prepare('SELECT member_id, date, kind FROM school_day_marks WHERE date BETWEEN ? AND ?').bind(from, to),
    db.prepare("SELECT key, value FROM settings WHERE key IN ('school', 'timezone', 'language')"),
  ]);
  const settingsRows = new Map((settingsRes.results as { key: string; value: string }[]).map(r => [r.key, r.value]));
  const lang = settingsRows.get('language');
  const settings = parseSchoolSettings(settingsRows.get('school'), isLang(lang) ? lang : 'en');
  const tz = settingsRows.get('timezone') ?? hostTimezone();
  const rows = (kidsRes.results as KidRow[]).filter(r => !memberIds || memberIds.includes(r.member_id));
  const calendars = [...new Set(rows.flatMap(r => parse<string[]>(r.calendar_ids, [])))];
  const events = new Map<string, DayEvent[]>();
  const add = (cal: string, e: DayEvent) => events.set(cal, [...(events.get(cal) ?? []), e]);
  if (calendars.length) {
    const day = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000);
    for (const cal of calendars) for (const e of await eventInstances(db, day(from, -1), day(to, 2), cal).catch(() => [])) add(cal, { title: e.title, start: e.start, end: e.end, allDay: e.allDay });
    // "Last day of school" events anywhere in those school years (titles only; they don't repeat), for kids without their own last day.
    const last = settings.rules.filter(r => r.kind === 'last');
    if (last.length && rows.some(r => !r.last_day)) {
      const starts = rows.map(r => schoolYearSpan(from, r.year_start ?? '08-15')[0]).sort(), ends = rows.map(r => schoolYearSpan(to, r.year_start ?? '08-15')[1]).sort();
      const { results } = await db.prepare('SELECT calendar_id, title, start, end, all_day FROM events WHERE calendar_id IN (SELECT value FROM json_each(?1)) AND start >= ?2 AND start < ?3 AND EXISTS (SELECT 1 FROM json_each(?4) p WHERE events.title LIKE p.value)')
        .bind(JSON.stringify(calendars), starts[0], ends[ends.length - 1], JSON.stringify(last.map(r => `%${r.words}%`))).all<{ calendar_id: string; title: string; start: string; end: string; all_day: number }>();
      for (const e of results) add(e.calendar_id, { title: e.title, start: e.start, end: e.end, allDay: !!e.all_day });
    }
  }
  const marks = marksRes.results as { member_id: string; date: string; kind: 'school' | 'half' | 'off' }[];
  const kids = new Map(rows.map(r => [r.member_id, {
    schoolDays: parse<number[]>(r.school_days, [1, 2, 3, 4, 5]), yearStart: r.year_start ?? '08-15', lastDay: r.last_day,
    events: parse<string[]>(r.calendar_ids, []).flatMap(c => events.get(c) ?? []),
    marks: Object.fromEntries(marks.filter(m => m.member_id === r.member_id).map(m => [m.date, m.kind])),
  } satisfies KidDays]));
  return { kids, settings, tz };
}

/** Whether a schoolwork row has no school on a day from `from` to `to` (a day off or summer for its
 * kid), so it's left out that day; schoolwork still due on days off, and ordinary chores, never are. */
export async function schoolworkOff(db: KinwallDb, from: string, to: string, rows: { id: string; member_id: string | null; eligible_member_ids?:string|null; school_subject_id?: string | null; school_kind?: string | null; school_days_off?: number | null }[], context?:AwayContext): Promise<(row: { id: string }, date: string) => boolean> {
  const away=context??await loadAway(db,from,to), byId=new Map(rows.map(r=>[r.id,r]));
  const work = new Map(rows.filter(r => (r.school_subject_id || r.school_kind) && !r.school_days_off && r.member_id).map(r => [r.id, r.member_id as string]));
  if (!work.size) return (row,date) => {const r=byId.get(row.id);return !!r&&away.duty(r,date).excused;};
  const { kids, settings, tz } = await loadSchoolDays(db, from, to, [...new Set(work.values())]);
  const seen = new Map<string, DayKind>();
  return (row, date) => {
    const r=byId.get(row.id);if(r&&away.duty(r,date).excused)return true;
    const member = work.get(row.id), kid = member && kids.get(member);
    if (!kid) return false;
    const key = `${member}:${date}`;
    let kind = seen.get(key);
    if (!kind) seen.set(key, kind = classifyDay(kid, date, settings.rules, tz).kind);
    return kind === 'off' || kind === 'summer';
  };
}
