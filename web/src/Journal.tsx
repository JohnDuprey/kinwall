// A person's journal (#/journal/{memberId}): their days, newest first, with that day's Temp check and
// evening goal check, and their own entries (a few lines and a mood), the start of bullet journaling.
// Opens on their own device and parents' devices only; the server refuses everyone else (403), and
// this page says so kindly. A private journal (server: journal-privacy.ts) shows its words only on a
// device that belongs to them; others see each day's mood and a gentle "Private" instead, and a
// parent's device that belongs to no one can say "This is my device" to read its owner's own.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { todayKeyInTz } from './date.ts'
import { dayName } from './Snapshot.tsx'
import { SLEEP } from './tempCheck.ts'
import { JOURNAL_TEXT_MAX, MOODS, outcomeOf, privacyLine } from './journal.ts'
import GoalFollowUp from './GoalFollowUp.tsx'
import Sheet from './Sheet.tsx'
import type { Journal as JournalData, JournalDay, JournalEntry, Member } from './types.ts'
import { Face } from './Face'
import { msg, t, tm, tn } from './i18n.ts'

/** "Slept great": the Temp check's sleep answer read back (marked: tm()). */
const SLEPT: Record<string, string> = { great: msg('Slept great'), good: msg('Slept good'), ok: msg('Slept ok'), poorly: msg('Slept poorly'), terrible: msg('Slept terrible') }

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
      .catch(e => { if (!canceled) setError(e instanceof ApiError && e.status === 403 ? t("{name}'s journal is private. It opens on {name}'s own device and parents' devices.", { name: member.name }) : e instanceof ApiError ? e.message : t("Couldn't open this journal.")) })
    return () => { canceled = true }
  }, [member?.id, refreshTick, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!member) return <div className="state-card">{t('No one in the family yet.')}</div>
  const shown = data?.memberId === member.id ? data : null
  const privacy = shown?.privacy
  const locked = !!privacy?.on && !privacy.mine // a private journal on someone else's device: no new entries here
  const claim = parentDevice && !meMemberId && !!member.grownUp // a parent's device that belongs to no one yet
  const setPrivate = async (on: boolean) => {
    try { await api.setJournalPrivacy(member.id, { private: on }); toast(on ? t('Your journal is private') : t('Your journal is shared with parents')); setTick(x => x + 1); reloadCore() }
    catch (e) { toast(e instanceof ApiError ? e.message : t("Couldn't change that"), true) }
  }
  const claimDevice = async () => {
    try { await api.setMyOwner(member.id); toast(t("This device is {name}'s", { name: member.name })); reloadCore(); setTick(x => x + 1) }
    catch (e) { toast(e instanceof ApiError ? e.message : t("Couldn't change that"), true) }
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
          <Face m={member} className="profile-avatar" aria-hidden="true" />
          <div>
            <h2 className="profile-name">{t("{name}'s journal", { name: member.name })}</h2>
            <p className="profile-meta">{privacyLine(member, privacy)}</p>
          </div>
        </div>
        {!error && (
          <div className="profile-actions">
            <a className="btn btn-secondary" href={`#/insights/${member.id}`}>📈 {t('Insights')}</a>
            {!locked && <button className="btn btn-primary" onClick={() => setEditing('new')}>{t('+ New entry')}</button>}
          </div>
        )}
      </section>
      {error && <p className="snap-empty" role="alert">{error}</p>}
      {privacy?.canChange && (
        <div className="board-card journal-privacy toggle-row">
          <div>
            <label id="journal-private-label">{t('Private journal')}</label>
            <div className="settings-row-sub">{privacy.on ? t("Turn it off to share new entries with parent devices. What you wrote while it's private stays private.") : t('Parent devices can read new entries. Turn it on to keep them to yourself.')}</div>
          </div>
          <button className={`switch ${privacy.on ? 'on' : ''}`} role="switch" aria-checked={privacy.on} aria-labelledby="journal-private-label" onClick={() => setPrivate(!privacy.on)}><span className="knob" /></button>
        </div>
      )}
      {shown && claim && (
        <div className="board-card journal-privacy">
          <p className="settings-row-sub">{t("Is this {name}'s phone or computer? Say so to read {name}'s private entries here.", { name: member.name })}</p>
          <button className="btn btn-secondary" onClick={claimDevice}>{t("This is {name}'s device", { name: member.name })}</button>
        </div>
      )}
      {!error && member.tempCheck?.on && <GoalFollowUp key={`last:${member.id}:${tick}`} member={member} lastNight onSaved={() => setTick(x => x + 1)} />}
      {!error && member.tempCheck?.on && <GoalFollowUp key={`${member.id}:${tick}`} member={member} onSaved={() => setTick(x => x + 1)} />}
      {!shown && !error && <p className="snap-empty">{t('Loading…')}</p>}
      {shown && shown.days.length === 0 && <p className="snap-empty">{t('Nothing here yet. Tap “+ New entry” to write about your day.')}</p>}
      {shown && (
        <ol className="journal-days">
          {shown.days.map(d => <Day key={d.date} day={d} today={today} onEdit={setEditing} />)}
        </ol>
      )}
      {shown && shown.days.length > 0 && <button className="btn btn-secondary journal-more" onClick={earlier}>{t('Show earlier')}</button>}
      {editing && <EntrySheet member={member} entry={editing === 'new' ? null : editing} today={today} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setTick(x => x + 1) }} />}
    </div>
  )
}

function Day({ day, today, onEdit }: { day: JournalDay; today: string; onEdit: (e: JournalEntry) => void }) {
  const check = day.tempCheck
  const sleep = check?.sleep ? SLEEP.find(s => s.key === check.sleep) : undefined
  const f = check?.followup
  const notes = f && [[t('Helped'), f.helped], [t('In the way'), f.hindered], [t('Next time'), f.next]].filter(([, v]) => v) as [string, string][]
  return (
    <li className="board-card journal-day">
      <h3 className="snap-heading">{day.date === today ? t('Today') : dayName(day.date, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
      {check && (sleep || check.feelings?.length) && (
        <p className="journal-line">{[sleep && `${sleep.emoji} ${tm(SLEPT[sleep.key])}`, check.feelings?.length && t('Feeling {list}', { list: check.feelings.join(', ') })].filter(Boolean).join(' · ')}</p>
      )}
      {check?.goal && (
        <div className="journal-goal">
          <p className="journal-line"><strong>🎯 {check.goal}</strong>{f && <span className={`journal-outcome journal-outcome-${f.outcome}`}>{outcomeOf(f.outcome).emoji} {tm(outcomeOf(f.outcome).label)}</span>}</p>
          {notes && notes.length > 0 && <ul className="journal-notes">{notes.map(([k, v]) => <li key={k}><span>{t('{label}:', { label: k })}</span> {v}</li>)}</ul>}
          {check.followupHidden && <p className="journal-private">{t('🔒 Notes are private')}</p>}
        </div>
      )}
      {day.entries.map(e => e.text === null ? (
        <div key={e.id} className="journal-entry journal-entry-private">
          {e.mood && <span className="journal-mood" role="img" aria-label={t('Mood {mood}', { mood: e.mood })}>{e.mood}</span>}
          <span className="journal-private">{t('🔒 Private entry')}</span>
        </div>
      ) : (
        <button key={e.id} className="journal-entry" onClick={() => onEdit(e)} aria-label={t('Edit entry: {text}', { text: e.text.slice(0, 60) })}>
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
      toast(t('Saved to the journal'))
      onSaved()
    } catch (e) { toast(e instanceof ApiError ? e.message : t("Couldn't save that"), true) }
  }
  const more = async (action: string) => {
    if (action !== 'delete' || !entry) return
    try { await api.deleteJournalEntry(member.id, entry.id); toast(t('Entry deleted')); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : t("Couldn't delete that"), true) }
  }
  return (
    <Sheet title={entry ? t('Edit entry') : t('New entry')} onClose={onClose}
      actions={<>
        {entry && <select className="settings-select" aria-label={t('More')} value="" onChange={e => more(e.target.value)}><option value="">{t('More…')}</option><option value="delete">{t('Delete entry')}</option></select>}
        <button className="btn btn-primary" onClick={save} disabled={!text.trim()}>{t('Save')}</button>
      </>}>
      <div className="field">
        <label htmlFor="journal-text">{t('What happened?')}</label>
        <textarea id="journal-text" rows={6} maxLength={JOURNAL_TEXT_MAX} value={text} onChange={e => setText(e.target.value)} placeholder={t('A memory, a thought, something to remember')} />
        <p className="field-hint">{tn(JOURNAL_TEXT_MAX - text.length, '{n} character left', '{n} characters left')}</p>
      </div>
      <div className="field">
        <label htmlFor="journal-mood">{t('Mood')} <span className="settings-row-sub">{t('(optional)')}</span></label>
        <select id="journal-mood" className="settings-select" value={mood} onChange={e => setMood(e.target.value)}>
          <option value="">{t('None')}</option>
          {[...new Set([...MOODS, ...(mood ? [mood] : [])])].map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="journal-date">{t('Day')}</label>
        <input id="journal-date" type="date" value={date} max={today} onChange={e => setDate(e.target.value || today)} />
      </div>
    </Sheet>
  )
}
