import Paint from './Paint.tsx'
import Stickers from './Stickers.tsx'
import Photos from './Photos.tsx'
import { useEffect, useState } from 'react'
import { useApp } from './AppContext.tsx'
import { api } from './api.ts'
import { PluginPlayer, PluginsSheet } from './Plugins.tsx'
import type { Plugin } from './types.ts'
import type { Settings } from './types.ts'
import { BrushIcon, ImagesIcon, StickerIcon } from './icons.tsx'

// Activities for the wall (everything here works with a display key). Add a card here and a
// sub-route below for the next one.
const ACTIVITIES = [
  { key: 'paint', title: 'Paint', blurb: 'Draw, color in and save your pictures', Icon: BrushIcon, color: '#FF9E7A' },
  { key: 'stickers', title: 'Sticker book', blurb: 'Decorate your page with stickers bought with chore points', Icon: StickerIcon, color: '#B39DFF' },
  { key: 'photos', title: 'Photos', blurb: 'Family pictures for the board and the screensaver', Icon: ImagesIcon, color: '#7ED9A6' },
] as const

/** The built-in activities this family has on: Paint and Photos have their own feature switches;
 * the sticker book needs chore points and its own switch. None left and no added activity on = no
 * Activities tab (App.tsx). Rewards are their own screen (#/rewards), not an activity. */
export function shownActivities(s: Settings) {
  return ACTIVITIES.filter(a => a.key === 'stickers' ? s.features.chores && s.stickersEnabled : s.features[a.key])
}

export default function Activities({ sub, rest }: { sub?: string; rest?: string }) {
  const { settings, refreshTick } = useApp()
  const shown = shownActivities(settings)
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [managing, setManaging] = useState(false)
  const loadPlugins = () => { api.getPlugins().then(setPlugins).catch(() => {}) }
  useEffect(loadPlugins, [refreshTick])
  useEffect(() => { api.meStrict().then(me => setIsAdmin(me.scope === 'admin')).catch(() => {}) }, [])
  if (sub === 'plugin' && rest) return <PluginPlayer id={rest} />
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
        {plugins.filter(p => p.enabled).map(p => (
          <li key={p.id}>
            <a className="activity-card" href={`#/activities/plugin/${p.id}`} style={{ ['--activity-color' as string]: p.color ?? '#7AB8FF' }}>
              <span className="activity-card-icon activity-card-emoji" aria-hidden="true">{p.emoji}</span>
              <span className="activity-card-title">{p.name}</span>
              <span className="activity-card-sub">{p.description}{p.ages ? ` · Ages ${p.ages.min}${p.ages.max ? `–${p.ages.max}` : '+'}` : ''}</span>
            </a>
          </li>
        ))}
        {isAdmin
          ? <li><button className="activity-card activity-card-more" onClick={() => setManaging(true)}><span className="activity-card-title">＋ Get more activities</span><span className="activity-card-sub">Add activities made by others, or manage yours</span></button></li>
          : plugins.length === 0 && <li className="activity-card activity-card-soon">More coming soon <span aria-hidden="true">✨</span></li>}
      </ul>
      {managing && <PluginsSheet onClose={() => setManaging(false)} onChanged={loadPlugins} />}
    </div>
  )
}
