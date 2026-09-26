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

/** `color` mixed toward black (on a light `bg`) or white (on a dark one) just enough to reach
 * `min` contrast against `bg`. Colors that already pass come back unchanged. */
export function readableOn(color: string, bg: string, min = 4.5): string {
  const n = color.replace('#', '')
  const rgb = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16))
  const toward = luminance(bg) > 0.18 ? 0 : 255
  for (let pct = 0; pct <= 100; pct += 2) {
    const hex = '#' + rgb.map(v => Math.round(v + (toward - v) * pct / 100).toString(16).padStart(2, '0')).join('')
    if (contrastRatio(hex, bg) >= min) return hex
  }
  return toward ? '#ffffff' : '#000000'
}

/** Fill for accent-colored surfaces (buttons, FAB, today marker) that always carry WHITE text:
 * the accent deepened just enough for white to reach 4.5:1 (WCAG AA for their 15px bold labels).
 * Mid/dark accents stay as-is; pastels deepen (orange -> terracotta, amber -> ochre). */
export const accentFill = (accent: string) => readableOn(accent, LIGHT_INK)

// Spoken names for the preset swatches (MEMBER_PALETTE in types.ts): a screen
// reader saying "#FF9E7A" helps nobody. Custom colors fall back to their hex.
const COLOR_NAMES: Record<string, string> = {
  '#FF9E7A': 'Peach', '#FFD166': 'Amber', '#7ED9A6': 'Mint', '#7AB8FF': 'Sky blue', '#B39DFF': 'Lavender',
  '#FF8FA3': 'Pink', '#8FE0D6': 'Aqua', '#FFB6D9': 'Rose', '#C7E27A': 'Lime', '#A0AEC0': 'Slate',
  '#FF6B6B': 'Coral red', '#6FCF97': 'Green', '#4DA3FF': 'Blue', '#2FBFB0': 'Teal',
  '#222222': 'Black', '#FFFFFF': 'White', '#8B5A2B': 'Brown', '#8A8A8A': 'Grey', // Paint's basics
}
export const colorName = (hex: string) => COLOR_NAMES[hex.toUpperCase()] ?? hex
