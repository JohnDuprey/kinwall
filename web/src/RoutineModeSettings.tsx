import type { RoutineDaySchedule, RoutineState } from './routineMode.ts'
import { useEffect, useState } from 'react'
import { schoolDomain } from './routineWebsites.ts'
import { useApp } from './AppContext.tsx'
import RoutineAppPreview from './RoutineAppPreview.tsx'
import { api, getKey, MOCK } from './api.ts'
import { t } from './i18n.ts'
import { useRoutineMode } from './useRoutineMode.ts'
import RoutineAppsSettings from './RoutineAppsSettings.tsx'
import { saveRoutinePolicy } from './routineSave.ts'
import { RoutineAutosave, type RoutineSaveStatus } from './routineAutosave.ts'
import { routineFormPolicy } from './routineForm.ts'

/** Parent configuration lives in Settings, away from the child's daily progress. */
export default function RoutineModeSettings() {
  const { parentDevice } = useApp()
  return parentDevice ? <RoutineModeSettingsBody /> : null
}
function RoutineModeSettingsBody() {
  const { children, picked, setPicked, memberId, state, states, error, nativeBusy, native, setNative, post, remember } = useRoutineMode()
  const [statuses, setStatuses] = useState<Record<string, RoutineSaveStatus>>({})
  const pending = (id: string) => !!statuses[id] && !['idle', 'saved'].includes(statuses[id]!.phase)
  return <div className="routine-settings">
    <label className="field">{t('Child')}<select className="settings-select" disabled={nativeBusy} value={picked} onChange={e => { setPicked(e.target.value); setNative(null) }}>{children.map(m => <option value={m.id} key={m.id}>{statuses[m.id]?.phase === 'error' || statuses[m.id]?.phase === 'invalid' ? t('{name} (not saved)', { name: m.name }) : m.name}</option>)}</select></label>
    <p className="settings-row-sub">{t('Changes save automatically for the selected child.')}</p>
    {!memberId && <p>{t('Add a child to your family before setting up routine mode.')}</p>}
    {error && <p role="alert">{error}</p>}
    {children.map(child => states[child.id] && <div key={child.id} hidden={child.id !== memberId}>
      <RoutineSettingsForm memberId={child.id} childName={child.name} state={states[child.id]!} active={child.id === memberId} onSaved={remember} onStatus={(id, status) => setStatuses(previous => ({ ...previous, [id]: status }))} />
    </div>)}
    {state && <>
      {MOCK && <RoutineAppPreview key={memberId} memberId={memberId} appMode={state.appMode ?? 'selected'} websiteList={state.allowedWebsitesOnly} />}
      <RoutineAppsSettings memberId={memberId} childName={children.find(child => child.id === memberId)?.name ?? ''} state={state} native={native} busy={nativeBusy} pending={pending(memberId)} post={post} />
    </>}
  </div>
}

function RoutineSettingsForm({ memberId, childName, state, active, onSaved, onStatus }: { memberId: string; childName: string; state: RoutineState; active: boolean; onSaved(id: string, state: RoutineState): void; onStatus(id: string, status: RoutineSaveStatus): void }) {
  const [status, setStatus] = useState<RoutineSaveStatus>({ phase: 'idle' })
  const [editor, setEditor] = useState({ seed: state, revision: 0 })
  const [autosave] = useState(() => new RoutineAutosave({
    initial: state,
    save: policy => saveRoutinePolicy(api, memberId, policy),
    confirmed: next => onSaved(memberId, next),
    status: next => { setStatus(next); onStatus(memberId, next) },
  }))
  useEffect(() => {
    if ((status.phase === 'idle' || status.phase === 'saved') && !autosave.matches(state)) {
      autosave.accept(state)
      setEditor(previous => ({ seed: state, revision: previous.revision + 1 }))
    }
  }, [state, status.phase, autosave])
  useEffect(() => { if (!active) void autosave.flush() }, [active, autosave])
  useEffect(() => {
    const flush = () => { void autosave.flush() }
    const hidden = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', flush)
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', flush); flush() }
  }, [autosave])
  const changed = (form: HTMLFormElement, delay: number) => {
    const key = getKey()
    autosave.edit(() => {
      if (key !== getKey()) throw new Error(t('Sign-in changed. Reopen Settings before changing this routine.'))
      return routineFormPolicy(new FormData(form))
    }, delay)
  }
  const seed = editor.seed
  return <form key={editor.revision} className="routine-settings-form" onSubmit={e => { e.preventDefault(); void autosave.flush() }} onInput={e => changed(e.currentTarget, 500)} onChange={e => changed(e.currentTarget, ['textarea', 'input'].includes((e.target as HTMLElement).tagName.toLowerCase()) && (e.target as HTMLInputElement).type !== 'checkbox' ? 500 : 0)} onBlur={() => { void autosave.flush() }}>
    <fieldset className="routine-form-fields">
        <h3 className="routine-child-settings-title">{t('Settings for {name}', { name: childName })}</h3>
        <p role="status" className="settings-row-sub">{status.phase === 'pending' || status.phase === 'saving' ? t('Saving…') : status.phase === 'saved' ? t('Saved') : status.phase === 'error' || status.phase === 'invalid' ? t('Changes have not been saved.') : t('Changes save automatically.')}</p>
        {status.error && <p role="alert">{status.error}</p>}
        {status.phase === 'error' && <button type="button" className="btn btn-secondary" onClick={() => { void autosave.retry() }}>{t('Try again')}</button>}
        <label className="field">{t('Routine mode')}<select name="enabled" className="settings-select" defaultValue={String(seed.enabled)}><option value="false">{t('Off')}</option><option value="true">{t('On')}</option></select></label>
        <label className="field">{t('Apps during routine mode')}<select name="appMode" className="settings-select" defaultValue={seed.appMode ?? 'selected'}><option value="selected">{t('Pause selected apps and categories')}</option><option value="all">{t('Pause all apps except allowed apps')}</option></select></label>
        <p className="settings-row-sub">{t('Allowed apps stay available even inside a paused category. In all-apps mode, Kinwall stays available. With only allowed websites on, select Safari or your school browser under Keep available.')}</p>
        <RoutineChoreFields selected={seed.requiredChoreIds ?? null} chores={state.availableChores ?? []} />
        <RoutineScheduleFields start={seed.start ?? '00:00'} cutoff={seed.cutoff} days={seed.daySchedules ?? Array(7).fill(null)} />
        <label className="field">{t('Websites during routine mode')}<select name="allowedWebsitesOnly" className="settings-select" defaultValue={String(seed.allowedWebsitesOnly)}><option value="false">{t('Allow all websites')}</option><option value="true">{t('Only allowed websites')}</option></select></label>
        <SchoolWebsiteFields domains={seed.allowedWebDomains} links={seed.schoolLinkDomains ?? seed.allowedWebDomains} />
        <p className="settings-row-sub">{t('With only allowed websites on, these sites stay available while other browsing is paused. Add your school’s sign-in sites too. Website access does not mark schoolwork complete.')}</p>
        <p className="settings-row-sub">{t('On the child’s device, put Safari or their school browser under Keep available. An allowed website cannot open inside a blocked browser.')}</p>
        <p>{t('Required chores count only when due today, and must have approved completions. Shared chores are not required. On days without required chores, free time is available until the end time.')}</p>
    </fieldset>
  </form>
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
