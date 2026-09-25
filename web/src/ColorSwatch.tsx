import { DropperIcon } from './icons.tsx'

/** The "any colour" swatch: a rainbow ring with a dropper so it reads as a picker, not a grey
 * preset. Once a custom colour is chosen it fills with that colour like the other swatches. */
export function CustomColorSwatch({ value, presets, onChange, label }: { value: string | undefined; presets: readonly string[]; onChange: (hex: string) => void; label: string }) {
  const valid = /^#[0-9a-f]{6}$/i.test(value ?? '')
  const active = valid && !presets.includes(value!)
  return (
    <label className={`color-swatch color-swatch-custom ${active ? 'active' : ''}`} style={active ? { background: value } : undefined} title="Pick any colour">
      <DropperIcon width={18} height={18} />
      <input type="color" value={valid ? value : '#888888'} onChange={e => onChange(e.target.value)} aria-label={active ? `${label} (selected)` : label} />
    </label>
  )
}
