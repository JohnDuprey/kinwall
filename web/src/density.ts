import type { Appearance, DeviceDensity, TextScale } from './types.ts'

/** Density actually in effect on this device. A parent's own phone runs compact unless this device
 * picked a density (Settings → This device), so a phone app fits more; big text keeps the family's.
 * Low-stimulation mode never runs compact (it wants more room). */
export function effectiveDensity(
  household: Pick<Appearance, 'density' | 'textScale'>,
  device: { density?: DeviceDensity; textScale?: TextScale; lowStim?: boolean },
  parentPhone = false,
): DeviceDensity {
  const bigText = ['l', 'xl'].includes(device.textScale ?? household.textScale)
  const d = device.density ?? (parentPhone && !bigText ? 'compact' : household.density)
  return device.lowStim && d === 'compact' ? 'comfortable' : d
}
