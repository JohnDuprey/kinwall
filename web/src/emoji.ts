// Shared single-emoji-grapheme validator (member avatars + chore emoji). Mirrors
// server/src/emoji.ts — keep both in sync if the rule changes.
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u

/** True if `input` is exactly one grapheme cluster (handles ZWJ families, skin tones, flags,
 * keycaps) that contains an emoji code point, and is small enough to store (<=32 bytes). */
export function isSingleEmoji(input: string): boolean {
  if (!input) return false
  if (new TextEncoder().encode(input).length > 32) return false
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(input)]
  if (segments.length !== 1) return false
  return EMOJI_RE.test(segments[0].segment)
}

/** Member avatars also allow a 1-2 letter initial (existing behavior, preserved). */
export function isValidAvatar(input: string): boolean {
  return isSingleEmoji(input) || /^[A-Za-z]{1,2}$/.test(input)
}

/** Last grapheme cluster of `input` - used so an "any emoji" text field acts as replace-on-type
 * (tapping the emoji keyboard after existing text keeps only the newest character typed). */
export function lastGrapheme(input: string): string {
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(input)]
  return segments.length ? segments[segments.length - 1].segment : ''
}
