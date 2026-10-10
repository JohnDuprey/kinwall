// Kids suggest chores (server: routes/chore-suggestions.ts). A kid's own device, or a wall after
// picking who, sends an idea with the points they think it's worth; it waits on their Chores screen
// until a parent says yes (maybe with other points or a changed schedule) or "Not this time", with a
// note either way, and the answer stays there as a card until the kid puts it away.
import { useEffect, useState } from 'react'
import { useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import type { ChoreSuggestion } from './types.ts'
import { dateKey } from './date.ts'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isSingleEmoji } from './emoji.ts'
import { MinusIcon, PlusIcon } from './icons.tsx'
import { announce } from './a11y.tsx'
import { durationLabel } from './timers.ts'
import { PRAISE, daysText, pointsMax, pointsStart, rruleWeekdays, suggestionDetails, weekdaysRrule } from './choreSuggest.ts'

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const TIMERS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120]
const pts = (n: number) => `${n} point${n === 1 ? '' : 's'}`

function PointsStepper({ value, max, onChange, label }: { value: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="suggest-stepper" role="group" aria-label={label}>
      <button type="button" className="icon-btn" aria-label="Fewer points" disabled={value <= 0} onClick={() => onChange(Math.max(0, value - 1))}><MinusIcon width={20} height={20} /></button>
      <span aria-live="polite">{pts(value)}</span>
      <button type="button" className="icon-btn" aria-label="More points" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><PlusIcon width={20} height={20} /></button>
    </div>
  )
}

/** The chore form's repeat days, start time and timer, for a suggestion. */
function RepeatFields({ days, setDays, time, setTime, timer, setTimer, idPrefix }: {
  days: number[]; setDays: (d: number[]) => void; time: string; setTime: (t: string) => void; timer: number | null; setTimer: (m: number | null) => void; idPrefix: string
}) {
  const { settings } = useApp()
  const weekOrder = Array.from({ length: 7 }, (_, i) => (i + settings.weekStart) % 7)
  return (
    <>
      <div className="field">
        <label id={`${idPrefix}-days`}>Which days?</label>
        <div className="day-toggles" role="group" aria-labelledby={`${idPrefix}-days`}>
          {weekOrder.map(d => {
            const on = days.includes(d)
            return <button key={d} type="button" className={on ? 'active' : ''} aria-pressed={on} aria-label={DAY_LONG[d]} onClick={() => setDays(on ? days.filter(x => x !== d) : [...days, d])}>{DAY_SHORT[d][0]}</button>
          })}
        </div>
        {!days.length && <p className="field-hint">Pick at least one day.</p>}
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-time`}>Start time (optional)</label>
        <div className="timer-custom-row">
          <input id={`${idPrefix}-time`} type="time" value={time} onChange={e => setTime(e.target.value)} />
          {time && <button type="button" className="btn btn-secondary" onClick={() => setTime('')}>No start time</button>}
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-timer`}>How long? (optional)</label>
        <select id={`${idPrefix}-timer`} value={timer ?? ''} onChange={e => setTimer(e.target.value ? Number(e.target.value) : null)}>
          <option value="">No timer</option>
          {[...new Set([...TIMERS, ...(timer ? [timer] : [])])].sort((a, b) => a - b).map(m => <option key={m} value={m}>{durationLabel(m)}</option>)}
        </select>
        <p className="field-hint">For things like practicing: tap the chore to start a timer this long.</p>
      </div>
    </>
  )
}

/** A kid's "Suggest a chore" sheet. */
export function SuggestChoreSheet({ memberId, onClose, onSent }: { memberId: string; onClose: () => void; onSent: () => void }) {
  const { members, toast } = useApp()
  const who = members.find(m => m.id === memberId)
  const [familyPoints, setFamilyPoints] = useState<number[]>([])
  useEffect(() => { api.getChoresDay(dateKey(new Date())).then(cs => setFamilyPoints(cs.map(c => c.points))).catch(() => { /* the stepper keeps its defaults */ }) }, [])
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState('⭐')
  const [points, setPoints] = useState<number | null>(null) // null: not touched, follows the family's usual
  const shown = points ?? pointsStart(familyPoints)
  const [repeat, setRepeat] = useState(false)
  const [days, setDays] = useState<number[]>(() => [new Date().getDay()])
  const [time, setTime] = useState('')
  const [timer, setTimer] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const [day, setDay] = useState(() => dateKey(new Date()))
  const [sending, setSending] = useState(false)
  const ok = !!title.trim() && isSingleEmoji(emoji) && (!repeat || days.length > 0)

  const send = async () => {
    if (!ok || sending) return
    setSending(true)
    try {
      await api.suggestChore({ memberId, title: title.trim(), emoji, points: shown, done, dueDate: done ? undefined : day, rrule: repeat ? weekdaysRrule(days) : null, dueTime: time || null, timerMinutes: timer })
      const msg = 'Sent! A grown-up will take a look.'
      toast(msg); announce(msg)
      onSent()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't send it. Try again.", true)
      setSending(false)
    }
  }

  return (
    <Sheet title="Suggest a chore" onClose={onClose}
      actions={<button className="btn btn-primary" onClick={send} disabled={!ok || sending}>Send to a grown-up</button>}>
      {who && <p className="settings-row-sub" style={{ margin: '0 0 12px' }}>An idea from {who.name}. A grown-up says yes or not this time.</p>}
      <div className="field">
        <label htmlFor="suggest-title">What's the chore?</label>
        <input id="suggest-title" type="text" maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder="Flute practice" autoComplete="off" autoFocus />
      </div>
      <div className="field">
        <label>Pick an emoji</label>
        <div className="emoji-swatch-row">
          {['⭐', '🎵', '📚', '🧹', '🐕', '🪴', '🍽️', '🧺', '🏃', '🎨'].map(e => (
            <button key={e} type="button" className={`emoji-swatch ${emoji === e ? 'active' : ''}`} aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>
          ))}
        </div>
        <AnyEmojiField value={emoji} onChange={setEmoji} />
      </div>
      <div className="field">
        <label id="suggest-points-label">How many points do you think it's worth?</label>
        <PointsStepper value={shown} max={pointsMax(familyPoints)} onChange={setPoints} label="Points you think it's worth" />
      </div>
      <div className="field suggest-checks">
        <label className="suggest-check"><input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} /> Make it repeat</label>
        {repeat && <RepeatFields idPrefix="suggest" days={days} setDays={setDays} time={time} setTime={setTime} timer={timer} setTimer={setTimer} />}
        <label className="suggest-check"><input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)} /> I already did it today</label>
        {done && <p className="field-hint">A grown-up checks it, then the points count.</p>}
      </div>
      {!done && !repeat && (
        <div className="field">
          <label htmlFor="suggest-day">Which day?</label>
          <input id="suggest-day" type="date" value={day} min={dateKey(new Date())} onChange={e => setDay(e.target.value || dateKey(new Date()))} />
        </div>
      )}
    </Sheet>
  )
}

/** The kid's own view: ideas waiting for a grown-up, and the answers until they're put away.
 * `memberId` shows one person's (their device, or a wall filtered to them); without it a wall
 * shows everyone's, named. */
export function SuggestionCards({ memberId }: { memberId: string | null }) {
  const { members, refreshTick, toast } = useApp()
  const [list, setList] = useState<ChoreSuggestion[]>([])
  const load = () => { api.getChoreSuggestions(memberId ?? undefined).then(setList).catch(() => { /* keep what's shown */ }) }
  useEffect(load, [memberId, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null
  const name = (id: string) => members.find(m => m.id === id)?.name ?? 'Someone'
  const dismiss = async (s: ChoreSuggestion) => {
    setList(l => l.filter(x => x !== s))
    try { await api.dismissSuggestion(s.id) } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't put it away", true); load() }
  }
  return (
    <section className="approve-card suggest-cards" aria-labelledby="suggest-cards-heading">
      <h3 id="suggest-cards-heading" className="approve-heading">Chore ideas</h3>
      <ul className="approve-list">
        {list.map(s => {
          const by = s.decidedByName ?? 'A grown-up'
          const whose = memberId ? '' : `${name(s.memberId)}: `
          const details = suggestionDetails(s)
          return (
            <li key={s.id} className={`approve-row suggest-row suggest-${s.status}`}>
              <span className="approve-emoji" aria-hidden="true">{s.status === 'approved' ? '🎉' : s.status === 'declined' ? '💬' : s.emoji ?? '💡'}</span>
              <div className="approve-info">
                {s.status === 'pending' && <>
                  <div className="approve-title">{whose}{s.title}</div>
                  <div className="approve-sub">{[`You asked for ${pts(s.points)}`, details].filter(Boolean).join(' · ')}</div>
                  <div className="chore-waiting">⏳ Waiting for a grown-up</div>
                </>}
                {s.status === 'approved' && <>
                  <div className="approve-title">{whose}{by} said yes! {s.emoji} {s.title}</div>
                  <div className="approve-sub">{[pts(s.pointsGiven ?? s.points), s.pointsGiven !== null && s.pointsGiven !== s.points && `you asked for ${s.points}`, s.done ? 'counted for today' : "it's on your chores now"].filter(Boolean).join(' · ')}</div>
                  {s.note && <div className="chore-notyet">“{s.note}”</div>}
                </>}
                {s.status === 'declined' && <>
                  <div className="approve-title">{whose}Not this time: {s.title}</div>
                  <div className="chore-notyet">{s.note ? `${by}: “${s.note}”` : `${by} said thanks for the idea.`}</div>
                </>}
              </div>
              {s.status !== 'pending' && <div className="approve-actions"><button className="btn btn-secondary" onClick={() => dismiss(s)} aria-label={`Got it: ${s.title}`}>Got it</button></div>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** A parent's answer: yes (as asked or changed) or not this time, with a note. */
export function SuggestionAnswerSheet({ s, mode, onClose, onDone }: { s: ChoreSuggestion; mode: 'yes' | 'no'; onClose: () => void; onDone: (msg: string) => void }) {
  const { members, toast } = useApp()
  const kid = members.find(m => m.id === s.memberId)?.name ?? 'Someone'
  const [points, setPoints] = useState(s.points)
  const [repeat, setRepeat] = useState(!!s.rrule)
  const [days, setDays] = useState<number[]>(() => { const d = rruleWeekdays(s.rrule); return d.length ? d : [new Date().getDay()] })
  const [time, setTime] = useState(s.dueTime ?? '')
  const [timer, setTimer] = useState<number | null>(s.timerMinutes)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // A repeat the day buttons can't show (sent through the API) is kept as it is unless it's turned off.
  const customRule = !!s.rrule && !rruleWeekdays(s.rrule).length
  const yes = mode === 'yes'

  const go = async () => {
    if (busy || (yes && repeat && !customRule && !days.length)) return
    setBusy(true)
    try {
      if (yes) {
        await api.approveSuggestion(s.id, { points, rrule: repeat ? (customRule ? s.rrule : weekdaysRrule(days)) : null, dueTime: time || null, timerMinutes: timer, note: note.trim() || undefined })
        onDone(`Approved: ${s.title} for ${kid}, ${pts(points)}`)
      } else {
        await api.declineSuggestion(s.id, note.trim() || undefined)
        onDone(`Not this time: ${s.title}. ${kid} will see your note.`)
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not answer it', true)
      setBusy(false)
    }
  }
  const tapChip = (p: string) => setNote(n => (n.trim() ? `${n.trim()} ${p}` : p).slice(0, 200))

  return (
    <Sheet title={yes ? `Say yes to ${kid}'s idea` : 'Not this time'} onClose={onClose}
      actions={<button className="btn btn-primary" onClick={go} disabled={busy || (yes && repeat && !customRule && !days.length)}>{yes ? (points === s.points ? 'Approve' : `Approve at ${pts(points)}`) : 'Send not this time'}</button>}>
      <div className="suggest-ask">
        <span className="approve-emoji" aria-hidden="true">{s.emoji ?? '💡'}</span>
        <div>
          <div className="approve-title">{s.title}</div>
          <div className="approve-sub">{[`${kid} thinks it's worth ${pts(s.points)}`, suggestionDetails(s) || (s.dueDate === dateKey(new Date()) ? 'Today' : s.dueDate)].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      {yes && <>
        <div className="field">
          <label>Points</label>
          <PointsStepper value={points} max={1000} onChange={setPoints} label="Points the chore is worth" />
          {s.done && <p className="field-hint">{kid} already did it today, so these points count now.</p>}
        </div>
        <div className="field suggest-checks">
          <label className="suggest-check"><input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} /> Repeats</label>
          {repeat && customRule && <p className="field-hint">Keeps its repeat ({daysText(s.rrule)}).</p>}
          {repeat && !customRule && <RepeatFields idPrefix="answer" days={days} setDays={setDays} time={time} setTime={setTime} timer={timer} setTimer={setTimer} />}
        </div>
      </>}
      <div className="field">
        <label htmlFor="answer-note">A note to {kid} (optional)</label>
        <div className="chip-row suggest-praise">
          {PRAISE.map(p => <button key={p} type="button" className="chip" onClick={() => tapChip(p)}>{p}</button>)}
        </div>
        <input id="answer-note" type="text" maxLength={200} value={note} onChange={e => setNote(e.target.value)} autoComplete="off"
          placeholder={yes ? 'Why the points, or a cheer' : "Let's talk about it at dinner"} onKeyDown={e => { if (e.key === 'Enter') void go() }} />
      </div>
    </Sheet>
  )
}
