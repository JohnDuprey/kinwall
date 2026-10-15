import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { announce, Segmented } from './a11y.tsx'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { allDone, choreItems, doOrder, listOrder, nextOpen, progress, savedView, saveView, startAt, stayOn, type DoView } from './getStuffDone.ts'
import { CalendarIcon, CheckIcon, ChevronLeft, ChevronRight, HomeIcon, XIcon } from './icons.tsx'
import { canChangeItem } from './listSections.ts'
import { compareItems, type ListDetail, type ListItem } from './types.ts'
import { dateKey } from './date.ts'
import { dueLabel, eventDueMap, eventLabel } from './itemDue.ts'
import { useEventWindow } from './useEventWindow.ts'
import { PriorityBadge } from './PriorityBadge.tsx'
import { holdAwake } from './wakeLock.ts'
import { Face } from './Face'
import { useBackClose } from './backStack.ts'
import { t, tn } from './i18n.ts'

/** Opened from a chore with this checklist: only its person's items (and nobody's), and once
 * they're all ticked the chore completes the usual way (`onComplete`: approval, points, reset).
 * `done`: what completing earns ("⭐ 5 points for Leo"); with it, ticking the last item completes the
 * chore right away. Without it (an Anyone chore that asks Who did it?) it's one more tap. */
export type DoChore = { memberId: string | null; title: string; points: number; done: string | null; onComplete: () => void }

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
  const [completed, setCompleted] = useState<string | null>(null) // what the chore earned once it completed itself (its list may reset under us)
  const lastIndex = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [opener] = useState(() => document.activeElement as HTMLElement | null)

  const { byId: events } = useEventWindow(refreshTick) // linked events: on the card, and their day in a due-date sort
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
  const exit = () => { if (pinned) location.hash = '#/home'; onClose() } // pinned: back to the Board
  const close = useRef(exit)
  close.current = exit
  useBackClose(() => close.current()) // the app's Back button: like Escape
  useEffect(() => { if (detail) heading.current?.focus({ preventScroll: true }) }, [!!detail]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = detail?.list
  // What this screen works through: a chore's person's items (or a screen shown for one person),
  // and on a kid's own device only what it may tick (canChangeItem, the server's rule too).
  const kid = !parentDevice && focusLocked ? meMemberId : null
  const who = chore ? chore.memberId : focusMemberId
  // In the list's own sort (as the list shows it); a tick doesn't move an item along.
  const today = dateKey(new Date())
  const items = !detail ? [] : doOrder(choreItems(detail.items, who).filter(i => canChangeItem(i, detail.list, kid)),
    compareItems(detail.list.sortBy, today, { keepChecked: true, eventDue: eventDueMap(events) }))
  const index = cur ? stayOn(items, cur, lastIndex.current) : startAt(items)
  lastIndex.current = index
  const item = items[index] as ListItem | undefined
  const due = item ? dueLabel(item, today) : null
  const linked = item?.eventId ? events.get(item.eventId) : undefined
  const { done, total } = progress(items)
  const finished = allDone(items)
  useEffect(() => { if (!finished) setReview(false) }, [finished])
  useEffect(() => { if (finished && !chore?.done) announce(t('All done! {name} is finished.', { name: list?.name ?? '' })) }, [finished]) // eslint-disable-line react-hooks/exhaustive-deps
  // From a chore that knows who gets the points: the last tick completes it, so nobody walks away with 0.
  useEffect(() => {
    if (!finished || !chore?.done || completed) return
    setCompleted(chore.done)
    chore.onComplete()
    announce(t('All done! {title}: {done}', { title: chore.title, done: chore.done }))
  }, [finished]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id: string, next: Partial<ListItem>) => setDetail(d => d && { ...d, items: d.items.map(i => (i.id === id ? { ...i, ...next } : i)) })
  const setDone = async (it: ListItem, on: boolean) => {
    patch(it.id, { done: on, steps: it.steps.map(st => ({ ...st, done: on })), stepsDone: on ? it.stepsTotal : 0 }) // ticking an item ticks its steps
    try { await api.queueUpdateListItem(listId, it.id, { done: on }) } // offline too: syncs when back
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not update item'), true); load() }
  }
  const tickStep = async (it: ListItem, stepId: string, on: boolean) => {
    const steps = it.steps.map(st => (st.id === stepId ? { ...st, done: on } : st))
    patch(it.id, { steps, stepsDone: steps.filter(st => st.done).length })
    try {
      const next = await api.updateListItemStep(listId, it.id, stepId, { done: on }) // the whole item back: done once every step is
      patch(it.id, next)
      if (next.done && !it.done) { announce(t('{title} done', { title: it.title })); goNext(next) }
    } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not update'), true); load() }
  }

  const go = (i: number, ticked?: string) => {
    const to = items[i]
    if (!to) return
    setCur(to.id)
    const at = { done: ticked ?? '', i: i + 1, total, title: to.title }
    announce((ticked ? t('{done} done. Next, {i} of {total}: {title}', at) : t('{i} of {total}: {title}', at)) + (to.done ? t(', done') : ''))
  }
  // After a tick: on to the next open one (with the ticked one counted done).
  const goNext = (ticked: ListItem) => {
    const after = items.map(i => (i.id === ticked.id ? { ...i, done: true } : i))
    const n = nextOpen(after, index)
    if (n >= 0) go(n, ticked.title)
  }
  const doneNow = () => { if (!item) return; setDone(item, true); goNext(item) }
  const skip = nextOpen(items, index)
  const pickView = (v: DoView) => { setView(v); saveView(v); announce(v === 'step' ? t('One at a time') : t('Whole list')) }

  const reset = async () => {
    const ids = items.filter(i => i.done).map(i => i.id)
    try { await api.resetList(listId, ids); toast(t('Reset for next time: {name}', { name: list?.name ?? '' })); exit() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not reset the list'), true) }
  }

  const avatar = (memberId: string | null, size: 'big' | 'small') => {
    const m = memberId ? members.find(x => x.id === memberId) : undefined
    return m && <Face m={m} className={`gsd-avatar gsd-avatar-${size}`} role="img" aria-label={t('For {name}', { name: m.name })} />
  }
  const stepRows = (it: ListItem) => it.steps.length > 0 && (
    <div className="gsd-steps" role="group" aria-label={t('{title} steps', { title: it.title })}>
      {it.steps.map(st => (
        <button key={st.id} type="button" className={`shop-row gsd-row ${st.done ? 'done' : ''}`} role="checkbox" aria-checked={st.done} onClick={() => tickStep(it, st.id, !st.done)}>
          <span className="shop-check" aria-hidden="true">{st.done && <CheckIcon width={20} height={20} />}</span>
          <span className="shop-row-body"><span className="shop-row-title">{st.title}</span></span>
        </button>
      ))}
    </div>
  )

  const name = list?.name ?? t('Checklist')
  let body: React.ReactNode
  if (error || !detail) body = <div className="state-card">{error ? t("Couldn't load this list.") : t('Loading…')}</div>
  else if (!items.length) body = <div className="empty-card gsd-empty"><span className="emoji">📝</span>{chore || kid ? t('Nothing on {name} for you yet.', { name }) : t('Nothing on {name} yet.', { name })}</div>
  else if (completed && chore) {
    body = (
      <div className="gsd-main scroll-y">
        <div className="gsd-celebrate">
          <span className="gsd-party" aria-hidden="true">🎉</span>
          <p className="gsd-title">{t('All done!')}</p>
          <p className="gsd-sub">{chore.title}: {completed}</p>
          <div className="gsd-finish"><button type="button" className="btn btn-primary" onClick={onClose}>{t('Finish')}</button></div>
        </div>
      </div>
    )
  } else if (finished && !review && chore) {
    // Who did it? comes next, so it can't complete itself: one more tap, and the party after.
    body = (
      <div className="gsd-main scroll-y">
        <div className="gsd-celebrate">
          <span className="gsd-party" aria-hidden="true">⭐</span>
          <p className="gsd-title">{t('One more tap!')}</p>
          <p className="gsd-sub">{t('Every step of {name} is ticked.', { name })}</p>
          <div className="gsd-finish">
            <button type="button" className="btn btn-primary" onClick={() => { onClose(); chore.onComplete() }}>⭐ {tn(chore.points, 'Get the {n} point', 'Get the {n} points')}</button>
            <button type="button" className="link-btn" onClick={() => setReview(true)}>{t('Look over the list')}</button>
          </div>
        </div>
      </div>
    )
  } else if (finished && !review) {
    body = (
      <div className="gsd-main scroll-y">
        <div className="gsd-celebrate">
          <span className="gsd-party" aria-hidden="true">🎉</span>
          <p className="gsd-title">{t('All done!')}</p>
          <p className="gsd-sub">{t('{name} is finished.', { name })}</p>
          <div className="gsd-finish">
            {list?.kind === 'reusable' && <button type="button" className="btn btn-secondary" onClick={reset}>{t('Reset for next time')}</button>}
            <button type="button" className="btn btn-primary" onClick={exit}>{pinned ? t('Back to the Board') : t('Finish')}</button>
            <button type="button" className="link-btn" onClick={() => setReview(true)}>{t('Look over the list')}</button>
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
              onClick={() => { setDone(it, !it.done); announce(it.done ? t('{title} not done', { title: it.title }) : t('{title} done', { title: it.title })) }}>
              <span className="shop-check" aria-hidden="true">{it.done && <CheckIcon width={24} height={24} />}</span>
              <span className="shop-row-body">
                <span className="shop-row-title">{it.title}</span>
                {it.stepsTotal > 0 && <span className="shop-row-note">{t('{done} of {total} steps', { done: it.stepsDone, total: it.stepsTotal })}</span>}
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
          <p className="cook-step-num gsd-count">{t('Item {i} of {total}', { i: index + 1, total })}{item.done ? ` · ✓ ${t('Done')}` : ''}</p>
          {avatar(item.memberId, 'big')}
          <p className={`gsd-title ${item.done ? 'done' : ''}`}>{item.title}</p>
          {(due || linked || item.priority !== 'normal') && (
            <p className="gsd-meta">
              <PriorityBadge p={item.priority} />
              {due && <span className={due.overdue ? 'gsd-overdue' : undefined}>{due.overdue && <span aria-hidden="true">⚠ </span>}{due.text}</span>}
              {linked && <span><CalendarIcon width={16} height={16} aria-hidden="true" /> {eventLabel(linked)}</span>}
            </p>
          )}
          {item.notes && <p className="gsd-sub">{item.notes}</p>}
          {stepRows(item)}
        </div>
      </div>
      <footer className="cook-nav gsd-nav">
        <button type="button" className="btn btn-secondary" disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft width={24} height={24} /> {t('Back')}</button>
        <button type="button" className="btn btn-secondary" disabled={skip < 0} onClick={() => go(skip)}>{item.done ? t('Next') : t('Skip')} <ChevronRight width={24} height={24} /></button>
        {item.done
          ? <button type="button" className="btn btn-secondary gsd-done" onClick={() => { setDone(item, false); announce(t('{title} not done', { title: item.title })) }}>{t('Not done')}</button>
          : <button type="button" className="btn btn-primary gsd-done" onClick={doneNow}><CheckIcon width={28} height={28} /> {t('Done')}</button>}
      </footer>
    </>
  }

  return createPortal(
    <div ref={root} className="cook-mode gsd-mode" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="cook-bar gsd-bar">
        {pinned
          ? <button type="button" className="btn btn-secondary gsd-exit" onClick={exit}><HomeIcon width={20} height={20} /> {t('Board')}</button>
          : <button type="button" className="icon-btn" aria-label={t('Exit Get stuff done')} onClick={exit}><XIcon width={24} height={24} /></button>}
        <div className="gsd-head">
          <h2 id={titleId} ref={heading} tabIndex={-1} className="cook-title">{t('Get stuff done: {name}', { name: `${list?.emoji ? `${list.emoji} ` : ''}${name}` })}</h2>
          {total > 0 && !completed && <span className="gsd-progress-text">{t('{done} of {total} done', { done, total })}</span>}
        </div>
        <Segmented label={t('Show')} value={view} onChange={pickView} className="gsd-toggle"
          options={[{ key: 'step', label: t('One at a time') }, { key: 'list', label: t('Whole list') }]} />
      </header>
      <div className="cook-progress" aria-hidden="true"><div style={{ width: `${completed ? 100 : total ? done / total * 100 : 0}%` }} /></div>
      {body}
    </div>,
    document.body,
  )
}
