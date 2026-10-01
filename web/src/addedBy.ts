// "Added by Maya · Tue 4:12 PM" / "Checked off by Leo · 5:02 PM" / "Last done: Maya · Tue 8:10 PM" on lists.
import type { Actor, Member } from './types.ts'
import { formatTime } from './timeFormat.ts'

/** A member's avatar and name, or a device's or app's label; null when nobody is known (or they've left). */
export function actorName(actor: Actor | null | undefined, members: Pick<Member, 'id' | 'name' | 'avatar'>[]): string | null {
  if (actor?.memberId) {
    const m = members.find(x => x.id === actor.memberId)
    return m ? `${m.avatar ? `${m.avatar} ` : ''}${m.name}` : null
  }
  return actor?.label || null
}

/** When, short: the time today, the weekday within the last week, else the date ("Sep 3, 4:12 PM"). */
export function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const time = formatTime(d)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86_400_000)
  if (days === 0) return time
  if (days > 0 && days < 7) return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}, ${time}`
}

/** The when part on one line, so a narrow screen breaks before it, not inside "4:12 PM". */
export const nowrap = (s: string) => s.replace(/ /g, '\u00a0')

/** "Added by Maya · Tue 4:12 PM", or null when nobody is known. */
export function byLine(prefix: string, actor: Actor | null | undefined, at: string | null | undefined, members: Pick<Member, 'id' | 'name' | 'avatar'>[], now = new Date()): string | null {
  const who = actorName(actor, members)
  return who ? `${prefix} ${who}${at ? ` · ${nowrap(whenLabel(at, now))}` : ''}` : null
}
