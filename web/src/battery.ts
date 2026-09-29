// The energy battery's meter helpers (Battery.tsx). Pure, so web/test/battery.test.ts covers them.
// The numbers and reasons come from the server (server/src/battery.ts); these only word them.
import type { BatteryReason, TempCheckSettings } from './types.ts'

/** "+60", "−30" (a real minus sign). */
export const points = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

/** "Sleep: ok (+60) · 3 events (−30)": everything behind the number. */
export const reasonLine = (reasons: BatteryReason[]) => reasons.map(r => `${r.text} (${points(r.points)})`).join(' · ')

/** Calm words for a level: nothing scary for kids. Under 25 matches the server's heads-up. */
export const levelWord = (level: number) => (level >= 75 ? 'Full' : level >= 50 ? 'Good' : level >= 25 ? 'Getting low' : 'Running low')

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** "Today", "Tomorrow" (not when `short`, for the strip), or a short weekday. */
export function dayLabel(date: string, today: string, short = false) {
  if (date === today) return 'Today'
  if (!short && Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) === 86_400_000) return 'Tomorrow'
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]
}

/** On for this person: their Temp check and its battery switch. */
export const batteryOn = (t: Partial<Pick<TempCheckSettings, 'on' | 'battery'>> | undefined) => !!(t?.on && t.battery)
