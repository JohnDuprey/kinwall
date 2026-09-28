import { tellAppKeepAwake } from './native.ts'

// Keep the screen on only while something needs it: a wall screen or kid's device, this device's
// own "Keep the screen on" switch, shopping mode, a recipe being cooked. Each caller holds a
// named reason; the browser's Screen Wake Lock (and, in the Kinwall app, the app's own keep-awake)
// is held while any reason is. The browser drops the lock whenever the page is hidden, so it's
// re-requested on every return to visible.
const reasons = new Set<string>()
let lock: WakeLockSentinel | null = null

function sync() {
  const want = reasons.size > 0
  tellAppKeepAwake(want)
  if (!want) { lock?.release().catch(() => {}); lock = null; return }
  if (lock || document.visibilityState !== 'visible') return
  navigator.wakeLock?.request('screen').then(l => {
    if (reasons.size === 0) { l.release().catch(() => {}); return }
    lock = l
    l.addEventListener('release', () => { if (lock === l) lock = null })
  }).catch(() => {})
}

export function holdAwake(reason: string, on: boolean) {
  if (on === reasons.has(reason)) return
  if (on) reasons.add(reason); else reasons.delete(reason)
  sync()
}

document.addEventListener('visibilitychange', sync)
