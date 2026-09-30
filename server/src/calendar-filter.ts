// Calendar filters (docs/using/calendar.md "Calendar filters"): per calendar, show only the events
// that match a rule, or everything except them. Evaluated when events are read, like category
// keywords, so sync keeps storing everything and a changed filter needs no resync.
// web/src/calendarFilter.ts mirrors this for the settings preview; test/calendar-filters.test.ts
// checks the two agree.
import { keywordMatches } from './calendar-categories.ts';

export type CalendarFilter = {
  mode: 'all' | 'only' | 'except';
  keywords: string[];
  allDay: 'any' | 'allDay' | 'timed';
  categoryIds: string[];
};

export const NO_FILTER: CalendarFilter = { mode: 'all', keywords: [], allDay: 'any', categoryIds: [] };

/** The stored JSON (calendars.filter) as a filter; anything unreadable is no filter. */
export function parseFilter(json: string | null | undefined): CalendarFilter {
  if (!json) return NO_FILTER;
  try {
    const f = JSON.parse(json);
    return {
      mode: f.mode === 'only' || f.mode === 'except' ? f.mode : 'all',
      keywords: Array.isArray(f.keywords) ? f.keywords.filter((k: unknown): k is string => typeof k === 'string' && k.trim() !== '') : [],
      allDay: f.allDay === 'allDay' || f.allDay === 'timed' ? f.allDay : 'any',
      categoryIds: Array.isArray(f.categoryIds) ? f.categoryIds.filter((k: unknown): k is string => typeof k === 'string') : [],
    };
  } catch {
    return NO_FILTER;
  }
}

/** A rule with no conditions does nothing (rather than hiding or keeping everything). */
export function filterActive(f: CalendarFilter): boolean {
  return f.mode !== 'all' && (f.keywords.length > 0 || f.allDay !== 'any' || f.categoryIds.length > 0);
}

type FilterEvent = { title: string; allDay: boolean; categoryId: string | null };

/** Every condition that's set must hold: any keyword (whole words, case-insensitive), all-day or timed, any of the categories. */
export function filterMatches(f: CalendarFilter, ev: FilterEvent): boolean {
  if (f.keywords.length > 0 && !f.keywords.some((k) => keywordMatches(ev.title, k))) return false;
  if (f.allDay === 'allDay' && !ev.allDay) return false;
  if (f.allDay === 'timed' && ev.allDay) return false;
  if (f.categoryIds.length > 0 && !(ev.categoryId && f.categoryIds.includes(ev.categoryId))) return false;
  return true;
}

export function filterShows(f: CalendarFilter, ev: FilterEvent): boolean {
  if (!filterActive(f)) return true;
  return f.mode === 'only' ? filterMatches(f, ev) : !filterMatches(f, ev);
}
