// Medication reminders (TakeNow.tsx, Medications.tsx, Trackers → Health → Medicines). Pure, so
// web/test/medications.test.ts covers it.
import { format } from 'date-fns'
import { timeLabel } from './journal.ts'
import type { DoseStatus, Medication, MedicationHistory } from './types.ts'

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

/** "Every day", "Weekdays", "Weekends" or "Mon, Wed, Fri". */
export function daysLabel(days: number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b).join()
  if (d === '0,1,2,3,4,5,6') return 'Every day'
  if (d === '1,2,3,4,5') return 'Weekdays'
  if (d === '0,6') return 'Weekends'
  return [...new Set(days)].sort((a, b) => a - b).map(i => WEEKDAYS[i]).join(', ')
}

/** "8:00 AM and 8:30 PM · Every day", plus the course when it has one (" · Until Mon, Oct 5"). */
export function scheduleLabel(m: Pick<Medication, 'times' | 'days'> & Partial<Pick<Medication, 'endDate' | 'totalDoses' | 'dosesLeft'>>): string {
  const t = m.times.map(timeLabel)
  const course = courseLabel({ endDate: m.endDate ?? null, totalDoses: m.totalDoses ?? null, dosesLeft: m.dosesLeft ?? null })
  return `${t.length > 1 ? `${t.slice(0, -1).join(', ')} and ${t.at(-1)}` : t[0]} · ${daysLabel(m.days)}${course ? ` · ${course}` : ''}`
}

/** A course (e.g. an antibiotic): "Until Mon, Oct 5", "7 of 20 doses left", "Done: all 20 doses taken", or ''. */
export function courseLabel(m: Pick<Medication, 'endDate' | 'totalDoses' | 'dosesLeft'>): string {
  if (m.totalDoses != null) return m.dosesLeft === 0 ? `Done: all ${m.totalDoses} doses taken` : `${m.dosesLeft ?? m.totalDoses} of ${m.totalDoses} doses left`
  return m.endDate ? `Until ${format(new Date(`${m.endDate}T12:00:00`), 'EEE, MMM d')}` : ''
}

/** What a Take now card says: the medicine where names show, "Meds" on a shared screen without them. */
export function cardLabel(d: { name: string | null; dose: string | null }): string {
  if (!d.name) return 'Meds'
  return d.dose ? `${d.name} · ${d.dose}` : d.name
}

export const STATUS: Record<DoseStatus, { emoji: string; label: string }> = {
  taken: { emoji: '✅', label: 'Taken' },
  skipped: { emoji: '⏭️', label: 'Skipped' },
  due: { emoji: '💊', label: 'Due now' },
  missed: { emoji: '⭕', label: 'Not marked' },
  upcoming: { emoji: '🕒', label: 'Later' },
}
const WORST_FIRST: DoseStatus[] = ['missed', 'due', 'skipped', 'upcoming', 'taken']

/** The 7-day grid's row for one medicine: a cell per day, oldest first; the worst dose that day wins. */
export function weekCells(days: MedicationHistory['days'], medicationId: string): { date: string; status: DoseStatus | null }[] {
  return days.map(d => {
    const mine = d.doses.filter(x => x.medicationId === medicationId).map(x => x.status)
    return { date: d.date, status: WORST_FIRST.find(s => mine.includes(s)) ?? null }
  })
}
