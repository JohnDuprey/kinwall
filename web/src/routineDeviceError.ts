import { t } from './i18n.ts'

/** Native setup failures are guidance for a parent, never a framework exception. */
export function routineDeviceError(error: string, role: 'parent' | 'child' = 'child'): string {
  if (/App choices changed on another device/.test(error)) return t('App choices changed on another device. Open the picker again.')
  if (role === 'parent') return t('Could not save app choices. Check your connection and make sure Screen Time is approved on the child’s device, then try again.')
  if (/child and teen (?:iCloud|Apple) accounts/i.test(error)) return t('This device needs to be signed into a child or teen Apple Account. Continue setup on the child’s iPhone or iPad.')
  return t('Could not finish device setup. On the child’s device, check Screen Time access and try again.')
}
