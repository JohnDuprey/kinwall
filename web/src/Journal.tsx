// A person's journal (#/journal/{memberId}): their days, newest first, with that day's Temp check and
// evening goal check, and their own entries (a few lines and a mood), the start of bullet journaling.
// Opens on their own device and parents' devices only; the server refuses everyone else (403), and
// this page says so kindly.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { inkFor } from './color.ts'
import { todayKeyInTz } from './date.ts'
import { dayName } from './Snapshot.tsx'
import { SLEEP } from './tempCheck.ts'
import { JOURNAL_TEXT_MAX, MOODS, outcomeOf } from './journal.ts'
import GoalFollowUp from './GoalFollowUp.tsx'
import Sheet from './Sheet.tsx'
import type { Journal as JournalData, JournalDay, JournalEntry, Member } from './types.ts'

const PAGE_DAYS = 60
const dayBefore = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

export default function Journal({ memberId }: { memberId?: string }) {
  const { members, meMemberId, settings, refreshTick } = useApp()
  const member = members.find(m => m.id === memberId) ?? members.find(m => m.id === meMemberId)
  const [data, setData] = useState<JournalData | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<JournalEntry | 'new' | null>(null)
  const [tick, setTick] = useState(0)
  const today = todayKeyInTz(settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)

  useEffect(() => {
    if (!member) return
    let canceled = false
    api.getJournal(member.id, { days: PAGE_DAYS })
      .then(j => { if (!canceled) { setData(j); setError('') } })
      .catch(e => { if (!canceled) setError(e instanceof ApiError && e.status === 403 ? `${member.name}'s journal is private. It opens on ${member.name}'s own device and parents' devices.` : e instanceof ApiError ? e.message : "Couldn't open this journal.") })
    return () => { canceled = true }
  }, [member?.id, refreshTick, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!member) return <div className="state-card">No one in the family yet.</div>
  const shown = data?.memberId === member.id ? data : null
  const earlier = async () => {
    if (!shown) return
    try {
      const more = await api.getJournal(member.id, { to: dayBefore(shown.from), days: PAGE_DAYS })
      setData({ ...shown, from: more.from, days: [...shown.days, ...more.days] })
    } catch { /* keep what's shown */ }
  }

  return (
    <div className="profile profile-narrow journal scroll-y" style={{ ['--m' as string]: member.color }}>
      <section className="profile-top">
        <div className="profile-hero">
          <span className="profile-avatar" style={{ background: member.color, color: inkFor(member.color) }} aria-hidden="true">{member.avatar || member.name[0]}</span>
          <div>
            <h2 className="profile-name">{member.name}'s journal</h2>
            <p className="profile-meta">🔒 {member.grownUp ? `Private to ${member.name}'s own devices and parent devices.` : `Just for ${member.name}, and parents can see it too.`}</p>
          </div>
        </div>
        {!error && (
          <div className="profile-actions">
            <a className="btn btn-secondary" href={`#/insights/${member.id}`}>📈 Insights</a>
            <button className="btn btn-primary" onClick={() => setEditing('new')}>+ New entry</button>
          </div>
        )}
      </section>
      {error && <p className="snap-empty" role="alert">{error}</p>}
      {!error && member.tempCheck?.on && <GoalFollowUp key={`${member.id}:${tick}`} member={member} onSaved={() => setTick(t => t + 1)} />}
      {!shown && !error && <p className="snap-empty">Loading…</p>}
      {shown && shown.days.length === 0 && <p className="snap-empty">Nothing here yet. Tap <strong>+ New entry</strong> to write about your day.</p>}
      {shown && (
        <ol className="journal-days">
          {shown.days.map(d => <Day key={d.date} day={d} today={today} onEdit={setEditing} />)}
        </ol>
      )}
      {shown && shown.days.length > 0 && <button className="btn btn-secondary journal-more" onClick={earlier}>Show earlier</button>}
      {editing && <EntrySheet member={member} entry={editing === 'new' ? null : editing} today={today} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setTick(t => t + 1) }} />}
    </div>
  )
}

function Day({ day, today, onEdit }: { day: JournalDay; today: string; onEdit: (e: JournalEntry) => void }) {
  const t = day.tempCheck
  const sleep = t?.sleep ? SLEEP.find(s => s.key === t.sleep) : undefined
  const f = t?.followup
  const notes = f && [['Helped', f.helped], ['In the way', f.hindered], ['Next time', f.next]].filter(([, v]) => v) as [string, string][]
  return (
    <li className="board-card journal-day">
      <h3 className="snap-heading">{day.date === today ? 'Today' : dayName(day.date, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
      {t && (sleep || t.feelings?.length) && (
        <p className="journal-line">{[sleep && `${sleep.emoji} Slept ${sleep.label.toLowerCase()}`, t.feelings?.length && `Feeling ${t.feelings.join(', ')}`].filter(Boolean).join(' · ')}</p>
      )}
      {t?.goal && (
        <div className="journal-goal">
          <p className="journal-line"><strong>🎯 {t.goal}</strong>{f && <span className={`journal-outcome journal-outcome-${f.outcome}`}>{outcomeOf(f.outcome).emoji} {outcomeOf(f.outcome).label}</span>}</p>
          {notes && notes.length > 0 && <ul className="journal-notes">{notes.map(([k, v]) => <li key={k}><span>{k}:</span> {v}</li>)}</ul>}
        </div>
      )}
      {day.entries.map(e => (
        <button key={e.id} className="journal-entry" onClick={() => onEdit(e)} aria-label={`Edit entry: ${e.text.slice(0, 60)}`}>
          {e.mood && <span className="journal-mood" aria-hidden="true">{e.mood}</span>}
          <span className="journal-text">{e.text}</span>
        </button>
      ))}
    </li>
  )
}

function EntrySheet({ member, entry, today, onClose, onSaved }: { member: Member; entry: JournalEntry | null; today: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp()
  const [date, setDate] = useState(entry?.date ?? today)
  const [text, setText] = useState(entry?.text ?? '')
  const [mood, setMood] = useState(entry?.mood ?? '')
  const save = async () => {
    try {
      const body = { date, text: text.trim(), mood: mood || null }
      if (entry) await api.updateJournalEntry(member.id, entry.id, body)
      else await api.addJournalEntry(member.id, body)
      toast('Saved to the journal')
      onSaved()
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
  }
  const more = async (action: string) => {
    if (action !== 'delete' || !entry) return
    try { await api.deleteJournalEntry(member.id, entry.id); toast('Entry deleted'); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't delete that", true) }
  }
  return (
    <Sheet title={entry ? 'Edit entry' : 'New entry'} onClose={onClose}
      actions={<>
        {entry && <select className="settings-select" aria-label="More" value="" onChange={e => more(e.target.value)}><option value="">More…</option><option value="delete">Delete entry</option></select>}
        <button className="btn btn-primary" onClick={save} disabled={!text.trim()}>Save</button>
      </>}>
      <div className="field">
        <label htmlFor="journal-text">What happened?</label>
        <textarea id="journal-text" rows={6} maxLength={JOURNAL_TEXT_MAX} value={text} onChange={e => setText(e.target.value)} placeholder="A memory, a thought, something to remember" />
        <p className="field-hint">{JOURNAL_TEXT_MAX - text.length} characters left</p>
      </div>
      <div className="field">
        <label htmlFor="journal-mood">Mood <span className="settings-row-sub">(optional)</span></label>
        <select id="journal-mood" className="settings-select" value={mood} onChange={e => setMood(e.target.value)}>
          <option value="">None</option>
          {[...new Set([...MOODS, ...(mood ? [mood] : [])])].map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="journal-date">Day</label>
        <input id="journal-date" type="date" value={date} max={today} onChange={e => setDate(e.target.value || today)} />
      </div>
    </Sheet>
  )
}
