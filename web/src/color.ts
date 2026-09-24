// WCAG relative-luminance / contrast helpers, used to pick readable ink (dark vs white) for text
// drawn over an arbitrary member/accent color - so a very light or very dark custom color still
// stays legible on avatars, event chips, and accent-colored buttons.

function luminance(hex: string): number {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255)
  const lin = [r, g, b].map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

export function contrastRatio(hexA: string, hexB: string): number {
  const [l1, l2] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a)
  return (l1 + 0.05) / (l2 + 0.05)
}

const DARK_INK = '#241a10' // matches the old fixed --chip-ink
const LIGHT_INK = '#ffffff'

/** Picks the ink (dark or white) with the best worst-case contrast against one or more
 * background colors - single color for a plain avatar/chip, several for a striped event. */
export function inkFor(colors: string | string[]): string {
  const list = Array.isArray(colors) ? colors : [colors]
  if (list.length === 0) return DARK_INK
  let worstDark = Infinity, worstLight = Infinity
  for (const c of list) {
    worstDark = Math.min(worstDark, contrastRatio(c, DARK_INK))
    worstLight = Math.min(worstLight, contrastRatio(c, LIGHT_INK))
  }
  return worstDark >= worstLight ? DARK_INK : LIGHT_INK
}

/** Fill for accent-colored surfaces (buttons, FAB, today marker) that always carry WHITE text:
 * the accent mixed toward black just enough for white to reach 3:1 (WCAG's bar for bold labels
 * and icons). Mid/dark accents stay as-is; pastels deepen slightly (amber -> ochre). */
export function accentFill(accent: string): string {
  const n = accent.replace('#', '')
  const rgb = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16))
  for (let pct = 100; pct >= 20; pct -= 2) {
    const hex = '#' + rgb.map(v => Math.round(v * pct / 100).toString(16).padStart(2, '0')).join('')
    if (contrastRatio(hex, LIGHT_INK) >= 3) return hex
  }
  return '#333333'
}
