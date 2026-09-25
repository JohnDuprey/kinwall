import { useEffect, useState } from 'react'
import { api, ApiError, setAdminKey } from './api.ts'
import { loginWithPasskey, passkeysSupported } from './webauthn.ts'

/** OAuth consent for MCP clients (#/authorize?..., reached via the server's /oauth/authorize).
 * Signs in like the pairing screen: a passkey, or an admin key held for this session only. The
 * server re-validates everything on approve and returns the redirect to follow. */
export default function AuthorizeScreen() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '')
  const qs = params.toString()
  const [info, setInfo] = useState<{ clientName: string; redirectHost: string; requestedScope: 'admin' | 'display' } | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [scope, setScope] = useState<'admin' | 'display'>('admin')
  const [adminKeyValue, setAdminKeyValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = async (viaPasskey: boolean) => {
    setBusy(true); setError('')
    try {
      if (viaPasskey) setAdminKey((await loginWithPasskey()).key)
      else if (adminKeyValue.trim()) setAdminKey(adminKeyValue.trim())
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
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

  return (
    <div className="gate-screen">
      <div className="gate-card authorize-card">
        {needsSignIn ? (
          <>
            <h1>Sign in to continue</h1>
            <p>An app wants to connect to Kinwall. Sign in as an admin to review it.</p>
            {passkeysSupported() && <button className="btn btn-primary btn-block" onClick={() => signIn(true)} disabled={busy}>{busy ? 'Checking…' : 'Sign in with passkey'}</button>}
            <div className="field" style={{ textAlign: 'left', marginTop: 16 }}>
              <label>Or an admin API key</label>
              <input type="password" value={adminKeyValue} onChange={e => setAdminKeyValue(e.target.value)} autoComplete="off" />
            </div>
            <button className="btn btn-secondary btn-block" onClick={() => signIn(false)} disabled={busy || !adminKeyValue.trim()}>Continue</button>
          </>
        ) : !info ? (
          <p>{error || 'Loading…'}</p>
        ) : (
          <>
            <h1>Connect {info.clientName}?</h1>
            <p><b>{info.clientName}</b> wants to use Kinwall. You'll return to <b>{info.redirectHost}</b> afterwards.</p>
            <div className="authorize-scopes">
              <button className={`authorize-scope ${scope === 'admin' ? 'active' : ''}`} onClick={() => setScope('admin')}>
                <b>Full access</b><span>Everything you can do as an admin, including members and settings.</span>
              </button>
              <button className={`authorize-scope ${scope === 'display' ? 'active' : ''}`} onClick={() => setScope('display')}>
                <b>Everyday access</b><span>Calendar, chores and lists. No members, settings or keys.</span>
              </button>
            </div>
            <button className="btn btn-primary btn-block" onClick={() => decide('approve')} disabled={busy}>{busy ? 'Connecting…' : 'Allow'}</button>
            <button className="link-btn" style={{ marginTop: 8 }} onClick={() => decide('deny')} disabled={busy}>Deny</button>
            <p className="settings-row-sub" style={{ marginTop: 12 }}>You can disconnect it any time in Settings → Access.</p>
          </>
        )}
        {error && info && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        {error && needsSignIn && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
    </div>
  )
}
