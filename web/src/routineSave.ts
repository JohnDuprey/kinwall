import type { RoutinePolicy, RoutineState } from './routineMode.ts'
import { t } from './i18n.ts'

type RoutineApi = { setRoutineMode(id: string, policy: RoutinePolicy): Promise<RoutinePolicy>; getRoutineMode(id: string): Promise<RoutineState> }
export const routinePolicyKey = (p: RoutinePolicy) => JSON.stringify({ enabled: p.enabled, appMode: p.appMode ?? 'selected', cutoff: p.cutoff, start: p.start ?? '00:00', daySchedules: p.daySchedules ?? Array(7).fill(null), requiredChoreIds: p.requiredChoreIds == null ? null : [...p.requiredChoreIds].sort(), allowedWebsitesOnly: p.allowedWebsitesOnly, allowedWebDomains: [...p.allowedWebDomains].sort(), schoolLinkDomains: [...(p.schoolLinkDomains ?? p.allowedWebDomains)].sort() })

/** A successful PUT alone must not show stale defaults as if they were the saved settings. */
export async function saveRoutinePolicy(api: RoutineApi, memberId: string, policy: RoutinePolicy): Promise<RoutineState> {
  const saved = await api.setRoutineMode(memberId, policy)
  const confirmed = await api.getRoutineMode(memberId)
  if (routinePolicyKey(saved) !== routinePolicyKey(confirmed)) throw new Error(t('The saved routine settings could not be confirmed. Check your connection and try again.'))
  return confirmed
}
