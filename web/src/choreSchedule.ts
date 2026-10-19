// The chore editor's supported RRULE subset. Unfamiliar rules stay opaque and are sent back intact.
import * as RRuleNS from 'rrule'
import { formatDate, t, tn } from './i18n.ts'
const RRule = (RRuleNS as unknown as { RRule?: typeof import('rrule').RRule }).RRule ??
  (RRuleNS as unknown as { default: { RRule: typeof import('rrule').RRule } }).default.RRule

export const RR_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
export type Repeat = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export type ScheduleForm = {
  repeat: Repeat; interval: number; days: number[]; weekStart: number
  end: 'never' | 'on' | 'after'; until: string; count: number
  monthly: 'date' | 'weekday'; monthDay: number | null; ordinal: number; monthWeekday: number
  custom: boolean
}
export const dayName = (d: number, weekday: 'short' | 'long' | 'narrow') => formatDate(new Date(2023, 0, 1 + d), { weekday })
export const dateParts = (key: string) => {
  const date = new Date(`${key}T12:00:00Z`)
  return { day: date.getUTCDate(), weekday: date.getUTCDay(), ordinal: Math.ceil(date.getUTCDate() / 7) }
}
const positive = (s: string) => /^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 9999

export function rruleToForm(rule: string | null): ScheduleForm {
  const f: ScheduleForm = { repeat: 'once', interval: 1, days: [], weekStart: 1, end: 'never', until: '', count: 10, monthly: 'date', monthDay: null, ordinal: 1, monthWeekday: 0, custom: false }
  if (!rule) return f
  const seen = new Set<string>()
  const parts = rule.replace(/^RRULE:/i, '').split(';').map(part => part.trim().toUpperCase().split('='))
  const freq = parts.find(([key]) => key === 'FREQ')?.[1]?.toLowerCase()
  if (['daily', 'weekly', 'monthly', 'yearly'].includes(freq ?? '')) f.repeat = freq as Repeat
  else f.custom = true
  for (const [key, value = '', extra] of parts) {
    if (seen.has(key) || extra !== undefined) f.custom = true
    seen.add(key)
    if (key === 'FREQ') continue
    if (key === 'INTERVAL' && positive(value)) f.interval = Number(value)
    else if (key === 'COUNT' && positive(value)) { f.end = 'after'; f.count = Number(value) }
    else if (key === 'UNTIL' && /^\d{8}$/.test(value)) {
      f.end = 'on'; f.until = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
      if (!validDate(f.until)) f.custom = true
    } else if (key === 'WKST' && f.repeat === 'weekly' && RR_DAYS.includes(value)) f.weekStart = RR_DAYS.indexOf(value)
    else if (key === 'BYDAY' && f.repeat === 'weekly' && value.split(',').every(d => RR_DAYS.includes(d))) {
      f.days = [...new Set(value.split(',').map(d => RR_DAYS.indexOf(d)))].sort()
    } else if (key === 'BYDAY' && f.repeat === 'monthly' && /^(-1|[1-5])(SU|MO|TU|WE|TH|FR|SA)$/.test(value)) {
      const match = /^(-1|[1-5])(.+)$/.exec(value)!
      f.monthly = 'weekday'; f.ordinal = Number(match[1]); f.monthWeekday = RR_DAYS.indexOf(match[2])
    } else if (key === 'BYMONTHDAY' && f.repeat === 'monthly' && /^\d+$/.test(value) && +value >= 1 && +value <= 31) f.monthDay = +value
    else f.custom = true
  }
  if (seen.has('COUNT') && seen.has('UNTIL') || seen.has('BYDAY') && seen.has('BYMONTHDAY')) f.custom = true
  return f
}

export function formToRrule(f: ScheduleForm): string | null {
  if (f.repeat === 'once') return null
  let rule = ['FREQ', f.repeat.toUpperCase()].join('=')
  if (f.interval > 1) rule += `;INTERVAL=${f.interval}`
  if (f.repeat === 'weekly') {
    if (f.days.length) rule += `;BYDAY=${[...f.days].sort((a, b) => (a + 6) % 7 - (b + 6) % 7).map(d => RR_DAYS[d]).join(',')}`
    rule += `;WKST=${RR_DAYS[f.weekStart]}`
  }
  if (f.repeat === 'monthly') {
    if (f.monthly === 'weekday') rule += `;BYDAY=${f.ordinal}${RR_DAYS[f.monthWeekday]}`
    else if (f.monthDay !== null) rule += `;BYMONTHDAY=${f.monthDay}`
  }
  if (f.end === 'on') rule += `;UNTIL=${f.until.replaceAll('-', '')}`
  if (f.end === 'after') rule += `;COUNT=${f.count}`
  return rule
}

export function validDate(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(Date.parse(key)) && new Date(`${key}T00:00:00Z`).toISOString().slice(0, 10) === key
}

export function validSchedule(f: ScheduleForm, start: string): boolean {
  if (f.custom) return true
  if (start && !validDate(start)) return false
  if (f.repeat === 'once') return validDate(start)
  return Number.isInteger(f.interval) && f.interval >= 1 && f.interval <= 9999
    && (f.end !== 'after' || Number.isInteger(f.count) && f.count >= 1 && f.count <= 9999)
    && (f.end !== 'on' || validDate(f.until) && (!start || f.until >= start))
}

/** dueDate doubles as DTSTART. In particular, never clear it when saving a title or points edit. */
export function scheduleBody(original: { rrule: string | null; dueDate: string | null }, f: ScheduleForm, touched: boolean, start: string) {
  return { rrule: touched ? formToRrule(f) : original.rrule, dueDate: start || null }
}

/** Floating UTC dates, like the server's all-day recurrence path. COUNT is counted from DTSTART. */
export function scheduleDates(rule: string | null, anchor: string, from: string, count = 5): string[] {
  if (!validDate(anchor) || !validDate(from)) return []
  if (!rule) return anchor >= from ? [anchor] : []
  if (rruleToForm(rule).custom) return []
  try {
    const start = new Date(`${from}T00:00:00Z`)
    const end = new Date(start); end.setUTCFullYear(Math.min(9999, end.getUTCFullYear() + 400))
    return new RRule({ ...RRule.parseString(rule), dtstart: new Date(`${anchor}T00:00:00Z`) })
      .between(start, end, true, (_date, length) => length < count).map(d => d.toISOString().slice(0, 10))
  } catch { return [] }
}

export function ordinalDay(n: number, day: number): string {
  const weekday = dayName(day, 'long')
  if (n === -1) return t('Last {day}', { day: weekday })
  if (n === 1) return t('First {day}', { day: weekday })
  if (n === 2) return t('Second {day}', { day: weekday })
  if (n === 3) return t('Third {day}', { day: weekday })
  if (n === 4) return t('Fourth {day}', { day: weekday })
  return t('Fifth {day}', { day: weekday })
}

export function scheduleText(rule: string | null): string {
  const f = rruleToForm(rule)
  if (f.custom) return t('Custom schedule')
  if (f.repeat === 'once') return ''
  const n = f.interval
  let text = f.repeat === 'daily' ? (n === 1 ? t('Daily') : t('Every {n} days', { n }))
    : f.repeat === 'weekly' ? (n === 1 ? t('Weekly') : t('Every {n} weeks', { n }))
    : f.repeat === 'monthly' ? (n === 1 ? t('Monthly') : t('Every {n} months', { n }))
    : n === 1 ? t('Yearly') : t('Every {n} years', { n })
  if (f.repeat === 'weekly' && f.days.length) text = t('{repeat} · {days}', { repeat: text, days: f.days.length === 7 ? t('Every day that week') : f.days.map(d => dayName(d, 'short')).join(', ') })
  if (f.repeat === 'monthly' && f.monthly === 'weekday') text = t('{repeat} · {pattern}', { repeat: text, pattern: ordinalDay(f.ordinal, f.monthWeekday) })
  else if (f.repeat === 'monthly' && f.monthDay) text = t('{repeat} · day {day}', { repeat: text, day: f.monthDay })
  if (f.end === 'on' && validDate(f.until)) text = t('{repeat} · until {date}', { repeat: text, date: formatDate(new Date(`${f.until}T12:00:00`), { year: 'numeric', month: 'short', day: 'numeric' }) })
  if (f.end === 'after') text = t('{repeat} · {count}', { repeat: text, count: tn(f.count, '{n} occurrence', '{n} occurrences') })
  return text
}
