// Speech for activity plugins (Kinwall.speak in a plugin's kinwall.js, answered in Plugins.tsx).
// A plugin uses its own speechSynthesis when its browser has one; Android's WebView has none, so
// there the plugin asks Kinwall, and Kinwall asks the app (kinwall-mobile), which speaks with
// Android's text-to-speech. The app says it can with window.kinwallNative.speech, and says each
// one is done with a 'kinwall-native' { type: 'spoken', id } event on window.
import { appSpeech, tellAppSpeak, tellAppStopSpeaking } from './native.ts'

const MAX_TEXT = 500
const webSpeech = () => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined)

// Safari speaks only after speech has started inside a tap on this page, and a plugin's request comes
// in a message, not a tap (taps inside the plugin's frame don't count for this page). So a tap that
// opens an activity (its card, a chore's Play) or picks who's playing starts a silent utterance to
// unlock it. Only then: speech claims the iPhone's audio (AirPods switch over, music elsewhere pauses),
// so ordinary taps around Kinwall never do.
/** Whether this tap starts or is inside an activity plugin: `hash` is read after the tap's own handlers ran. */
export function inActivity(hash: string, target: unknown): boolean {
  const link = (target as Element | null)?.closest?.('a[href]')?.getAttribute('href') ?? ''
  return [hash, link].some(h => h.startsWith('#/activities/plugin/'))
}
if (typeof window !== 'undefined' && webSpeech() && typeof SpeechSynthesisUtterance !== 'undefined') {
  const unlock = (e: Event) => {
    if (appSpeech() || !inActivity(location.hash, e.target)) return
    removeEventListener('click', unlock); removeEventListener('keydown', unlock)
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    webSpeech()?.speak(u)
  }
  // Bubbling click: after a handler like a chore's Play has set the hash.
  addEventListener('click', unlock); addEventListener('keydown', unlock)
}

/** Whether Kinwall can speak for a plugin here: the app's voice, or this browser's. */
export const canSpeak = () => appSpeech() || !!webSpeech()

let seq = 0
const pending = new Map<number, () => void>() // speech not yet done -> its resolve
const listening = new WeakSet<object>() // windows already listening for the app's "spoken"
let current: SpeechSynthesisUtterance | null = null // referenced so it isn't garbage-collected mid-word

function onAppEvent(e: Event) {
  const d = (e as CustomEvent<{ type?: unknown; id?: unknown }>).detail
  if (d?.type === 'spoken' && typeof d.id === 'number') pending.get(d.id)?.()
}

/** Says `text` (at most 500 characters); resolves once it's done, stopped or failed, never rejects.
 *  A fallback resolves it if no "done" ever comes (some voices never say). */
export function speak(text: string, rate = 1, lang = 'en-US'): Promise<void> {
  const words = String(text).slice(0, MAX_TEXT)
  const r = Number.isFinite(rate) ? Math.min(Math.max(rate, 0.5), 2) : 1
  const l = typeof lang === 'string' && /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{1,8})*$/.test(lang) ? lang : 'en-US'
  const id = ++seq
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(fallback); pending.delete(id); resolve() }
    const fallback = setTimeout(done, 1500 + words.length * 150)
    pending.set(id, done)
    if (appSpeech()) {
      if (!listening.has(window)) { window.addEventListener('kinwall-native', onAppEvent); listening.add(window) }
      if (!tellAppSpeak({ id, text: words, rate: r, lang: l })) done()
      return
    }
    const synth = webSpeech()
    if (!synth || !words.trim()) return done()
    // Newest wins: what was being said stops (and its promise resolves).
    for (const [other, finish] of pending) if (other !== id) finish()
    synth.cancel()
    const u = new SpeechSynthesisUtterance(words)
    u.rate = r
    u.lang = l
    u.onend = u.onerror = () => { if (current === u) current = null; done() }
    current = u
    synth.speak(u)
  })
}

/** Stops whatever a plugin asked Kinwall to say. */
export function stopSpeaking() {
  if (appSpeech()) tellAppStopSpeaking()
  else if (current) webSpeech()?.cancel()
  current = null
  for (const finish of [...pending.values()]) finish()
}
