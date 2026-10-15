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
import { useDialog } from './dialog.tsx'
import { durationLabel } from './timers.ts'
import { formatDate, t, tc, tm, tn } from './i18n.ts'
import { NOT_NOW, daysText, praiseFor, pointsMax, pointsStart, rruleWeekdays, suggestionDetails, weekdaysRrule } from './choreSuggest.ts'

// A weekday's name in the current language (0 = Sunday): 2023-01-01 was a Sunday.
const dayName = (d: number, weekday: 'long' | 'short') => formatDate(new Date(2023, 0, 1 + d), { weekday })
const TIMERS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120]
const pts = (n: number) => tn(n, '{n} point', '{n} points')

/** The points control in every chore and reward sheet: − and + (by `step`), or type a number. */
export function PointsStepper({ value, max, onChange, label, min = 0, step = 1 }: { value: number; max: number; onChange: (n: number) => void; label: string; min?: number; step?: number }) {
  return (
    <div className="suggest-stepper" role="group" aria-label={label}>
      <button type="button" className="icon-btn" aria-label={tc('stepper', '{n} fewer', { n: step })} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}><MinusIcon width={20} height={20} /></button>
      <input className="stepper-value" type="text" inputMode="numeric" aria-label={label} value={value}
        onChange={e => onChange(Math.min(max, Number(e.target.value.replace(/\D/g, '')) || 0))} onBlur={() => { if (value < min) onChange(min) }} />
      <span aria-hidden="true">{tn(value, 'point', 'points')}</span>
      <button type="button" className="icon-btn" aria-label={tc('stepper', '{n} more', { n: step })} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}><PlusIcon width={20} height={20} /></button>
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
        <label id={`${idPrefix}-days`}>{t('Which days?')}</label>
        <div className="day-toggles" role="group" aria-labelledby={`${idPrefix}-days`}>
          {weekOrder.map(d => {
            const on = days.includes(d)
            return <button key={d} type="button" className={on ? 'active' : ''} aria-pressed={on} aria-label={dayName(d, 'long')} onClick={() => setDays(on ? days.filter(x => x !== d) : [...days, d])}>{dayName(d, 'short')}</button>
          })}
        </div>
        {!days.length && <p className="field-hint">{t('Pick at least one day.')}</p>}
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-time`}>{t('Start time (optional)')}</label>
        <div className="timer-custom-row">
          <input id={`${idPrefix}-time`} type="time" value={time} onChange={e => setTime(e.target.value)} />
          {time && <button type="button" className="btn btn-secondary" onClick={() => setTime('')}>{t('No start time')}</button>}
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-timer`}>{t('How long? (optional)')}</label>
        <select id={`${idPrefix}-timer`} value={timer ?? ''} onChange={e => setTimer(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t('No timer')}</option>
          {[...new Set([...TIMERS, ...(timer ? [timer] : [])])].sort((a, b) => a - b).map(m => <option key={m} value={m}>{durationLabel(m)}</option>)}
        </select>
        <p className="field-hint">{t('For things like practicing: tap the chore to start a timer this long.')}</p>
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
  const tomorrow = dateKey(new Date(Date.now() + 86_400_000))
  const [picking, setPicking] = useState(false) // "Pick a day": the date field
  const [sending, setSending] = useState(false)
  const ok = !!title.trim() && isSingleEmoji(emoji) && (!repeat || days.length > 0)

  const send = async () => {
    if (!ok || sending) return
    setSending(true)
    try {
      await api.suggestChore({ memberId, title: title.trim(), emoji, points: shown, done, dueDate: done ? undefined : day, rrule: repeat ? weekdaysRrule(days) : null, dueTime: time || null, timerMinutes: timer })
      const sent = t('Sent! A grown-up will take a look.')
      toast(sent); announce(sent)
      onSent()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("Couldn't send it. Try again."), true)
      setSending(false)
    }
  }

  return (
    <Sheet title={t('Suggest a chore')} onClose={onClose}
      actions={<div className="suggest-send">
        <button className="btn btn-primary" onClick={send} disabled={!ok || sending} aria-describedby={ok ? undefined : 'suggest-why'}>{t('Send to a grown-up')}</button>
        {!ok && <p id="suggest-why" className="field-hint">{!title.trim() ? t('Type your idea first.') : !isSingleEmoji(emoji) ? t('Pick an emoji.') : t('Pick at least one day.')}</p>}
      </div>}>
      {who && <p className="settings-row-sub" style={{ margin: '0 0 12px' }}>{t('An idea from {name}. A grown-up says yes or not this time.', { name: who.name })}</p>}
      <div className="field">
        <label htmlFor="suggest-title">{t("What's the chore?")}</label>
        <input id="suggest-title" type="text" maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder={t('Piano practice')} autoComplete="off" autoFocus />
      </div>
      <div className="field">
        <label>{t('Pick an emoji')}</label>
        <div className="emoji-swatch-row">
          {['⭐', '🎵', '📚', '🧹', '🐕', '🪴', '🍽️', '🧺', '🏃', '🎨'].map(e => (
            <button key={e} type="button" className={`emoji-swatch ${emoji === e ? 'active' : ''}`} aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>
          ))}
        </div>
        <AnyEmojiField value={emoji} onChange={setEmoji} />
      </div>
      <div className="field">
        <label id="suggest-points-label">{t("How many points do you think it's worth?")}</label>
        <PointsStepper value={shown} max={pointsMax(familyPoints)} onChange={setPoints} label={t("Points you think it's worth")} />
      </div>
      <div className="field suggest-checks">
        <label className="suggest-check"><input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} /> {t('Make it repeat')}</label>
        {repeat && <RepeatFields idPrefix="suggest" days={days} setDays={setDays} time={time} setTime={setTime} timer={timer} setTimer={setTimer} />}
        <label className="suggest-check"><input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)} /> {t('I already did it today')}</label>
        {done && <p className="field-hint">{t('A grown-up checks it, then the points count.')}</p>}
      </div>
      {!done && !repeat && (
        <div className="field">
          <label id="suggest-day-label">{t('Which day?')}</label>
          <div className="chip-row" role="group" aria-labelledby="suggest-day-label">
            {([[t('Today'), dateKey(new Date())], [t('Tomorrow'), tomorrow]] as const).map(([label, d]) => (
              <button key={d} type="button" className={`chip ${!picking && day === d ? 'active' : ''}`} aria-pressed={!picking && day === d} onClick={() => { setPicking(false); setDay(d) }}>{label}</button>
            ))}
            <button type="button" className={`chip ${picking ? 'active' : ''}`} aria-pressed={picking} onClick={() => setPicking(true)}>{t('Pick a day')}</button>
          </div>
          {picking && <input id="suggest-day" type="date" aria-label={t('Day')} value={day} min={dateKey(new Date())} onChange={e => setDay(e.target.value || dateKey(new Date()))} style={{ marginTop: 8 }} />}
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
  const dialog = useDialog()
  const [list, setList] = useState<ChoreSuggestion[]>([])
  const load = () => { api.getChoreSuggestions(memberId ?? undefined).then(setList).catch(() => { /* keep what's shown */ }) }
  useEffect(load, [memberId, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null
  const name = (id: string) => members.find(m => m.id === id)?.name ?? t('Someone')
  const dismiss = async (s: ChoreSuggestion) => {
    setList(l => l.filter(x => x !== s))
    try { await api.dismissSuggestion(s.id) } catch (e) { toast(e instanceof ApiError ? e.message : t("Couldn't put it away"), true); load() }
  }
  const takeBack = async (s: ChoreSuggestion) => {
    if (!await dialog.confirm({ title: t('Take back "{title}"?', { title: s.title }), body: t("It won't go to a grown-up."), confirmLabel: t('Take back'), cancelLabel: t('Keep it') })) return
    setList(l => l.filter(x => x !== s))
    try { await api.withdrawSuggestion(s.id); toast(t('Taken back: {title}', { title: s.title })) } catch (e) { toast(e instanceof ApiError ? e.message : t("Couldn't take it back"), true); load() }
  }
  return (
    <section className="approve-card suggest-cards" aria-labelledby="suggest-cards-heading">
      <h3 id="suggest-cards-heading" className="approve-heading">{t('Chore ideas')}</h3>
      <ul className="approve-list">
        {list.map(s => {
          const by = s.decidedByName ?? t('A grown-up')
          const whose = memberId ? '' : `${name(s.memberId)}: `
          const details = suggestionDetails(s)
          return (
            <li key={s.id} className={`approve-row suggest-row suggest-${s.status}`}>
              <span className="approve-emoji" aria-hidden="true">{s.status === 'approved' ? '🎉' : s.status === 'declined' ? '💬' : s.emoji ?? '💡'}</span>
              <div className="approve-info">
                {s.status === 'pending' && <>
                  <div className="approve-title">{whose}{s.title}</div>
                  <div className="approve-sub">{[t('You asked for {points}', { points: pts(s.points) }), details].filter(Boolean).join(' · ')}</div>
                  <div className="chore-waiting">⏳ {t('Waiting for a grown-up')}</div>
                </>}
                {s.status === 'approved' && <>
                  <div className="approve-title">{whose}{t('{by} said yes! {emoji} {title}', { by, emoji: s.emoji ?? '', title: s.title })}</div>
                  <div className="approve-sub">{[pts(s.pointsGiven ?? s.points), s.pointsGiven !== null && s.pointsGiven !== s.points && t('you asked for {n}', { n: s.points }), s.done ? t('counted for today') : t("it's on your chores now")].filter(Boolean).join(' · ')}</div>
                  {s.note && <div className="chore-notyet">“{s.note}”</div>}
                </>}
                {s.status === 'declined' && <>
                  <div className="approve-title">{whose}{t('Not this time: {title}', { title: s.title })}</div>
                  <div className="chore-notyet">{s.note ? t('{by}: “{note}”', { by, note: s.note }) : t('{by} said thanks for the idea.', { by })}</div>
                </>}
              </div>
              <div className="approve-actions">{s.status === 'pending'
                ? <button className="btn btn-secondary" onClick={() => takeBack(s)} aria-label={t('Take back: {title}', { title: s.title })}>{t('Take back')}</button>
                : <button className="btn btn-secondary" onClick={() => dismiss(s)} aria-label={t('Got it: {title}', { title: s.title })}>{t('Got it')}</button>}</div>
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
  const kid = members.find(m => m.id === s.memberId)?.name ?? t('Someone')
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
        onDone(t('Approved: {title} for {kid}, {points}', { title: s.title, kid, points: pts(points) }))
      } else {
        await api.declineSuggestion(s.id, note.trim() || undefined)
        onDone(t('Not this time: {title}. {kid} will see your note.', { title: s.title, kid }))
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('Could not answer it'), true)
      setBusy(false)
    }
  }
  const tapChip = (p: string) => setNote(n => (n.trim() ? `${n.trim()} ${p}` : p).slice(0, 200))

  return (
    <Sheet title={yes ? t("Say yes to {kid}'s idea", { kid }) : t('Not this time')} onClose={onClose}
      actions={<button className="btn btn-primary" onClick={go} disabled={busy || (yes && repeat && !customRule && !days.length)}>{yes ? (points === s.points ? t('Approve') : t('Approve at {points}', { points: pts(points) })) : t('Send not this time')}</button>}>
      <div className="suggest-ask">
        <span className="approve-emoji" aria-hidden="true">{s.emoji ?? '💡'}</span>
        <div>
          <div className="approve-title">{s.title}</div>
          <div className="approve-sub">{[t("{kid} thinks it's worth {points}", { kid, points: pts(s.points) }), suggestionDetails(s) || (s.dueDate === dateKey(new Date()) ? t('Today') : s.dueDate)].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      {yes && <>
        <div className="field">
          <label>{t('Points')}</label>
          <PointsStepper value={points} max={1000} onChange={setPoints} label={t('Points the chore is worth')} />
          {s.done && <p className="field-hint">{t('{kid} already did it today, so these points count now.', { kid })}</p>}
        </div>
        <div className="field suggest-checks">
          <label className="suggest-check"><input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} /> {t('Make it repeat')}</label>
          {repeat && customRule && <p className="field-hint">{t('Keeps its repeat ({days}).', { days: daysText(s.rrule) ?? '' })}</p>}
          {repeat && !customRule && <RepeatFields idPrefix="answer" days={days} setDays={setDays} time={time} setTime={setTime} timer={timer} setTimer={setTimer} />}
        </div>
      </>}
      <div className="field">
        <label htmlFor="answer-note">{t('A note to {kid} (optional)', { kid })}</label>
        <div className="chip-row suggest-praise">
          {(yes ? praiseFor(s) : NOT_NOW).map(p => <button key={p} type="button" className="chip" onClick={() => tapChip(tm(p))}>{tm(p)}</button>)}
        </div>
        <input id="answer-note" type="text" maxLength={200} value={note} onChange={e => setNote(e.target.value)} autoComplete="off"
          placeholder={yes ? t('Why the points, or a cheer') : t("Let's talk about it at dinner")} onKeyDown={e => { if (e.key === 'Enter') void go() }} />
      </div>
    </Sheet>
  )
}
