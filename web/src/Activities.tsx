import Paint from './Paint.tsx'
import Stickers from './Stickers.tsx'
import Photos from './Photos.tsx'
import { useApp } from './AppContext.tsx'
import type { Settings } from './types.ts'
import { BrushIcon, ImagesIcon, StickerIcon } from './icons.tsx'

// Activities for the wall (everything here works with a display key). Add a card here and a
// sub-route below for the next one.
const ACTIVITIES = [
  { key: 'paint', title: 'Paint', blurb: 'Draw, color in and save your pictures', Icon: BrushIcon, color: '#FF9E7A' },
  { key: 'stickers', title: 'Sticker book', blurb: 'Spend chore points on stickers and decorate your page', Icon: StickerIcon, color: '#B39DFF' },
  { key: 'photos', title: 'Photos', blurb: 'Family pictures for the board and the screensaver', Icon: ImagesIcon, color: '#7ED9A6' },
] as const

/** The activities this family has on: Paint and Photos have their own feature switches; the sticker
 * book needs chore points and its own switch. None left = no Activities tab (App.tsx). */
export function shownActivities(s: Settings) {
  return ACTIVITIES.filter(a => a.key === 'stickers' ? s.features.chores && s.stickersEnabled : s.features[a.key])
}

export default function Activities({ sub }: { sub?: string }) {
  const { settings } = useApp()
  const shown = shownActivities(settings)
  // A sub-page that's turned off renders nothing while App.tsx redirects away from it.
  if (sub) return !shown.some(a => a.key === sub) ? null : sub === 'paint' ? <Paint /> : sub === 'stickers' ? <Stickers /> : sub === 'photos' ? <Photos /> : null
  return (
    <div className="activities scroll-y">
      <ul className="activity-grid" aria-label="Activities">
        {shown.map(a => (
          <li key={a.key}>
            <a className="activity-card" href={`#/activities/${a.key}`} style={{ ['--activity-color' as string]: a.color }}>
              <span className="activity-card-icon"><a.Icon width={44} height={44} /></span>
              <span className="activity-card-title">{a.title}</span>
              <span className="activity-card-sub">{a.blurb}</span>
            </a>
          </li>
        ))}
        <li className="activity-card activity-card-soon">More coming soon <span aria-hidden="true">✨</span></li>
      </ul>
    </div>
  )
}
