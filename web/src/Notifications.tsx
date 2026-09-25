import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import type { AppNotification } from './types.ts'
import { BellIcon } from './icons.tsx'
import Sheet from './Sheet.tsx'
import { SendMessageForm } from './Settings.tsx'
import { announce } from './a11y.tsx'
import { useDialog } from './dialog.tsx'
import { inkFor } from './color.ts'
import { formatTime, todayKeyInTz, zonedDayKey } from './date.ts'

// Read state is per device, like the other device prefs: everything newer than this is unread.
const SEEN_KEY = 'kinwall.notificationsSeenAt'
function readSeen(): string {
  try {
    const v = localStorage.getItem(SEEN_KEY)
    if (v) return v
    // A device's first look starts caught up, instead of 9+ from before it was set up.
    const now = new Date().toISOString()
    localStorage.setItem(SEEN_KEY, now)
    return now
  } catch { return new Date().toISOString() }
}
function writeSeen(iso: string) {
  try { localStorage.setItem(SEEN_KEY, iso) } catch { /* private mode: badge just won't persist */ }
}

const KIND_ICON: Record<AppNotification['kind'], string> = { reminder: '🔔', summary: '☀️', chore: '✅', list: '🛒', message: '💬' }

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })
function relTime(iso: string, tz: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return rtf.format(-min, 'minute')
  if (zonedDayKey(iso, tz) === todayKeyInTz(tz)) return rtf.format(-Math.round(min / 60), 'hour')
  return formatTime(iso, tz)
}

function dayLabel(dayKey: string, tz: string): string {
  const today = todayKeyInTz(tz)
  const yesterday = zonedDayKey(new Date(Date.now() - 864e5).toISOString(), tz)
  if (dayKey === today) return 'Today'
  if (dayKey === yesterday) return 'Yesterday'
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}

// Deep links are the same ones a push opens ('/#/calendar?event=…', '/chores', '/'); the app
// routes on the hash.
function toHash(url: string): string {
  const i = url.indexOf('#')
  if (i >= 0) return url.slice(i)
  return url === '/' || url === '' ? '#/calendar' : `#${url.startsWith('/') ? url : `/${url}`}`
}

/** Header bell: unread badge + the "Notifications" sheet (every notification Kinwall sent). */
export default function NotificationBell({ isAdmin }: { isAdmin: boolean }) {
  const { settings, members, refreshTick } = useApp()
  const [items, setItems] = useState<AppNotification[]>([])
  const [seenAt, setSeenAt] = useState(readSeen)
  const [open, setOpen] = useState(false)
  const [sheetSeenAt, setSheetSeenAt] = useState(seenAt) // what was unread when the sheet opened
  const [composing, setComposing] = useState(false)
  const dialog = useDialog()

  const load = () => { api.getNotifications().then(setItems).catch(() => { /* offline: keep what we have */ }) }
  useEffect(load, [refreshTick]) // rev bumps when a notification is recorded

  const unread = items.filter(n => n.at > seenAt).length
  const badge = unread > 9 ? '9+' : String(unread)

  const markSeen = () => { const now = new Date().toISOString(); setSeenAt(now); writeSeen(now) }
  const openSheet = () => { setSheetSeenAt(seenAt); markSeen(); setComposing(false); setOpen(true) }
  const closeSheet = () => { markSeen(); setOpen(false) } // anything that arrived while it was open was seen too
  const markAllRead = () => { setSheetSeenAt(new Date().toISOString()); announce('All notifications marked read') }
  const go = (n: AppNotification) => { if (!n.url) return; closeSheet(); location.hash = toHash(n.url) }
  const remove = async (n: AppNotification) => {
    setItems(list => list.filter(x => x.id !== n.id))
    try { await api.deleteNotification(n.id); announce('Notification removed') } catch { load() }
  }
  const clearAll = async () => {
    if (!await dialog.confirm({ title: 'Clear all notifications?', body: 'Removes them for the whole family, on every device.', confirmLabel: 'Clear all', danger: true })) return
    setItems([])
    try { await api.clearNotifications(); announce('Notifications cleared') } catch { load() }
  }

  const tz = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const groups: { key: string; rows: AppNotification[] }[] = []
  for (const n of items) {
    const key = zonedDayKey(n.at, tz)
    if (groups.at(-1)?.key !== key) groups.push({ key, rows: [] })
    groups.at(-1)!.rows.push(n)
  }
  const sheetUnread = items.some(n => n.at > sheetSeenAt)

  return (
    <>
      <button className="icon-btn header-bell" onClick={openSheet} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
        <BellIcon width={22} height={22} />
        {unread > 0 && <span className="bell-badge" aria-hidden="true">{badge}</span>}
      </button>
      {open && (
        <Sheet title="Notifications" onClose={closeSheet}>
          {(sheetUnread || (isAdmin && items.length > 0)) && (
            <div className="notif-toolbar">
              {sheetUnread && <button className="btn btn-secondary" onClick={markAllRead}>Mark all read</button>}
              {isAdmin && items.length > 0 && <button className="btn btn-secondary" onClick={clearAll}>Clear all</button>}
            </div>
          )}
          {items.length === 0 && <p className="notif-empty">Nothing yet — reminders and messages will show up here.</p>}
          {groups.map(g => (
            <section key={g.key} className="notif-group" aria-label={dayLabel(g.key, tz)}>
              <h3 className="notif-day">{dayLabel(g.key, tz)}</h3>
              <ul className="notif-list">
                {g.rows.map(n => {
                  const isUnread = n.at > sheetSeenAt
                  const who = n.memberIds.map(id => members.find(m => m.id === id)).filter(m => !!m)
                  const content = (
                    <>
                      <span className="notif-icon" aria-hidden="true">{KIND_ICON[n.kind] ?? '🔔'}</span>
                      <span className="notif-main">
                        <span className="notif-title">{isUnread && <><span className="notif-dot" /><span className="sr-only">Unread: </span></>}{n.title}</span>
                        {n.body && <span className="notif-body">{n.body}</span>}
                        <span className="notif-meta">
                          <time dateTime={n.at}>{relTime(n.at, tz)}</time>
                          {who.length > 0 && (
                            <span className="notif-who">
                              <span className="sr-only">For {who.map(m => m.name).join(', ')}</span>
                              {who.map(m => <span key={m.id} className="member-avatar-sm notif-avatar" aria-hidden="true" style={{ background: m.color, color: inkFor(m.color) }}>{m.avatar || m.name[0]}</span>)}
                            </span>
                          )}
                        </span>
                      </span>
                    </>
                  )
                  return (
                    <li key={n.id} className="notif-row">
                      {n.url
                        ? <button className={`notif-item ${isUnread ? 'unread' : ''}`} onClick={() => go(n)}>{content}</button>
                        : <div className={`notif-item ${isUnread ? 'unread' : ''}`}>{content}</div>}
                      {isAdmin && <button className="icon-btn notif-remove" onClick={() => remove(n)} aria-label={`Remove: ${n.title}`}>×</button>}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
          {isAdmin && (composing
            ? <SendMessageForm onSent={() => { setComposing(false); load() }} />
            : <div className="notif-compose"><button className="btn btn-secondary" onClick={() => setComposing(true)}>💬 Send a message</button></div>)}
        </Sheet>
      )}
    </>
  )
}
