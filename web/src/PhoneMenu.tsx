// A contact phone's menu, step by step (Contacts.tsx, under each number): wait some seconds, press keys,
// or wait for me, each with an optional label. Under it, the steps in words, the dial string and Try it.
// The dial string and words come from dialSteps.ts (the server checks the steps: schemas.ts DialStepSchema).
import { msg, t, tm } from './i18n.ts'
import { stepsToDial, stepsToWords, telUri, usable, type DialStep } from './dialSteps.ts'

const KIND_NAMES: Record<DialStep['kind'], string> = { wait: msg('Wait'), press: msg('Press'), confirm: msg('Wait for me') }

/** The phone menu, step by step (no typing commas): wait, press keys, or wait for me; each with an
 *  optional label, moved up and down. Under it, the steps in words, the dial string and Try it. */
export default function PhoneMenuEditor({ steps, onChange, phone }: { steps: DialStep[]; onChange: (s: DialStep[]) => void; phone: string }) {
  const put = (i: number, s: DialStep) => onChange(steps.map((x, j) => (j === i ? s : x)))
  const move = (i: number, by: number) => { const next = [...steps]; [next[i], next[i + by]] = [next[i + by], next[i]]; onChange(next) }
  const kindOf = (k: DialStep['kind'], label?: string): DialStep => (k === 'wait' ? { kind: k, seconds: 2, label } : k === 'press' ? { kind: k, digits: '', label } : { kind: k, label })
  const ready = usable(steps)
  const dial = stepsToDial(ready)
  const tel = telUri(phone, dial)
  return (
    <fieldset className="field meds-times dial-editor">
      <legend>{t('Phone menu')} <span className="settings-row-sub">{t('(optional)')}</span></legend>
      <ol className="dial-steps">
        {steps.map((s, i) => (
          <li key={i} className="dial-step">
            <div className="meds-time-row">
              <span className="dial-step-n" aria-hidden="true">{i + 1}</span>
              <select className="settings-select" aria-label={t('Step {n}', { n: i + 1 })} value={s.kind} onChange={e => put(i, kindOf(e.target.value as DialStep['kind'], s.label))}>
                {(['wait', 'press', 'confirm'] as const).map(k => <option key={k} value={k}>{tm(KIND_NAMES[k])}</option>)}
              </select>
              {s.kind === 'wait' && <div className="dial-stepper" role="group" aria-label={t('Step {n}: seconds', { n: i + 1 })}>
                <button type="button" className="btn btn-secondary" aria-label={t('1 second less')} disabled={s.seconds <= 1} onClick={() => put(i, { ...s, seconds: s.seconds - 1 })}>−</button>
                <span className="dial-seconds" aria-live="polite">{t('{n} s', { n: s.seconds })}</span>
                <button type="button" className="btn btn-secondary" aria-label={t('1 second more')} disabled={s.seconds >= 60} onClick={() => put(i, { ...s, seconds: s.seconds + 1 })}>+</button>
              </div>}
              {s.kind === 'press' && <input type="text" inputMode="tel" maxLength={20} aria-label={t('Step {n}: keys to press', { n: i + 1 })} placeholder="2" value={s.digits}
                onChange={e => put(i, { ...s, digits: e.target.value.replace(/[^0-9*#]/g, '') })} className="dial-keys" />}
              {s.kind === 'confirm' && <span className="field-hint dial-confirm">{t('Your phone asks before going on.')}</span>}
            </div>
            <div className="meds-time-row">
              <input type="text" maxLength={40} aria-label={t('Step {n}: label', { n: i + 1 })} placeholder={t('Label, like Prescriptions')} value={s.label ?? ''} onChange={e => put(i, { ...s, label: e.target.value })} className="dial-label" />
              <button type="button" className="btn btn-secondary" aria-label={t('Move step {n} up', { n: i + 1 })} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn btn-secondary" aria-label={t('Move step {n} down', { n: i + 1 })} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="btn btn-secondary" aria-label={t('Remove step {n}', { n: i + 1 })} onClick={() => onChange(steps.filter((_, j) => j !== i))}>✕</button>
            </div>
          </li>
        ))}
      </ol>
      {steps.length < 20 && <div className="settings-inline-btns">
        <button type="button" className="btn btn-secondary" onClick={() => onChange([...steps, kindOf('wait')])}>{t('+ Wait')}</button>
        <button type="button" className="btn btn-secondary" onClick={() => onChange([...steps, kindOf('press')])}>{t('+ Press')}</button>
        <button type="button" className="btn btn-secondary" onClick={() => onChange([...steps, kindOf('confirm')])}>{t('+ Wait for me')}</button>
      </div>}
      {ready.length > 0 && <div className="dial-preview">
        <p className="refill-steps">{stepsToWords(ready)}</p>
        <div className="refill-way">
          <code className="dial-string">{tel ? decodeURIComponent(tel.slice(4)) : dial}</code>
          {tel && <a className="btn btn-secondary refill-btn" href={tel}>{t('Try it')}</a>}
        </div>
        {!tel && <p className="field-hint">{t('Add the phone number above to try it.')}</p>}
      </div>}
    </fieldset>
  )
}
