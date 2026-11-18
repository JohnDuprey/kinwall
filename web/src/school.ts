// School's screen logic (School.tsx; server: routes/school.ts): the week shown, one save for several
// kids shown once, each kid's minutes by subject, and the CSV export.
import { addDayKeys } from './library.ts'
import { zonedDayKey } from './date.ts'
import type { SchoolLog } from './types.ts'

/** The week holding `day`, starting on the family's first day (0 Sunday, 1 Monday). */
export function weekOf(day: string, weekStart: number): { from: string; to: string } {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay()
  const from = addDayKeys(day, -((dow - weekStart + 7) % 7))
  return { from, to: addDayKeys(from, 6) }
}

// memberIds: the kids still in the family; removed: the names of removed members on it (their logs stay).
export type LogGroup = { groupId: string; first: SchoolLog; logs: SchoolLog[]; memberIds: string[]; removed: string[]; pending: boolean }
/** One entry per save (its kids' copies together), newest day first, in the server's order. */
export function groups(logs: SchoolLog[]): LogGroup[] {
  const byId = new Map<string, LogGroup>()
  for (const l of [...logs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))) {
    const g = byId.get(l.groupId)
    const g2 = g ?? { groupId: l.groupId, first: l, logs: [], memberIds: [], removed: [], pending: false }
    g2.logs.push(l); g2.pending ||= l.pending
    if (l.memberId) g2.memberIds.push(l.memberId); else if (l.formerMember) g2.removed.push(l.formerMember)
    if (!g) byId.set(l.groupId, g2)
  }
  return [...byId.values()]
}

export type KidTotal = { memberId: string; total: number; bySubject: { subjectId: string | null; minutes: number }[] }
/** Each kid's approved minutes, most time first, by subject (most first). */
export function kidTotals(logs: SchoolLog[]): KidTotal[] {
  const kids = new Map<string, Map<string | null, number>>()
  for (const l of logs) {
    if (l.pending || !l.memberId) continue // a removed member's time isn't any kid's total
    const subjects = kids.get(l.memberId) ?? new Map()
    subjects.set(l.subjectId, (subjects.get(l.subjectId) ?? 0) + l.minutes)
    kids.set(l.memberId, subjects)
  }
  return [...kids].map(([memberId, subjects]) => {
    const bySubject = [...subjects].map(([subjectId, minutes]) => ({ subjectId, minutes })).sort((a, b) => b.minutes - a.minutes)
    return { memberId, total: bySubject.reduce((n, s) => n + s.minutes, 0), bySubject }
  }).sort((a, b) => b.total - a.total)
}

const cell = (v: string | number) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
/** The logs as CSV, oldest first; `header` and `yesNo` come translated. */
export function csv(logs: SchoolLog[], kid: (l: SchoolLog) => string, subject: (id: string | null) => string, header: string[], yesNo: [string, string]): string {
  const rows = [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map(l => [l.date, kid(l), subject(l.subjectId), l.minutes, l.title ?? '', l.notes ?? '', l.pending ? yesNo[0] : yesNo[1]])
  return [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** Whether a calendar event is on `day` (YYYY-MM-DD) in the family's timezone: an all-day event
 * from its start up to its (exclusive) end, a timed one on the day it starts. */
export function onDay(e: { allDay: boolean; start: string; end: string }, day: string, tz: string): boolean {
  if (e.allDay) return e.start.slice(0, 10) <= day && day < e.end.slice(0, 10)
  return zonedDayKey(e.start, tz) === day
}

/** When a school year starts unless a kid's is set (the server's DEFAULT_YEAR_START): mid-August. */
export const DEFAULT_YEAR_START = '08-15'
/** Which school year a day is in, named by its first calendar year, for a year starting on `start` (MM-DD). */
export const schoolYearOf = (day: string, start = DEFAULT_YEAR_START) => Number(day.slice(0, 4)) - (day.slice(5) < start ? 1 : 0)
/** The days school year `year` covers: from its start to the day before the next year's. */
export function schoolYearRange(year: number, start = DEFAULT_YEAR_START) {
  return { from: `${year}-${start}`, to: addDayKeys(`${year + 1}-${start}`, -1) }
}

/** Every school year from this calendar year back to the API's earliest supported year. */
export function schoolYears(today: string): number[] {
  const latest = Math.min(2100, Math.max(2000, Number(today.slice(0, 4))))
  return Array.from({ length: latest - 2000 + 1 }, (_, i) => latest - i)
}

