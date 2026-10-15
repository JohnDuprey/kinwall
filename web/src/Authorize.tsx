import { useEffect, useState } from 'react'
import { api, ApiError, setAdminKey } from './api.ts'
import { loginWithPasskey, passkeysSupported, registerPasskey } from './webauthn.ts'
import Setup from './Setup.tsx'
import type { Member } from './types.ts'
import { Brand } from './Brand.tsx'
import { ChipFace } from './Face'
import { t } from './i18n.ts'

/** A translated sentence with its {placeholders} shown in bold. */
const bold = (text: string, vars: Record<string, string>) =>
  text.split(/\{(\w+)\}/).map((part, i) => i % 2 ? <b key={i}>{vars[part]}</b> : part)

/** OAuth consent for MCP clients and the Kinwall apps (#/authorize?..., reached via the server's
 * /oauth/authorize). Signs in with a passkey, a recovery code, or an admin key held for this
 * session only. On a server that isn't set up yet it runs the setup wizard first. Someone who got
 * in without a passkey is offered one before approving (this page runs in the browser, or an
 * app's Safari sheet, where passkeys work on any domain). The server re-validates everything on
 * approve and returns the redirect to follow. */
export default function AuthorizeScreen() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '')
  const qs = params.toString()
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.authorizationRequest>> | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [scope, setScope] = useState<'admin' | 'display'>('admin')
  // Kinwall's own app: whose device this is ('shared' or a member id). MCP clients aren't asked.
  const [owner, setOwner] = useState('shared')
  const [members, setMembers] = useState<Member[]>([])
  const [adminKeyValue, setAdminKeyValue] = useState('')
  const [recoveryValue, setRecoveryValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [setup, setSetup] = useState<Awaited<ReturnType<typeof api.getSetup>> | null>(null) // set while unclaimed
  const [offerPasskey, setOfferPasskey] = useState(false)
  const [passkeyAdded, setPasskeyAdded] = useState(false)

  const load = async () => {
    setError('')
    try {
      const r = await api.authorizationRequest(qs)
      setInfo(r)
      setScope(r.requestedScope)
      setNeedsSignIn(false)
      if (r.deviceApp) setMembers(await api.getMembers(true).catch(() => []))
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setNeedsSignIn(true)
      else setError(e instanceof ApiError ? e.message : t('Could not load this request'))
    }
  }
  useEffect(() => {
    api.getSetup().then(s => { if (!s.claimed) setSetup(s); else load() }).catch(() => load())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = async (how: 'passkey' | 'recovery' | 'key') => {
    setBusy(true); setError('')
    try {
      if (how === 'passkey') setAdminKey((await loginWithPasskey()).key)
      else if (how === 'recovery') { setAdminKey((await api.recoveryLogin(recoveryValue.trim())).key); setOfferPasskey(passkeysSupported()) }
      else if (adminKeyValue.trim()) { setAdminKey(adminKeyValue.trim()); setOfferPasskey(passkeysSupported()) }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Sign-in failed'))
    } finally {
      setBusy(false)
    }
  }

  const addPasskey = async () => {
    setBusy(true); setError('')
    try {
      await registerPasskey(/iPad/.test(navigator.userAgent) ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : t('This device'), undefined, true)
      setPasskeyAdded(true); setOfferPasskey(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not create a passkey'))
    } finally {
      setBusy(false)
    }
  }

  const decide = async (decision: 'approve' | 'deny') => {
    setBusy(true); setError('')
    try {
      const { redirect } = await api.decideAuthorization({
        decision, scope, owner: info?.deviceApp && (scope === 'admin' || !members.find(m => m.id === owner)?.grownUp) ? owner : undefined,
        client_id: params.get('client_id') ?? undefined,
        redirect_uri: params.get('redirect_uri') ?? undefined,
        state: params.get('state') ?? undefined,
        code_challenge: params.get('code_challenge') ?? undefined,
        code_challenge_method: params.get('code_challenge_method') ?? undefined,
      })
      location.href = redirect
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Could not complete this request'))
      setBusy(false)
    }
  }

  // A server that isn't set up has no admin to approve anything yet: set it up here, then continue.
  if (setup) return <Setup oauth={setup.oauth} passkeyRequired={setup.passkeyRequired} onDone={() => { setSetup(null); load() }} />

  return (
    <div className="gate-screen">
      <div className="gate-card authorize-card">
        <Brand />
        {needsSignIn ? (
          <>
            <h1>{t('Sign in to continue')}</h1>
            <p>{t('An app wants to connect to Kinwall. Sign in as a parent to review it.')}</p>
            {passkeysSupported() && <button className="btn btn-primary btn-block" onClick={() => signIn('passkey')} disabled={busy}>{busy ? t('Checking…') : t('Sign in with passkey')}</button>}
            <div className="field" style={{ textAlign: 'left', marginTop: 16 }}>
              <label htmlFor="authorize-recovery">{t('No passkey here? Use a recovery code')}</label>
              <input id="authorize-recovery" type="text" value={recoveryValue} onChange={e => setRecoveryValue(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
            </div>
            <button className="btn btn-secondary btn-block" onClick={() => signIn('recovery')} disabled={busy || !recoveryValue.trim()}>{t('Continue')}</button>
            <details className="authorize-more">
              <summary>{t('Use an admin API key')}</summary>
              <div className="field" style={{ textAlign: 'left', marginTop: 8 }}>
                <label htmlFor="authorize-key">{t('Admin API key')}</label>
                <input id="authorize-key" type="password" value={adminKeyValue} onChange={e => setAdminKeyValue(e.target.value)} autoComplete="off" />
              </div>
              <button className="btn btn-secondary btn-block" onClick={() => signIn('key')} disabled={busy || !adminKeyValue.trim()}>{t('Continue')}</button>
            </details>
          </>
        ) : !info ? (
          <p>{error || t('Loading…')}</p>
        ) : (
          <>
            <h1>{t('Connect {name}?', { name: info.clientName })}</h1>
            <p>{bold(t("{name} wants to use Kinwall. You'll return to {host} afterwards."), { name: info.clientName, host: info.redirectHost })}</p>
            {offerPasskey && (
              <div className="authorize-passkey">
                <b>{t('Sign in faster next time')}</b>
                <span>{t("Create a passkey on this device, so you won't need a recovery code again.")}</span>
                <div className="authorize-passkey-actions">
                  <button className="btn btn-secondary" onClick={addPasskey} disabled={busy}>{t('Create a passkey')}</button>
                  <button className="link-btn" onClick={() => setOfferPasskey(false)} disabled={busy}>{t('Not now')}</button>
                </div>
              </div>
            )}
            {passkeyAdded && <p className="authorize-passkey-done" role="status">{t('Passkey created. Use it next time you sign in.')}</p>}
            <div className="authorize-scopes" role="group" aria-label={t('Access level')}>
              <button className={`authorize-scope ${scope === 'admin' ? 'active' : ''}`} aria-pressed={scope === 'admin'} onClick={() => setScope('admin')}>
                <b>{t('Full access')}</b><span>{t('Everything you can do as an admin, including members and settings.')}</span>
              </button>
              <button className={`authorize-scope ${scope === 'display' ? 'active' : ''}`} aria-pressed={scope === 'display'} onClick={() => setScope('display')}>
                <b>{t('Everyday access')}</b><span>{t('Calendar, chores and lists. No members, settings or keys.')}</span>
              </button>
            </div>
            {info.deviceApp && (
              <div className="field authorize-owner">
                <label id="authorize-owner">{t('Whose device is this?')}</label>
                <div className="chip-row" role="group" aria-labelledby="authorize-owner">
                  <button type="button" className={`chip ${owner === 'shared' ? 'active' : ''}`} aria-pressed={owner === 'shared'} onClick={() => setOwner('shared')}>👪 {t('Shared')}</button>
                  {/* Everyday access is a kid's or shared, never a grown-up's (it would open their journal). */}
                  {members.filter(m => scope === 'admin' || !m.grownUp).map(m => (
                    <button key={m.id} type="button" className={`chip ${owner === m.id ? 'active' : ''}`} aria-pressed={owner === m.id}
                      style={{ ['--chip-color' as string]: m.color }} onClick={() => setOwner(m.id)}><ChipFace m={m} /> {m.name}</button>
                  ))}
                </div>
                <p className="settings-row-sub">{scope === 'admin'
                  ? t('Picks whose reminders and defaults it uses. Everyone stays visible.')
                  : owner === 'shared' ? t('Shows the whole family.') : t('Shows only their events, chores and lists.')}</p>
              </div>
            )}
            <button className="btn btn-primary btn-block" onClick={() => decide('approve')} disabled={busy}>{busy ? t('Connecting…') : t('Allow')}</button>
            <button className="link-btn" style={{ marginTop: 8 }} onClick={() => decide('deny')} disabled={busy}>{t('Deny')}</button>
            <p className="settings-row-sub" style={{ marginTop: 12 }}>{t('You can disconnect it any time in Settings → Access.')}</p>
          </>
        )}
        {error && info && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
        {error && needsSignIn && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
    </div>
  )
}
