import type { RoutineDaySchedule, RoutineState } from './routineMode.ts'
import { useEffect, useState } from 'react'
import { Switch, CheckRow } from './a11y.tsx'
import { Choose } from './PickField.tsx'
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
import { appPlatform, appRoutineSelection, appRoutineSupported } from './native.ts'
import { routineDeviceError } from './routineDeviceError.ts'
import { routineChoreName, routineChoreNames } from './routineChores.ts'

/** Parent configuration lives in Settings, away from the child's daily progress. */
export default function RoutineModeSettings() {
  const { parentDevice } = useApp()
  return parentDevice ? <RoutineModeSettingsBody /> : <RoutineDeviceSettings />
}

/** Child devices can approve their own Screen Time setup without editing the parent's policy. */
function RoutineDeviceSettings() {
  const { memberId, state, native, nativeBusy, post } = useRoutineMode()
  if (!memberId || appPlatform() !== 'ios' || !appRoutineSupported()) return null
  const unenrolled = native?.enrolled === false || state?.enrolled === false
  return <section className="routine-card">
    <h3 className="routine-child-settings-title">{t('Screen Time on this device')}</h3>
    {!appRoutineSelection() ? <p>{t('Update Kinwall to receive app choices from your grown-up.')}</p> : <>
      {unenrolled && <p>{t('Your grown-up stopped routine mode management on this device. They can set it up again from Settings → Family on their device.')}</p>}
      {!unenrolled && native?.authorized !== true && <>
        <p>{t('Ask a grown-up to approve Screen Time on this device. Your device must use your child or teen Apple Account in the family’s Apple Family Sharing group.')}</p>
        <button type="button" className="btn btn-primary" disabled={nativeBusy} onClick={() => post('authorize')}>{nativeBusy ? t('Please wait…') : t('Approve Screen Time with a grown-up')}</button>
      </>}
      {!unenrolled && native?.authorized && <p>{native.awaitingSelection ? t('Screen Time is approved. Your grown-up can now choose your apps from their phone.') : t('Screen Time is approved on this device.')}</p>}
      {native?.error && <p role="alert">{routineDeviceError(native.error)}</p>}
      <button type="button" className="btn btn-secondary" disabled={nativeBusy} onClick={() => post('sync', state)}>{t('Check device status')}</button>
    </>}
  </section>
}

function RoutineModeSettingsBody() {
  const { children, picked, setPicked, memberId, state, states, error, nativeBusy, native, setNative, post, remember } = useRoutineMode()
  const [statuses, setStatuses] = useState<Record<string, RoutineSaveStatus>>({})
  const pending = (id: string) => !!statuses[id] && !['idle', 'saved'].includes(statuses[id]!.phase)
  return <div className="routine-settings">
    <label className="field">{t('Child')}<Choose hideLabel label={t('Child')} disabled={nativeBusy} value={picked} onChange={next => { setPicked(next); setNative(null) }} sheet
      options={children.map(m => ({ value: m.id, label: statuses[m.id]?.phase === 'error' || statuses[m.id]?.phase === 'invalid' ? t('{name} (not saved)', { name: m.name }) : m.name }))} /></label>
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
  // Text uses React onChange; choice controls commit their named hidden values with an input
  // event so the autosave reads the new choice from FormData immediately.
  return <form key={editor.revision} className="routine-settings-form" onSubmit={e => { e.preventDefault(); void autosave.flush() }} onChange={e => changed(e.currentTarget, ((e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') || e.target instanceof HTMLTextAreaElement) ? 500 : 0)} onInput={e => { if (e.target instanceof HTMLInputElement && e.target.type === 'hidden') changed(e.currentTarget, 0) }} onBlur={() => { void autosave.flush() }}>
    <fieldset className="routine-form-fields">
        <h3 className="routine-child-settings-title">{t('Settings for {name}', { name: childName })}</h3>
        <p role="status" className="settings-row-sub">{status.phase === 'pending' || status.phase === 'saving' ? t('Saving…') : status.phase === 'saved' ? t('Saved') : status.phase === 'error' || status.phase === 'invalid' ? t('Changes have not been saved.') : t('Changes save automatically.')}</p>
        {status.error && <p role="alert">{status.error}</p>}
        {status.phase === 'error' && <button type="button" className="btn btn-secondary" onClick={() => { void autosave.retry() }}>{t('Try again')}</button>}
        <label className="field">{t('Routine mode')}<Choose hideLabel label={t('Routine mode')} name="enabled" defaultValue={String(seed.enabled)}
          options={[
            { value: 'false', label: t('Off') },
            { value: 'true', label: t('On') },
          ]} /></label>
        <label className="field">{t('Apps during routine mode')}<Choose hideLabel label={t('Apps during routine mode')} name="appMode" defaultValue={seed.appMode ?? 'selected'}
          options={[
            { value: 'selected', label: t('Pause selected apps and categories') },
            { value: 'all', label: t('Pause all apps except allowed apps') },
          ]} /></label>
        <p className="settings-row-sub">{t('Allowed apps stay available even inside a paused category. In all-apps mode, Kinwall stays available. With only allowed websites on, select Safari or your school browser under Keep available.')}</p>
        <RoutineChoreFields selected={seed.requiredChoreIds ?? null} names={seed.requiredOneTimeChoreNames ?? []} chores={state.availableChores ?? []} />
        <RoutineScheduleFields start={seed.start ?? '00:00'} cutoff={seed.cutoff} days={seed.daySchedules ?? Array(7).fill(null)} />
        <label className="field">{t('Websites during routine mode')}<Choose hideLabel label={t('Websites during routine mode')} name="allowedWebsitesOnly" defaultValue={String(seed.allowedWebsitesOnly)}
          options={[
            { value: 'false', label: t('Allow all websites') },
            { value: 'true', label: t('Only allowed websites') },
          ]} /></label>
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
      <p className="settings-row-sub">{t('Selected sites appear on the child’s routine page. Other sites stay allowed, so school sign-in and redirects can still work.')}</p>
      {websites.map(domain => <CheckRow checked={!hidden.has(domain)} onChange={checked => { setHidden(previous => { const next = new Set(previous); if (checked) next.delete(domain); else next.add(domain); return next }) }} label={<><span>{t('Show {site} in website links', { site: domain })}</span></>} name="schoolLinkDomains" value={domain} key={domain} />)}
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
    <label className="field">{t('Schedule')}<Choose hideLabel label={t('Schedule')} name="scheduleMode" value={custom ? 'custom' : 'daily'} onChange={next => setCustom(next === 'custom')}
      options={[
        { value: 'daily', label: t('Same times every day') },
        { value: 'custom', label: t('Customize by day') },
      ]} /></label>
    <div className="routine-time-pair">
      <label className="field">{t('Routine mode starts')}<input type="time" name="start" required defaultValue={start} onChange={e => setDailyStart(e.target.value)} /></label>
      <label className="field">{t('Free time ends')}<input type="time" name="cutoff" required defaultValue={cutoff} onChange={e => setDailyEnd(e.target.value)} /></label>
    </div>
    <p className="settings-row-sub">{t('Before the start time, apps are available. After it, today’s chores must be approved to unlock them. At the end time, free time closes for the night. Times use your family’s timezone.')}</p>
    {custom && <fieldset className="routine-school-visibility">
      <legend>{t('Day overrides')}</legend>
      <p className="settings-row-sub">{t('Days without an override use the times above.')}</p>
      {names.map((name, day) => <div key={day} className="routine-day-schedule">
        <Switch checked={overrides[day]} onChange={checked => { setOverrides(previous => previous.map((value, index) => index === day ? checked : value)) }} label={<><span>{t('Use different times on {day}', { day: name })}</span></>} name={`day-${day}`} />
        {overrides[day] && <div className="routine-time-pair">
          <label className="field">{t('{day} routine starts', { day: name })}<input type="time" name={`start-${day}`} required defaultValue={days[day]?.start ?? dailyStart} /></label>
          <label className="field">{t('{day} free time ends', { day: name })}<input type="time" name={`cutoff-${day}`} required defaultValue={days[day]?.cutoff ?? dailyEnd} /></label>
        </div>}
      </div>)}
    </fieldset>}
  </>
}

function RoutineChoreFields({ selected, names, chores }: { selected: string[] | null; names: string[]; chores: { id: string; title: string; oneTime?: boolean }[] }) {
  const [specific, setSpecific] = useState(selected !== null)
  const [chosen, setChosen] = useState(() => new Set(selected ?? []))
  const [chosenNames, setChosenNames] = useState(() => new Map(names.map(name => [routineChoreName(name), name])))
  const repeating = chores.filter(chore => !chore.oneTime)
  const oneTimeNames = routineChoreNames([...names, ...chores.filter(chore => chore.oneTime).map(chore => chore.title), ...chosenNames.values()])
  return <>
    <label className="field">{t('Chores required for free time')}<Choose hideLabel label={t('Chores required for free time')} name="choreRequirement" value={specific ? 'selected' : 'all'} onChange={next => setSpecific(next === 'selected')}
      options={[
        { value: 'all', label: t('All assigned chores due today') },
        { value: 'selected', label: t('Selected chores') },
      ]} /></label>
    {specific && <fieldset className="routine-school-visibility">
      <legend>{t('Required chores')}</legend>
      <p className="settings-row-sub">{t('Choose active chores assigned to this child. Each chore is required only on the days it is due. Inactive, deleted, or reassigned chores do not count.')}</p>
      {repeating.map(chore => <CheckRow checked={chosen.has(chore.id)} onChange={checked => { setChosen(previous => { const next = new Set(previous); if (checked) next.add(chore.id); else next.delete(chore.id); return next }) }} label={<><span>{chore.title}</span></>} name="requiredChoreIds" value={chore.id} key={chore.id} />)}
      {oneTimeNames.length > 0 && <>
        <p className="settings-row-sub">{t('One-time chore names')}</p>
        <p className="settings-row-sub">{t('Completed one-time chores are hidden. Selected names also require future one-time chores with the same name for this child, only when due. Capitalization and extra spaces do not matter. Deselect a name to stop requiring it.')}</p>
        {oneTimeNames.map(name => <CheckRow checked={chosenNames.has(routineChoreName(name))} onChange={checked => { setChosenNames(previous => { const next = new Map(previous); if (checked) next.set(routineChoreName(name), name); else next.delete(routineChoreName(name)); return next }) }} label={<><span>{name}</span></>} name="requiredOneTimeChoreNames" value={name} key={routineChoreName(name)} />)}
      </>}
      {!repeating.length && !oneTimeNames.length && <p>{t('No active chores are assigned to this child.')}</p>}
      {!repeating.some(chore => chosen.has(chore.id)) && !chosenNames.size && <p>{t('With no chores selected, free time follows the schedule without chore requirements.')}</p>}
    </fieldset>}
  </>
}
