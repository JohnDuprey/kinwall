// Away days' date rules and words (Away.tsx; server: away.ts decides what's due). Pure, so
// web/test/away.test.ts covers it. The server is the authority; these only explain and check a
// draft before it's sent.
import { addDays } from './upkeep-rules.ts'
import { DAY, formatDate, intlLocale, MONTH_DAY, t, tn } from './i18n.ts'
import { longDay } from './trips.ts'
import type { AwayPeriod, AwayPerson, Handoff } from './trip-types.ts'

/** The days someone is actually away: the leave and return days only when ticked. null: none. */
export function awayDays(p: AwayPerson): { from: string; to: string } | null {
  const from = p.leaveDayAway ? p.startDate : addDays(p.startDate, 1)
  const to = p.returnDayAway ? p.endDate : addDays(p.endDate, -1)
  return from <= to ? { from, to } : null
}

const rangesOf = (periods: Pick<AwayPeriod, 'people'>[], memberId: string) =>
  periods.flatMap(x => x.people.filter(p => p.memberId === memberId).map(awayDays)).filter((r): r is { from: string; to: string } => !!r)

/** Away on that date, in any period (they combine). */
export function awayOn(periods: Pick<AwayPeriod, 'people'>[], memberId: string, date: string): boolean {
  return rangesOf(periods, memberId).some(r => r.from <= date && date <= r.to)
}

/** The last away day of the run that includes `date`, across periods that touch or overlap; null
 * when not away then. */
export function awayUntil(periods: Pick<AwayPeriod, 'people'>[], memberId: string, date: string): string | null {
  if (!awayOn(periods, memberId, date)) return null
  const ranges = rangesOf(periods, memberId)
  let until = date
  for (let grew = true; grew;) {
    grew = false
    for (const r of ranges) if (r.from <= addDays(until, 1) && r.to > until) { until = r.to; grew = true }
  }
  return until
}

/** One notice per return date, in date order; a person filter never means the whole family. */
export function groupChoreAway(periods: Pick<AwayPeriod, 'people'>[], members: { id: string; name: string }[], date: string, memberId?: string | null) {
  const groups = new Map<string, string[]>()
  for (const member of members) {
    if (memberId && member.id !== memberId) continue
    const until = awayUntil(periods, member.id, date)
    if (until) groups.set(until, [...(groups.get(until) ?? []), member.name])
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([until, names]) => ({
    until, names, everyone: !memberId && names.length === members.length,
  }))
}

/** Short visible words, with the complete sentence and names retained for assistive reading. */
export function choreAwayNotice(group: ReturnType<typeof groupChoreAway>[number]) {
  const day = formatDate(new Date(`${group.until}T12:00:00`), DAY)
  const list = new Intl.ListFormat(intlLocale(), { style: 'long', type: 'conjunction' })
  const names = list.format(group.names.length > 3 ? [...group.names.slice(0, 2), tn(group.names.length - 2, '{n} more', '{n} more')] : group.names)
  return {
    text: group.everyone ? t('✈️ Everyone’s away until {day} · chores wait', { day })
      : tn(group.names.length, '✈️ {names} is away until {day} · chores wait', '✈️ {names} are away until {day} · chores wait', { names, day }),
    label: group.everyone ? t('Everyone is away until {day}. Chores wait until everyone is back.', { day })
      : tn(group.names.length, '{names} is away until {day}. Their chores wait until they’re back.', '{names} are away until {day}. Their chores wait until they’re back.', { names: list.format(group.names), day }),
  }
}

/** "Wed, Mar 3 – Fri, Mar 5 · leave day counts, back day doesn’t". */
export function personSummary(p: AwayPerson): string {
  const dates = p.startDate === p.endDate ? longDay(p.startDate) : t('{from} – {to}', { from: longDay(p.startDate), to: longDay(p.endDate) })
  if (!awayDays(p)) return t('{dates} · no away days', { dates })
  const rule = p.startDate === p.endDate ? null
    : p.leaveDayAway && p.returnDayAway ? t('both days count')
    : p.leaveDayAway ? t('leave day counts, back day doesn’t')
    : p.returnDayAway ? t('back day counts, leave day doesn’t')
    : t('neither the leave nor the back day counts')
  return rule ? `${dates} · ${rule}` : dates
}

/** What's wrong with a draft's handoffs, in words: given to someone away that day (in this draft or
 * another saved period), to the chore's own person, one chore to two people on a day, or days
 * outside the person's away days. The server checks the same and has the last word. */
export function handoffProblems(draft: Pick<AwayPeriod, 'people' | 'handoffs'>, others: Pick<AwayPeriod, 'people'>[], names: Record<string, string>): string[] {
  const out: string[] = []
  const all = [draft, ...others]
  const short = (d: string) => formatDate(new Date(`${d}T12:00:00`), MONTH_DAY)
  draft.handoffs.forEach((h: Handoff, i) => {
    if (h.toMemberId === h.fromMemberId) { out.push(t('Pick someone other than {name}.', { name: names[h.fromMemberId] ?? '' })); return }
    for (let d = h.startDate; d <= h.endDate; d = addDays(d, 1)) {
      if (!awayOn([draft], h.fromMemberId, d)) { out.push(t('A handoff covers only {name}’s away days.', { name: names[h.fromMemberId] ?? '' })); return }
    }
    for (let d = h.startDate; d <= h.endDate; d = addDays(d, 1)) {
      if (awayOn(all, h.toMemberId, d)) { out.push(t('{name} is away on {date}, so can’t take a chore that day.', { name: names[h.toMemberId] ?? '', date: longDay(d) })); return }
    }
    const clash = draft.handoffs.slice(0, i).find(o => o.choreId === h.choreId && o.toMemberId !== h.toMemberId && o.startDate <= h.endDate && h.startDate <= o.endDate)
    if (clash) out.push(t('One chore can go to only one person on a day: check {date}.', { date: short(h.startDate > clash.startDate ? h.startDate : clash.startDate) }))
  })
  return out
}
