// Sticker book: each member's scrapbook page, decorated with emoji stickers from packs they unlock
// with chore points (server: routes/stickers.ts). Every call is display-key allowed, so it works on
// the wall. Placed stickers store x/y as 0-1 fractions of the page, so a page looks the same on
// any screen; changes save a moment after the last tap/drag (one PATCH per burst).
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { announce, Segmented } from './a11y.tsx'
import { inkFor } from './color.ts'
import { dateKey } from './date.ts'
import { ChevronLeft } from './icons.tsx'
import type { StickerPack, StickerPatch, StickerPlacement } from './types.ts'

const SAVE_DELAY_MS = 400
const MIN_SCALE = 0.4, MAX_SCALE = 3.6, SCALE_STEP = 1.25, ROTATE_STEP = 15
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

type Tab = 'book' | 'shop'

export default function Stickers() {
  const { members, selectedMemberId, settings, refreshTick, reloadCore, toast } = useApp()
  const dialog = useDialog()
  const [memberId, setMemberId] = useState<string | null>(() =>
    (members.some(m => m.id === selectedMemberId) ? selectedMemberId : members[0]?.id) ?? null)
  const member = members.find(m => m.id === memberId) ?? null
  const [tab, setTab] = useState<Tab>('book')
  const [packs, setPacks] = useState<StickerPack[] | null>(null)
  const [placed, setPlaced] = useState<StickerPlacement[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [balance, setBalance] = useState(member?.balance ?? 0)
  const [unlocked, setUnlocked] = useState<StickerPack | null>(null) // just bought: the "unlocked!" card
  const pageRef = useRef<HTMLDivElement>(null)
  const pending = useRef(new Map<string, { memberId: string; patch: StickerPatch; timer: ReturnType<typeof setTimeout> }>())
  const drag = useRef<{ id: string; pointerId: number; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null)

  useEffect(() => { setBalance(member?.balance ?? 0) }, [member?.balance])

  // ---------- Saving ----------
  const flush = (id: string) => {
    const e = pending.current.get(id)
    if (!e) return
    clearTimeout(e.timer)
    pending.current.delete(id)
    api.updateSticker(e.memberId, id, e.patch).catch(() => toast("Couldn't save that sticker.", true))
  }
  const flushAll = () => [...pending.current.keys()].forEach(flush)
  const flushRef = useRef(flushAll)
  flushRef.current = flushAll
  useEffect(() => () => flushRef.current(), []) // leaving the page (or idle reset) saves right away

  /** Apply locally now, save after a short pause (bursts of Bigger taps become one PATCH). */
  const change = (id: string, patch: StickerPatch) => {
    setPlaced(ps => ps.map(s => s.id === id ? { ...s, ...patch } : s))
    if (!memberId) return
    const prev = pending.current.get(id)
    if (prev) clearTimeout(prev.timer)
    pending.current.set(id, { memberId, patch: { ...prev?.patch, ...patch }, timer: setTimeout(() => flush(id), SAVE_DELAY_MS) })
  }

  // ---------- Loading ----------
  // A poll tick reloads too, but never under a drag or a change still waiting to save.
  useEffect(() => {
    if (!memberId || drag.current || pending.current.size) return
    let canceled = false
    Promise.all([api.getStickerPacks(memberId), api.getScrapbook(memberId)])
      .then(([p, s]) => { if (!canceled) { setPacks(p); setPlaced(s) } })
      .catch(() => { if (!canceled) toast("Couldn't load the sticker book.", true) })
    return () => { canceled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, refreshTick])

  const pickMember = (id: string) => {
    if (id === memberId) return
    flushAll()
    setMemberId(id); setSelId(null); setPacks(null); setPlaced([]); setUnlocked(null)
    const m = members.find(x => x.id === id)
    if (m) announce(`${m.name}'s sticker book`)
  }

  if (!settings.stickersEnabled) {
    return <div className="stickers stickers-empty"><p>The sticker book is turned off. A grown-up can turn it on in Settings → Family → Chores.</p></div>
  }
  if (!member) {
    return <div className="stickers stickers-empty"><p>Add a family member in Settings to start a sticker book.</p></div>
  }

  const sel = placed.find(s => s.id === selId) ?? null
  const topZ = () => Math.max(0, ...placed.map(s => s.z))
  const focusSticker = (id: string) => setTimeout(() => pageRef.current?.querySelector<HTMLElement>(`[data-sticker-id="${id}"]`)?.focus(), 0)

  // ---------- Book actions ----------
  const place = async (sticker: string) => {
    try {
      const s = await api.placeSticker(member.id, { sticker })
      setPlaced(ps => [...ps, s])
      setSelId(s.id)
      focusSticker(s.id)
      announce(`Placed ${sticker}. Drag it, or use the arrow keys, to move it.`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't place that sticker.", true)
    }
  }
  const bigger = (s: StickerPlacement) => { const scale = clamp(s.scale * SCALE_STEP, MIN_SCALE, MAX_SCALE); change(s.id, { scale }); announce(scale === MAX_SCALE ? 'Biggest' : 'Bigger') }
  const smaller = (s: StickerPlacement) => { const scale = clamp(s.scale / SCALE_STEP, MIN_SCALE, MAX_SCALE); change(s.id, { scale }); announce(scale === MIN_SCALE ? 'Smallest' : 'Smaller') }
  const rotate = (s: StickerPlacement) => { change(s.id, { rotation: ((s.rotation + ROTATE_STEP + 180) % 360) - 180 }); announce('Turned') }
  const toFront = (s: StickerPlacement) => { change(s.id, { z: topZ() + 1 }); announce('Moved to the front') }
  const remove = async (s: StickerPlacement) => {
    const e = pending.current.get(s.id)
    if (e) { clearTimeout(e.timer); pending.current.delete(s.id) }
    setPlaced(ps => ps.filter(x => x.id !== s.id))
    setSelId(null)
    announce(`Removed ${s.sticker}`)
    try { await api.removeSticker(member.id, s.id) } catch { toast("Couldn't remove that sticker.", true) }
  }

  // Drag: the grab offset keeps the sticker from jumping its center to the finger.
  const pagePoint = (e: { clientX: number; clientY: number }, dx = 0, dy = 0) => {
    const box = pageRef.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - dx - box.left) / box.width, 0, 1), y: clamp((e.clientY - dy - box.top) / box.height, 0, 1) }
  }
  const onStickerDown = (e: ReactPointerEvent<HTMLButtonElement>, s: StickerPlacement) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || drag.current) return
    e.stopPropagation()
    setSelId(s.id)
    const box = pageRef.current!.getBoundingClientRect()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    drag.current = { id: s.id, pointerId: e.pointerId, dx: e.clientX - (box.left + s.x * box.width), dy: e.clientY - (box.top + s.y * box.height), x: s.x, y: s.y, moved: false }
  }
  const onStickerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const p = pagePoint(e, d.dx, d.dy)
    d.x = p.x; d.y = p.y; d.moved = true
    setPlaced(ps => ps.map(s => s.id === d.id ? { ...s, ...p } : s))
  }
  const onStickerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    if (d.moved) change(d.id, { x: d.x, y: d.y })
  }
  const onStickerKey = (e: KeyboardEvent<HTMLButtonElement>, s: StickerPlacement) => {
    const step = e.shiftKey ? 0.1 : 0.02
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (nudge[e.key]) {
      e.preventDefault()
      setSelId(s.id)
      change(s.id, { x: clamp(s.x + nudge[e.key][0], 0, 1), y: clamp(s.y + nudge[e.key][1], 0, 1) })
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); bigger(s) }
    else if (e.key === '-') { e.preventDefault(); smaller(s) }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); rotate(s) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(s) }
    else if (e.key === 'Escape' && selId) { e.preventDefault(); setSelId(null) }
  }

  // ---------- Shop ----------
  // "About N more chores": from the average points of today's chores for this member (or anyone's).
  const choresWorth = async (points: number) => {
    let per = 5
    try {
      const day = await api.getChoresDay(dateKey(new Date()))
      const pts = day.filter(c => c.points > 0 && (c.memberId === member.id || !c.memberId)).map(c => c.points)
      if (pts.length) per = pts.reduce((a, b) => a + b, 0) / pts.length
    } catch { /* keep the default */ }
    return Math.max(1, Math.ceil(points / per))
  }
  const notEnough = async (pack: StickerPack, have: number) => {
    const short = pack.price - have
    await dialog.alert({
      title: 'Not quite enough points yet',
      body: `${member.name} needs ${plural(short, 'more point')} for ${pack.name}. That's about ${plural(await choresWorth(short), 'more chore')}!`,
      confirmLabel: 'OK',
    })
  }
  const buy = async (pack: StickerPack) => {
    if (pack.price > balance) return notEnough(pack, balance)
    if (pack.price > 0 && !await dialog.confirm({
      title: `Spend ${plural(pack.price, 'point')} on ${pack.name}?`,
      body: `${member.name} will have ${balance - pack.price} left.`,
      confirmLabel: 'Buy',
    })) return
    try {
      const res = await api.buyStickerPack(pack.id, member.id)
      setBalance(res.balance)
      setPacks(ps => ps?.map(p => p.id === pack.id ? res.pack : p) ?? ps)
      setUnlocked(res.pack)
      announce(`${pack.name} unlocked! ${member.name} has ${plural(res.balance, 'point')} left.`)
      reloadCore() // members' balances
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) return notEnough(pack, balance)
      toast(e instanceof ApiError ? e.message : `Couldn't buy ${pack.name}.`, true)
    }
  }

  const owned = packs?.filter(p => p.unlocked) ?? []
  const sorted = [...placed].sort((a, b) => a.z - b.z)

  return (
    <div className="stickers">
      <div className="stickers-head">
        <a className="paint-btn" href="#/activities" aria-label="Back to activities"><ChevronLeft /></a>
        <div className="chip-row stickers-members" role="group" aria-label="Whose sticker book?">
          {members.map(m => (
            <button key={m.id} className={`chip ${m.id === memberId ? 'active' : ''}`} aria-pressed={m.id === memberId}
              style={{ ['--chip-color' as string]: m.color }} onClick={() => pickMember(m.id)}>
              <span className="stickers-avatar" style={{ background: m.color, color: inkFor(m.color) }} aria-hidden="true">{m.avatar || m.name[0]}</span>{m.name}
            </button>
          ))}
        </div>
        <Segmented tabs idBase="stickers-tab" label="Sticker book" value={tab} onChange={v => { flushAll(); setSelId(null); setTab(v) }}
          options={[{ key: 'book', label: 'Book' }, { key: 'shop', label: 'Shop' }]} />
      </div>

      {tab === 'book' ? (
        <div className="stickers-book" role="tabpanel" aria-labelledby="stickers-tab-book">
          <div className="sticker-stage">
            <div className="sticker-page" ref={pageRef} role="group" aria-label={`${member.name}'s sticker page, ${plural(placed.length, 'sticker')}`}
              onPointerDown={() => setSelId(null)}>
              {sorted.map(s => (
                <button key={s.id} data-sticker-id={s.id} className={`sticker ${s.id === selId ? 'selected' : ''}`}
                  style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, zIndex: s.z, ['--sticker-t' as string]: `translate(-50%, -50%) rotate(${s.rotation}deg) scale(${s.scale})` }}
                  aria-label={`${s.sticker} sticker${s.id === selId ? ', selected' : ''}`} aria-describedby="sticker-keys"
                  onClick={() => setSelId(s.id)} onKeyDown={e => onStickerKey(e, s)}
                  onPointerDown={e => onStickerDown(e, s)} onPointerMove={onStickerMove} onPointerUp={onStickerUp} onPointerCancel={onStickerUp}>
                  <span aria-hidden="true">{s.sticker}</span>
                </button>
              ))}
              {placed.length === 0 && packs && <p className="sticker-page-hint">Tap a sticker below to stick it here.</p>}
            </div>
            <span id="sticker-keys" hidden>Arrow keys move it, plus and minus resize, R turns it, Delete removes it.</span>
            {sel && (
              <div className="sticker-toolbar" role="toolbar" aria-label={`${sel.sticker} sticker`}>
                <button className="btn btn-secondary" onClick={() => bigger(sel)} disabled={sel.scale >= MAX_SCALE}>Bigger</button>
                <button className="btn btn-secondary" onClick={() => smaller(sel)} disabled={sel.scale <= MIN_SCALE}>Smaller</button>
                <button className="btn btn-secondary" onClick={() => rotate(sel)}>Rotate</button>
                <button className="btn btn-secondary" onClick={() => toFront(sel)} disabled={sel.z >= topZ() && placed.filter(p => p.z === sel.z).length === 1}>To front</button>
                <button className="btn btn-danger" onClick={() => remove(sel)}>Remove</button>
              </div>
            )}
          </div>
          <div className="sticker-tray" role="group" aria-label={`${member.name}'s stickers`}>
            {owned.map(p => (
              <div key={p.id} className="sticker-tray-pack" role="group" aria-label={p.name}>
                <span className="sticker-tray-label" aria-hidden="true">{p.cover} {p.name}</span>
                <div className="sticker-tray-row">
                  {p.stickers.map(st => (
                    <button key={st} className="sticker-tray-btn" aria-label={`Stick on ${st}`} onClick={() => place(st)}>{st}</button>
                  ))}
                </div>
              </div>
            ))}
            {packs && (
              <button className="sticker-tray-more" onClick={() => { setSelId(null); setTab('shop') }}>
                <span aria-hidden="true">🛍️</span> More stickers
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="stickers-shop scroll-y" role="tabpanel" aria-labelledby="stickers-tab-shop">
          <p className="stickers-balance"><strong>{member.name}</strong> has <strong>{plural(balance, 'point')}</strong> to spend</p>
          {unlocked && (
            <div className="sticker-unlocked" role="status">
              <span className="sticker-unlocked-cover" aria-hidden="true">{unlocked.cover}</span>
              <span className="sticker-unlocked-text"><strong>{unlocked.name}</strong> unlocked!</span>
              <button className="btn btn-primary" onClick={() => { setUnlocked(null); setTab('book') }}>Open the book</button>
            </div>
          )}
          <ul className="sticker-packs" aria-label="Sticker packs">
            {(packs ?? []).map(p => (
              <li key={p.id} className={`sticker-pack ${p.unlocked ? 'owned' : ''}`}>
                <span className="sticker-pack-cover" aria-hidden="true">{p.cover}</span>
                <span className="sticker-pack-name">{p.name}</span>
                <span className="sticker-pack-peek" aria-label={`${plural(p.stickers.length, 'sticker')}, like ${p.stickers.slice(0, 5).join(' ')}`}>
                  <span aria-hidden="true">{p.stickers.slice(0, 5).join(' ')}</span>
                </span>
                {p.unlocked
                  ? <span className="sticker-pack-owned">✓ Owned</span>
                  : <button className={`btn ${p.price <= balance ? 'btn-primary' : 'btn-secondary'}`} onClick={() => buy(p)}
                      aria-label={p.price === 0 ? `Get ${p.name}, free` : `Buy ${p.name} for ${plural(p.price, 'point')}`}>
                      {p.price === 0 ? 'Free' : `${p.price} pts`}
                    </button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
