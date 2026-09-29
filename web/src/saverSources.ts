// Which picture sources a screen uses: the Night screen's slideshow (App.tsx) and the Board's
// picture card (Board.tsx). Sources the family can't show right now drop out and the rest carry on.
import type { GooglePhotosState } from './types.ts'
import type { SaverSource } from './useTheme.ts'

type Family = { photos: boolean; googlePhotos?: GooglePhotosState }

/** This display's picks, minus what the family can't show: family photos turned off become nature
 * pictures; Google Photos not ready (connecting, or needing reconnecting) is left out, and if it was
 * the only pick nature pictures stand in. Nothing picked stays nothing: the plain clock. */
export function nightSources(picked: SaverSource[], family: Family): SaverSource[] {
  const out = picked
    .map(s => (s === 'photos' && !family.photos ? 'nature' : s))
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
