import { test } from 'node:test'
import assert from 'node:assert/strict'
import { providerConsentUrl } from '../src/providerConsent.ts'

test('providerConsentUrl: keeps the provider consent URL and its encoded OAuth parameters', () => {
  for (const [kind, address] of [
    ['google', 'https://accounts.google.com/o/oauth2/v2/auth?state=a%26b&redirect_uri=https%3A%2F%2Fwall.example%2Fcallback&code_challenge=abc'],
    ['microsoft', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=a%26b&code_challenge=abc'],
  ] as const) {
    assert.equal(providerConsentUrl(kind, address), address)
  }
})

test('providerConsentUrl: refuses other origins, credentials, insecure URLs and executable schemes', () => {
  for (const kind of ['google', 'microsoft'] as const) {
    const host = kind === 'google' ? 'accounts.google.com' : 'login.microsoftonline.com'
    for (const address of [
      `http://${host}/authorize`, `https://${host}.evil.example/authorize`,
      `https://evil.example/?provider=${host}`, `https://${host}@evil.example/authorize`,
      `https://user:password@${host}/authorize`, `https://${host}:8443/authorize`,
      '//evil.example/authorize', '/authorize', 'not a URL', 'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      kind === 'google' ? 'https://login.microsoftonline.com/common/authorize' : 'https://accounts.google.com/authorize',
    ]) assert.equal(providerConsentUrl(kind, address), null, address)
  }
})
