// node --test test/ (npm test). Sign-in links (#key=…): taken out of the address at once, and
// stored only after asking, unless this browser's own hosted sign-in made the link a moment ago.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { expireSigninCookie, resolveKeyLink, SIGNIN_COOKIE, takeKeyLink } from '../src/keyLink.ts'

const hash = (v: string) => createHash('sha256').update(v).digest('hex')
const NONCE = 'a1'.repeat(32)
/** What app.<root> answers with: the redirect's fragment carries the hash, the cookie the value. */
const hosted = `https://smiths.kinwall.family/#key=kw_admin123&from=${hash(NONCE)}`
const cookie = `theme=dark; ${SIGNIN_COOKIE}=${NONCE}`

/** resolveKeyLink with a recorded `ask`; `answer` is what the person picks. */
async function resolve(href: string, { current = null as string | null, cookies = '', answer = false } = {}) {
  const link = takeKeyLink(href)!
  let asked = 0
  const take = await resolveKeyLink(link, { current, cookies, ask: async () => { asked++; return answer } })
  return { take, asked }
}

test('takeKeyLink: the key leaves the address at once, the rest stays', () => {
  const l = takeKeyLink('https://smiths.kinwall.family/#key=kw_abc&from=ff')!
  assert.deepEqual(l, { key: 'kw_abc', from: 'ff', url: '/' })
  // The older ?key=: only the key goes; a fragment can't carry `from` there.
  assert.deepEqual(takeKeyLink('http://kinwall.local:8080/app/?key=kw_d&x=1#/lists'), { key: 'kw_d', from: null, url: '/app/?x=1#/lists' })
  // A setup code (signup, the wall screen's QR) the same way.
  assert.equal(takeKeyLink('https://host.example/#key=123456')!.url, '/')
  for (const href of ['https://smiths.kinwall.family/#/calendar', 'https://smiths.kinwall.family/?start=pair', 'https://smiths.kinwall.family/#key=']) {
    assert.equal(takeKeyLink(href), null, href)
  }
  for (const href of [hosted, 'https://x.example/?key=kw_q#key=kw_r']) assert.ok(!takeKeyLink(href)!.url.includes('key='), href)
})

test('resolveKeyLink: a link without the marker asks; Continue takes it, Cancel leaves the browser as it was', async () => {
  assert.deepEqual(await resolve('https://smiths.kinwall.family/#key=kw_admin123', { current: 'kw_mine', answer: true }), { take: true, asked: 1 })
  assert.deepEqual(await resolve('https://smiths.kinwall.family/#key=kw_admin123', { current: 'kw_mine', answer: false }), { take: false, asked: 1 })
  // Self-hosted servers never set the cookie: their links always ask, ?key= too.
  assert.deepEqual(await resolve('http://kinwall.local/?key=kw_d', { cookies: cookie }), { take: false, asked: 1 })
})

test('resolveKeyLink: the marker matching this browser\'s cookie signs in without asking', async () => {
  assert.deepEqual(await resolve(hosted, { cookies: cookie }), { take: true, asked: 0 })
  assert.deepEqual(await resolve(hosted, { cookies: `${SIGNIN_COOKIE}=${NONCE}`, current: 'kw_other' }), { take: true, asked: 0 })
})

test('resolveKeyLink: a marker that doesn\'t match, or no cookie, asks', async () => {
  assert.equal((await resolve(hosted)).asked, 1, 'no cookie')
  assert.equal((await resolve(hosted, { cookies: `${SIGNIN_COOKIE}=${'b2'.repeat(32)}` })).asked, 1, 'another value')
  assert.equal((await resolve(hosted, { cookies: `x${SIGNIN_COOKIE}=${NONCE}` })).asked, 1, 'another cookie\'s name')
  // Someone who knows the cookie's value can't just put it in the link: `from` is its hash.
  assert.equal((await resolve(`https://smiths.kinwall.family/#key=kw_admin123&from=${NONCE}`, { cookies: cookie })).asked, 1, 'value, not hash')
  assert.equal((await resolve('https://smiths.kinwall.family/#key=kw_admin123&from=', { cookies: `${SIGNIN_COOKIE}=` })).asked, 1, 'empty')
})

test('resolveKeyLink: the key this browser already has changes nothing, so nothing to ask (a kiosk reopening its start link)', async () => {
  assert.deepEqual(await resolve('http://kinwall.local:8080/?key=kw_wall', { current: 'kw_wall' }), { take: true, asked: 0 })
})

test('expireSigninCookie: the same name, Domain and Path as app.<root> set it, expired', () => {
  assert.equal(expireSigninCookie('smiths.kinwall.family'), `${SIGNIN_COOKIE}=; Domain=kinwall.family; Path=/; Max-Age=0; Secure; SameSite=Lax`)
})
