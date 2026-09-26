import { useEffect, useState } from 'react'
import { api, ApiError, setAdminKey } from './api.ts'
import { loginWithPasskey, passkeysSupported, registerPasskey } from './webauthn.ts'
import Setup from './Setup.tsx'

/** OAuth consent for MCP clients and the Kinwall apps (#/authorize?..., reached via the server's
 * /oauth/authorize). Signs in with a passkey, a recovery code, or an admin key held for this
 * session only. On a server that isn't set up yet it runs the setup wizard first. Someone who got
 * in without a passkey is offered one before approving (this page runs in the browser, or an
 * app's Safari sheet, where passkeys work on any domain). The server re-validates everything on
 * approve and returns the redirect to follow. */
export default function AuthorizeScreen() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '')
  const qs = params.toString()
  const [info, setInfo] = useState<{ clientName: string; redirectHost: string; requestedScope: 'admin' | 'display' } | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [scope, setScope] = useState<'admin' | 'display'>('admin')
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
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setNeedsSignIn(true)
      else setError(e instanceof ApiError ? e.message : 'Could not load this request')
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
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  const addPasskey = async () => {
    setBusy(true); setError('')
    try {
      await registerPasskey(/iPad/.test(navigator.userAgent) ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'This device', undefined, true)
      setPasskeyAdded(true); setOfferPasskey(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a passkey')
    } finally {
      setBusy(false)
    }
  }

  const decide = async (decision: 'approve' | 'deny') => {
    setBusy(true); setError('')
    try {
      const { redirect } = await api.decideAuthorization({
        decision, scope,
        client_id: params.get('client_id') ?? undefined,
        redirect_uri: params.get('redirect_uri') ?? undefined,
        state: params.get('state') ?? undefined,
        code_challenge: params.get('code_challenge') ?? undefined,
        code_challenge_method: params.get('code_challenge_method') ?? undefined,
      })
      location.href = redirect
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not complete this request')
      setBusy(false)
    }
  }

  // A server that isn't set up has no admin to approve anything yet: set it up here, then continue.
  if (setup) return <Setup oauth={setup.oauth} passkeyRequired={setup.passkeyRequired} onDone={() => { setSetup(null); load() }} />

  return (
    <div className="gate-screen">
      <div className="gate-card authorize-card">
        {needsSignIn ? (
          <>
            <h1>Sign in to continue</h1>
            <p>An app wants to connect to Kinwall. Sign in as an admin to review it.</p>
            {passkeysSupported() && <button className="btn btn-primary btn-block" onClick={() => signIn('passkey')} disabled={busy}>{busy ? 'Checking…' : 'Sign in with passkey'}</button>}
            <div className="field" style={{ textAlign: 'left', marginTop: 16 }}>
              <label htmlFor="authorize-recovery">No passkey here? Use a recovery code</label>
              <input id="authorize-recovery" type="text" value={recoveryValue} onChange={e => setRecoveryValue(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
            </div>
            <button className="btn btn-secondary btn-block" onClick={() => signIn('recovery')} disabled={busy || !recoveryValue.trim()}>Continue</button>
            <details className="authorize-more">
              <summary>Use an admin API key</summary>
              <div className="field" style={{ textAlign: 'left', marginTop: 8 }}>
                <label htmlFor="authorize-key">Admin API key</label>
                <input id="authorize-key" type="password" value={adminKeyValue} onChange={e => setAdminKeyValue(e.target.value)} autoComplete="off" />
              </div>
              <button className="btn btn-secondary btn-block" onClick={() => signIn('key')} disabled={busy || !adminKeyValue.trim()}>Continue</button>
            </details>
          </>
        ) : !info ? (
          <p>{error || 'Loading…'}</p>
        ) : (
          <>
            <h1>Connect {info.clientName}?</h1>
            <p><b>{info.clientName}</b> wants to use Kinwall. You'll return to <b>{info.redirectHost}</b> afterwards.</p>
            {offerPasskey && (
              <div className="authorize-passkey">
                <b>Sign in faster next time</b>
                <span>Create a passkey on this device, so you won't need a recovery code again.</span>
                <div className="authorize-passkey-actions">
                  <button className="btn btn-secondary" onClick={addPasskey} disabled={busy}>Create a passkey</button>
                  <button className="link-btn" onClick={() => setOfferPasskey(false)} disabled={busy}>Not now</button>
                </div>
              </div>
            )}
            {passkeyAdded && <p className="authorize-passkey-done" role="status">Passkey created. Use it next time you sign in.</p>}
            <div className="authorize-scopes" role="group" aria-label="Access level">
              <button className={`authorize-scope ${scope === 'admin' ? 'active' : ''}`} aria-pressed={scope === 'admin'} onClick={() => setScope('admin')}>
                <b>Full access</b><span>Everything you can do as an admin, including members and settings.</span>
              </button>
              <button className={`authorize-scope ${scope === 'display' ? 'active' : ''}`} aria-pressed={scope === 'display'} onClick={() => setScope('display')}>
                <b>Everyday access</b><span>Calendar, chores and lists. No members, settings or keys.</span>
              </button>
            </div>
            <button className="btn btn-primary btn-block" onClick={() => decide('approve')} disabled={busy}>{busy ? 'Connecting…' : 'Allow'}</button>
            <button className="link-btn" style={{ marginTop: 8 }} onClick={() => decide('deny')} disabled={busy}>Deny</button>
            <p className="settings-row-sub" style={{ marginTop: 12 }}>You can disconnect it any time in Settings → Access.</p>
          </>
        )}
        {error && info && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
        {error && needsSignIn && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
    </div>
  )
}
