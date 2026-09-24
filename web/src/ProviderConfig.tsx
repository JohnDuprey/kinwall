// Shared Google/Microsoft OAuth provider config form — used by Settings' "Calendar providers"
// section and reused as-is inside the setup wizard's calendars step (same component, just a
// different `useAdmin` key while the wizard's own key is still display-scoped).
import { useState } from 'react'
import { api, ApiError } from './api.ts'
import type { Providers } from './types.ts'

const LABEL = { google: 'Google', microsoft: 'Microsoft' } as const

// Always saves/deletes with the admin key (getAdminKey() ?? the stored key — see api.ts) since
// these routes are admin-only regardless of caller: the setup wizard's temporary session admin
// key covers a display-role device mid-setup, and the stored key already is admin otherwise.
export function ProviderForm({ kind, providers, toast, onChanged }: {
  kind: 'google' | 'microsoft'
  providers: Providers
  toast: (m: string) => void
  onChanged: () => void
}) {
  const status = providers[kind]
  const redirect = providers.redirectUris[kind]
  const locked = status.source === 'env'
  const [clientId, setClientId] = useState(status.clientId ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [tenant, setTenant] = useState(status.tenant ?? 'common')
  const [showGuide, setShowGuide] = useState(false)
  const [copied, setCopied] = useState(false)
  const label = LABEL[kind]

  const save = async () => {
    if (!clientId.trim()) return
    try {
      await api.saveProvider(kind, { clientId: clientId.trim(), clientSecret: clientSecret.trim() || undefined, tenant: kind === 'microsoft' ? tenant.trim() || 'common' : undefined })
      setClientSecret('')
      toast(`${label} saved`)
      onChanged()
    } catch (e) { toast(e instanceof ApiError ? e.message : `Could not save ${label}`) }
  }
  const remove = async () => {
    try { await api.deleteProvider(kind); setClientId(''); setClientSecret(''); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : `Could not remove ${label}`) }
  }
  const copy = () => {
    navigator.clipboard?.writeText(redirect).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }

  return (
    <div className="provider-card">
      <div className="provider-card-head">
        <div className="settings-row-label">{label}</div>
        <div className={`provider-chip ${status.source ?? 'none'}`}>
          {status.source === 'env' ? 'Configured by server' : status.source === 'ui' ? 'Configured' : 'Not set up'}
        </div>
      </div>

      {locked ? (
        <p className="settings-row-sub">
          Set via {kind === 'google' ? 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET' : 'MS_CLIENT_ID / MS_CLIENT_SECRET'} — remove those env vars to configure here instead.
        </p>
      ) : (
        <>
          <div className="field"><label>Client ID</label><input type="text" value={clientId} onChange={e => setClientId(e.target.value)} /></div>
          <div className="field">
            <label>Client secret</label>
            <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder={status.secretSet ? '••••• set — leave blank to keep' : ''} />
          </div>
          {kind === 'microsoft' && <div className="field"><label>Tenant</label><input type="text" value={tenant} onChange={e => setTenant(e.target.value)} placeholder="common" /></div>}
          <div className="cal-actions">
            <button className="btn btn-primary" onClick={save}>Save</button>
            {status.configured && <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={remove}>Remove</button>}
          </div>
        </>
      )}

      <div className="field">
        <label>Redirect URI</label>
        <div className="provider-redirect">
          <code>{redirect}</code>
          <button className="link-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        {redirect.startsWith('/') && <p className="settings-row-sub">Set the Public URL above first — {label} needs a full https:// redirect URI.</p>}
      </div>

      <button className="link-btn" onClick={() => setShowGuide(s => !s)}>{showGuide ? 'Hide setup guide' : 'Show setup guide'}</button>
      {showGuide && (
        <ol className="provider-guide">
          {kind === 'google' ? (
            <>
              <li>In Google Cloud Console, create an OAuth client of type "Web application".</li>
              <li>Add the redirect URI above to its Authorized redirect URIs.</li>
              <li>Enable the Google Calendar API for the project.</li>
              <li>If the consent screen is in Testing, add yourself as a test user.</li>
            </>
          ) : (
            <>
              <li>In Microsoft Entra, go to App registrations → New registration.</li>
              <li>Add the redirect URI above under a Web platform.</li>
              <li>Add delegated permissions: Calendars.ReadWrite, User.Read, offline_access.</li>
              <li>Create a client secret and paste it above.</li>
            </>
          )}
        </ol>
      )}

      {status.configured && <button className="btn btn-block" onClick={() => location.href = api.oauthStartUrl(kind)}>Test sign-in</button>}
    </div>
  )
}

export function PublicUrlRow({ providers, toast, onChanged }: { providers: Providers; toast: (m: string) => void; onChanged: () => void }) {
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
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save public URL') }
  }

  return (
    <div className="field">
      <label>Public URL</label>
      {locked ? (
        <p className="settings-row-sub">Set via PUBLIC_URL — {providers.publicUrl.value}</p>
      ) : (
        <>
          <div className="provider-redirect">
            <input type="url" value={value} onChange={e => setValue(e.target.value)} placeholder="https://cal.home.example" />
            <button className="btn btn-primary" onClick={save}>Save</button>
          </div>
          {warning && <p className="settings-row-sub" style={{ color: 'var(--danger)' }}>{warning}</p>}
        </>
      )}
    </div>
  )
}
