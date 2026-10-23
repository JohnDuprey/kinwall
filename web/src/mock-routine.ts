import { schoolDomain } from './routineWebsites.ts'
import { mock } from './mock.ts'
import { todayKeyInTz } from './date.ts'
import type { RoutinePolicy, RoutineState } from './routineMode.ts'
const policies = new Map<string, RoutinePolicy>()
export async function mockRoutine(memberId: string, policy?: RoutinePolicy): Promise<RoutineState> {
  if (policy) {
    if ((policy.start ?? '00:00') >= policy.cutoff || policy.daySchedules?.some(day => day && day.start >= day.cutoff)) throw new Error('Routine mode must start before free time ends.')
    const domains = policy.allowedWebDomains.map(schoolDomain)
    if (domains.some(d => !d) || (policy.allowedWebsitesOnly && !domains.length)) throw new Error('Choose valid allowed websites before limiting browsing.')
    if (policy.schoolLinkDomains?.some(domain => !domains.includes(domain))) throw new Error('Website links must also be allowed websites.')
    const available = await mock.getRoutineChores(memberId)
    if (policy.requiredChoreIds?.some(id => !available.some(chore => chore.id === id))) throw new Error('Choose active chores assigned to this child.')
    policies.set(memberId, { ...policy, allowedWebDomains: [...new Set(domains as string[])] })
  }
  const settings = await mock.getSettings(), timezone = settings.timezone ?? 'America/New_York'
  const p = policies.get(memberId) ?? { enabled: true, appMode: 'selected' as const, cutoff: '23:59', allowedWebsitesOnly: false, allowedWebDomains: ['clever.com', 'www.clever.com', 'student.freckle.com'], schoolLinkDomains: ['clever.com'] }
  const date = todayKeyInTz(timezone)
  const chores = (await mock.getChoresDay(date)).filter(c => c.memberId === memberId)
  const required = p.requiredChoreIds == null ? chores : chores.filter(chore => p.requiredChoreIds!.includes(chore.id))
  const remaining = required.filter(c => !c.completed).map(c => ({ id: c.id, title: c.title, completed: c.completed, pending: c.pending ?? false }))
  // Preview only: the production decision and absolute cutoff are computed on the server.
  const now = new Date()
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  const schedule = p.daySchedules?.[weekday] ?? { start: p.start ?? '00:00', cutoff: p.cutoff }
  const [h, m] = schedule.cutoff.split(':').map(Number)
  const [sh, sm] = schedule.start.split(':').map(Number)
  const start = new Date(now); start.setHours(sh, sm, 0, 0)
  const before = now < start
  const cutoff = new Date(now); cutoff.setHours(h, m, 0, 0)
  const late = now >= cutoff
  return { ...p, availableChores: await mock.getRoutineChores(memberId), effectiveStart: schedule.start, effectiveCutoff: schedule.cutoff, date, timezone, locked: p.enabled && !before && (late || remaining.length > 0), reason: !p.enabled ? 'off' : before ? 'scheduled' : late ? 'bedtime' : remaining.length ? 'routine' : 'ready', total: required.length, remaining, validUntil: (before ? start : cutoff).toISOString(), checkedAt: now.toISOString() }
}
