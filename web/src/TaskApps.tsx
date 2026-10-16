// To-do apps: Settings → Calendars → To-do apps (connect Todoist, Google Tasks, Microsoft To Do),
// a to-do list's "Sync with…" in its Edit sheet, and the synced list's status line. Server:
// routes/tasks.ts. Connecting and linking are for parent devices; every screen sees the status.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import { useDialog } from './dialog.tsx'
import { appProviderReturn, inNativeApp } from './native.ts'
import { ChevronRight } from './icons.tsx'
import { whenLabel } from './addedBy.ts'
import { t } from './i18n.ts'
import { appName, calendarAccountFor, taskLinkBroken } from './taskSync.ts'
import type { Account, List, TaskAccount, TaskAppKind, TaskAppList, TaskLink } from './types.ts'

/** Google Tasks or Microsoft To Do: the server answers this browser with the consent URL and the
 * cookie its callback needs (like connectCalendar in ProviderConfig.tsx). */
async function connectTaskApp(kind: 'google' | 'microsoft', say: (m: string) => void, loginHint?: string | null) {
  if (inNativeApp() && !appProviderReturn()) {
    say(t('Update the Kinwall app to connect {name}, or connect from a web browser.', { name: appName(kind) }))
    return
  }
  try {
    location.href = (await api.startTaskApp(kind, loginHint ?? undefined)).url
  } catch (e) {
    say(e instanceof Error ? e.message : t("Couldn't start the {name} sign-in", { name: appName(kind) }))
  }
}

/** The Settings card's rows: connected accounts, the lists each one syncs, and the connect buttons. */
export function TaskAppsRows({ toast }: { toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
  const [accounts, setAccounts] = useState<TaskAccount[]>([])
  const [links, setLinks] = useState<TaskLink[]>([])
  const [lists, setLists] = useState<List[]>([])
  const [calendarAccounts, setCalendarAccounts] = useState<Account[]>([])
  const [oauth, setOauth] = useState({ google: false, microsoft: false })
  const [todoist, setTodoist] = useState(false)

  const load = () => {
    api.getTaskAccounts().then(setAccounts).catch(() => {})
    api.getTaskLinks().then(setLinks).catch(() => {})
    api.getLists().then(setLists).catch(() => {})
    api.getAccounts().then(setCalendarAccounts).catch(() => {})
    api.getProviders().then(p => setOauth({ google: p.google.configured, microsoft: p.microsoft.configured })).catch(() => {})
  }
  useEffect(load, [])
  // Back from Google or Microsoft (routes/oauth.ts → ?taskAccount= or ?taskError=): say how it went, once.
  useEffect(() => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '')
    const error = q.get('taskError'), account = q.get('taskAccount')
    if (!error && !account) return
    if (error) {
      const [kind, ...rest] = error.split(':')
      const name = appName(kind === 'microsoft' ? 'microsoft' : 'google'), reason = rest.join(':').trim()
      toast(reason === 'canceled' ? t('{name} sign-in canceled — nothing was connected', { name }) : t('{name} connection failed: {reason}', { name, reason }), true)
    } else toast(t('Connected. Pick a to-do list to sync in its Edit sheet.'))
    q.delete('taskError'); q.delete('taskAccount')
    history.replaceState(history.state, '', `#/settings?${q}`)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const reconnect = (a: TaskAccount) => a.kind === 'todoist' ? setTodoist(true) : connectTaskApp(a.kind, m => toast(m, true), a.name)
  const remove = async (a: TaskAccount) => {
    const body = a.kind === 'todoist' ? t('Lists stop syncing; their items stay in Kinwall and in Todoist. To turn the token off too, reset it in Todoist’s settings.')
      : a.alsoCalendar ? t('Lists stop syncing; their items stay in Kinwall and in {app}. Your calendars from this account keep syncing.', { app: appName(a.kind) })
      : t('Lists stop syncing; their items stay in Kinwall and in {app}.', { app: appName(a.kind) })
    if (!await dialog.confirm({ title: t('Remove {account}?', { account: a.name }), body, confirmLabel: t('Remove'), danger: true })) return
    try { await api.deleteTaskAccount(a.id); load() } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not remove the account'), true) }
  }
  const googleHint = calendarAccountFor('google', calendarAccounts, accounts)
  const msHint = calendarAccountFor('microsoft', calendarAccounts, accounts)

  return <>
    <p className="settings-row-sub">{t('Sync a to-do list with Todoist, Google Tasks or Microsoft To Do: open the list, tap Edit, then Sync with…')}</p>
    {accounts.map(a => {
      const mine = links.filter(l => l.accountId === a.id)
      const broken = mine.find(l => l.lastErrorCode === 'revoked')
      const names = mine.map(l => lists.find(x => x.id === l.listId)?.name).filter(Boolean)
      return (
        <div key={a.id} className="cal-list-item">
          <div className="cal-list-top task-account-top">
            <span className="cal-name">{a.name}</span>
            <span className="cal-kind-badge">{appName(a.kind)}</span>
            <span className={`cal-sub ${broken ? 'error' : ''}`}>
              {broken ? broken.lastError : names.length ? t('Syncs {lists}', { lists: names.join(', ') }) : t('No lists sync yet')}
            </span>
          </div>
          <div className="cal-actions">
            {broken && <button className="btn btn-primary cal-reconnect" disabled={a.kind !== 'todoist' && !oauth[a.kind]} onClick={() => reconnect(a)}>{t('Reconnect')}</button>}
            <button className="link-btn cal-remove" style={{ color: 'var(--danger)' }} onClick={() => remove(a)} aria-label={t('Remove {account}', { account: a.name })}>{t('Remove')}</button>
          </div>
        </div>
      )
    })}
    <div className="connect-buttons" style={{ marginTop: 14 }}>
      <button className="connect-btn" onClick={() => setTodoist(true)}>{t('Connect {provider}', { provider: 'Todoist' })}</button>
      <button className="connect-btn" disabled={!oauth.google} onClick={() => connectTaskApp('google', m => toast(m, true), googleHint)}>
        {googleHint ? t('Add Google Tasks to {account}', { account: googleHint }) : t('Connect {provider}', { provider: appName('google') })}
        {!oauth.google && <span className="connect-btn-note">{t('Needs setup')}</span>}
      </button>
      <button className="connect-btn" disabled={!oauth.microsoft} onClick={() => connectTaskApp('microsoft', m => toast(m, true), msHint)}>
        {msHint ? t('Add Microsoft To Do to {account}', { account: msHint }) : t('Connect {provider}', { provider: appName('microsoft') })}
        {!oauth.microsoft && <span className="connect-btn-note">{t('Needs setup')}</span>}
      </button>
    </div>
    {(!oauth.google || !oauth.microsoft) && <p className="settings-row-sub" style={{ marginTop: 8 }}>{t('Google Tasks and Microsoft To Do use the Google and Microsoft sign-ins under Calendar providers below.')}</p>}
    {todoist && <TodoistSheet onClose={() => setTodoist(false)} onConnected={() => { setTodoist(false); load(); toast(t('Connected. Pick a to-do list to sync in its Edit sheet.')) }} toast={toast} />}
  </>
}

function TodoistSheet({ onClose, onConnected, toast }: { onClose: () => void; onConnected: () => void; toast: (m: string, persist?: boolean) => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!token.trim()) return
    setBusy(true)
    try { await api.connectTodoist(token.trim()); onConnected() } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not connect Todoist'), true) } finally { setBusy(false) }
  }
  return (
    <Sheet title={t('Connect {provider}', { provider: 'Todoist' })} onClose={onClose} dirty={!!token}
      actions={<button className="btn btn-primary btn-block" onClick={save} disabled={!token.trim() || busy}>{busy ? t('Connecting…') : t('Connect')}</button>}>
      <div className="field">
        <label htmlFor="todoist-token">{t('Todoist API token')}</label>
        <input id="todoist-token" type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" spellCheck={false} aria-describedby="todoist-token-hint" autoFocus />
      </div>
      <p className="field-hint" id="todoist-token-hint">{t('Where to find it: in Todoist, open Settings, then Integrations, then Developer, and copy your API token. Kinwall keeps it locked with your family’s key and uses it only to sync the lists you pick. You can reset it there any time.')}</p>
    </Sheet>
  )
}

/** A synced list's link, kept fresh as the list changes (rev). null: not synced. */
export function useTaskLink(listId: string, rev: unknown): TaskLink | null {
  const [link, setLink] = useState<TaskLink | null>(null)
  useEffect(() => {
    let live = true
    api.getTaskLinks().then(all => { if (live) setLink(all.find(l => l.listId === listId) ?? null) }).catch(() => {})
    return () => { live = false }
  }, [listId, rev])
  return link
}

/** Under a synced list's name: where it syncs, and on parent devices a warning when it can't. */
export function TaskSyncLine({ link }: { link: TaskLink }) {
  const { parentDevice } = useApp()
  const where = t('Syncs with {list} in {app}', { list: link.remoteName, app: appName(link.app) })
  if (parentDevice && taskLinkBroken(link)) return (
    <div className="sync-alert task-sync-alert" role="status">
      <span aria-hidden="true">⚠️</span>
      <span>{t("This list isn't syncing with {app}.", { app: appName(link.app) })} {link.lastError} <a className="text-link" href="#/settings?tab=calendars&section=todo-apps">{t('Repair the connection')}</a></span>
    </div>
  )
  return <div className="list-detail-sub task-sync-line">🔄 {link.lastSyncedAt ? t('{where} · synced {time}', { where, time: whenLabel(link.lastSyncedAt) }) : where}</div>
}

/** The Edit sheet's row: what the list syncs with, opening the Sync with… sheet. */
export function TaskSyncField({ list }: { list: List }) {
  const [open, setOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const link = useTaskLink(list.id, tick)
  const value = link ? t('{list} in {app}', { list: link.remoteName, app: appName(link.app) }) : t('Not synced')
  return (
    <div className="field">
      <label htmlFor="list-task-sync">{t('Sync with…')}</label>
      <button id="list-task-sync" type="button" className="sheet-link" aria-haspopup="dialog" onClick={() => setOpen(true)} aria-label={t('Sync with: {value}', { value })}>
        <span>{value}<small>{t('Todoist, Google Tasks or Microsoft To Do')}</small></span><ChevronRight />
      </button>
      {open && <TaskSyncSheet list={list} link={link} onClose={() => setOpen(false)} onChanged={() => setTick(n => n + 1)} />}
    </div>
  )
}

const NEW = '\u0000new'

function TaskSyncSheet({ list, link, onClose, onChanged }: { list: List; link: TaskLink | null; onClose: () => void; onChanged: () => void }) {
  const { toast } = useApp()
  const dialog = useDialog()
  const [accounts, setAccounts] = useState<TaskAccount[] | null>(null)
  const [accountId, setAccountId] = useState(link?.accountId ?? '')
  const [remote, setRemote] = useState<TaskAppList[] | null>(null)
  const [remoteId, setRemoteId] = useState(link?.remoteId ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.getTaskAccounts().then(a => { setAccounts(a); setAccountId(id => id || a[0]?.id || '') }).catch(() => setAccounts([])) }, [])
  useEffect(() => {
    if (!accountId) return
    setRemote(null)
    api.getTaskAppLists(accountId).then(r => {
      setRemote(r)
      // The list of the same name, else a new one named after this list.
      setRemoteId(id => (r.some(x => x.remoteId === id) ? id : r.find(x => x.name.toLowerCase() === list.name.toLowerCase())?.remoteId ?? NEW))
    }).catch(e => { setRemote([]); toast(e instanceof ApiError ? e.message : t('Could not load the lists'), true) })
  }, [accountId]) // eslint-disable-line react-hooks/exhaustive-deps
  const account = accounts?.find(a => a.id === accountId)
  const changedPick = !link || link.accountId !== accountId || link.remoteId !== remoteId

  const save = async () => {
    if (!account || !remoteId) return
    setBusy(true)
    try {
      const done = await api.linkTaskList(list.id, remoteId === NEW ? { accountId, newListName: list.name } : { accountId, remoteId })
      onChanged()
      if (done.lastError) toast(done.lastError, true)
      else toast(t('Syncing {list} with {app}', { list: list.name, app: appName(account.kind) }))
      onClose()
    } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not start syncing'), true) } finally { setBusy(false) }
  }
  const syncNow = async () => {
    if (!link) return
    setBusy(true)
    try { const l = await api.syncTaskList(list.id); onChanged(); toast(l.lastError ?? t('Synced'), !!l.lastError) } catch (e) { toast(e instanceof ApiError ? e.message : t('Sync failed'), true) } finally { setBusy(false) }
  }
  const stop = async () => {
    if (!link) return
    if (!await dialog.confirm({ title: t('Stop syncing “{name}”?', { name: list.name }), body: t('Its items stay in Kinwall and in {app}.', { app: appName(link.app) }), confirmLabel: t('Stop syncing'), danger: true })) return
    try { await api.unlinkTaskList(list.id); onChanged(); onClose() } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not stop syncing'), true) }
  }
  const label = (kind: TaskAppKind, name: string) => t('{app}: {account}', { app: appName(kind), account: name })

  return (
    <Sheet title={t('Sync with…')} onClose={onClose}
      actions={accounts?.length ? <button className="btn btn-primary btn-block" onClick={save} disabled={busy || !remote || !remoteId || !changedPick}>{busy ? t('Syncing…') : link ? t('Save') : t('Start syncing')}</button> : undefined}>
      {accounts === null ? <p className="settings-row-sub">{t('Loading…')}</p> : !accounts.length ? (
        <p className="settings-row-sub">{t('First connect Todoist, Google Tasks or Microsoft To Do in Settings → Calendars → To-do apps.')} <a className="text-link" href="#/settings?tab=calendars&section=todo-apps" onClick={onClose}>{t('Open Settings')}</a></p>
      ) : <>
        {link && (
          <div className="field">
            <TaskSyncLine link={link} />
            {link.lastError && !taskLinkBroken(link) && <p className="field-hint">{link.lastError}</p>}
          </div>
        )}
        <div className="field">
          <label htmlFor="task-sync-account">{t('Account')}</label>
          <select id="task-sync-account" value={accountId} onChange={e => setAccountId(e.target.value)}>
            {accounts.map(a => <option key={a.id} value={a.id}>{label(a.kind, a.name)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="task-sync-list">{account ? t('List in {app}', { app: appName(account.kind) }) : t('List')}</label>
          <select id="task-sync-list" value={remoteId} onChange={e => setRemoteId(e.target.value)} disabled={!remote}>
            {!remote && <option value={remoteId}>{t('Loading…')}</option>}
            {remote?.map(r => <option key={r.remoteId} value={r.remoteId}>{r.name}</option>)}
            {remote && <option value={NEW}>{t('Make a new one: {name}', { name: list.name })}</option>}
          </select>
        </div>
        <p className="field-hint">{t('Titles, done, due dates and notes sync both ways, and priority with Todoist and Microsoft To Do. Who it’s for, steps and the discussion stay in Kinwall.')}</p>
        <p className="field-hint">{link ? t('Picking another list starts over: items with the same title are matched, the rest are copied across.') : t('Items with the same title are matched; the rest are copied across. Done items stay where they are.')}</p>
        {link && (
          <div className="sheet-danger-zone">
            <button className="link-btn" onClick={syncNow} disabled={busy}>{t('Sync now')}</button>
            <button className="link-btn link-danger" onClick={stop}>{t('Stop syncing')}</button>
          </div>
        )}
      </>}
    </Sheet>
  )
}
