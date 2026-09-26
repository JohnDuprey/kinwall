// Small shims for the browser APIs Kinwall uses that old Safari (iOS 12-15, e.g. an old iPad mini
// on the wall) lacks and core-js can't polyfill. Imported first by main.tsx; each is a no-op where
// the real API exists, so modern browsers are unaffected.
/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any

// Safari < 14: MediaQueryList only has addListener/removeListener.
const mql = w.MediaQueryList?.prototype
if (mql && !mql.addEventListener) {
  mql.addEventListener = function (_type: string, fn: () => void) { this.addListener(fn) }
  mql.removeEventListener = function (_type: string, fn: () => void) { this.removeListener(fn) }
}

// Safari < 13.1. ponytail: only fires on window resize, not element-only resizes; fine for the
// month grid and paint canvas, which only change size with the window.
if (!w.ResizeObserver) {
  w.ResizeObserver = class {
    cb: () => void
    constructor(cb: (entries: unknown[], ro: unknown) => void) { this.cb = () => cb([], this) }
    observe() { addEventListener('resize', this.cb) }
    unobserve() {}
    disconnect() { removeEventListener('resize', this.cb) }
  }
}

// Safari < 15.4 (the demo's sample data uses it).
if (w.crypto && !w.crypto.randomUUID) {
  w.crypto.randomUUID = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c: string) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16))
}

// Safari < 14. English only ("5 minutes ago"); real browsers get localized, shorter wording.
if (!Intl.RelativeTimeFormat) {
  w.Intl.RelativeTimeFormat = class {
    format(v: number, unit: string) {
      if (v === 0) return 'now'
      const n = Math.abs(v), s = `${n} ${unit.replace(/s$/, '')}${n === 1 ? '' : 's'}`
      return v < 0 ? `${s} ago` : `in ${s}`
    }
  }
}

// Safari < 14.1. Approximates grapheme clusters for emoji: a code point plus any variation
// selectors, skin tones, keycap/tag marks and ZWJ-joined parts, or a regional-indicator flag pair.
if (!w.Intl.Segmenter) {
  // eslint-disable-next-line no-misleading-character-class -- a skin-tone range, not a sequence
  const RE = /\p{Regional_Indicator}{2}|[\s\S](?:[\u{FE0E}\u{FE0F}\u{20E3}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]|\u{200D}[\s\S])*/gu
  w.Intl.Segmenter = class {
    segment(s: string) { return (s.match(RE) || []).map(segment => ({ segment })) }
  }
}
