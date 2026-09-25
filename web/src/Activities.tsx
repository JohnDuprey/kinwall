import Paint from './Paint.tsx'
import Stickers from './Stickers.tsx'
import { useApp } from './AppContext.tsx'
import { BrushIcon, StickerIcon } from './icons.tsx'

// Activities for the wall (everything here works with a display key). Add a card here and a
// sub-route below for the next one.
const ACTIVITIES = [
  { key: 'paint', title: 'Paint', blurb: 'Draw, colour in and save your pictures', Icon: BrushIcon, color: '#FF9E7A' },
  { key: 'stickers', title: 'Sticker book', blurb: 'Spend chore points on stickers and decorate your page', Icon: StickerIcon, color: '#B39DFF' },
]

export default function Activities({ sub }: { sub?: string }) {
  const { settings } = useApp()
  if (sub === 'paint') return <Paint />
  if (sub === 'stickers') return <Stickers />
  return (
    <div className="activities scroll-y">
      <ul className="activity-grid" aria-label="Activities">
        {ACTIVITIES.filter(a => a.key !== 'stickers' || settings.stickersEnabled).map(a => (
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
