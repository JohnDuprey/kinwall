import type { Typeface } from './types.ts'

// The typefaces, as the server knows them (server/src/schemas.ts TYPEFACES). 'default' is Nunito.
const TYPEFACES: readonly Typeface[] = ['default', 'hyperlegible', 'dyslexia', 'modern', 'playful', 'storybook', 'handwritten']

/** A device's saved typeface: any real pick is an override, anything else (nothing saved, which is
 * how older builds stored Default) follows the family. */
export function deviceTypeface(raw: unknown): Typeface | undefined {
  return TYPEFACES.find(t => t === raw)
}

/** The typeface in effect: this device's override, then the family's, then Default. */
export function resolveTypeface(family: Typeface | undefined, device: Typeface | undefined): Typeface {
  return device ?? family ?? 'default'
}
