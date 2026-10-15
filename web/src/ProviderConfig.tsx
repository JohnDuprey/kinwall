// Shared Google/Microsoft OAuth provider config form — used by Settings' "Calendar providers"
// section and reused as-is inside the setup wizard's calendars step (same component, just a
// different `useAdmin` key while the wizard's own key is still display-scoped).
import { useId, useState } from 'react'
import { DOCS_URL } from './Help.tsx'
import { api, ApiError } from './api.ts'
import type { Providers } from './types.ts'
import { useDialog } from './dialog.tsx'
import { appProviderReturn, inNativeApp } from './native.ts'

const LABEL = { google: 'Google', microsoft: 'Microsoft' } as const

/** Connect Google or Outlook: the server answers this browser with the consent URL and a cookie
 * the callback needs (server/src/routes/oauth.ts), so the sign-in has to happen here. An older
 * Kinwall app can't bring the sign-in back from its in-app browser, so it says so instead. */
export async function connectCalendar(kind: 'google' | 'microsoft', say: (m: string) => void) {
  if (inNativeApp() && !appProviderReturn()) {
    say(`Update the Kinwall app to connect ${LABEL[kind]}, or connect from a web browser.`)
    return
  }
  try {
    location.href = (await api.oauthStart(kind)).url
  } catch (e) {
    say(e instanceof Error ? e.message : `Couldn't start the ${LABEL[kind]} sign-in`)
  }
}

// Always saves/deletes with the admin key (getAdminKey() ?? the stored key — see api.ts) since
// these routes are admin-only regardless of caller: the setup wizard's temporary session admin
// key covers a display-role device mid-setup, and the stored key already is admin otherwise.
export function ProviderForm({ kind, providers, toast, onChanged }: {
  kind: 'google' | 'microsoft'
  providers: Providers
  toast: (m: string, persist?: boolean) => void
  onChanged: () => void
}) {
  const dialog = useDialog()
  const status = providers[kind]
  const redirect = providers.redirectUris[kind]
  const locked = status.source === 'env'
  const [clientId, setClientId] = useState(status.clientId ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [tenant, setTenant] = useState(status.tenant ?? 'common')
  const [showGuide, setShowGuide] = useState(false)
  const [copied, setCopied] = useState(false)
  const label = LABEL[kind]
  const id = useId()

  const save = async () => {
    if (!clientId.trim()) return
    try {
      await api.saveProvider(kind, { clientId: clientId.trim(), clientSecret: clientSecret.trim() || undefined, tenant: kind === 'microsoft' ? tenant.trim() || 'common' : undefined })
      setClientSecret('')
      toast(`${label} saved`)
      onChanged()
    } catch (e) { toast(e instanceof ApiError ? e.message : `Could not save ${label}`, true) }
  }
  const remove = async () => {
    if (!await dialog.confirm({ title: `Remove the ${kind === 'google' ? 'Google' : 'Microsoft'} sign-in settings?`, body: 'Connected calendars stop syncing until they are set up again.', confirmLabel: 'Remove', danger: true })) return
    try { await api.deleteProvider(kind); setClientId(''); setClientSecret(''); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : `Could not remove ${label}`, true) }
  }
  const copy = () => {
    navigator.clipboard?.writeText(redirect).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }

  return (
    <div className="provider-card">
      <div className="provider-card-head">
        <div className="settings-row-label">{label}</div>
        <div className={`provider-chip ${status.source ?? 'none'}`}>
          {status.source === 'env' ? 'Provided by your host' : status.source === 'ui' ? 'Configured' : 'Not set up'}
        </div>
      </div>

      {locked ? (
        <p className="settings-row-sub">{label} sign-in is provided by your host — nothing to set up here.</p>
      ) : <>
        {!status.configured && <p className="settings-row-sub provider-intro">{kind === 'google' ? 'Google' : 'Outlook'} needs a one-time app setup, about 10 minutes. Easier: subscribe to a link or use iCloud.</p>}
        <div className="provider-guide-links">
          <a className="text-link" href={`${DOCS_URL}/calendars/${kind}`} target="_blank" rel="noopener">Step-by-step guide</a>
          <button className="link-btn" onClick={() => setShowGuide(s => !s)} aria-expanded={showGuide}>{showGuide ? 'Hide the steps' : 'Show the steps here'}</button>
        </div>
        {showGuide && (
          <ol className="provider-guide">
            {kind === 'google' ? (
              <>
                <li>In Google Cloud Console, create an OAuth client of type "Web application".</li>
                <li>Add the redirect URI below to its Authorized redirect URIs.</li>
                <li>Enable the Google Calendar API for the project.</li>
                <li>Under Data access, add the scopes <code>calendar.events</code> and <code>calendar.calendarlist.readonly</code> (and openid, email).</li>
                <li>If the consent screen is in Testing, add yourself as a test user.</li>
              </>
            ) : (
              <>
                <li>In Microsoft Entra, go to App registrations → New registration.</li>
                <li>Add the redirect URI below under a Web platform.</li>
                <li>Add delegated permissions: Calendars.ReadWrite, User.Read, offline_access.</li>
                <li>Create a client secret and paste it below.</li>
              </>
            )}
          </ol>
        )}
        <div className="field">
          <label htmlFor={`${id}-redirect`}>Redirect URI</label>
          <div className="provider-redirect">
            <code id={`${id}-redirect`}>{redirect}</code>
            <button className="link-btn" onClick={copy} aria-label={copied ? 'Copied' : 'Copy the redirect URI'}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          {redirect.startsWith('/') && <p className="settings-row-sub">Set the Public URL above first — {label} needs a full https:// redirect URI.</p>}
        </div>
        <div className="field"><label htmlFor={`${id}-client`}>Client ID</label><input id={`${id}-client`} type="text" value={clientId} onChange={e => setClientId(e.target.value)} /></div>
        <div className="field">
          <label htmlFor={`${id}-secret`}>Client secret</label>
          <input id={`${id}-secret`} type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder={status.secretSet ? '••••• set — leave blank to keep' : ''} />
        </div>
        {kind === 'microsoft' && <div className="field"><label htmlFor={`${id}-tenant`}>Tenant</label><input id={`${id}-tenant`} type="text" value={tenant} onChange={e => setTenant(e.target.value)} placeholder="common" /></div>}
        <div className="form-actions">
          <button className="btn btn-primary" onClick={save} disabled={!clientId.trim()}>Save</button>
          {status.configured && <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={remove}>Remove</button>}
        </div>
      </>}

      {status.configured && <button className="btn btn-block" onClick={() => connectCalendar(kind, m => toast(m, true))}>Test sign-in</button>}
    </div>
  )
}

export function PublicUrlRow({ providers, toast, onChanged }: { providers: Providers; toast: (m: string, persist?: boolean) => void; onChanged: () => void }) {
  const locked = providers.publicUrl.source === 'env'
  const [value, setValue] = useState(providers.publicUrl.value ?? (typeof location !== 'undefined' ? location.origin : ''))
  const [warning, setWarning] = useState<string | undefined>()

  const save = async () => {
    if (!value.trim()) return
    try {
      const res = await api.savePublicUrl(value.trim())
      setValue(res.value)
      setWarning(res.warning)
      toast('Public URL saved')
      onChanged()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save public URL', true) }
  }

  return (
    <div className="field">
      <label htmlFor="provider-public-url">Public URL</label>
      {locked ? (
        <p className="settings-row-sub">Set via PUBLIC_URL — {providers.publicUrl.value}</p>
      ) : (
        <>
          <div className="provider-redirect">
            <input id="provider-public-url" type="url" value={value} onChange={e => setValue(e.target.value)} placeholder="https://cal.home.example" />
            <button className="btn btn-primary" onClick={save} disabled={!value.trim()}>Save</button>
          </div>
          {warning && <p className="settings-row-sub" style={{ color: 'var(--danger)' }}>{warning}</p>}
        </>
      )}
    </div>
  )
}
