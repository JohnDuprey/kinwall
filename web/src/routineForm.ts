import type { RoutinePolicy } from './routineMode.ts'
import { schoolDomain } from './routineWebsites.ts'
import { t } from './i18n.ts'
import { routineChoreNames } from './routineChores.ts'

export function routineFormPolicy(form: Pick<FormData, 'get' | 'getAll'>): RoutinePolicy {
  const start = String(form.get('start') ?? ''), cutoff = String(form.get('cutoff') ?? '')
  const days = Array.from({ length: 7 }, (_, day) => form.get('scheduleMode') === 'custom' && form.get(`day-${day}`) === 'on' ? { start: String(form.get(`start-${day}`) ?? ''), cutoff: String(form.get(`cutoff-${day}`) ?? '') } : null)
  const valid = (s: string, e: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s) && /^([01]\d|2[0-3]):[0-5]\d$/.test(e) && s < e
  if (!valid(start, cutoff) || days.some(day => day && !valid(day.start, day.cutoff))) throw new Error(t('Routine mode must start before free time ends. Finish entering both times.'))
  const domains = String(form.get('allowedWebDomains') ?? '').split(/[\s,]+/).filter(Boolean).map(schoolDomain)
  if (domains.some(domain => domain === null)) throw new Error(t('Enter a valid website address, such as clever.com.'))
  const allowedWebsitesOnly = form.get('allowedWebsitesOnly') === 'true'
  if (allowedWebsitesOnly && !domains.length) throw new Error(t('Add at least one allowed website before limiting browsing.'))
  return { enabled: form.get('enabled') === 'true', appMode: form.get('appMode') === 'all' ? 'all' : 'selected', requiredChoreIds: form.get('choreRequirement') === 'selected' ? form.getAll('requiredChoreIds').map(String) : null, requiredOneTimeChoreNames: form.get('choreRequirement') === 'selected' ? routineChoreNames(form.getAll('requiredOneTimeChoreNames').map(String)) : [], start, cutoff, daySchedules: days, allowedWebsitesOnly, allowedWebDomains: domains as string[], schoolLinkDomains: form.getAll('schoolLinkDomains').map(String) }
}
