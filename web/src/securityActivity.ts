// Settings → Access → Security activity: one line per event, "🔑 Passkey "iPhone" added by 🦊 Alex"
// with "Tue 4:12 PM" under it.
import type { Member, SecurityEvent } from './types.ts'
import { actorName, whenLabel } from './addedBy.ts'

export const SECURITY_PAGE = 20 // events per page (GET /api/security-events?limit=)

const ICONS: [prefix: string, icon: string][] = [
  ['passkey.', '🔑'], ['signin.recovery', '🔐'], ['signin.', '👋'], ['signout', '🚪'], ['recovery.', '🔐'],
  ['device.', '📱'], ['key.', '🗝️'], ['widgets.', '🧩'], ['app.', '🔌'], ['pin.', '🔢'], ['journal.', '📓'],
]

export function securityLine(e: Pick<SecurityEvent, 'kind' | 'summary' | 'by' | 'at'>, members: Pick<Member, 'id' | 'name' | 'avatar'>[], now = new Date()): { icon: string; text: string; when: string } {
  const who = actorName(e.by, members)
  return {
    icon: ICONS.find(([p]) => e.kind.startsWith(p))?.[1] ?? '🛡️',
    text: who ? `${e.summary} by ${who}` : e.summary,
    when: whenLabel(e.at, now),
  }
}
