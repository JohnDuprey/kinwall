// Which picture sources a screen uses: the Night screen's slideshow (App.tsx) and the Board's
// picture card (Board.tsx). Sources the family can't show right now drop out and the rest carry on.
import type { GooglePhotosState, NightLook } from './types.ts'
import type { DeviceAppearance, SaverSource } from './useTheme.ts'
export type { NightLook }

type Family = { photos: boolean; paint?: boolean; googlePhotos?: GooglePhotosState }

/** This display's picks, minus what the family can't show: family photos or drawings (Paint) turned
 * off become nature pictures; Google Photos not ready (connecting, or needing reconnecting) is left out, and if it was
 * the only pick nature pictures stand in. Nothing picked stays nothing: the plain clock. */
export function nightSources(picked: SaverSource[], family: Family): SaverSource[] {
  const out = picked
    .map(s => ((s === 'photos' && !family.photos) || (s === 'drawings' && family.paint === false) ? 'nature' : s))
    .filter(s => s !== 'google' || family.googlePhotos === 'ready')
  return [...new Set(picked.length && !out.length ? ['nature' as const] : out)]
}

/** The Board's picture: this display's Night screen picks, or with none picked the family's own
 * pictures (Google Photos when it's ready, family photos when there are some), else nature. */
export function boardSources(picked: SaverSource[], family: Family, hasPhotos: boolean): SaverSource[] {
  if (picked.length) return nightSources(picked, family)
  const own: SaverSource[] = []
  if (family.googlePhotos === 'ready') own.push('google')
  if (family.photos && hasPhotos) own.push('photos')
  return own.length ? own : ['nature']
}

/** The next family photo of a shuffled pass (`queue`, ids; taken from the end), looked up in the
 * latest list so an edited caption shows and a photo deleted since the pass began is skipped.
 * null = the pass is over. */
export function nextPhoto<P extends { id: string }>(queue: string[], list: P[]): P | null {
  const byId = new Map(list.map(p => [p.id, p]))
  while (queue.length) { const p = byId.get(queue.pop()!); if (p) return p }
  return null
}

/** A Night screen's choices, in this device's own shape (useTheme.ts). */
export type NightFields = Pick<DeviceAppearance, 'saverSources' | 'saverEvery' | 'saverBright' | 'saverClock' | 'clockPos'>

/** This screen picks its own Night screen (Settings → This display) rather than the family's. A
 * device that picked anything before the family default existed keeps that as its own. */
export const ownsNight = (d: DeviceAppearance) =>
  !!d.nightOwn || !!d.saverSources?.length || d.saverClock === false || !!d.clockPos || d.saverEvery !== undefined || d.saverBright !== undefined

/** The family's Night screen (settings.nightLook) in the device's shape; defaults are left out. */
export function familyNightFields(f: NightLook | undefined): NightFields {
  if (!f) return {} // settings from before the family default: the plain clock
  const out: NightFields = {}
  if (f.sources.length) out.saverSources = [...f.sources]
  if (f.every !== 5) out.saverEvery = f.every
  if (f.brightness === 'medium') out.saverBright = 'medium'
  if (!f.clock) out.saverClock = false
  if (f.clockPosition) out.clockPos = f.clockPosition
  return out
}

/** What this screen's Night screen does: its own choices, else the family's. */
export function nightFieldsFor(d: DeviceAppearance, family: NightLook | undefined): NightFields {
  if (!ownsNight(d)) return familyNightFields(family)
  const { saverSources, saverEvery, saverBright, saverClock, clockPos } = d
  return Object.fromEntries(Object.entries({ saverSources, saverEvery, saverBright, saverClock, clockPos }).filter(([, v]) => v !== undefined)) as NightFields
}

/** Back to the family setting's shape, for saving. */
export const toNightLook = (n: NightFields): NightLook => ({
  sources: n.saverSources ?? [], every: (n.saverEvery ?? 5) as NightLook['every'], brightness: n.saverBright ?? 'low', clock: n.saverClock !== false, clockPosition: n.clockPos ?? null,
})
