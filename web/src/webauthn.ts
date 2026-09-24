// Thin wrapper around @simplewebauthn/browser + the passkey API calls in api.ts. Kept in one
// small module so every screen that offers "create/sign in with a passkey" (Setup, App's
// PairingGate/PairPhoneScreen, Settings) shares the same capability check and error handling.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { api, ApiError } from './api.ts'

/** Passkeys need a secure context (HTTPS or localhost) and browser WebAuthn support. Screens
 * fall back to today's key-paste flows when this is false, with a one-line explanation. */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!window.PublicKeyCredential
}

function friendlyError(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error && e.name === 'NotAllowedError') return 'Cancelled.'
  return e instanceof Error ? e.message : 'Passkey action failed.'
}

/** Registers a new passkey. `token` authorizes registration from a device with no key yet (the
 * "finish on your phone" flow) — pass it and the response may include a fresh session, since that
 * device had no key to begin with. Omit it to register from an already admin-signed-in device;
 * `useAdmin` forwards to api.ts's in-memory setup-wizard admin key when this device only holds a
 * display-scope key so far. */
export async function registerPasskey(name: string, token?: string, useAdmin?: boolean): Promise<{ id: string; name: string; session?: { key: string; expiresAt: string } }> {
  try {
    const options = await api.passkeyRegisterOptions(token, useAdmin)
    const response = await startRegistration({ optionsJSON: options as any })
    return await api.passkeyRegisterVerify({ token, name, response }, useAdmin)
  } catch (e) {
    throw new Error(friendlyError(e))
  }
}

/** Signs in with an existing passkey, returning a new 30-day session key. */
export async function loginWithPasskey(): Promise<{ key: string; expiresAt: string }> {
  try {
    const options = await api.passkeyLoginOptions()
    const response = await startAuthentication({ optionsJSON: options as any })
    return await api.passkeyLoginVerify(response)
  } catch (e) {
    throw new Error(friendlyError(e))
  }
}
