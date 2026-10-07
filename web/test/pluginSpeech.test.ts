// node --test test/ (npm test). Kinwall.speak for plugins: the app's voice (Android) or the browser's.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { canSpeak, inActivity, speak, stopSpeaking } from '../src/pluginSpeech.ts'

const g = globalThis as { window?: unknown; SpeechSynthesisUtterance?: unknown }
const settled = (p: Promise<unknown>) => Promise.race([p.then(() => true), new Promise(r => setImmediate(() => r(false)))])

/** A window inside the app: messages to it are kept, and it can say "spoken". */
function appWindow() {
  const sent: Record<string, unknown>[] = []
  const w = Object.assign(new EventTarget(), {
    kinwallNative: { speech: true },
    webkit: { messageHandlers: { kinwall: { postMessage: (m: Record<string, unknown>) => sent.push(m) } } },
  })
  g.window = w
  const spoken = (id: unknown) => w.dispatchEvent(Object.assign(new Event('kinwall-native'), { detail: { type: 'spoken', id } }))
  return { sent, spoken }
}

test('canSpeak: the app says it can, or the browser has speech; neither, no', () => {
  g.window = new EventTarget()
  assert.equal(canSpeak(), false)
  appWindow()
  assert.equal(canSpeak(), true)
  g.window = Object.assign(new EventTarget(), { speechSynthesis: {} })
  assert.equal(canSpeak(), true)
})

test('in the app: sent to the app, done when it says spoken, text capped at 500', async () => {
  const { sent, spoken } = appWindow()
  const p = speak('x'.repeat(800), 0.75, 'en-US')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].type, 'speak')
  assert.equal((sent[0].text as string).length, 500)
  assert.equal(sent[0].rate, 0.75)
  assert.equal(sent[0].lang, 'en-US')
  assert.equal(await settled(p), false)
  spoken(9999) // someone else's
  assert.equal(await settled(p), false)
  spoken(sent[0].id)
  assert.equal(await settled(p), true)
})

test('in the app: odd rate and lang are made safe', () => {
  const { sent } = appWindow()
  void speak('hi', 40, '"><script>')
  void speak('hi', Number.NaN, 'es-MX')
  assert.deepEqual(sent.map(m => [m.rate, m.lang]), [[2, 'en-US'], [1, 'es-MX']])
  stopSpeaking()
})

test('in the app: stopSpeaking tells the app and finishes what was waiting', async () => {
  const { sent } = appWindow()
  const p = speak('friend')
  stopSpeaking()
  assert.deepEqual(sent[1], { type: 'stopSpeaking' })
  assert.equal(await settled(p), true)
})

test('in the app: done after a while even if the app never says so', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    appWindow()
    const p = speak('cat') // 1500 + 3 * 150 ms
    mock.timers.tick(1900)
    assert.equal(await settled(p), false)
    mock.timers.tick(100)
    await p
  } finally { mock.timers.reset() }
})

test('in a browser: its speechSynthesis, newest wins', async () => {
  const said: { text: string; rate: number; lang: string; onend?: () => void }[] = []
  let cancels = 0
  g.SpeechSynthesisUtterance = class { text: string; rate = 1; lang = ''; onend?: () => void; onerror?: () => void; constructor(t: string) { this.text = t } }
  g.window = Object.assign(new EventTarget(), { speechSynthesis: { speak: (u: (typeof said)[0]) => said.push(u), cancel: () => { cancels++ } } })
  const first = speak('because', 0.8)
  const second = speak('friend')
  assert.equal(await settled(first), true) // replaced
  assert.equal(said.length, 2)
  assert.equal(said[0].rate, 0.8)
  assert.equal(await settled(second), false)
  said[1].onend!()
  assert.equal(await settled(second), true)
  assert.equal(cancels, 2)
})

test('inActivity: only taps that open or are inside an activity plugin unlock speech', () => {
  const at = (href: string | null) => ({ closest: () => (href === null ? null : { getAttribute: () => href }) })
  assert.equal(inActivity('#/board', at(null)), false)
  assert.equal(inActivity('#/board', at('#/calendar')), false)
  assert.equal(inActivity('#/activities', at(null)), false) // the Activities tab itself
  assert.equal(inActivity('#/activities', at('#/activities/plugin/spelling')), true) // its card
  assert.equal(inActivity('#/activities/plugin/spelling?member=a', at(null)), true) // a chore's Play, the picker
  assert.equal(inActivity('#/board', null), false)
})
