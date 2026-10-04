// Bonus points (parent devices only): a "Give points" button that opens a sheet (who, how many, an
// optional note, the day), then a toast with Undo. Used in the Chores header and on a profile.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import { announce } from './a11y.tsx'
import { todayKeyInTz } from './date.ts'
import { BONUS_MAX, BONUS_NOTE_MAX, BONUS_QUICK, bonusPoints, gaveText } from './bonus.ts'
import { ChipFace } from './Face'

const UNDO_MS = 6000

export function GivePoints({ memberId, className, label, children }: { memberId?: string | null; className: string; label: string; children: ReactNode }) {
  const { members, settings, toast, reloadCore } = useApp()
  const [open, setOpen] = useState(false)
  const [undo, setUndo] = useState<{ id: string; text: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const given = (id: string, text: string) => {
    setOpen(false)
    setUndo({ id, text })
    announce(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setUndo(null), UNDO_MS)
    reloadCore()
  }
  const takeBack = async () => {
    if (!undo) return
    clearTimeout(timer.current)
    setUndo(null)
    try {
      await api.deletePointAward(undo.id)
      announce('Undone')
      reloadCore()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't undo that.", true)
    }
  }

  if (!settings.features.chores || members.length === 0) return null
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label={label}>{children}</button>
      {open && <GiveSheet memberId={memberId ?? null} onClose={() => setOpen(false)} onGiven={given} />}
      {undo && (
        <div className="toast list-undo-toast" role="status">
          <span>{undo.text}</span>
          <button className="list-undo-btn" onClick={takeBack}>Undo</button>
        </div>
      )}
    </>
  )
}

function GiveSheet({ memberId, onClose, onGiven }: { memberId: string | null; onClose: () => void; onGiven: (id: string, text: string) => void }) {
  const { members, settings, toast } = useApp()
  const today = todayKeyInTz(settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  const kids = members.filter(m => !m.grownUp)
  const [who, setWho] = useState(memberId ?? (kids.length === 1 ? kids[0].id : ''))
  const [raw, setRaw] = useState('10')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const points = bonusPoints(raw)
  const person = members.find(m => m.id === who)

  const give = async () => {
    if (!person || !points) return
    setSaving(true)
    try {
      const { award } = await api.givePoints({ memberId: person.id, points, note: note.trim() || undefined, date: date === today ? undefined : date })
      onGiven(award.id, gaveText(person.name, points))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't give the points.", true)
      setSaving(false)
    }
  }

  return (
    <Sheet title="Give points" onClose={onClose}
      actions={<button className="btn btn-primary" onClick={give} disabled={saving || !person || !points}>{person && points ? `Give ${person.name} ${points}` : 'Give'}</button>}>
      <p className="settings-row-sub" style={{ margin: '0 0 12px' }}>A bonus for something that isn't a chore. It counts toward their points, not their streak.</p>
      <div className="field">
        <label>Who</label>
        <div className="chip-row">
          {members.map(m => (
            <button key={m.id} type="button" className={`chip ${who === m.id ? 'active' : ''}`} aria-pressed={who === m.id}
              style={{ ['--chip-color' as string]: m.color }} onClick={() => setWho(m.id)}><ChipFace m={m} /> {m.name}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="give-points">Points</label>
        <div className="chip-row" style={{ marginBottom: 8 }}>
          {BONUS_QUICK.map(n => (
            <button key={n} type="button" className={`chip ${points === n ? 'active' : ''}`} aria-pressed={points === n} onClick={() => setRaw(String(n))}>+{n}</button>
          ))}
        </div>
        <input id="give-points" type="text" inputMode="numeric" value={raw} onChange={e => setRaw(e.target.value.replace(/[^\d]/g, ''))} aria-describedby="give-points-hint" />
        <p id="give-points-hint" className="settings-row-sub">{raw && !points ? `From 1 to ${BONUS_MAX}.` : `Any amount from 1 to ${BONUS_MAX}.`}</p>
      </div>
      <div className="field">
        <label htmlFor="give-note">What for? <span className="settings-row-sub">(optional)</span></label>
        <input id="give-note" type="text" value={note} maxLength={BONUS_NOTE_MAX} onChange={e => setNote(e.target.value)} placeholder="Helped carry groceries" autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="give-date">Day</label>
        <input id="give-date" type="date" value={date} max={today} onChange={e => setDate(e.target.value && e.target.value <= today ? e.target.value : today)} />
      </div>
    </Sheet>
  )
}
