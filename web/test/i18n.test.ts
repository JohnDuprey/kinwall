import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DAY, formatDate, intlLocale, lang, msg, pickLang, playerLang, setLang, t, tc, tn } from '../src/i18n.ts'

const de = {
  'Notifications': 'Benachrichtigungen', 'Remove: {title}': 'Entfernen: {title}', 'now-next|Next': 'Danach', 'Next': 'Weiter',
  '{n} day': '{n} Tag', '{n} days': '{n} Tage',
}
const load = async () => de

test('t: English is the key; a missing entry falls back to English', async () => {
  await setLang('en')
  assert.equal(t('Notifications'), 'Notifications')
  await setLang('de', load)
  assert.equal(t('Notifications'), 'Benachrichtigungen')
  assert.equal(t('Not translated yet'), 'Not translated yet')
  await setLang('en')
})

test('t: placeholders fill in whole sentences; an unknown one is left as is', async () => {
  await setLang('de', load)
  assert.equal(t('Remove: {title}', { title: 'Milch' }), 'Entfernen: Milch')
  assert.equal(t('Hi {name}, {n} left', { name: 'Leo', n: 2 }), 'Hi Leo, 2 left')
  assert.equal(t('Hi {name}', {}), 'Hi {name}')
  await setLang('en')
})

test('tc: a context entry wins, else the plain word, else English', async () => {
  await setLang('de', load)
  assert.equal(tc('now-next', 'Next'), 'Danach')
  assert.equal(tc('button', 'Next'), 'Weiter')
  assert.equal(tc('button', 'Back'), 'Back')
  await setLang('en')
})

test('tn: one or other by the plural rules, with {n} formatted for the language', async () => {
  await setLang('en')
  assert.equal(tn(1, '{n} day', '{n} days'), '1 day')
  assert.equal(tn(0, '{n} day', '{n} days'), '0 days')
  assert.equal(tn(1000, '{n} day', '{n} days'), '1,000 days')
  await setLang('de', load)
  assert.equal(tn(1, '{n} day', '{n} days'), '1 Tag')
  assert.equal(tn(3, '{n} day', '{n} days'), '3 Tage')
  assert.equal(tn(1000, '{n} day', '{n} days'), '1.000 Tage')
  // A language with more forms adds "<other>#<category>"; it wins over the plain entry.
  await setLang('de', async () => ({ ...de, '{n} days#other': '{n} Tage (Form)' }))
  assert.equal(tn(3, '{n} day', '{n} days'), '3 Tage (Form)')
  assert.equal(tn(1, '{n} day', '{n} days'), '1 Tag')
  await setLang('en')
})

test('setLang: the later of two overlapping switches wins; English loads nothing', async () => {
  let release!: () => void
  const slow = setLang('de', () => new Promise(r => { release = () => r(de) }))
  await setLang('en', () => { throw new Error('English never loads a file') })
  release()
  await slow
  assert.equal(lang(), 'en')
  assert.equal(t('Notifications'), 'Notifications')
})

test("pickLang: the member's own, then the device's, then the family's, then English", () => {
  assert.equal(pickLang({ member: 'de', device: 'en', family: 'en' }), 'de')
  assert.equal(pickLang({ member: null, device: 'de', family: 'en' }), 'de')
  assert.equal(pickLang({ member: null, device: undefined, family: 'de' }), 'de')
  assert.equal(pickLang({}), 'en')
  assert.equal(pickLang({ member: 'xx', device: 'fr', family: 'de' }), 'de', 'unknown languages are skipped')
})

test("playerLang: an activity follows the player's own language, else the screen's", () => {
  assert.equal(playerLang('de', 'en'), 'de')
  assert.equal(playerLang(null, 'de'), 'de')
  assert.equal(playerLang(undefined, 'en'), 'en')
})

test('msg marks text without translating it', async () => {
  await setLang('de', async () => ({ Home: 'Start' }))
  const label = msg('Home')
  assert.equal(label, 'Home')
  assert.equal(t(label), 'Start')
  await setLang('en')
})

test('intlLocale and formatDate: the regional locale when it is the same language, the household day', async () => {
  await setLang('en')
  assert.equal(intlLocale('en-GB'), 'en-GB')
  assert.equal(intlLocale('de-AT'), 'en')
  await setLang('de', load)
  assert.equal(intlLocale('de-AT'), 'de-AT')
  assert.equal(intlLocale('en-US'), 'de')
  const day = new Date(2026, 9, 8) // a calendar day: no time zone needed
  assert.equal(formatDate(day, DAY), new Intl.DateTimeFormat(intlLocale(), DAY).format(day))
  // A moment late at night UTC is still the evening before in New York.
  const moment = new Date('2026-10-09T02:30:00Z')
  assert.match(formatDate(moment, { day: 'numeric' }, 'America/New_York'), /^8\.?$/)
  assert.match(formatDate(moment, { day: 'numeric' }, 'Europe/Berlin'), /^9\.?$/)
  await setLang('en')
})

test("an activity's locale: the player's language, regional when the browser's matches", async () => {
  await setLang('en')
  assert.equal(intlLocale('en-US', playerLang('de', lang())), 'de')
  assert.equal(intlLocale('de-AT', playerLang('de', lang())), 'de-AT')
  assert.equal(intlLocale('en-GB', playerLang(null, lang())), 'en-GB')
})
