import type { RoutineDaySchedule } from './routineMode.ts'
import { useState } from 'react'
import { schoolDomain } from './routineWebsites.ts'
import { useApp } from './AppContext.tsx'
import RoutineAppPreview from './RoutineAppPreview.tsx'
import { api, MOCK } from './api.ts'
import { appPlatform } from './native.ts'
import { t, tn } from './i18n.ts'
import { useRoutineMode } from './useRoutineMode.ts'
import { routineDeviceError } from './routineDeviceError.ts'

/** Parent configuration lives in Settings, away from the child's daily progress. */
export default function RoutineModeSettings() {
  const { parentDevice } = useApp()
  return parentDevice ? <RoutineModeSettingsBody /> : null
}
function RoutineModeSettingsBody() {
  const { children, parentDevice, picked, setPicked, memberId, state, error, setError, busy, setBusy, native, setNative, post, load, toast } = useRoutineMode()
  return <div className="routine-settings">
    <label className="field">{t('Child')}<select className="settings-select" value={picked} onChange={e => { setPicked(e.target.value); setNative(null) }}>{children.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select></label>
    <p className="settings-row-sub">{t('These settings apply only to the selected child.')}</p>
    {!memberId && <p>{t('Add a child to your family before setting up routine mode.')}</p>}
    {error && <p role="alert">{error}</p>}
    {state && <>
      <form key={`${memberId}:${state.enabled}:${JSON.stringify(state.requiredChoreIds)}:${state.appMode}:${state.cutoff}:${state.allowedWebsitesOnly}:${state.allowedWebDomains.join(',')}:${state.schoolLinkDomains?.join(',')}:${state.start}:${JSON.stringify(state.daySchedules)}`} className="routine-settings-form" onSubmit={async e => { e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); try { await api.setRoutineMode(memberId, { enabled: form.get('enabled') === 'true', requiredChoreIds: form.get('choreRequirement') === 'selected' ? form.getAll('requiredChoreIds').map(String) : null, appMode: form.get('appMode') === 'all' ? 'all' : 'selected', cutoff: String(form.get('cutoff')), start: String(form.get('start')), daySchedules: Array.from({ length: 7 }, (_, day) => form.get('scheduleMode') === 'custom' && form.get(`day-${day}`) === 'on' ? { start: String(form.get(`start-${day}`)), cutoff: String(form.get(`cutoff-${day}`)) } : null), allowedWebsitesOnly: form.get('allowedWebsitesOnly') === 'true', allowedWebDomains: String(form.get('allowedWebDomains')).split(/[\s,]+/).filter(Boolean), schoolLinkDomains: form.getAll('schoolLinkDomains').map(String) }); await load(); toast(t('Routine mode saved.')) } catch (e) { setError(String(e instanceof Error ? e.message : e)) } finally { setBusy(false) } }}>
        <h3 className="routine-child-settings-title">{t('Settings for {name}', { name: children.find(child => child.id === memberId)?.name ?? '' })}</h3>
        <label className="field">{t('Routine mode')}<select name="enabled" className="settings-select" defaultValue={String(state.enabled)}><option value="false">{t('Off')}</option><option value="true">{t('On')}</option></select></label>
        <label className="field">{t('Apps during routine mode')}<select name="appMode" className="settings-select" defaultValue={state.appMode ?? 'selected'}><option value="selected">{t('Pause selected apps and categories')}</option><option value="all">{t('Pause all apps except allowed apps')}</option></select></label>
        <p className="settings-row-sub">{t('Allowed apps stay available even inside a paused category. In all-apps mode, Kinwall stays available. With only allowed websites on, select Safari or your school browser under Keep available.')}</p>
        <RoutineChoreFields selected={state.requiredChoreIds ?? null} chores={state.availableChores ?? []} />
        <RoutineScheduleFields start={state.start ?? '00:00'} cutoff={state.cutoff} days={state.daySchedules ?? Array(7).fill(null)} />
        <label className="field">{t('Websites during routine mode')}<select name="allowedWebsitesOnly" className="settings-select" defaultValue={String(state.allowedWebsitesOnly)}><option value="false">{t('Allow all websites')}</option><option value="true">{t('Only allowed websites')}</option></select></label>
        <SchoolWebsiteFields domains={state.allowedWebDomains} links={state.schoolLinkDomains ?? state.allowedWebDomains} />
        <p className="settings-row-sub">{t('With only allowed websites on, these sites stay available while other browsing is paused. Add your school’s sign-in sites too. Website access does not mark schoolwork complete.')}</p>
        <p className="settings-row-sub">{t('On the child’s device, put Safari or their school browser under Keep available. An allowed website cannot open inside a blocked browser.')}</p>
        <p>{t('Required chores count only when due today, and must have approved completions. Shared chores are not required. On days without required chores, free time is available until the end time.')}</p>
        <button className="btn btn-primary" disabled={busy}>{t('Save routine settings')}</button>
      </form>
      {MOCK && <RoutineAppPreview key={memberId} memberId={memberId} appMode={state.appMode ?? 'selected'} websiteList={state.allowedWebsitesOnly} />}
      {appPlatform() === 'ios' && <section className="routine-card">
        <h2>{t('Set up the child’s device')}</h2>
        <p>{t('App choices must be set up on the child’s iPhone or iPad. Chores, schedules, and allowed websites can be managed from your phone.')}</p>
        {native?.simulator && <p className="chip-static">{t('Simulator preview — apps are not blocked')}</p>}
        {native?.authorized && <p>{native.appMode === 'all' ? t('All apps paused except allowed apps') : native.selected ? tn(native.selected, 'One app or category selected', '{n} apps or categories selected') : t('A grown-up chooses which entertainment apps to pause on this device.')}</p>}
        {native?.authorized === false && !native.error && <p>{t('Screen Time access has not been approved on this device.')}</p>}
        {native?.authorized && typeof native.locked === 'boolean' && <p>{native.locked ? t('Device status: entertainment paused') : t('Device status: entertainment available')}</p>}
        {native?.allowedApps !== undefined && <p>{tn(native.allowedApps, 'One app kept available', '{n} apps kept available')}</p>}
        {native?.error && <p role="alert">{routineDeviceError(native.error)}</p>}
        {parentDevice && <button className="btn btn-secondary" onClick={() => post('setup')}>{t('Choose apps on this device')}</button>}
        <button className="btn btn-secondary" onClick={() => { post('sync', state); load() }}>{t('Check device status')}</button>
        <p className="settings-row-sub">{t('Sign into Kinwall as a grown-up on the child’s device, approve Apple’s Screen Time request, then pair the device to the child. Keep essential apps available.')}</p>
      </section>}
    </>}
  </div>
}

function SchoolWebsiteFields({ domains, links }: { domains: string[]; links: string[] }) {
  const [text, setText] = useState(domains.join('\n'))
  const [hidden, setHidden] = useState(() => new Set(domains.filter(domain => !links.includes(domain))))
  const websites = [...new Set(text.split(/[\s,]+/).map(schoolDomain).filter((domain): domain is string => domain !== null))]
  return <>
    <label className="field">{t('Allowed websites')}<textarea name="allowedWebDomains" rows={4} value={text} onChange={e => setText(e.target.value)} placeholder={t('One website per line, such as clever.com or student.freckle.com')} /></label>
    {websites.length > 0 && <fieldset className="routine-school-visibility">
      <legend>{t('Website links')}</legend>
      <p className="settings-row-sub">{t('Checked sites appear on the child’s routine page. Unchecked sites stay allowed, so school sign-in and redirects can still work.')}</p>
      {websites.map(domain => <label key={domain} className="routine-school-checkbox"><input type="checkbox" name="schoolLinkDomains" value={domain} checked={!hidden.has(domain)} onChange={e => { const checked = e.target.checked; setHidden(previous => { const next = new Set(previous); if (checked) next.delete(domain); else next.add(domain); return next }) }} /><span>{t('Show {site} in website links', { site: domain })}</span></label>)}
    </fieldset>}
  </>
}

function RoutineScheduleFields({ start, cutoff, days }: { start: string; cutoff: string; days: (RoutineDaySchedule | null)[] }) {
  const [custom, setCustom] = useState(days.some(Boolean))
  const [overrides, setOverrides] = useState(days.map(Boolean))
  const [dailyStart, setDailyStart] = useState(start)
  const [dailyEnd, setDailyEnd] = useState(cutoff)
  const names = [t('Sunday'), t('Monday'), t('Tuesday'), t('Wednesday'), t('Thursday'), t('Friday'), t('Saturday')]
  return <>
    <label className="field">{t('Schedule')}<select name="scheduleMode" className="settings-select" value={custom ? 'custom' : 'daily'} onChange={e => setCustom(e.target.value === 'custom')}><option value="daily">{t('Same times every day')}</option><option value="custom">{t('Customize by day')}</option></select></label>
    <div className="routine-time-pair">
      <label className="field">{t('Routine mode starts')}<input type="time" name="start" required defaultValue={start} onChange={e => setDailyStart(e.target.value)} /></label>
      <label className="field">{t('Free time ends')}<input type="time" name="cutoff" required defaultValue={cutoff} onChange={e => setDailyEnd(e.target.value)} /></label>
    </div>
    <p className="settings-row-sub">{t('Before the start time, apps are available. After it, today’s chores must be approved to unlock them. At the end time, free time closes for the night. Times use your family’s timezone.')}</p>
    {custom && <fieldset className="routine-school-visibility">
      <legend>{t('Day overrides')}</legend>
      <p className="settings-row-sub">{t('Days without an override use the times above.')}</p>
      {names.map((name, day) => <div key={day} className="routine-day-schedule">
        <label className="routine-school-checkbox"><input type="checkbox" name={`day-${day}`} checked={overrides[day]} onChange={e => { const checked = e.target.checked; setOverrides(previous => previous.map((value, index) => index === day ? checked : value)) }} /><span>{t('Use different times on {day}', { day: name })}</span></label>
        {overrides[day] && <div className="routine-time-pair">
          <label className="field">{t('{day} routine starts', { day: name })}<input type="time" name={`start-${day}`} required defaultValue={days[day]?.start ?? dailyStart} /></label>
          <label className="field">{t('{day} free time ends', { day: name })}<input type="time" name={`cutoff-${day}`} required defaultValue={days[day]?.cutoff ?? dailyEnd} /></label>
        </div>}
      </div>)}
    </fieldset>}
  </>
}

function RoutineChoreFields({ selected, chores }: { selected: string[] | null; chores: { id: string; title: string }[] }) {
  const [specific, setSpecific] = useState(selected !== null)
  const [chosen, setChosen] = useState(() => new Set(selected ?? []))
  return <>
    <label className="field">{t('Chores required for free time')}<select name="choreRequirement" className="settings-select" value={specific ? 'selected' : 'all'} onChange={e => setSpecific(e.target.value === 'selected')}><option value="all">{t('All assigned chores due today')}</option><option value="selected">{t('Selected chores')}</option></select></label>
    {specific && <fieldset className="routine-school-visibility">
      <legend>{t('Required chores')}</legend>
      <p className="settings-row-sub">{t('Choose active chores assigned to this child. Each chore is required only on the days it is due. Inactive, deleted, or reassigned chores do not count.')}</p>
      {chores.map(chore => <label key={chore.id} className="routine-school-checkbox"><input name="requiredChoreIds" type="checkbox" value={chore.id} checked={chosen.has(chore.id)} onChange={e => { const checked = e.target.checked; setChosen(previous => { const next = new Set(previous); if (checked) next.add(chore.id); else next.delete(chore.id); return next }) }} /><span>{chore.title}</span></label>)}
      {!chores.length && <p>{t('No active chores are assigned to this child.')}</p>}
      {!chores.some(chore => chosen.has(chore.id)) && <p>{t('With no chores selected, free time follows the schedule without chore requirements.')}</p>}
    </fieldset>}
  </>
}
