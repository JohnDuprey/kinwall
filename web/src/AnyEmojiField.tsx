import { useState } from 'react'
import { isSingleEmoji, isValidAvatar, lastGrapheme } from './emoji.ts'

/** Free-text "any emoji" input to pair with a curated emoji-swatch grid. Accepts exactly one
 * grapheme cluster (ZWJ families, skin tones, flags, keycaps all handled by lastGrapheme/
 * isSingleEmoji) - typing replaces rather than appends, so tapping the emoji keyboard after
 * existing text keeps only the newest character. `allowInitials` also accepts a 1-2 letter
 * initial (members only; chores require an emoji). */
export function AnyEmojiField({ value, onChange, allowInitials }: { value: string; onChange: (v: string) => void; allowInitials?: boolean }) {
  const [error, setError] = useState('')
  const valid = allowInitials ? isValidAvatar : isSingleEmoji
  return (
    <div style={{ marginTop: 8 }}>
      <input
        type="text"
        inputMode="text"
        enterKeyHint="done"
        placeholder="Tap 🌐 for the emoji keyboard"
        value={value}
        onChange={e => {
          const v = lastGrapheme(e.target.value)
          onChange(v)
          setError(v && !valid(v) ? (allowInitials ? 'Pick one emoji, or a 1-2 letter initial' : 'Pick a single emoji') : '')
        }}
      />
      {error && <div className="settings-row-sub" style={{ color: 'var(--danger)' }}>{error}</div>}
    </div>
  )
}
