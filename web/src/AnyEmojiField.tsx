import { useState } from 'react'
import { isSingleEmoji, lastGrapheme } from './emoji.ts'

/** "Any emoji" picker to pair with a curated emoji-swatch grid: shows the current choice as a
 * selected tile (custom emojis aren't in the grid, so this is the only place they're visible) next
 * to an empty input that opens the emoji keyboard. A valid entry replaces the value and clears the
 * input. Accepts exactly one grapheme cluster (ZWJ families, skin tones, flags, keycaps);
 * `allowInitials` also accepts a 1-2 letter initial (members only; chores require an emoji). */
export function AnyEmojiField({ value, onChange, allowInitials }: { value: string; onChange: (v: string) => void; allowInitials?: boolean }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="any-emoji">
      <div className="emoji-swatch active any-emoji-current" aria-label="Current">{value || '?'}</div>
      <label className="any-emoji-field">
        <span>{allowInitials ? 'Any emoji or initial' : 'Any emoji'}</span>
        <input
          type="text"
          inputMode="text"
          enterKeyHint="done"
          placeholder="Tap here, then 😀 on the keyboard"
          value={draft}
          onChange={e => {
            const raw = e.target.value.trim()
            // Letters are typed one at a time, so they stay in the box: 1-2 is an initial, more is an error.
            if (/^[A-Za-z]+$/.test(raw)) {
              setDraft(raw)
              if (allowInitials && raw.length <= 2) { onChange(raw); setError('') }
              else setError(allowInitials ? 'Initials are 1-2 letters' : 'Pick a single emoji')
              return
            }
            // Anything else: keep the newest character, which replaces the value if it's an emoji.
            const v = lastGrapheme(e.target.value)
            if (v && isSingleEmoji(v)) { onChange(v); setDraft(''); setError(''); return }
            setDraft(v)
            setError(v ? (allowInitials ? 'Pick one emoji, or a 1-2 letter initial' : 'Pick a single emoji') : '')
          }}
        />
      </label>
      {error && <div className="settings-row-sub any-emoji-error">{error}</div>}
    </div>
  )
}
