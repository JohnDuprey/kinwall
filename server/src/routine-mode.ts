import { zonedTimeToUtc } from './recurrence.ts';
import { todayInTz } from './routes/members.ts';
export type RoutinePolicy = { enabled: boolean; appMode?: 'selected' | 'all'; cutoff: string; requiredChoreIds?: string[] | null; start?: string; daySchedules?: ({ start: string; cutoff: string } | null)[]; allowedWebsitesOnly?: boolean; allowedWebDomains?: string[]; schoolLinkDomains?: string[] };
export { schoolDomain } from './routine-websites.ts';
export type RoutineChore = { id: string; title: string; completed: boolean; pending: boolean };
/** Conditions use the household clock, never a child-provided date or completion list. */
export function evaluateRoutine(policy: RoutinePolicy, chores: RoutineChore[], timezone: string, now = new Date()) {
  const date = todayInTz(timezone, now);
  const [y, mo, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const schedule = policy.daySchedules?.[weekday] ?? { start: policy.start ?? '00:00', cutoff: policy.cutoff };
  const [h, mi] = schedule.cutoff.split(':').map(Number);
  const [sh, sm] = schedule.start.split(':').map(Number);
  const start = zonedTimeToUtc({ y, mo: mo - 1, d, h: sh, mi: sm, s: 0 }, timezone);
  const cutoff = zonedTimeToUtc({ y, mo: mo - 1, d, h, mi, s: 0 }, timezone);
  const required = policy.requiredChoreIds == null ? chores : chores.filter(chore => policy.requiredChoreIds!.includes(chore.id));
  const remaining = required.filter(chore => !chore.completed);
  const beforeStart = now < start;
  const afterCutoff = now >= cutoff;
  return { ...policy, requiredChoreIds: policy.requiredChoreIds ?? null, appMode: policy.appMode ?? 'selected', allowedWebsitesOnly: policy.allowedWebsitesOnly ?? false, allowedWebDomains: policy.allowedWebDomains ?? [], schoolLinkDomains: policy.schoolLinkDomains ?? policy.allowedWebDomains ?? [], start: policy.start ?? '00:00', daySchedules: policy.daySchedules ?? Array(7).fill(null), effectiveStart: schedule.start, effectiveCutoff: schedule.cutoff, date, timezone, locked: policy.enabled && !beforeStart && (afterCutoff || remaining.length > 0),
    reason: !policy.enabled ? 'off' : beforeStart ? 'scheduled' : afterCutoff ? 'bedtime' : remaining.length ? 'routine' : 'ready',
    remaining, total: required.length, validUntil: (beforeStart ? start : cutoff).toISOString(), checkedAt: now.toISOString() };
}
