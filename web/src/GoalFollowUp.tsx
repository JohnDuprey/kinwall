// The evening goal check (Temp check → Evening goal check): "Did you finish your goal?" from the
// person's chosen time until midnight, at the bottom of their Day view and at the top of their
// journal. Yes / Partly / Not today saves right away; then three optional notes when their journal
// keeps them. On a shared wall the server keeps the answer private (tc.private): once answered it
// says "Answered ✓", and "Change" starts fresh. Private notes (tc.followupHidden: written in their
// private journal, and this isn't their device) show the same way, with no "Change": only they can.
// With their energy battery on, the same card (or on its own, on a day without a goal) asks "How
// drained do you feel?": Full / OK / Low / Empty or Skip, which calibrates their battery. The server
// only opens that question on their own device or a parent's (drainedOpen), never on a shared wall.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { announce } from './a11y.tsx'
import { followupThanks, OUTCOMES, outcomeOf } from './journal.ts'
import { DRAINED, drainedOf } from './battery.ts'
import type { Drained, FollowupOutcome, Member, TempCheck } from './types.ts'

const NOTES = [
  { key: 'helped', label: 'What helped?' },
  { key: 'hindered', label: 'What got in the way?' },
  { key: 'next', label: 'Next time I’ll…' },
] as const
type Notes = Record<(typeof NOTES)[number]['key'], string>
const EMPTY: Notes = { helped: '', hindered: '', next: '' }

export default function GoalFollowUp({ member, onSaved }: { member: Member; onSaved?: () => void }) {
  const { toast } = useApp()
  const [tc, setTc] = useState<TempCheck | null>(null)
  const [step, setStep] = useState<'ask' | 'notes' | 'done'>('ask')
  const [notes, setNotes] = useState<Notes>(EMPTY)
  const [changeDrained, setChangeDrained] = useState(false)
  useEffect(() => {
    let canceled = false
    api.getTempCheck(member.id).then(t => {
      if (canceled) return
      setTc(t)
      if (t.followup) setNotes({ helped: t.followup.helped ?? '', hindered: t.followup.hindered ?? '', next: t.followup.next ?? '' })
      setStep(t.answered.followup ? 'done' : 'ask')
    }).catch(() => { /* no card rather than an error at the end of their day */ })
    return () => { canceled = true }
  }, [member.id])
  if (!tc?.followupOpen && !tc?.drainedOpen) return null

  const save = async (outcome: FollowupOutcome, withNotes: boolean) => {
    try {
      const t = await api.putTempCheck(member.id, { followup: { outcome, ...(withNotes ? notes : {}) } })
      setTc(t)
      if (!withNotes && t.settings.journal && !t.private) { setStep('notes'); return }
      setStep('done'); announce(followupThanks(outcome, member.name)); onSaved?.()
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
  }
  const saveDrained = async (drained: Drained | 'skip') => {
    try {
      setTc(await api.putTempCheck(member.id, { drained }))
      setChangeDrained(false); announce(drained === 'skip' ? 'Skipped' : `Thanks for checking in, ${member.name} ✓`); onSaved?.()
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
  }
  const outcome = tc.followup?.outcome
  const picked = outcome && outcomeOf(outcome)
  const felt = drainedOf(tc.drained)

  return (
    <section className="snap-temp snap-goalcheck" aria-label={tc.followupOpen ? 'Goal check' : 'Evening check'}>
      <h3 className="snap-heading">{tc.followupOpen ? '🎯 Goal check' : '🔋 Evening check'}</h3>
      {!tc.followupOpen ? null : step === 'done' ? (
        <div className="snap-temp-done">
          <p role="status">
            <strong>{tc.private || !outcome ? `Answered ✓` : followupThanks(outcome, member.name)}</strong>
            {!tc.private && picked && <span className="snap-meta">{picked.emoji} {picked.label}: {tc.goal}{tc.followupHidden ? ' · 🔒 notes are private' : [tc.followup?.helped, tc.followup?.hindered, tc.followup?.next].some(Boolean) ? ' · notes saved' : ''}</span>}
          </p>
          {!tc.followupHidden && <button className="btn btn-secondary" onClick={() => { if (tc.private) setNotes(EMPTY); setStep('ask') }}>Change</button>}
        </div>
      ) : (
        <div className="snap-temp-q">
          <p className="snap-temp-ask">Did you finish your goal?</p>
          <p className="snap-goalcheck-goal">🎯 {tc.goal}</p>
          <div className="snap-goalcheck-choices" role="group" aria-label="Did you finish your goal?">
            {OUTCOMES.map(o => {
              const on = !tc.private && outcome === o.key
              return (
                <button key={o.key} className={`snap-temp-face ${on ? 'active' : ''}`} aria-pressed={on} onClick={() => save(o.key, false)}>
                  <span aria-hidden="true">{o.emoji}</span>{o.label}
                </button>
              )
            })}
          </div>
          {step === 'notes' && outcome && (
            <form className="snap-goalcheck-notes" onSubmit={e => { e.preventDefault(); save(outcome, true) }}>
              <p className="snap-dim">Want to add a note? <span>Any, all or none.</span></p>
              {NOTES.map(n => (
                <label key={n.key} className="snap-goalcheck-note">
                  <span>{n.label}</span>
                  <input type="text" maxLength={500} value={notes[n.key]} onChange={e => setNotes(v => ({ ...v, [n.key]: e.target.value }))} />
                </label>
              ))}
              <div className="snap-temp-row">
                <button type="button" className="btn btn-secondary" onClick={() => { setStep('done'); announce(followupThanks(outcome, member.name)); onSaved?.() }}>No notes</button>
                <button className="btn btn-primary">Save</button>
              </div>
            </form>
          )}
        </div>
      )}
      {tc.drainedOpen && (tc.answered.drained && !changeDrained ? (
        <div className="snap-temp-done">
          <p role="status">
            <strong>{felt ? `Thanks for checking in, ${member.name} ✓` : 'Skipped for today'}</strong>
            {felt && <span className="snap-meta">{felt.emoji} Feeling {felt.label.toLowerCase()}</span>}
          </p>
          <button className="btn btn-secondary" onClick={() => setChangeDrained(true)}>Change</button>
        </div>
      ) : (
        <div className="snap-temp-q">
          <p className="snap-temp-ask">How drained do you feel?</p>
          <div className="snap-goalcheck-choices snap-drained-choices" role="group" aria-label="How drained do you feel?">
            {DRAINED.map(d => {
              const on = tc.drained === d.key
              return (
                <button key={d.key} className={`snap-temp-face ${on ? 'active' : ''}`} aria-pressed={on} onClick={() => saveDrained(d.key)}>
                  <span aria-hidden="true">{d.emoji}</span>{d.label}
                </button>
              )
            })}
          </div>
          <div className="snap-temp-row">
            <button className="btn btn-secondary" onClick={() => saveDrained('skip')}>Skip</button>
          </div>
        </div>
      ))}
    </section>
  )
}
