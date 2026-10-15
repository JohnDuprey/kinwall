// The energy battery's meter helpers (Battery.tsx). Pure, so web/test/battery.test.ts covers them.
// The numbers and reasons come from the server (server/src/battery.ts); these only word them.
import type { BatteryReason, Drained, TempCheckSettings } from './types.ts'
import { formatDate, msg, t } from './i18n.ts'

/** "+60", "−30" (a real minus sign). */
export const points = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

/** "Sleep: ok (+60) · 3 events (−30)": everything behind the number. A note ("Learning: 4 of 10 check-ins") has no points. */
export const reasonLine = (reasons: BatteryReason[]) => reasons.map(r => (r.points ? `${r.text} (${points(r.points)})` : r.text)).join(' · ')

/** "How drained do you feel?" in the evening check (GoalFollowUp.tsx): calm faces, nothing scary.
 * Labels marked: show with tm(); `feeling` is the answer read back ("Feeling low"). */
export const DRAINED: { key: Drained; emoji: string; label: string; feeling: string }[] = [
  { key: 'full', emoji: '😊', label: msg('Full'), feeling: msg('Feeling full') },
  { key: 'ok', emoji: '🙂', label: msg('OK'), feeling: msg('Feeling ok') },
  { key: 'low', emoji: '😌', label: msg('Low'), feeling: msg('Feeling low') },
  { key: 'empty', emoji: '😴', label: msg('Empty'), feeling: msg('Feeling empty') },
]
export const drainedOf = (k: string | null | undefined) => DRAINED.find(d => d.key === k)

/** Calm words for a level: nothing scary for kids. Under 25 matches the server's heads-up. */
export const levelWord = (level: number) => (level >= 75 ? t('Full') : level >= 50 ? t('Good') : level >= 25 ? t('Getting low') : t('Running low'))

/** `date` is today or tomorrow (the day heads-ups show for). */
export const soon = (date: string, today: string) => date === today || Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) === 86_400_000
/** "Today", "Tomorrow" (not when `short`, for the strip), or a short weekday. */
export function dayLabel(date: string, today: string, short = false) {
  if (date === today) return t('Today')
  if (!short && Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) === 86_400_000) return t('Tomorrow')
  const [y, m, d] = date.split('-').map(Number)
  return formatDate(new Date(y, m - 1, d), { weekday: 'short' })
}

/** On for this person: their Temp check and its battery switch. */
export const batteryOn = (t: Partial<Pick<TempCheckSettings, 'on' | 'battery'>> | undefined) => !!(t?.on && t.battery)
