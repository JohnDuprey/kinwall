// Temp check: a person's daily questions at the end of their day (Snapshot.tsx), their goal on the
// Board and the calendar. Pure, so web/test/tempCheck.test.ts covers it. Mirrors server/src/schemas.ts.
import type { Member, TempCheckAnswered, TempCheckSettings } from './types.ts'

export const SLEEP = [
  { key: 'great', emoji: '😄', label: 'Great' },
  { key: 'good', emoji: '🙂', label: 'Good' },
  { key: 'ok', emoji: '😐', label: 'OK' },
  { key: 'poorly', emoji: '😕', label: 'Poorly' },
  { key: 'terrible', emoji: '😫', label: 'Terrible' },
] as const
export type Sleep = (typeof SLEEP)[number]['key']
export const FEELINGS = ['great', 'good', 'fine', 'ok', 'bad', 'awful', 'tired', 'sore']
export const GOAL_MAX = 140

type GoalMember = Pick<Member, 'id' | 'name'> & { tempCheck?: TempCheckSettings; todayGoal?: string | null }
const hasGoal = (m: GoalMember) => !!(m.tempCheck?.on && m.tempCheck.goal && m.todayGoal)

/** The Board's "Today's goals": people who set one and chose to show it (only the pinned person on a pinned display). */
export function boardGoals<M extends GoalMember>(members: M[], focusMemberId?: string | null): M[] {
  return members.filter(m => hasGoal(m) && m.tempCheck!.showGoal && (!focusMemberId || m.id === focusMemberId))
}

/** The goal line on the calendar when it shows one person (pinned, filtered, or their own device). */
export function calendarGoal(members: GoalMember[], memberId: string | null): string | null {
  const m = memberId ? members.find(x => x.id === memberId) : undefined
  return m && hasGoal(m) ? m.todayGoal! : null
}

/** The chips to pick from: the built-ins, then their own ("Other" answers). */
export function feelingOptions(custom: string[]): string[] {
  const seen = new Set(FEELINGS)
  return [...FEELINGS, ...custom.filter(f => !seen.has(f.toLowerCase()) && seen.add(f.toLowerCase()))]
}

export function toggleFeeling(picked: string[], f: string): string[] {
  const has = picked.some(p => p.toLowerCase() === f.toLowerCase())
  return has ? picked.filter(p => p.toLowerCase() !== f.toLowerCase()) : [...picked, f]
}

/** Every question they get has an answer (a skipped goal counts). */
export function tempCheckDone(s: TempCheckSettings, a: TempCheckAnswered): boolean {
  const asked = (['sleep', 'feelings', 'goal'] as const).filter(q => s[q])
  return asked.length > 0 && asked.every(q => a[q])
}
