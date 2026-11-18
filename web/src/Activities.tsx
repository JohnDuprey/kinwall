import { shownActivities } from './activityConfig.ts'
import Paint from './Paint.tsx'
import Stickers from './Stickers.tsx'
import Photos from './Photos.tsx'
import { useEffect, useState } from 'react'
import { useApp } from './AppContext.tsx'
import { api } from './api.ts'
import { hashPath, hashQuery } from './hashQuery.ts'
import { PluginPlayer, PluginsSheet } from './Plugins.tsx'
import type { Plugin } from './types.ts'
import { t, tm } from './i18n.ts'

export default function Activities({ sub, rest }: { sub?: string; rest?: string }) {
  const { settings, refreshTick } = useApp()
  const shown = shownActivities(settings)
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [managing, setManaging] = useState(false)
  const loadPlugins = () => { api.getPlugins().then(setPlugins).catch(() => {}) }
  useEffect(loadPlugins, [refreshTick])
  useEffect(() => {
    // #/activities?more=1 (a chore whose activity isn't installed links here) opens Get more activities.
    const more = hashQuery(location.hash).get('more') === '1'
    if (more) history.replaceState(history.state, '', hashPath(location.hash))
    api.meStrict().then(me => { setIsAdmin(me.scope === 'admin'); if (more && me.scope === 'admin') setManaging(true) }).catch(() => {})
  }, [])
  if (sub === 'plugin' && rest) return <PluginPlayer id={rest} />
  // A sub-page that's turned off renders nothing while App.tsx redirects away from it.
  if (sub) return !shown.some(a => a.key === sub) ? null : sub === 'paint' ? <Paint /> : sub === 'stickers' ? <Stickers /> : sub === 'photos' ? <Photos /> : null
  return (
    <div className="activities scroll-y">
      <ul className="activity-grid" aria-label={t('Activities')}>
        {shown.map(a => (
          <li key={a.key}>
            <a className="activity-card" href={`#/activities/${a.key}`} style={{ ['--activity-color' as string]: a.color }}>
              <span className="activity-card-icon"><a.Icon width={44} height={44} /></span>
              <span className="activity-card-title">{tm(a.title)}</span>
              <span className="activity-card-sub">{tm(a.blurb)}</span>
            </a>
          </li>
        ))}
        {plugins.filter(p => p.enabled).map(p => (
          <li key={p.id}>
            <a className="activity-card" href={`#/activities/plugin/${p.id}`} style={{ ['--activity-color' as string]: p.color ?? '#7AB8FF' }}>
              <span className="activity-card-icon activity-card-emoji" aria-hidden="true">{p.emoji}</span>
              <span className="activity-card-title">{p.name}</span>
              <span className="activity-card-sub">{p.description}{p.ages ? ` · ${p.ages.max ? t('Ages {min}–{max}', { min: p.ages.min, max: p.ages.max }) : t('Ages {min}+', { min: p.ages.min })}` : ''}</span>
            </a>
          </li>
        ))}
        {isAdmin
          ? <li><button className="activity-card activity-card-more" onClick={() => setManaging(true)}><span className="activity-card-title">{t('＋ Get more activities')}</span><span className="activity-card-sub">{t('Add activities made by others, or manage yours')}</span></button></li>
          : plugins.length === 0 && <li className="activity-card activity-card-soon">{t('More coming soon')} <span aria-hidden="true">✨</span></li>}
      </ul>
      {managing && <PluginsSheet onClose={() => setManaging(false)} onChanged={loadPlugins} />}
    </div>
  )
}
