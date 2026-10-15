// Medication reminders (TakeNow.tsx, Medications.tsx, Trackers → Health → Medicines). Pure, so
// web/test/medications.test.ts covers it.
import { format } from 'date-fns'
import { formatTime } from './timeFormat.ts'
import { DAY, formatDate, msg, t, tm, tn } from './i18n.ts'
import type { DoseStatus, Medication, MedicationHistory, MedTime } from './types.ts'

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
/** A weekday (0 = Sunday) in the current language, short: "Mon". */
export const weekdayShort = (i: number) => formatDate(new Date(2023, 0, 1 + i), { weekday: 'short' }) // Jan 1, 2023 was a Sunday

/** Which of Every day, Weekdays, Weekends or certain days these are. */
export function daysMode(days: number[]): 'every' | 'weekdays' | 'weekends' | 'some' {
  const d = [...new Set(days)].sort((a, b) => a - b).join()
  return d === '0,1,2,3,4,5,6' ? 'every' : d === '1,2,3,4,5' ? 'weekdays' : d === '0,6' ? 'weekends' : 'some'
}

/** "Every day", "Weekdays", "Weekends" or "Mon, Wed, Fri". */
export function daysLabel(days: number[]): string {
  const mode = daysMode(days)
  if (mode === 'every') return t('Every day')
  if (mode === 'weekdays') return t('Weekdays')
  if (mode === 'weekends') return t('Weekends')
  return [...new Set(days)].sort((a, b) => a - b).map(weekdayShort).join(', ')
}

/** A dose time in a schedule: "8:00 AM", or "When I start my day (by 12:00 PM)". */
export const timeLabel = (time: MedTime) => (typeof time === 'string' ? formatTime(time) : t('When I start my day (by {time})', { time: formatTime(time.latest) }))

/** A dose's time on a card or the person page: "8:00 AM", "When you start your day", or "Started at 9:40 AM". */
export function doseTimeLabel(d: { time: string; startedAt: string | null }): string {
  if (d.time !== 'wake') return formatTime(d.time)
  return d.startedAt ? t('Started at {time}', { time: formatTime(new Date(d.startedAt)) }) : t('When you start your day')
}

/** Should this device tell the server its person's day started (POST /api/members/{id}/day-started)?
 *  Once a day (lastSent: the day it last did), only on a person's own device with medications on: a
 *  kid's or a grown-up's own phone (a parent device a grown-up owns). A parent's device opening a
 *  kid's day must never start it, and a shared wall or an unowned parent device belongs to no one. */
export function dayStartDue(d: { medications: boolean; parentDevice: boolean; ownerId: string | null; ownerGrownUp: boolean; today: string }, lastSent: string | null): boolean {
  return d.medications && !!d.ownerId && (!d.parentDevice || d.ownerGrownUp) && lastSent !== d.today
}

/** "8:00 AM and 8:30 PM · Every day", plus the course when it has one (" · Until Mon, Oct 5"). */
export function scheduleLabel(m: Pick<Medication, 'times' | 'days'> & Partial<Pick<Medication, 'endDate' | 'totalDoses' | 'dosesLeft'>>): string {
  const times = m.times.map(timeLabel)
  const course = courseLabel({ endDate: m.endDate ?? null, totalDoses: m.totalDoses ?? null, dosesLeft: m.dosesLeft ?? null })
  return `${times.length > 1 ? t('{list} and {last}', { list: times.slice(0, -1).join(', '), last: times.at(-1)! }) : times[0]} · ${daysLabel(m.days)}${course ? ` · ${course}` : ''}`
}

/** A course (e.g. an antibiotic): "Until Mon, Oct 5", "7 of 20 doses left", "Done: all 20 doses taken", or ''. */
export function courseLabel(m: Pick<Medication, 'endDate' | 'totalDoses' | 'dosesLeft'>): string {
  if (m.totalDoses != null) return m.dosesLeft === 0 ? tn(m.totalDoses, 'Done: {n} dose taken', 'Done: all {n} doses taken') : tn(m.totalDoses, '{left} of {n} dose left', '{left} of {n} doses left', { left: m.dosesLeft ?? m.totalDoses })
  return m.endDate ? t('Until {day}', { day: formatDate(new Date(`${m.endDate}T12:00:00`), DAY) }) : ''
}

/** What a Take now card says: the medicine where names show, "Meds" on a shared screen without them. */
export function cardLabel(d: { name: string | null; dose: string | null }): string {
  if (!d.name) return t('Meds')
  return d.dose ? `${d.name} · ${d.dose}` : d.name
}

/** Labels marked: show with tm(). */
export const STATUS: Record<DoseStatus, { emoji: string; label: string }> = {
  taken: { emoji: '✅', label: msg('Taken') },
  skipped: { emoji: '⏭️', label: msg('Skipped') },
  due: { emoji: '💊', label: msg('Due now') },
  missed: { emoji: '⭕', label: msg('Not marked') },
  upcoming: { emoji: '🕒', label: msg('Later') },
}
/** The person page's catch-up button for a dose: "Taken" while it's due or not marked (catching up
 *  asks when, and the log then says "Taken late" if it was), null when it's marked, still to come, or
 *  already on the Take now card above (one set of buttons per dose). */
export const catchUpLabel = (s: DoseStatus, inTakeNow = false): string | null => (!inTakeNow && (s === 'due' || s === 'missed') ? t('Taken') : null)

/** What a marked dose says: "Taken late" when it was taken after its late window closed. */
export const statusLabel = (d: { status: DoseStatus; late: boolean }) => (d.status === 'taken' && d.late ? t('Taken late') : tm(STATUS[d.status].label))

/** Taken this long after a dose's time asks "When did you take it?" (Just now, At its time, Earlier…);
 *  sooner, the Take now card keeps one tap. */
export const ASK_AFTER_MS = 15 * 60_000
export const askWhenTaken = (dueAt: string, now: number) => now - Date.parse(dueAt) > ASK_AFTER_MS

/** "Earlier…": a time input for today's dose, a date and time for yesterday's; from the start of the
 *  dose's day to now, starting at the dose's time. On this device's clock (the server checks the range again). */
export function earlierInput(date: string, today: string, dueAt: string, now: number): { type: 'time' | 'datetime-local'; min: string; max: string; value: string } {
  const f = date === today ? 'HH:mm' : "yyyy-MM-dd'T'HH:mm"
  return { type: date === today ? 'time' : 'datetime-local', min: date === today ? '00:00' : `${date}T00:00`, max: format(now, f), value: format(Math.min(Date.parse(dueAt), now), f) }
}
/** The Earlier… input's value as an instant (ISO), or null while it's empty. */
export const pickedTime = (value: string, date: string): string | null => (value ? new Date(value.includes('T') ? value : `${date}T${value}`).toISOString() : null)

const WORST_FIRST: DoseStatus[] = ['missed', 'due', 'skipped', 'upcoming', 'taken']

/** The 7-day grid's row for one medicine: a cell per day, oldest first; the worst dose that day wins. */
export function weekCells(days: MedicationHistory['days'], medicationId: string): { date: string; status: DoseStatus | null }[] {
  return days.map(d => {
    const mine = d.doses.filter(x => x.medicationId === medicationId).map(x => x.status)
    return { date: d.date, status: WORST_FIRST.find(s => mine.includes(s)) ?? null }
  })
}

// Taken: a different cheer each time. Novelty keeps a daily habit fresh (a strong driver for
// neurodivergent kids); a fixed line fades into the background within a week.
const CHEERS = [
  msg('🎉 Nice job, {name}!'), msg('🌟 Way to go, {name}!'), msg('🚀 {name} for the win!'), msg('🦄 Magical, {name}!'),
  msg('🏆 Champion move, {name}!'), msg('🌈 You did it, {name}!'), msg('⚡ Power up, {name}!'), msg('🐢 Steady as always, {name}!'),
  msg('🎈 Hooray, {name}!'), msg('🦖 Rawr-some, {name}!'), msg('🍀 Great job, {name}!'), msg('🎵 High five, {name}!'),
]
/** A random cheer for Taken ("🚀 Leo for the win!"), never the same as the last one shown. */
export function cheerLine(name: string, last?: string, random = Math.random): string {
  const pick = () => tm(CHEERS[Math.floor(random() * CHEERS.length)], { name })
  let line = pick()
  for (let i = 0; i < 5 && line === last; i++) line = pick()
  return line
}
