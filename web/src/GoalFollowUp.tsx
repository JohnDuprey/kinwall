// The evening goal check (Temp check → Evening goal check): "Did you finish your goal?" from the
// person's chosen time until midnight, at the bottom of their Day view and at the top of their
// journal. Yes / Partly / Not today saves right away; then three optional notes when their journal
// keeps them. On a shared wall the server keeps the answer private (tc.private): once answered it
// says "Answered ✓", and "Change" starts fresh. Private notes (tc.followupHidden: written in their
// private journal, and this isn't their device) show the same way, with no "Change": only they can.
// With their energy battery on, the same card (or on its own, on a day without a goal) asks "How
// drained do you feel?": Full / OK / Low / Empty or Skip, which calibrates their battery. The server
// only opens that question on their own device or a parent's (drainedOpen), never on a shared wall.
// With `lastNight`, the same card for last night's check-in, after midnight while the server keeps it
// open (until noon, their morning Temp check or a skip): "🌙 Last night's check-in" with its date,
// answers saved to that day, and while something is unanswered "Finish last night's check-in?" with
// a Skip that closes it for good. It sits above the morning Temp check.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { announce } from './a11y.tsx'
import { followupThanks, OUTCOMES, outcomeOf } from './journal.ts'
import { DRAINED, drainedOf } from './battery.ts'
import { lastNightTitle } from './tempCheck.ts'
import type { Drained, FollowupOutcome, Member, TempCheck } from './types.ts'

const NOTES = [
  { key: 'helped', label: 'What helped?' },
  { key: 'hindered', label: 'What got in the way?' },
  { key: 'next', label: 'Next time I’ll…' },
] as const
type Notes = Record<(typeof NOTES)[number]['key'], string>
const EMPTY: Notes = { helped: '', hindered: '', next: '' }

export default function GoalFollowUp({ member, onSaved, lastNight }: { member: Member; onSaved?: () => void; lastNight?: boolean }) {
  const { toast } = useApp()
  const [tc, setTc] = useState<TempCheck | null>(null)
  const [night, setNight] = useState<{ date: string } | null>(null) // lastNight: which day
  const [step, setStep] = useState<'ask' | 'notes' | 'done'>('ask')
  const [notes, setNotes] = useState<Notes>(EMPTY)
  const [changeDrained, setChangeDrained] = useState(false)
  useEffect(() => {
    let canceled = false
    const load = async () => {
      if (!lastNight) return api.getTempCheck(member.id)
      const n = (await api.getTempCheck(member.id)).lastNight
      if (canceled || !n) return null
      setNight(n)
      return api.getTempCheck(member.id, n.date)
    }
    load().then(t => {
      if (canceled || !t) return
      setTc(t)
      if (t.followup) setNotes({ helped: t.followup.helped ?? '', hindered: t.followup.hindered ?? '', next: t.followup.next ?? '' })
      setStep(t.answered.followup ? 'done' : 'ask')
    }).catch(() => { /* no card rather than an error at the end of their day */ })
    return () => { canceled = true }
  }, [member.id, lastNight])
  if (!tc?.followupOpen && !tc?.drainedOpen) return null
  const date = night?.date
  const pending = (tc.followupOpen && !tc.answered.followup) || (!!tc.drainedOpen && !tc.answered.drained)

  const save = async (outcome: FollowupOutcome, withNotes: boolean) => {
    try {
      const t = await api.putTempCheck(member.id, { followup: { outcome, ...(withNotes ? notes : {}) } }, date)
      setTc(t)
      if (!withNotes && t.settings.journal && !t.private) { setStep('notes'); return }
      setStep('done'); announce(followupThanks(outcome, member.name)); onSaved?.()
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
  }
  const saveDrained = async (drained: Drained | 'skip') => {
    try {
      setTc(await api.putTempCheck(member.id, { drained }, date))
      setChangeDrained(false); announce(drained === 'skip' ? 'Skipped' : `Thanks for checking in, ${member.name} ✓`); onSaved?.()
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
  }
  const skipLastNight = async () => {
    try {
      setTc(await api.putTempCheck(member.id, { lastNightSkipped: true }, date))
      announce("Skipped last night's check-in"); onSaved?.()
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
  }
  const outcome = tc.followup?.outcome
  const picked = outcome && outcomeOf(outcome)
  const felt = drainedOf(tc.drained)

  return (
    <section className="snap-temp snap-goalcheck" aria-label={date ? "Last night's check-in" : tc.followupOpen ? 'Goal check' : 'Evening check'}>
      <h3 className="snap-heading">{date ? "🌙 Last night's check-in" : tc.followupOpen ? '🎯 Goal check' : '🔋 Evening check'}</h3>
      {date && <p className="snap-dim">{lastNightTitle(date)}{pending ? ' · Finish last night’s check-in?' : ''}</p>}
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
          {!date && (
            <div className="snap-temp-row">
              <button className="btn btn-secondary" onClick={() => saveDrained('skip')}>Skip</button>
            </div>
          )}
        </div>
      ))}
      {date && pending && (
        <div className="snap-temp-row">
          <button className="btn btn-secondary" onClick={skipLastNight}>Skip last night</button>
        </div>
      )}
    </section>
  )
}
