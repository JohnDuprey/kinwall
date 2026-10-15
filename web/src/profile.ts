// Words and labels for a member's profile (Profile.tsx). Pure, so web/test/profile.test.ts covers them.
import type { MemberStats, StatsPeriod } from './types.ts'

import { formatDate, msg, t, tm, tn } from './i18n.ts'

const monthOf = (key: string, opts: Intl.DateTimeFormatOptions) => formatDate(new Date(Number(key.slice(0, 4)) || 2000, Number(key.slice(5, 7)) - 1, 1), opts)
type Earlier = Exclude<StatsPeriod, 'all'>
const MORE: Record<Earlier, string> = { today: msg('▲ {n} more than yesterday'), week: msg('▲ {n} more than last week'), month: msg('▲ {n} more than this time last month'), year: msg('▲ {n} more than this time last year') }
const SAME: Record<Earlier, string> = { today: msg('Same as yesterday'), week: msg('Same as last week'), month: msg('Same as this time last month'), year: msg('Same as this time last year') }
const THEN: Record<Earlier, string> = { today: msg('{n} yesterday'), week: msg('{n} last week'), month: msg('{n} this time last month'), year: msg('{n} this time last year') }

/** Chores done against their own earlier stretch: up is cheered, down is just a number. */
export function compareText(now: number, previous: Pick<NonNullable<MemberStats['previous']>, 'choresDone'> | null, period: StatsPeriod, joined: string): string {
  if (!previous || period === 'all') return t('Since {month}', { month: monthOf(joined, { month: 'long', year: 'numeric' }) })
  if (now > previous.choresDone) return tm(MORE[period], { n: now - previous.choresDone })
  if (now === previous.choresDone) return tm(SAME[period])
  return tm(THEN[period], { n: previous.choresDone })
}

export function periodWord(period: StatsPeriod, today: string): string {
  return period === 'today' ? t('today') : period === 'week' ? t('this week') : period === 'month' ? t('in {month}', { month: monthOf(today, { month: 'long' }) }) : period === 'year' ? t('in {year}', { year: today.slice(0, 4) }) : t('since joining')
}

export function duration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  return m >= 60 ? t('{h}h {m}m', { h: Math.floor(m / 60), m: m % 60 }) : t('{m}m', { m })
}

/** Near a birthday, the countdown (60 days out) or "Turned 10 on Sep 13" (two weeks after); otherwise
 * just their age, or nothing without a birth year. */
export function birthdayText(b: { date: string; daysUntil: number; turning: number | null }): string | null {
  if (b.daysUntil === 0) return t('Birthday today! 🎂')
  const age = b.turning === null ? null : b.turning - 1
  const since = 365 - b.daysUntil // ponytail: a day off across Feb 29, fine for "two weeks ago"
  if (since >= 1 && since <= 14) {
    const day = formatDate(new Date(2000, Number(b.date.slice(-5, -3)) - 1, Number(b.date.slice(-2))), { month: 'short', day: 'numeric' })
    return age === null ? t('Birthday was {day} 🎂', { day }) : t('Turned {age} on {day} 🎂', { age, day })
  }
  if (b.daysUntil <= 60) {
    const days = b.daysUntil
    if (b.turning === null) return days === 1 ? t('Birthday tomorrow 🎂') : t('Birthday in {days} days', { days })
    return days === 1 ? t('Turns {age} tomorrow 🎂', { age: b.turning }) : t('Turns {age} in {days} days', { age: b.turning, days })
  }
  return age === null ? null : age < 1 ? t('Under 1 year old') : tn(age, '{n} year old', '{n} years old')
}

/** Axis labels for the chores chart: weekday initials, a few days of the month, month initials,
 * or (all time) the first month, Januaries and Julys. */
export function chartLabels(keys: string[], period: StatsPeriod): string[] {
  return keys.map((k, i) => {
    if (period === 'week') return formatDate(new Date(`${k}T12:00:00Z`), { weekday: 'narrow' }, 'UTC')
    const day = Number(k.slice(8, 10))
    if (period === 'month') return [1, 8, 15, 22, 29].includes(day) ? String(day) : ''
    const month = Number(k.slice(5, 7))
    if (period === 'year') return monthOf(k, { month: 'narrow' })
    return i === 0 || month === 1 || month === 7 ? `${monthOf(k, { month: 'short' })} ’${k.slice(2, 4)}` : ''
  })
}

/** A weekday's name, 0 = Sunday. */
export const weekdayName = (d: number) => formatDate(new Date(2023, 0, 1 + d), { weekday: 'long' })

/** A link to a profile (#/profile/<id>) whose person isn't in the family (removed, or a bad link):
 * show "That isn't here anymore" rather than someone else's profile. No id: the viewer's own. */
export const unknownMember = (id: string | undefined, members: { id: string }[]) =>
  !!id && members.length > 0 && !members.some(m => m.id === id)
