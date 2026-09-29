// Goal follow-up and the journal (GoalFollowUp.tsx, Journal.tsx, Settings → Family). Pure, so
// web/test/journal.test.ts covers it.
import type { FollowupOutcome, JournalDay } from './types.ts'

/** "21:00" -> "9:00 PM". */
export function timeLabel(hm: string): string {
  const [h, m] = hm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** The evening check's times: noon to 11:30 PM in half hours (midnight ends the day). */
export const EVENING_TIMES = Array.from({ length: 24 }, (_, i) => {
  const value = `${String(12 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`
  return { value, label: timeLabel(value) }
})

export const OUTCOMES: { key: FollowupOutcome; emoji: string; label: string }[] = [
  { key: 'yes', emoji: '🎉', label: 'Yes' },
  { key: 'partly', emoji: '🌗', label: 'Partly' },
  { key: 'no', emoji: '🌱', label: 'Not today' },
]
export const outcomeOf = (k: FollowupOutcome) => OUTCOMES.find(o => o.key === k)!

export const MOODS = ['😄', '🙂', '😐', '😕', '😢', '😡', '😴', '🤩', '🥰', '🌈']
export const JOURNAL_TEXT_MAX = 2000

export function followupThanks(outcome: FollowupOutcome, name: string): string {
  if (outcome === 'yes') return `Nice work, ${name} ✓`
  if (outcome === 'partly') return `Good going, ${name}: a bit counts ✓`
  return `That's OK, ${name}. Tomorrow's a new day ✓`
}

/** Goals met (yes) out of goals set (not skipped) in the 7 days ending `today`. */
export function goalsThisWeek(days: JournalDay[], today: string): { met: number; of: number } {
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10)
  const week = days.filter(d => d.date >= start && d.date <= today && d.tempCheck?.goal)
  return { met: week.filter(d => d.tempCheck!.followup?.outcome === 'yes').length, of: week.length }
}
