// Settings → Access → Security activity: a row with the latest event, and a sheet with every event
// grouped by day, searchable and filtered by kind on the server. One line per event, "🔑 Passkey
// "iPhone" added by 🦊 Alex" with "4:12 PM" under it.
import type { Member, SecurityEvent } from './types.ts'
import { actorName, whenLabel } from './addedBy.ts'

export const SECURITY_PAGE = 20 // events per page (GET /api/security-events?limit=)

const ICONS: [prefix: string, icon: string][] = [
  ['passkey.', '🔑'], ['signin.recovery', '🔐'], ['signin.', '👋'], ['signout', '🚪'], ['recovery.', '🔐'],
  ['device.', '📱'], ['key.', '🗝️'], ['widgets.', '🧩'], ['app.', '🔌'], ['pin.', '🔢'], ['journal.', '📓'], ['support.', '🛟'],
]

export function securityLine(e: Pick<SecurityEvent, 'kind' | 'summary' | 'by' | 'at'>, members: Pick<Member, 'id' | 'name' | 'avatar'>[], now = new Date()): { icon: string; text: string; when: string } {
  const who = actorName(e.by, members)
  return {
    icon: ICONS.find(([p]) => e.kind.startsWith(p))?.[1] ?? '🛡️',
    text: who ? `${e.summary} by ${who}` : e.summary,
    when: whenLabel(e.at, now),
  }
}

/** The row's hint: `Passkey "iPhone" added · 9:00 AM`, or "Nothing yet". */
export function securityHint(latest: Pick<SecurityEvent, 'summary' | 'at'> | undefined, now = new Date()): string {
  return latest ? `${latest.summary} · ${whenLabel(latest.at, now)}` : 'Nothing yet'
}

/** The sheet's filter chips; each sends its kinds (GET /api/security-events?kinds=). All sends none. */
export const SECURITY_FILTERS = [
  { key: 'all', label: 'All', kinds: [] },
  { key: 'signins', label: 'Sign-ins', kinds: ['signin.passkey', 'signin.recovery', 'signout', 'recovery.generated', 'support.link_issued', 'support.link_revoked', 'support.signin'] },
  { key: 'passkeys', label: 'Passkeys', kinds: ['passkey.added', 'passkey.renamed', 'passkey.removed'] },
  { key: 'devices', label: 'Devices', kinds: ['device.paired', 'device.owner', 'widgets.added', 'widgets.removed'] },
  { key: 'keys', label: 'Keys & apps', kinds: ['key.created', 'key.removed', 'app.connected', 'app.disconnected'] },
  { key: 'pin', label: 'PIN', kinds: ['pin.set', 'pin.removed'] },
  { key: 'journal', label: 'Journal', kinds: ['journal.privacy', 'member.grown_up'] },
] as const satisfies readonly { key: string; label: string; kinds: readonly string[] }[]
export type SecurityFilter = (typeof SECURITY_FILTERS)[number]['key']

/** "Today", "Yesterday", "Tue, Sep 29" (with the year when it isn't this one). */
export function securityDay(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

/** Newest-first events in runs by local day, for the sheet's day headings. */
export function groupByDay<E extends Pick<SecurityEvent, 'at'>>(events: E[], now = new Date()): { day: string; events: E[] }[] {
  const groups: { day: string; events: E[] }[] = []
  for (const e of events) {
    const day = securityDay(e.at, now)
    if (groups.at(-1)?.day === day) groups.at(-1)!.events.push(e)
    else groups.push({ day, events: [e] })
  }
  return groups
}

/** What the server's ?q= matches (the demo uses it): summary, the thing's name, or who did it. */
export function matchesSecurityQuery(e: Pick<SecurityEvent, 'summary' | 'device' | 'by'>, q: string, members: Pick<Member, 'id' | 'name'>[]): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const who = e.by?.memberId ? members.find(m => m.id === e.by!.memberId)?.name : null
  return [e.summary, e.device, e.by?.label, who].some(v => v?.toLowerCase().includes(needle))
}
