// To-do lists synced with Todoist, Google Tasks or Microsoft To Do (server routes/tasks.ts): the
// small rules the Settings rows, the list's Sync with… sheet and its status line share.
import { msg, tm } from './i18n.ts'
import type { Account, TaskAccount, TaskAppKind, TaskLink } from './types.ts'

// Names, the same in every language (msg() marks them for the check).
const APP_NAME: Record<TaskAppKind, string> = { todoist: 'Todoist', google: msg('Google Tasks'), microsoft: msg('Microsoft To Do') }
export const appName = (kind: TaskAppKind) => tm(APP_NAME[kind])

/** Worth a warning: a refused sign-in at once (it won't fix itself), or a list imported without
 * its account, else two failures in a row (one blip doesn't cry wolf), like a calendar's (Calendar.tsx SyncAlert). */
export const taskLinkBroken = (l: Pick<TaskLink, 'lastError' | 'lastErrorCode' | 'syncFailures'> & { needsReconnect?: boolean }) =>
  !!l.needsReconnect || l.lastErrorCode === 'revoked' || (!!l.lastError && l.syncFailures >= 2)

/** The Google or Microsoft account the family's calendars already use, to add tasks to (suggested
 * at sign-in), when it isn't connected for tasks yet. Only accounts named by an email. */
export function calendarAccountFor(kind: 'google' | 'microsoft', calendarAccounts: Pick<Account, 'kind' | 'name'>[], taskAccounts: Pick<TaskAccount, 'kind' | 'name'>[]): string | null {
  const taken = new Set(taskAccounts.filter(a => a.kind === kind).map(a => a.name.toLowerCase()))
  return calendarAccounts.find(a => a.kind === kind && a.name.includes('@') && !taken.has(a.name.toLowerCase()))?.name ?? null
}
