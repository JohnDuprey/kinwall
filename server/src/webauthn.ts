// WebAuthn (passkey) primitives, isolated in one small module so tests can mock just
// `verifyRegistrationResponse` / `verifyAuthenticationResponse` (real ceremonies need a browser +
// authenticator) while everything else (rpID/origin derivation, challenge storage) runs for real.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse as realVerifyAuthenticationResponse,
  verifyRegistrationResponse as realVerifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { Env } from './env.ts';

export { generateAuthenticationOptions, generateRegistrationOptions };

// Overridable for tests (node:test has no `jest.mock` - this is the seam instead). Production
// code always calls through `verifyRegistrationResponse`/`verifyAuthenticationResponse` below.
export let verifyRegistrationResponse = realVerifyRegistrationResponse;
export let verifyAuthenticationResponse = realVerifyAuthenticationResponse;
export function __setVerifiers(overrides: { registration?: typeof realVerifyRegistrationResponse; authentication?: typeof realVerifyAuthenticationResponse }) {
  if (overrides.registration) verifyRegistrationResponse = overrides.registration;
  if (overrides.authentication) verifyAuthenticationResponse = overrides.authentication;
}
export function __resetVerifiers() {
  verifyRegistrationResponse = realVerifyRegistrationResponse;
  verifyAuthenticationResponse = realVerifyAuthenticationResponse;
}

export class RpIdIsIpError extends Error {
  constructor() {
    super('This server is addressed by IP - passkeys need a real hostname (set PUBLIC_URL, or use a DNS name).');
    this.name = 'RpIdIsIpError';
  }
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function isIpAddress(hostname: string): boolean {
  return IPV4_RE.test(hostname) || hostname === '[::1]' || hostname.includes(':'); // IPv6 literal
}

/** rpID = hostname of PUBLIC_URL if set, else the request's own Host. Throws RpIdIsIpError for
 * an IP address (WebAuthn RP IDs must be a registrable domain, and Chrome silently rejects IPs
 * other than localhost). */
export function resolveRpId(env: Env, requestUrl: string): { rpID: string; origin: string } {
  const url = new URL(env.PUBLIC_URL || requestUrl);
  const rpID = url.hostname;
  if (rpID !== 'localhost' && isIpAddress(rpID)) throw new RpIdIsIpError();
  return { rpID, origin: url.origin };
}
