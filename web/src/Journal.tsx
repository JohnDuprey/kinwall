// A person's journal (#/journal/{memberId}): their days, newest first, with that day's Temp check and
// evening goal check, and their own entries (a few lines and a mood), the start of bullet journaling.
// Opens on their own device and parents' devices only; the server refuses everyone else (403), and
// this page says so kindly. A private journal (server: journal-privacy.ts) shows its words only on a
// device that belongs to them; others see each day's mood and a gentle "Private" instead, and a
// parent's device that belongs to no one can say "This is my device" to read its owner's own.
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
import type { Journal as JournalData, JournalDay, JournalEntry, JournalPrivacy, Member } from './types.ts'

const PAGE_DAYS = 60
const dayBefore = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

export default function Journal({ memberId }: { memberId?: string }) {
  const { members, meMemberId, parentDevice, settings, refreshTick, reloadCore, toast } = useApp()
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
  const privacy = shown?.privacy
  const locked = !!privacy?.on && !privacy.mine // a private journal on someone else's device: no new entries here
  const claim = parentDevice && !meMemberId && !!member.grownUp // a parent's device that belongs to no one yet
  const setPrivate = async (on: boolean) => {
    try { await api.setJournalPrivacy(member.id, { private: on }); toast(on ? 'Your journal is private' : 'Your journal is shared with parents'); setTick(t => t + 1); reloadCore() }
    catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't change that", true) }
  }
  const claimDevice = async () => {
    try { await api.setMyOwner(member.id); toast(`This device is ${member.name}'s`); reloadCore(); setTick(t => t + 1) }
    catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't change that", true) }
  }
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
            <p className="profile-meta">{privacyLine(member, privacy)}</p>
          </div>
        </div>
        {!error && (
          <div className="profile-actions">
            <a className="btn btn-secondary" href={`#/insights/${member.id}`}>📈 Insights</a>
            {!locked && <button className="btn btn-primary" onClick={() => setEditing('new')}>+ New entry</button>}
          </div>
        )}
      </section>
      {error && <p className="snap-empty" role="alert">{error}</p>}
      {privacy?.canChange && (
        <div className="board-card journal-privacy toggle-row">
          <div>
            <label id="journal-private-label">Private journal</label>
            <div className="settings-row-sub">{privacy.on ? "Turn it off to share new entries with parent devices. What you wrote while it's private stays private." : 'Parent devices can read new entries. Turn it on to keep them to yourself.'}</div>
          </div>
          <button className={`switch ${privacy.on ? 'on' : ''}`} role="switch" aria-checked={privacy.on} aria-labelledby="journal-private-label" onClick={() => setPrivate(!privacy.on)}><span className="knob" /></button>
        </div>
      )}
      {shown && claim && (
        <div className="board-card journal-privacy">
          <p className="settings-row-sub">Is this {member.name}'s phone or computer? Say so to read {member.name}'s private entries here.</p>
          <button className="btn btn-secondary" onClick={claimDevice}>This is {member.name}'s device</button>
        </div>
      )}
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

/** The line under their name: who reads this journal, from this device's point of view. */
function privacyLine(member: Member, p: JournalPrivacy | undefined): string {
  if (!p) return '🔒'
  if (p.on && p.mine) return '🔒 Private: only you can read these. Parents see your mood, not what you write.'
  if (p.on) return `🔒 Private: only ${member.name} can read these. You see ${member.name}'s mood, not what they write.`
  if (p.mine) return member.grownUp ? 'Shared: parent devices can read your journal.' : 'Just for you, and parents can see it too.'
  return member.grownUp ? `${member.name}'s own devices and parent devices can read this.` : `Just for ${member.name}, and parents can see it too.`
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
          {t.followupHidden && <p className="journal-private">🔒 Notes are private</p>}
        </div>
      )}
      {day.entries.map(e => e.text === null ? (
        <div key={e.id} className="journal-entry journal-entry-private">
          {e.mood && <span className="journal-mood" role="img" aria-label={`Mood ${e.mood}`}>{e.mood}</span>}
          <span className="journal-private">🔒 Private entry</span>
        </div>
      ) : (
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
