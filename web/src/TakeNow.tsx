// "Take now": a card for each medicine dose that's due (from its time, or when the person's day started,
// until it's taken, skipped or its late window closes; a snooze hides it for 10 minutes). In a person's Day view and on their medications page;
// on the Board it's one of the count tiles (TakeNowTile), which opens the list in a sheet. The server decides what this device may see: a shared wall gets
// everyone's doses as "Meds" unless the family turned names on, a person's own device only theirs.
import { useEffect, useState } from 'react'
import { api, ApiError, PUSH_SUB_ID_KEY } from './api.ts'
import { useApp } from './AppContext.tsx'
import { announce } from './a11y.tsx'
import { inkFor } from './color.ts'
import { askWhenTaken, cardLabel, cheerLine, doseTimeLabel, earlierInput, pickedTime } from './medications.ts'
import { formatTime } from './timeFormat.ts'
import { todayKeyInTz } from './date.ts'
import { medicationActivity } from './liveActivity.ts'
import { appMedicineNames, endAppActivity, MED_NAMES_EVENT, tellAppActivity } from './native.ts'
import { Confetti } from './Chores.tsx'
import Sheet from './Sheet.tsx'
import { PillIcon } from './icons.tsx'
import type { DueDose, MedicationsDue } from './types.ts'

const RECHECK_MS = 60_000 // a dose shows up at its time without waiting for the next refresh

// The board's tile and the phone app's Live Activity both ask, at the same moments (a refresh, the
// top of each minute): they share one request.
let dueRequest: Promise<MedicationsDue> | null = null
const fetchDue = () => (dueRequest ??= api.getMedicationsDue().finally(() => { dueRequest = null }))

/** Today's due doses for this device, refetched on each refresh and at the top of every minute
 * while the screen is showing. The Board uses it to know whether to show its Take now tile; `drop`
 * removes a dose once it's marked. */
export function useDueDoses() {
  const { settings, refreshTick } = useApp()
  const [due, setDue] = useState<MedicationsDue | null>(null)
  const [tick, setTick] = useState(0)
  const on = settings.medications
  useEffect(() => {
    if (!on) return
    let canceled = false
    fetchDue().then(d => { if (!canceled) setDue(d) }).catch(() => { if (!canceled) setDue(null) }) // no card rather than an error
    return () => { canceled = true }
  }, [on, refreshTick, tick])
  useEffect(() => {
    if (!on) return
    let t: ReturnType<typeof setTimeout>
    const next = () => { t = setTimeout(() => { if (document.visibilityState !== 'hidden') setTick(x => x + 1); next() }, RECHECK_MS - Date.now() % RECHECK_MS) }
    const onVis = () => { if (document.visibilityState === 'visible') setTick(x => x + 1) }
    next()
    document.addEventListener('visibilitychange', onVis)
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onVis) }
  }, [on])
  const drop = (d: DueDose) => setDue(x => x && { ...x, doses: x.doses.filter(y => key(y) !== key(d)) })
  return { doses: on && due ? due.doses : [], drop }
}
type Due = ReturnType<typeof useDueDoses>

/** Inside the phone app: this device's person's dose that's due, as a Live Activity with Taken and
 * Snooze (liveActivity.ts medicationActivity). Only the person's own doses, so it shows on their own
 * device, or a parent's device that belongs to that parent; never a kid's dose on a parent's phone
 * (parents get the "hasn't been marked yet" note) and never on a shared wall. It names the medicine
 * only when this device turned on medicine names for notifications. Snooze ends it until the snooze
 * runs out; Taken, Skip or the late window closing end it. Renders nothing. */
export function MedicationLiveActivity() {
  const { members, meMemberId, refreshTick } = useApp()
  const { doses } = useDueDoses()
  const [names, setNames] = useState(false)
  const [namesTick, setNamesTick] = useState(0) // the app's own "Show medicine names" changed
  useEffect(() => {
    const on = () => setNamesTick(t => t + 1)
    window.addEventListener(MED_NAMES_EVENT, on)
    return () => window.removeEventListener(MED_NAMES_EVENT, on)
  }, [])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), RECHECK_MS); return () => clearInterval(t) }, [])
  useEffect(() => {
    let id: string | null = null
    try { id = localStorage.getItem(PUSH_SUB_ID_KEY) } catch { /* storage blocked: generic */ }
    if (!id) { setNames(appMedicineNames()); return } // the app: no push subscription, its own device choice
    api.getPushSubscriptions().then(subs => setNames(!!subs.find(s => s.id === id)?.prefs.medicationNames)).catch(() => setNames(false))
  }, [refreshTick, namesTick])
  const me = members.find(m => m.id === meMemberId)
  const a = me ? medicationActivity(doses, me, now, names) : null
  const json = JSON.stringify(a)
  useEffect(() => { if (a) tellAppActivity('medication', a); else endAppActivity('medication') }, [json]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

const key = (d: DueDose) => `${d.medicationId}:${d.date}:${d.time}`

export default function TakeNow({ memberId, className = '' }: { memberId?: string; className?: string }) {
  const due = useDueDoses()
  const doses = due.doses.filter(d => !memberId || d.memberId === memberId)
  if (!doses.length) return null
  return (
    <section className={`board-card meds-now ${className}`} aria-labelledby="meds-now-title">
      <h3 id="meds-now-title" className="snap-heading">💊 Take now</h3>
      <DoseList doses={doses} drop={due.drop} />
    </section>
  )
}

/** The Board's count tile: "2 due" with who, opening the doses in a sheet. */
export function TakeNowTile({ doses, drop }: Due) {
  const { members } = useApp()
  const [open, setOpen] = useState(false)
  const who = [...new Set(doses.map(d => d.memberId))].map(id => members.find(m => m.id === id)).filter(m => m !== undefined)
  return <>
    <button className="board-tile meds-now meds-now-tile" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <span className="board-tile-label"><PillIcon width={16} height={16} />Take now</span>
      <span className="board-tile-value">{doses.length} due</span>
      <span className="board-tile-people">
        {who.map(m => (
          <span key={m.id} className="board-tile-person">
            <span className="board-avatar" style={{ background: m.color, color: inkFor(m.color) }} aria-hidden="true">{m.avatar || m.name[0]}</span>{m.name}
          </span>
        ))}
      </span>
    </button>
    {open && <Sheet title="💊 Take now" onClose={() => setOpen(false)}><DoseList doses={doses} drop={drop} /></Sheet>}
  </>
}

/** "When did you take it?" for a dose marked Taken more than ASK_AFTER_MS after its time: Just now (one
 *  tap), At its time, or Earlier… (from the start of its day to now). onPick gets the time, none for now. */
export function WhenTakenSheet({ dose, today, onPick, onClose }: { dose: { date: string; dueAt: string }; today: string; onPick: (at?: string) => void; onClose: () => void }) {
  const [earlier, setEarlier] = useState<ReturnType<typeof earlierInput> | null>(null)
  const picked = earlier && pickedTime(earlier.value, dose.date)
  return (
    <Sheet title="When did you take it?" variant="dialog" onClose={onClose}
      actions={earlier && <button className="btn btn-primary" disabled={!picked} onClick={() => picked && onPick(picked)}>Save</button>}>
      <div className="sheet-links">
        <button type="button" className="sheet-link" onClick={() => onPick()}>Just now</button>
        <button type="button" className="sheet-link" onClick={() => onPick(dose.dueAt)}>At {formatTime(new Date(dose.dueAt))}</button>
        <button type="button" className="sheet-link" aria-expanded={!!earlier} onClick={() => setEarlier(earlierInput(dose.date, today, dose.dueAt, Date.now()))}>Earlier…</button>
      </div>
      {earlier && <div className="field">
        <label htmlFor="when-taken">Taken at</label>
        <input id="when-taken" type={earlier.type} min={earlier.min} max={earlier.max} value={earlier.value} onChange={e => setEarlier({ ...earlier, value: e.target.value })} />
      </div>}
    </Sheet>
  )
}

function DoseList({ doses, drop }: Due) {
  const { members, settings, toast } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [asking, setAsking] = useState<DueDose | null>(null) // Taken, well after its time: when?
  const [cheer, setCheer] = useState<{ key: string; line: string } | null>(null) // the dose just marked Taken: a moment of cheer before it goes
  const mark = async (d: DueDose, action: 'taken' | 'skipped' | 'snooze', at?: string) => {
    const who = members.find(m => m.id === d.memberId)?.name ?? 'Them'
    setBusy(key(d))
    try {
      await api.markDose(d.medicationId, { date: d.date, time: d.time, action, ...(at ? { at } : {}) })
      if (action === 'taken') {
        // A small celebration, no points: points would give a reason to tap Taken without taking it.
        // Low-stimulation mode (per device): one calm line, and its CSS already hides the confetti.
        const line = document.documentElement.hasAttribute('data-lowstim') ? `Nice job, ${who}.` : cheerLine(who, cheer?.line)
        setCheer({ key: key(d), line }); announce(`${line} Taken ✓`)
        setTimeout(() => { setCheer(c => (c?.key === key(d) ? null : c)); drop(d) }, 1400)
        return
      }
      drop(d)
      const said = action === 'skipped' ? `Skipped for now: ${who}` : `We'll remind you again in 10 minutes`
      toast(said); announce(said)
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
    finally { setBusy(null) }
  }

  return <>
    <ul className="meds-now-list">
      {doses.map(d => {
        const m = members.find(x => x.id === d.memberId)
        const label = cardLabel(d)
        return (
          <li key={key(d)} className="meds-now-item">
            {m && <span className="board-avatar meds-now-avatar" style={{ background: m.color, color: inkFor(m.color) }} aria-hidden="true">{m.avatar || m.name[0]}</span>}
            <p className="meds-now-what">
              <strong>{m?.name ?? 'Someone'}</strong>
              <span>{label} · {doseTimeLabel(d)}</span>
            </p>
            {cheer?.key === key(d) ? <p className="meds-now-cheer" role="status">{cheer.line} Taken ✓<Confetti /></p> : <div className="meds-now-actions" role="group" aria-label={`${m?.name ?? 'Someone'}: ${label}, ${doseTimeLabel(d)}`}>
              <button className="btn btn-primary" disabled={busy === key(d)} onClick={() => (askWhenTaken(d.dueAt, Date.now()) ? setAsking(d) : mark(d, 'taken'))}>Taken</button>
              <button className="btn btn-secondary" disabled={busy === key(d)} onClick={() => mark(d, 'skipped')}>Skip</button>
              <button className="btn btn-secondary" disabled={busy === key(d)} onClick={() => mark(d, 'snooze')}>Snooze 10 min</button>
            </div>}
          </li>
        )
      })}
    </ul>
    {asking && <WhenTakenSheet dose={asking} today={todayKeyInTz(settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)} onClose={() => setAsking(null)}
      onPick={at => { setAsking(null); mark(asking, 'taken', at) }} />}
  </>
}
