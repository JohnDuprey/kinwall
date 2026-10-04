import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { announce, Segmented } from './a11y.tsx'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { allDone, choreItems, doOrder, listOrder, nextOpen, progress, savedView, saveView, startAt, stayOn, type DoView } from './getStuffDone.ts'
import { CheckIcon, ChevronLeft, ChevronRight, HomeIcon, XIcon } from './icons.tsx'
import { canChangeItem } from './listSections.ts'
import type { ListDetail, ListItem } from './types.ts'
import { holdAwake } from './wakeLock.ts'
import { Face } from './Face'

/** Opened from a chore with this checklist: only its person's items (and nobody's), and once
 * they're all ticked the chore completes the usual way (`onComplete`: approval, points, reset). */
export type DoChore = { memberId: string | null; title: string; onComplete: () => void }

/** Get stuff done: one checklist, full screen, for a routine (Bedtime, After school). One item at a
 * time (big, with its person and steps, Done / Skip / Back) or the whole list, the last view kept
 * per device. Ticks are the list's own (the same rules as on the list, live from other screens).
 * Built like cooking mode (CookingMode.tsx): screen on, the app behind out of reach. `pinned`: this
 * screen's pinned checklist (Settings → This display), whose way out goes back to the Board. */
export default function GetStuffDone({ listId, chore, pinned, onClose }: { listId: string; chore?: DoChore; pinned?: boolean; onClose: () => void }) {
  const { members, toast, refreshTick, parentDevice, focusLocked, meMemberId, focusMemberId } = useApp()
  const titleId = useId()
  const [detail, setDetail] = useState<ListDetail | null>(null)
  const [error, setError] = useState(false)
  const [view, setView] = useState<DoView>(savedView)
  const [cur, setCur] = useState<string | null>(null) // the item one at a time shows, by id (stays put through reloads)
  const [review, setReview] = useState(false) // all done, but looking the list over
  const lastIndex = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [opener] = useState(() => document.activeElement as HTMLElement | null)

  const load = () => api.getList(listId).then(d => { setDetail(d); setError(false) }).catch(() => setError(true))
  useEffect(() => { load() }, [listId, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Screen on, the app behind out of reach, focus in; all undone on the way out (as in cooking mode).
  useEffect(() => {
    holdAwake(`get-stuff-done:${listId}`, true)
    const behind = [...document.querySelectorAll<HTMLElement>('.app-shell, .sheet-backdrop')].filter(el => !el.hasAttribute('inert'))
    behind.forEach(el => el.setAttribute('inert', ''))
    const ownsMode = !('fullscreenMode' in document.documentElement.dataset)
    document.documentElement.dataset.fullscreenMode = ''
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); close.current() } }
    document.addEventListener('keydown', onKey)
    return () => {
      holdAwake(`get-stuff-done:${listId}`, false); behind.forEach(el => el.removeAttribute('inert')); if (ownsMode) delete document.documentElement.dataset.fullscreenMode
      document.removeEventListener('keydown', onKey); opener?.focus?.({ preventScroll: true })
    }
  }, [opener, listId])
  const exit = () => { if (pinned) location.hash = '#/calendar'; onClose() } // pinned: back to the Board
  const close = useRef(exit)
  close.current = exit
  useEffect(() => { if (detail) heading.current?.focus({ preventScroll: true }) }, [!!detail]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = detail?.list
  // What this screen works through: a chore's person's items (or a screen shown for one person),
  // and on a kid's own device only what it may tick (canChangeItem, the server's rule too).
  const kid = !parentDevice && focusLocked ? meMemberId : null
  const who = chore ? chore.memberId : focusMemberId
  const items = !detail ? [] : doOrder(choreItems(detail.items, who).filter(i => canChangeItem(i, detail.list, kid)))
  const index = cur ? stayOn(items, cur, lastIndex.current) : startAt(items)
  lastIndex.current = index
  const item = items[index] as ListItem | undefined
  const { done, total } = progress(items)
  const finished = allDone(items)
  useEffect(() => { if (!finished) setReview(false) }, [finished])
  useEffect(() => { if (finished) announce(`All done! ${list?.name ?? ''} is finished.`) }, [finished]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id: string, next: Partial<ListItem>) => setDetail(d => d && { ...d, items: d.items.map(i => (i.id === id ? { ...i, ...next } : i)) })
  const setDone = async (it: ListItem, on: boolean) => {
    patch(it.id, { done: on, steps: it.steps.map(st => ({ ...st, done: on })), stepsDone: on ? it.stepsTotal : 0 }) // ticking an item ticks its steps
    try { await api.queueUpdateListItem(listId, it.id, { done: on }) } // offline too: syncs when back
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update item', true); load() }
  }
  const tickStep = async (it: ListItem, stepId: string, on: boolean) => {
    const steps = it.steps.map(st => (st.id === stepId ? { ...st, done: on } : st))
    patch(it.id, { steps, stepsDone: steps.filter(st => st.done).length })
    try {
      const next = await api.updateListItemStep(listId, it.id, stepId, { done: on }) // the whole item back: done once every step is
      patch(it.id, next)
      if (next.done && !it.done) { announce(`${it.title} done`); goNext(next) }
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update', true); load() }
  }

  const go = (i: number, said = '') => {
    const to = items[i]
    if (!to) return
    setCur(to.id)
    announce(`${said}${i + 1} of ${total}: ${to.title}${to.done ? ', done' : ''}`)
  }
  // After a tick: on to the next open one (with the ticked one counted done).
  const goNext = (ticked: ListItem) => {
    const after = items.map(i => (i.id === ticked.id ? { ...i, done: true } : i))
    const n = nextOpen(after, index)
    if (n >= 0) go(n, `${ticked.title} done. Next, `)
  }
  const doneNow = () => { if (!item) return; setDone(item, true); goNext(item) }
  const skip = nextOpen(items, index)
  const pickView = (v: DoView) => { setView(v); saveView(v); announce(v === 'step' ? 'One at a time' : 'Whole list') }

  const reset = async () => {
    const ids = items.filter(i => i.done).map(i => i.id)
    try { await api.resetList(listId, ids); toast(`Reset for next time: ${list?.name}`); exit() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reset the list', true) }
  }

  const avatar = (memberId: string | null, size: 'big' | 'small') => {
    const m = memberId ? members.find(x => x.id === memberId) : undefined
    return m && <Face m={m} className={`gsd-avatar gsd-avatar-${size}`} role="img" aria-label={`For ${m.name}`} />
  }
  const stepRows = (it: ListItem) => it.steps.length > 0 && (
    <div className="gsd-steps" role="group" aria-label={`${it.title} steps`}>
      {it.steps.map(st => (
        <button key={st.id} type="button" className={`shop-row gsd-row ${st.done ? 'done' : ''}`} role="checkbox" aria-checked={st.done} onClick={() => tickStep(it, st.id, !st.done)}>
          <span className="shop-check" aria-hidden="true">{st.done && <CheckIcon width={20} height={20} />}</span>
          <span className="shop-row-body"><span className="shop-row-title">{st.title}</span></span>
        </button>
      ))}
    </div>
  )

  const name = list?.name ?? 'Checklist'
  let body: React.ReactNode
  if (error || !detail) body = <div className="state-card">{error ? "Couldn't load this list." : 'Loading…'}</div>
  else if (!items.length) body = <div className="empty-card gsd-empty"><span className="emoji">📝</span>Nothing on {name} {chore || kid ? 'for you ' : ''}yet.</div>
  else if (finished && !review) {
    body = (
      <div className="gsd-main scroll-y">
        <div className="gsd-celebrate">
          <span className="gsd-party" aria-hidden="true">🎉</span>
          <p className="gsd-title">All done!</p>
          <p className="gsd-sub">{chore ? `Every step of ${name} is ticked.` : `${name} is finished.`}</p>
          <div className="gsd-finish">
            {chore ? <button type="button" className="btn btn-primary" onClick={() => { onClose(); chore.onComplete() }}>Complete {chore.title}</button> : <>
              {list?.kind === 'reusable' && <button type="button" className="btn btn-secondary" onClick={reset}>Reset for next time</button>}
              <button type="button" className="btn btn-primary" onClick={exit}>{pinned ? 'Back to the Board' : 'Finish'}</button>
            </>}
            <button type="button" className="link-btn" onClick={() => setReview(true)}>Look over the list</button>
          </div>
        </div>
      </div>
    )
  } else if (view === 'list') {
    body = (
      <div className="gsd-main scroll-y">
        <div className="gsd-list" role="group" aria-label={name}>
          {listOrder(items).map(it => (
            <button key={it.id} type="button" className={`shop-row gsd-row ${it.done ? 'done' : ''}`} role="checkbox" aria-checked={it.done}
              onClick={() => { setDone(it, !it.done); announce(`${it.title} ${it.done ? 'not done' : 'done'}`) }}>
              <span className="shop-check" aria-hidden="true">{it.done && <CheckIcon width={24} height={24} />}</span>
              <span className="shop-row-body">
                <span className="shop-row-title">{it.title}</span>
                {it.stepsTotal > 0 && <span className="shop-row-note">{it.stepsDone} of {it.stepsTotal} steps</span>}
              </span>
              {avatar(it.memberId, 'small')}
            </button>
          ))}
        </div>
      </div>
    )
  } else if (item) {
    body = <>
      <div className="gsd-main scroll-y">
        <div className="gsd-step">
          <div className="gsd-dots" aria-hidden="true">{items.map((it, i) => <span key={it.id} className={`${it.done ? 'done' : ''} ${i === index ? 'here' : ''}`} />)}</div>
          <p className="cook-step-num gsd-count">{index + 1} of {total}{item.done ? ' · ✓ Done' : ''}</p>
          {avatar(item.memberId, 'big')}
          <p className={`gsd-title ${item.done ? 'done' : ''}`}>{item.title}</p>
          {item.notes && <p className="gsd-sub">{item.notes}</p>}
          {stepRows(item)}
        </div>
      </div>
      <footer className="cook-nav gsd-nav">
        <button type="button" className="btn btn-secondary" disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft width={24} height={24} /> Back</button>
        <button type="button" className="btn btn-secondary" disabled={skip < 0} onClick={() => go(skip)}>{item.done ? 'Next' : 'Skip'} <ChevronRight width={24} height={24} /></button>
        {item.done
          ? <button type="button" className="btn btn-secondary gsd-done" onClick={() => { setDone(item, false); announce(`${item.title} not done`) }}>Not done</button>
          : <button type="button" className="btn btn-primary gsd-done" onClick={doneNow}><CheckIcon width={28} height={28} /> Done</button>}
      </footer>
    </>
  }

  return createPortal(
    <div ref={root} className="cook-mode gsd-mode" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="cook-bar gsd-bar">
        {pinned
          ? <button type="button" className="btn btn-secondary gsd-exit" onClick={exit}><HomeIcon width={20} height={20} /> Board</button>
          : <button type="button" className="icon-btn" aria-label="Exit Get stuff done" onClick={exit}><XIcon width={24} height={24} /></button>}
        <div className="gsd-head">
          <h2 id={titleId} ref={heading} tabIndex={-1} className="cook-title">Get stuff done: {list?.emoji ? `${list.emoji} ` : ''}{name}</h2>
          {total > 0 && <span className="gsd-progress-text">{done} of {total} done</span>}
        </div>
        <Segmented label="Show" value={view} onChange={pickView} className="gsd-toggle"
          options={[{ key: 'step', label: 'One at a time' }, { key: 'list', label: 'Whole list' }]} />
      </header>
      <div className="cook-progress" aria-hidden="true"><div style={{ width: `${total ? done / total * 100 : 0}%` }} /></div>
      {body}
    </div>,
    document.body,
  )
}
