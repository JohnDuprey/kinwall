import { t, tn } from './i18n.ts'
import { useRoutineMode } from './useRoutineMode.ts'
import { appPlatform, appRoutineSelection } from './native.ts'
import { routineDeviceError } from './routineDeviceError.ts'

export default function RoutineMode() {
  const { children, parentDevice, picked, setPicked, memberId, state, error, native, nativeBusy, post, setNative, settings } = useRoutineMode()
  const schoolLinks = state?.schoolLinkDomains ?? state?.allowedWebDomains ?? []
  if (!settings.features.chores) return <div className="content"><p>{t('Turn on chores to use routine mode.')}</p></div>
  return <div className="content scroll-y"><div className="routine-page">
    <button type="button" className="btn btn-secondary routine-back" onClick={() => { location.hash = '#/chores' }}>{t('Back to chores')}</button>
    <h1>{t('Ready for free time')}</h1>
    {native?.simulator && <p className="chip-static">{t('Simulator preview — apps are not blocked')}</p>}
    <p>{t('Finish today’s required chores to unlock the apps your family has chosen.')}</p>
    {parentDevice && <label className="field">{t('Child')}<select className="settings-select" value={picked} onChange={e => { setPicked(e.target.value); setNative(null) }}>{children.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select></label>}
    {!memberId && <p>{t('A grown-up needs to assign this device to a child first.')}</p>}
    {error && <p role="alert">{error}</p>}
    {!parentDevice && memberId && appPlatform() === 'ios' && <section className="routine-card">
      <h2>{t('Screen Time on this device')}</h2>
      {!appRoutineSelection() ? <p>{t('Update Kinwall to receive app choices from your grown-up.')}</p> : <>
        {native?.authorized !== true && <>
          <p>{t('Ask a grown-up to approve Screen Time on this device. Your device must use your child or teen Apple Account in the family’s Apple Family Sharing group.')}</p>
          <button type="button" className="btn btn-primary" disabled={nativeBusy} onClick={() => post('authorize')}>{nativeBusy ? t('Please wait…') : t('Approve Screen Time with a grown-up')}</button>
        </>}
        {native?.authorized && <p>{native.awaitingSelection ? t('Screen Time is approved. Your grown-up can now choose your apps from their phone.') : t('Screen Time is approved on this device.')}</p>}
        {native?.error && <p role="alert">{routineDeviceError(native.error)}</p>}
        <button type="button" className="btn btn-secondary" disabled={nativeBusy} onClick={() => post('sync', state)}>{t('Check device status')}</button>
      </>}
    </section>}
    {state && <>
      {schoolLinks.length > 0 && <section className="routine-card">
        <h2>{t('Allowed websites')}</h2>
        <p>{t('Open websites in the browser your grown-up kept available.')}</p>
        <div className="routine-school-links">{schoolLinks.map(domain => <a key={domain} className="btn btn-secondary" href={`https://${domain}`}>{domain}</a>)}</div>
      </section>}
      <section className="routine-card" aria-live="polite">
        <div className="routine-symbol" aria-hidden="true">{!state.enabled ? '○' : state.locked ? '🔒' : '✓'}</div>
        <h2>{!state.enabled ? t('Routine mode is off') : state.reason === 'scheduled' ? t('Free time is available') : state.reason === 'bedtime' ? t('Free time is finished for today') : state.locked ? tn(state.remaining.length, 'One thing left before free time', '{n} things left before free time') : t('Ready for free time!')}</h2>
        <p>{t('{done} of {total} chores approved', { done: state.total - state.remaining.length, total: state.total })}</p>
        <progress aria-label={t('Approved chores')} max={Math.max(1, state.total)} value={state.total - state.remaining.length} />
        {state.allowedWebsitesOnly && <p>{t('Allowed websites are available during routine mode.')}</p>}
        <ul className="routine-list">{state.remaining.map(c => <li key={c.id}><span>{c.title}</span><span className="chip-static">{c.pending ? t('Waiting for a grown-up') : t('To do')}</span></li>)}</ul>
        <a className="btn btn-primary" href="#/chores">{t('Open chores')}</a>
        {state.reason === 'scheduled' && <p>{t('Routine mode starts at {time}.', { time: state.effectiveStart ?? state.start ?? '00:00' })}</p>}
        <p className="settings-row-sub">{t('Free time ends at {time}, using your family’s timezone.', { time: state.effectiveCutoff ?? state.cutoff })}</p>
      </section>
    </>}
  </div></div>
}
