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
import { effectivePublicUrl } from './providers/config.ts';

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
    super('This page is open at an IP address, and passkeys need a name: open Kinwall at its https name (in Home Assistant, at Home Assistant\'s https address) or set PUBLIC_URL.');
    this.name = 'RpIdIsIpError';
  }
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function isIpAddress(hostname: string): boolean {
  return IPV4_RE.test(hostname) || hostname === '[::1]' || hostname.includes(':'); // IPv6 literal
}

/** The Home Assistant Supervisor's ingress proxy: "Only connections from 172.30.32.2 must be
 * allowed" (developers.home-assistant.io/docs/apps/presentation, Ingress). */
export function isSupervisorPeer(remoteAddress: string | undefined): boolean {
  return remoteAddress?.replace(/^::ffff:/, '') === '172.30.32.2';
}

/** The page's origin as the browser sent it (every passkey call is a POST, which carries Origin). */
function browserOrigin(req: Request): string | undefined {
  const origin = req.headers.get('origin');
  try {
    const url = new URL(origin!);
    return /^https?:$/.test(url.protocol) && url.origin === origin ? origin : undefined;
  } catch {
    return undefined;
  }
}

/** rpID = WEBAUTHN_RP_ID if set, else the hostname of PUBLIC_URL if set, else (Home Assistant
 * ingress) the page's own origin, else the request's own Host. WEBAUTHN_RP_ID lets a multi-tenant
 * host share one rpID across families on subdomains, so the origin must be that host or under it.
 * Throws RpIdIsIpError for an IP address (WebAuthn RP IDs must be a registrable domain, and Chrome
 * silently rejects IPs other than localhost), and a plain error when the browser's page is on
 * another address than the one passkeys are set up for (verification would fail anyway). */
export async function resolveRpId(env: Env, req: Request): Promise<{ rpID: string; origin: string; expectedOrigins: string[] }> {
  const publicUrl = await effectivePublicUrl(env, env.DB);
  const pageOrigin = browserOrigin(req);
  // Through ingress the browser is on Home Assistant's own address. Host usually says the same, but
  // a proxy in front of Home Assistant may have rewritten it; the browser's Origin can't be. Only
  // requests the Supervisor proxied get this (HA_INGRESS); anywhere else Origin is a mere claim.
  const ingressOrigin = !publicUrl.value && env.HA_INGRESS?.(req) ? pageOrigin : undefined;
  const url = new URL(publicUrl.value || ingressOrigin || req.url);
  const rpID = env.WEBAUTHN_RP_ID || url.hostname;
  if (rpID !== 'localhost' && isIpAddress(rpID)) throw new RpIdIsIpError();
  if (url.hostname !== rpID && !url.hostname.endsWith('.' + rpID)) {
    throw new Error(`${url.hostname} is not ${rpID} or a subdomain of it (WEBAUTHN_RP_ID)`);
  }
  // Behind a TLS-terminating proxy (a reverse proxy without PUBLIC_URL) the request arrives as
  // http while the browser is on https, so also accept the same host over https.
  const expectedOrigins = !publicUrl.value && !ingressOrigin && url.protocol === 'http:' ? [url.origin, 'https://' + url.host] : [url.origin];
  if (pageOrigin && !expectedOrigins.includes(pageOrigin)) {
    throw new Error(`This page is open at ${pageOrigin}, but passkeys here are set up for ${url.origin}: open Kinwall there, or set PUBLIC_URL to the address you use.`);
  }
  return { rpID, origin: url.origin, expectedOrigins };
}
