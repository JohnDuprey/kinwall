// Calendar filters (docs/using/calendar.md "Calendar filters"). The server decides what's hidden
// (server/src/calendar-filter.ts); this mirror only drives the settings preview, "Hide events like
// this" and the demo. server/test/calendar-filters.test.ts checks the two agree.

export type CalendarFilter = {
  mode: 'all' | 'only' | 'except'
  keywords: string[]
  allDay: 'any' | 'allDay' | 'timed'
  categoryIds: string[]
}

export const NO_FILTER: CalendarFilter = { mode: 'all', keywords: [], allDay: 'any', categoryIds: [] }

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Case-insensitive whole word or phrase: "break" matches "Winter Break" but not "Breakfast". Same as category keywords. */
export function keywordMatches(title: string, keyword: string): boolean {
  const trimmed = keyword.trim()
  if (!trimmed) return false
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(trimmed)}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(` ${title} `)
}

/** A rule with no conditions does nothing (rather than hiding or keeping everything). */
export function filterActive(f: CalendarFilter): boolean {
  return f.mode !== 'all' && (f.keywords.length > 0 || f.allDay !== 'any' || f.categoryIds.length > 0)
}

type FilterEvent = { title: string; allDay: boolean; categoryId: string | null }

export function filterMatches(f: CalendarFilter, ev: FilterEvent): boolean {
  if (f.keywords.length > 0 && !f.keywords.some(k => keywordMatches(ev.title, k))) return false
  if (f.allDay === 'allDay' && !ev.allDay) return false
  if (f.allDay === 'timed' && ev.allDay) return false
  if (f.categoryIds.length > 0 && !(ev.categoryId && f.categoryIds.includes(ev.categoryId))) return false
  return true
}

export function filterShows(f: CalendarFilter, ev: FilterEvent): boolean {
  if (!filterActive(f)) return true
  return f.mode === 'only' ? filterMatches(f, ev) : !filterMatches(f, ev)
}

/** The calendar sheet's row: what the filter does now, opening the filter sheet. */
export function filterSummary(f: CalendarFilter | undefined): string {
  if (!f || !filterActive(f)) return 'All events'
  const parts = [f.mode === 'only' ? 'Only matching' : 'All except matching']
  if (f.keywords.length) parts.push(`${f.keywords.length} word${f.keywords.length === 1 ? '' : 's'}`)
  if (f.allDay !== 'any') parts.push(f.allDay === 'allDay' ? 'all-day' : 'timed')
  if (f.categoryIds.length) parts.push(`${f.categoryIds.length} categor${f.categoryIds.length === 1 ? 'y' : 'ies'}`)
  return parts.join(' · ')
}

/** "no school, Half Day" -> ['no school', 'Half Day'], deduped ignoring case. */
export function parseKeywordList(text: string): string[] {
  const seen = new Set<string>()
  return text.split(',').map(k => k.trim()).filter(k => k && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()))
}

// US school calendars: days off, breaks and half days. Named holidays too, since "Labor Day" alone
// usually means no school.
const US_HOLIDAYS = ["New Year's Day", 'Martin Luther King', 'MLK', "Presidents' Day", 'Presidents Day', 'Memorial Day', 'Juneteenth', 'Independence Day', 'Fourth of July', 'Labor Day', 'Columbus Day', "Indigenous Peoples' Day", 'Veterans Day', 'Thanksgiving']

export const FILTER_PRESETS: { id: string; label: string; filter: CalendarFilter }[] = [
  {
    id: 'school', label: 'School: days off & half days',
    filter: {
      mode: 'only', allDay: 'allDay', categoryIds: [],
      keywords: ['no school', 'no classes', 'school closed', 'closed', 'day off', 'vacation', 'break', 'holiday', 'holidays', 'recess', 'half day', 'half-day',
        'early release', 'early dismissal', 'professional development', 'PD day', 'staff development', 'teacher workshop', 'teacher workday', 'in-service',
        'snow day', 'conference', 'conferences', ...US_HOLIDAYS],
    },
  },
  {
    id: 'holidays', label: 'Holidays only',
    filter: {
      mode: 'only', allDay: 'any', categoryIds: [],
      keywords: ['holiday', 'holidays', ...US_HOLIDAYS, 'Christmas', 'Hanukkah', 'Kwanzaa', 'Easter', 'Passover', 'Halloween', "Valentine's Day", "Mother's Day", "Father's Day", 'Diwali', 'Eid', 'Rosh Hashanah', 'Yom Kippur', 'Lunar New Year'],
    },
  },
  { id: 'birthdays', label: 'Hide birthdays', filter: { mode: 'except', allDay: 'any', categoryIds: [], keywords: ['birthday', 'bday', 'b-day'] } },
]

type PreviewEvent = FilterEvent & { hidden?: 'event' | 'series' | 'filter' | null }

/** What a draft filter would show out of a calendar's events. Events hidden one by one stay hidden. */
export function previewFilter<E extends PreviewEvent>(events: E[], f: CalendarFilter): { shown: E[]; hidden: E[] } {
  const shown: E[] = [], hidden: E[] = []
  for (const ev of events) (ev.hidden === 'event' || ev.hidden === 'series' || !filterShows(f, ev) ? hidden : shown).push(ev)
  return { shown, hidden }
}

/** "Hide events like this": the filter with this event's title added as an exception, or null when
 * that can't hide it (an "only" filter, or an "except" rule whose other conditions don't fit it). */
export function hideLikeThis(f: CalendarFilter, ev: FilterEvent): CalendarFilter | null {
  const title = ev.title.trim()
  if (!title || f.mode === 'only') return null
  // Adding a keyword to a rule with none would narrow it and show what it hides now.
  if (filterActive(f) && f.keywords.length === 0) return null
  const next: CalendarFilter = filterActive(f)
    ? { ...f, keywords: f.keywords.some(k => k.toLowerCase() === title.toLowerCase()) ? f.keywords : [...f.keywords, title] }
    : { mode: 'except', keywords: [title], allDay: 'any', categoryIds: [] }
  return filterShows(next, ev) ? null : next
}
