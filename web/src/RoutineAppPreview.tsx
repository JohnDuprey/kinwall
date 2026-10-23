import { useState } from 'react'
import { t, msg, tm } from './i18n.ts'
import { previewAppAccess } from './routineAppPreview.ts'
const apps = [
  { id: 'puzzle', category: 'games', name: msg('Puzzle game'), icon: '🧩' },
  { id: 'racing', category: 'games', name: msg('Racing game'), icon: '🏎️' },
  { id: 'video', category: 'entertainment', name: msg('Video player'), icon: '▶️' },
  { id: 'reading', category: 'education', name: msg('Reading app'), icon: '📚' },
  { id: 'calculator', category: 'utilities', name: msg('Calculator'), icon: '🧮' },
  { id: 'safari', category: 'utilities', name: msg('Safari'), icon: '🧭' },
  { id: 'kinwall', category: 'utilities', name: msg('Kinwall'), icon: '🏠' },
]
const categories = [{ id: 'games', name: msg('Games') }, { id: 'entertainment', name: msg('Entertainment') }, { id: 'education', name: msg('Education') }, { id: 'utilities', name: msg('Utilities') }]
type Choices = { categories: string[]; selected: string[]; allowed: string[] }
const choices = new Map<string, Choices>()
/** Fictional app choices stay in this demo tab; they are never used as Apple tokens. */
export default function RoutineAppPreview({ memberId, appMode, websiteList }: { memberId: string; appMode: 'selected' | 'all'; websiteList: boolean }) {
  const [profile, setProfile] = useState<Choices>(() => choices.get(memberId) ?? { categories: ['games'], selected: ['video'], allowed: ['reading'] })
  const access = previewAppAccess(appMode, profile.categories, profile.selected, profile.allowed, websiteList, apps)
  const toggle = (key: keyof Choices, id: string, checked: boolean) => setProfile(previous => {
    const next = { ...previous, [key]: checked ? [...new Set([...previous[key], id])] : previous[key].filter(value => value !== id) }
    choices.set(memberId, next)
    return next
  })
  return <section className="routine-card routine-app-preview">
    <h3 className="routine-child-settings-title">{t('App selection preview')}</h3>
    <p className="chip-static">{t('Sample apps — nothing is blocked')}</p>
    <p className="settings-row-sub">{t('This preview uses the saved app mode and website settings above. Sample choices are separate for each child and reset when the demo reloads.')}</p>
    {appMode === 'selected' && <>
      <fieldset className="routine-school-visibility"><legend>{t('Categories to pause')}</legend>{categories.map(category => <label key={category.id} className="routine-school-checkbox"><input type="checkbox" checked={profile.categories.includes(category.id)} onChange={e => toggle('categories', category.id, e.target.checked)} /><span>{tm(category.name)}</span></label>)}</fieldset>
      <fieldset className="routine-school-visibility"><legend>{t('Individual apps to pause')}</legend>{apps.filter(app => app.id !== 'kinwall').map(app => <label key={app.id} className="routine-school-checkbox"><input type="checkbox" checked={profile.selected.includes(app.id)} onChange={e => toggle('selected', app.id, e.target.checked)} /><span>{app.icon} {tm(app.name)}</span></label>)}</fieldset>
    </>}
    <fieldset className="routine-school-visibility"><legend>{t('Keep available')}</legend>{apps.filter(app => app.id !== 'kinwall' && !(websiteList && app.id === 'safari')).map(app => <label key={app.id} className="routine-school-checkbox"><input type="checkbox" checked={profile.allowed.includes(app.id)} onChange={e => toggle('allowed', app.id, e.target.checked)} /><span>{app.icon} {tm(app.name)}</span></label>)}</fieldset>
    {websiteList && <p className="settings-row-sub">{t('Safari stays available in this preview. On a real device, select Safari in Keep available so the allowed websites can open.')}</p>}
    <h4>{t('While routine mode is locked')}</h4>
    <ul className="routine-list">{apps.map(app => <li key={app.id}><span>{app.icon} {tm(app.name)}</span><span className="chip-static">{access[app.id] ? t('Available') : t('Paused')}</span></li>)}</ul>
  </section>
}
