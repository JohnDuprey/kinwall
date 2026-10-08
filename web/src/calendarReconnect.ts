// A Google or Microsoft calendar whose sign-in was turned down (lastErrorCode 'revoked', server
// sync.ts): Settings → Calendars shows its message with a Reconnect button and these hints.
import type { CalendarEntry, Member } from './types.ts'

export const revoked = (c: Pick<CalendarEntry, 'kind' | 'lastErrorCode'>): c is typeof c & { kind: 'google' | 'microsoft' } =>
  c.lastErrorCode === 'revoked' && (c.kind === 'google' || c.kind === 'microsoft')

/** Which account to sign in with again, when Kinwall knows it. */
export function signInHint(accountName: string | undefined): string | null {
  return accountName ? `Tap Reconnect and sign in as ${accountName}.` : null
}

/** A kid's Google calendar: Family Link can take Kinwall's access away, and a parent may need to
 * allow it there too. The kid's name when the calendar is one kid's. */
export function familyLinkHint(c: Pick<CalendarEntry, 'kind' | 'memberIds'>, members: Pick<Member, 'id' | 'name' | 'grownUp'>[]): string | null {
  if (c.kind !== 'google') return null
  const kids = c.memberIds.map(id => members.find(m => m.id === id)).filter(m => m && !m.grownUp)
  if (!kids.length) return null
  const whose = c.memberIds.length === 1 ? `${kids[0]!.name}'s` : 'this'
  return `If ${whose} Google account is supervised with Family Link, a parent may need to approve Kinwall there too.`
}
