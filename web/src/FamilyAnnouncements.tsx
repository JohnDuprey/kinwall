import { useEffect, useId, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { formatDate, t } from './i18n.ts'
import { activeAnnouncements, announcementLocalInput, announcementStatus, announcementTimestamp, type Announcement, type AnnouncementInput, type Announcements } from './announcements.ts'

const CHANGED = 'kinwall:announcements-changed'

export function AnnouncementsButton() {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="btn btn-secondary polls-btn announcements-btn" aria-haspopup="dialog" aria-label={t('Family announcements')} onClick={() => setOpen(true)}><span aria-hidden="true">📣</span><span className="polls-btn-label"> {t('Announcements')}</span></button>
    {open && <AnnouncementManager onClose={() => setOpen(false)} onChanged={() => window.dispatchEvent(new Event(CHANGED))} />}
  </>
}

const when = (at: string) => formatDate(new Date(at), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const statusLabel = (a: Announcement) => announcementStatus(a) === 'active' ? t('Showing now') : announcementStatus(a) === 'scheduled' ? t('Scheduled') : t('Expired')

export default function FamilyAnnouncements() {
  const { settings, refreshTick } = useApp()
  const enabled = settings.features.announcements !== false
  const [data, setData] = useState<Announcements>({ announcements: [], nextChangeAt: null })
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!enabled) return
    let canceled = false, timer: ReturnType<typeof setTimeout> | undefined, serial = 0
    const load = async () => {
      const request = ++serial
      setNow(Date.now()) // cached messages still expire if the network is unavailable
      try {
        const answer = await api.getAnnouncements()
        if (canceled || request !== serial) return
        setData(answer)
        clearTimeout(timer)
        if (answer.nextChangeAt) timer = setTimeout(load, Math.min(2147483647, Math.max(50, Date.parse(answer.nextChangeAt) - Date.now() + 20)))
      } catch { // retain messages only while their visibility window remains active, and try again soon
        if (!canceled && request === serial) { clearTimeout(timer); timer = setTimeout(load, 30000) }
      }
    }
    void load() // again when anything changes (refreshTick: announcement changes bump rev)
    window.addEventListener('focus', load)
    window.addEventListener(CHANGED, load)
    return () => { canceled = true; clearTimeout(timer); window.removeEventListener('focus', load); window.removeEventListener(CHANGED, load) }
  }, [enabled, refreshTick])
  if (!enabled) return null
  const active = activeAnnouncements(data.announcements, now)
  if (!active.length) return null
  return <section className="board-announcements" aria-label={t('Family announcements')}>
    {active.map(a => <article key={a.id} className={`announcement-banner${a.priority === 'important' ? ' announcement-important' : ''}`}>
      <span className="announcement-icon" aria-hidden="true">📣</span>
      <div><div className="announcement-label">{a.priority === 'important' ? t('Important announcement') : t('Family announcement')}</div><h2>{a.title}</h2>{a.details && <p>{a.details}</p>}</div>
    </article>)}
  </section>
}

function AnnouncementManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<Announcement[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [edit, setEdit] = useState<Announcement | 'new' | null>(null), [version, setVersion] = useState(0)
  useEffect(() => {
    let canceled = false
    api.getAnnouncements('all').then(answer => { if (!canceled) { setItems(answer.announcements); setError(''); setLoading(false) } }).catch(() => { if (!canceled) { setError(t('Could not load announcements.')); setLoading(false) } })
    return () => { canceled = true }
  }, [version])
  return <>
    <Sheet title={t('Family announcements')} onClose={onClose} actions={<button type="button" className="btn btn-primary" onClick={() => setEdit('new')}>{t('Add announcement')}</button>}>
      <p className="field-hint">{t('Announcements appear at the top of the Board during their scheduled time. Everyone in the family can see them.')}</p>
      {error && <p role="alert">{error} <button type="button" className="btn btn-secondary" onClick={() => setVersion(v => v + 1)}>{t('Try again')}</button></p>}
      {loading && <p>{t('Loading…')}</p>}
      {!loading && !error && !items.length && <p className="state-card">{t('No announcements yet.')}</p>}
      <div className="sheet-links">{items.map(a => <button type="button" className="sheet-link" key={a.id} onClick={() => setEdit(a)}>
        <span><strong>{a.title}</strong><small>{statusLabel(a)} · {when(a.startsAt)} – {when(a.expiresAt)}</small></span>
      </button>)}</div>
    </Sheet>
    {edit && <AnnouncementEditor announcement={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setVersion(v => v + 1); onChanged() }} />}
  </>
}

function AnnouncementEditor({ announcement: a, onClose, onSaved }: { announcement: Announcement | null; onClose: () => void; onSaved: () => void }) {
  const id = useId(), dialog = useDialog()
  const [title, setTitle] = useState(a?.title ?? ''), [details, setDetails] = useState(a?.details ?? ''), [priority, setPriority] = useState<AnnouncementInput['priority']>(a?.priority ?? 'normal')
  const [starts, setStarts] = useState(() => announcementLocalInput(a?.startsAt ?? new Date().toISOString()))
  const [expires, setExpires] = useState(() => announcementLocalInput(a?.expiresAt ?? new Date(Date.now() + 86400000).toISOString()))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const startsAt = a && starts === announcementLocalInput(a.startsAt) ? a.startsAt : announcementTimestamp(starts)
  const expiresAt = a && expires === announcementLocalInput(a.expiresAt) ? a.expiresAt : announcementTimestamp(expires)
  const valid = !!title.trim() && !!startsAt && !!expiresAt && expiresAt > startsAt
  const save = async () => {
    if (!valid || busy) return
    setBusy(true); setError('')
    try {
      const input = { title: title.trim(), details: details.trim(), priority, startsAt: startsAt!, expiresAt: expiresAt! }
      if (a) await api.updateAnnouncement(a.id, input); else await api.createAnnouncement(input)
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : t('Could not save announcement.')); setBusy(false) }
  }
  const remove = async () => {
    if (!a || busy || !await dialog.confirm({ title: t('Delete “{title}”?', { title: a.title }), confirmLabel: t('Delete'), danger: true })) return
    setBusy(true); setError('')
    try { await api.deleteAnnouncement(a.id); onSaved() } catch (e) { setError(e instanceof Error ? e.message : t('Could not delete announcement.')); setBusy(false) }
  }
  return <Sheet title={a ? t('Edit announcement') : t('Add announcement')} onClose={busy ? () => {} : onClose} actions={<button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={save}>{a ? t('Save') : t('Add announcement')}</button>}>
    <div className="field"><label htmlFor={`${id}-title`}>{t('Title')}</label><input id={`${id}-title`} maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></div>
    <div className="field"><label htmlFor={`${id}-details`}>{t('Details (optional)')}</label><textarea id={`${id}-details`} rows={3} maxLength={2000} value={details} onChange={e => setDetails(e.target.value)} /></div>
    <div className="field"><label htmlFor={`${id}-starts`}>{t('Visible from')}</label><input id={`${id}-starts`} type="datetime-local" required value={starts} onChange={e => setStarts(e.target.value)} /></div>
    <div className="field"><label htmlFor={`${id}-expires`}>{t('Expires')}</label><input id={`${id}-expires`} type="datetime-local" required value={expires} min={starts} onChange={e => setExpires(e.target.value)} /></div>
    <p className="field-hint">{t('Times are shown in {timezone}.', { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
    {(!startsAt || !expiresAt || expiresAt <= startsAt) && <p role="alert" className="field-hint">{t('Choose valid dates and an expiration after the announcement starts.')}</p>}
    <div className="field"><label htmlFor={`${id}-priority`}>{t('Emphasis')}</label><select id={`${id}-priority`} value={priority} onChange={e => setPriority(e.target.value as AnnouncementInput['priority'])}><option value="normal">{t('Normal')}</option><option value="important">{t('Important')}</option></select></div>
    {error && <p role="alert">{error}</p>}
    {a && <div className="sheet-danger-zone"><button type="button" className="btn btn-danger" disabled={busy} onClick={remove}>{t('Delete announcement…')}</button></div>}
  </Sheet>
}
