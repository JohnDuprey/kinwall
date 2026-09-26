// Preset "skins" for the per-device color scheme (Settings -> Appearance -> Color scheme).
// Each skin supplies the handful of raw colors that vary by season/mood; the derived tokens
// (accentStrong, accentInk, accentText) are computed with the same WCAG-AA-guaranteeing formulas
// useTheme.ts already uses for a custom accent, so a new skin can't accidentally ship a failing
// combination - see assertSkinsAA() below, and useTheme.ts's applyAppearance for where these land
// on <html> as CSS custom properties.
import { accentFill, contrastRatio, readableOn } from './color.ts'

export type SkinBase = {
  bg: string; bgAlt: string; card: string
  text: string; textDim: string; border: string
  accent: string
}
export type SkinTokens = SkinBase & { accentStrong: string; accentInk: string; accentText: string }
export type Skin = { id: string; name: string; emoji: string; light: SkinBase; dark: SkinBase }

export const SKINS: Skin[] = [
  { id: 'meadow', name: 'Peach', emoji: '🍑', // the default look (shown as Peach; the id stays 'meadow' so stored choices keep working) - must stay byte-for-byte the pre-skin colors
    light: { bg: '#FFFBF5', bgAlt: '#FFF4E8', card: '#FFFFFF', border: '#F1E4D6', text: '#3A2E27', textDim: '#7A6B60', accent: '#FF9E7A' },
    dark: { bg: '#1C1712', bgAlt: '#241D17', card: '#2A221B', border: '#3A3028', text: '#F3EAE0', textDim: '#B3A395', accent: '#FF9E7A' } },
  { id: 'field', name: 'Meadow', emoji: '🌿', // soft greens (id 'field': 'meadow' is Peach's id from before the rename)
    light: { bg: '#F3F7EE', bgAlt: '#E8F0E0', card: '#FFFFFF', border: '#D5E2CA', text: '#1F2E1C', textDim: '#51634B', accent: '#4A8A3A' },
    dark: { bg: '#111A11', bgAlt: '#172217', card: '#1C281B', border: '#2C3B2A', text: '#E6F0E1', textDim: '#A7BC9F', accent: '#6FB35C' } },
  { id: 'autumn', name: 'Autumn', emoji: '🍂',
    light: { bg: '#FDF3E7', bgAlt: '#F7E8D4', card: '#FFFFFF', border: '#EAD9BE', text: '#3B2A18', textDim: '#7A5C3E', accent: '#C2571C' },
    dark: { bg: '#211509', bgAlt: '#2B1C0E', card: '#32220F', border: '#4A3520', text: '#F5E6D3', textDim: '#C7A87E', accent: '#C2571C' } },
  { id: 'winter', name: 'Winter', emoji: '❄️',
    light: { bg: '#F3F8FC', bgAlt: '#E7F1F9', card: '#FFFFFF', border: '#D7E6F2', text: '#1B2A38', textDim: '#55707F', accent: '#2E7DD1' },
    dark: { bg: '#0F1722', bgAlt: '#16212F', card: '#1C2938', border: '#2B3C4E', text: '#E8F1FA', textDim: '#9FB4C6', accent: '#2E7DD1' } },
  { id: 'spring', name: 'Spring', emoji: '🌸',
    light: { bg: '#FBF3F6', bgAlt: '#F6E6ED', card: '#FFFFFF', border: '#ECD3DE', text: '#3A2430', textDim: '#7A566A', accent: '#3F8F56' },
    dark: { bg: '#1A1420', bgAlt: '#221A29', card: '#281F31', border: '#3A2E44', text: '#F1E4EC', textDim: '#C0A6B8', accent: '#3F8F56' } },
  { id: 'summer', name: 'Summer', emoji: '☀️',
    light: { bg: '#FFFDF0', bgAlt: '#FFF6D9', card: '#FFFFFF', border: '#F0E2A8', text: '#3A3210', textDim: '#7A6E3A', accent: '#E0A100' },
    dark: { bg: '#101A1F', bgAlt: '#16242B', card: '#1C2E36', border: '#2B4753', text: '#E9F5F7', textDim: '#9FC1C9', accent: '#E0A100' } },
  { id: 'ocean', name: 'Ocean', emoji: '🌊',
    light: { bg: '#EFF8FA', bgAlt: '#E1F1F5', card: '#FFFFFF', border: '#C9E4EB', text: '#10333A', textDim: '#4C7078', accent: '#0E86A8' },
    dark: { bg: '#071A20', bgAlt: '#0D2530', card: '#123241', border: '#1E4A5B', text: '#DCF1F5', textDim: '#8FBAC5', accent: '#0E86A8' } },
  { id: 'midnight', name: 'Midnight', emoji: '🌌', // dark-first: same deep navy whatever the mode
    light: { bg: '#0B1020', bgAlt: '#121A33', card: '#171F3D', border: '#263261', text: '#E7ECFA', textDim: '#9FADD1', accent: '#6C8CFF' },
    dark: { bg: '#0B1020', bgAlt: '#121A33', card: '#171F3D', border: '#263261', text: '#E7ECFA', textDim: '#9FADD1', accent: '#6C8CFF' } },
  { id: 'lavender', name: 'Lavender', emoji: '💜',
    light: { bg: '#F7F4FC', bgAlt: '#EFE8F9', card: '#FFFFFF', border: '#DCCEF0', text: '#2E2140', textDim: '#6B5A85', accent: '#8657D6' },
    dark: { bg: '#170F24', bgAlt: '#1E152E', card: '#251A38', border: '#382952', text: '#EDE6F7', textDim: '#B8A8D0', accent: '#8657D6' } },
  { id: 'harvest', name: 'Harvest', emoji: '🎃',
    light: { bg: '#FAF1E4', bgAlt: '#F3E4CB', card: '#FFFFFF', border: '#E4CFA3', text: '#33270F', textDim: '#705A31', accent: '#B5651D' },
    dark: { bg: '#1D1409', bgAlt: '#26190C', card: '#2F2110', border: '#493018', text: '#F2E4CC', textDim: '#C6A876', accent: '#B5651D' } },
  { id: 'festive', name: 'Festive', emoji: '🎄',
    light: { bg: '#FBF3F1', bgAlt: '#F5E5E1', card: '#FFFFFF', border: '#E8CFC8', text: '#331A16', textDim: '#6E4038', accent: '#A5342E' },
    dark: { bg: '#16100E', bgAlt: '#1F1512', card: '#261A16', border: '#3D2823', text: '#F3E4DE', textDim: '#C8A199', accent: '#A5342E' } },
]

export const DEFAULT_SKIN_ID = 'meadow'

/** The household background presets from before color schemes (styles.css's old [data-bg] rules).
 * Warm and Cocoa are Peach's own colors; any other one is offered as "Save as a scheme". */
export const OLD_BACKGROUNDS: Record<string, { name: string; bg: string; card: string; text: string }> = {
  warm: { name: 'Warm', bg: '#FFFBF5', card: '#FFFFFF', text: '#3A2E27' },
  white: { name: 'White', bg: '#FFFFFF', card: '#FFFFFF', text: '#232323' },
  gray: { name: 'Gray', bg: '#F1F2F4', card: '#FFFFFF', text: '#25282C' },
  sage: { name: 'Sage', bg: '#F3F6F1', card: '#FFFFFF', text: '#263024' },
  cocoa: { name: 'Cocoa', bg: '#1C1712', card: '#2A221B', text: '#F3EAE0' },
  charcoal: { name: 'Charcoal', bg: '#191A1C', card: '#25272B', text: '#EDEEF0' },
  midnight: { name: 'Midnight', bg: '#0F1420', card: '#1B2333', text: '#E7ECF7' },
}
export const getSkin = (id?: string): Skin => SKINS.find(s => s.id === id) ?? SKINS[0]

// ---- The family's own schemes (Settings -> Appearance -> Customize) ----
// People pick four colors per mode; the softer background, border and dim text are derived from
// them the way the built-in skins are shaped, and contrast is checked before a scheme can be saved.
export type Palette = { bg: string; card: string; text: string; accent: string }
export type CustomScheme = { id: `custom-${string}`; name: string; emoji: string; light: Palette; dark: Palette }

/** `a` moved `t` (0..1) of the way toward `b`, as #rrggbb. */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

export function baseFromPalette(p: Palette, dark: boolean): SkinBase {
  // Dim text: partway to the background, then pulled back until it reads on both surfaces.
  let textDim = mix(p.text, p.bg, 0.4)
  for (const surface of [p.bg, p.card, p.bg]) textDim = readableOn(textDim, surface)
  return { bg: p.bg, card: p.card, text: p.text, accent: p.accent, textDim,
    bgAlt: mix(p.bg, p.text, dark ? 0.06 : 0.04), border: mix(p.bg, p.text, dark ? 0.16 : 0.12) }
}

export const skinFromCustom = (c: CustomScheme): Skin =>
  ({ id: c.id, name: c.name, emoji: c.emoji || '🎨', light: baseFromPalette(c.light, false), dark: baseFromPalette(c.dark, true) })

/** A built-in skin or one of the family's schemes; unknown ids (a deleted scheme) fall back to Peach (id 'meadow'). */
export function findSkin(id: string | undefined, custom: CustomScheme[] = []): Skin {
  const c = custom.find(s => s.id === id)
  return c ? skinFromCustom(c) : getSkin(id)
}

export const paletteOf = (skin: Skin, dark: boolean): Palette => {
  const b = dark ? skin.dark : skin.light
  return { bg: b.bg, card: b.card, text: b.text, accent: b.accent }
}

/** The pairs a saved scheme must pass (4.5:1), for one mode. Accent buttons always pass: their
 * fill is deepened for white text (accentFill), and accent-as-text is adjusted (readableOn). */
export function paletteChecks(p: Palette, dark: boolean): { label: string; ratio: number }[] {
  const b = baseFromPalette(p, dark)
  return [
    { label: 'Text on background', ratio: contrastRatio(b.text, b.bg) },
    { label: 'Text on cards', ratio: contrastRatio(b.text, b.card) },
    { label: 'Dim text on background', ratio: contrastRatio(b.textDim, b.bg) },
    { label: 'Dim text on cards', ratio: contrastRatio(b.textDim, b.card) },
  ]
}

/** Which skin `seasonal` mode picks for a given date - see useTheme.ts. Exported for the test below
 * and for Settings to preview the current pick. */
export function seasonalSkinId(d = new Date()): string {
  const m = d.getMonth() + 1, day = d.getDate()
  if ((m === 12 && day >= 15) || (m === 1 && day <= 2)) return 'festive'
  if (m === 11 && day >= 15 && day <= 30) return 'harvest'
  if (m === 12 || m === 1 || m === 2) return 'winter'
  if (m >= 3 && m <= 5) return 'spring'
  if (m >= 6 && m <= 8) return 'summer'
  return 'autumn' // Sep-Nov
}

/** Re-exported WCAG contrast ratio, used by the Settings custom-color badges too. */
export const contrast = contrastRatio

/** Full token set for one skin/mode, with accentStrong/accentInk/accentText derived the same way
 * a custom accent is (readableOn/accentFill), so any new skin above is AA-safe by construction. */
export function tokensFor(skin: Skin, dark: boolean): SkinTokens {
  const base = dark ? skin.dark : skin.light
  const accentStrong = accentFill(base.accent)
  return { ...base, accentStrong, accentInk: '#ffffff', accentText: readableOn(base.accent, dark ? base.card : base.bgAlt) }
}

/** Dev-only sanity check: every skin's text/textDim must hit 4.5:1 on its bg/card, and white must
 * hit 4.5:1 on the derived accentStrong (the only place --accent-ink is actually drawn on top of
 * --accent - see styles.css). Run once from main.tsx in dev; console.warns rather than throwing so
 * a bad color doesn't take down the app. */
export function assertSkinsAA() {
  for (const skin of SKINS) {
    for (const dark of [false, true]) {
      const t = tokensFor(skin, dark)
      const checks: [string, number][] = [
        ['text/bg', contrastRatio(t.text, t.bg)],
        ['text/card', contrastRatio(t.text, t.card)],
        ['textDim/bg', contrastRatio(t.textDim, t.bg)],
        ['textDim/card', contrastRatio(t.textDim, t.card)],
        ['accentInk/accentStrong', contrastRatio(t.accentInk, t.accentStrong)],
      ]
      for (const [label, ratio] of checks) {
        if (ratio < 4.5) console.warn(`[skins] ${skin.id} ${dark ? 'dark' : 'light'} ${label} = ${ratio.toFixed(2)} - fails WCAG AA`)
      }
    }
  }
}
