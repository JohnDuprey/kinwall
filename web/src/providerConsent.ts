// Calendar and to-do sign-ins share the same provider origins. Check the server's response before
// navigating, so an unexpected or compromised response cannot send this browser to another site.
export function providerConsentUrl(kind: 'google' | 'microsoft', address: string): string | null {
  try {
    const url = new URL(address)
    const origin = kind === 'google' ? 'https://accounts.google.com' : 'https://login.microsoftonline.com'
    return url.origin === origin && !url.username && !url.password ? url.href : null
  } catch { return null }
}
