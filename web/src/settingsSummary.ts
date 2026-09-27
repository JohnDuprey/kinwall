// One-line summaries for the Settings → General sections that open in a sheet (Features, Time
// cues, Night screen). Labels come in from Settings.tsx so these stay pure and testable.

const list = (xs: string[]) => new Intl.ListFormat('en-US', { type: 'conjunction' }).format(xs)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "8 of 10 on" and, when some are off, "Off: Paint, Family messages." */
export function featuresSummary(rows: { label: string; on: boolean }[]): { summary: string; detail?: string } {
  const off = rows.filter(r => !r.on).map(r => r.label)
  if (!off.length) return { summary: `All ${rows.length} on` }
  return { summary: `${rows.length - off.length} of ${rows.length} on`, detail: `Off: ${off.join(', ')}.` }
}

/** "Now / Next on · warnings at 10 and 5 min with sound · back to the calendar when idle". */
export function timeCuesSummary(c: { idleReset: boolean; nowNext: boolean; warnings: number[]; sound: boolean }): string {
  const parts = [
    c.nowNext && 'Now / Next on',
    c.warnings.length > 0 && `warnings at ${list(c.warnings.map(String))} min${c.sound ? ' with sound' : ''}`,
    c.idleReset && 'back to the calendar when idle',
  ].filter((p): p is string => !!p)
  return parts.length ? cap(parts.join(' · ')) : 'All off'
}

/** "Drawings and family photos, every 5 min, clock on", or "Clock only". */
export function nightSummary(n: { sources: string[]; every: number; bright: 'low' | 'medium'; clock: boolean }): string {
  if (!n.sources.length) return 'Clock only'
  return [cap(list(n.sources.map(s => s.charAt(0).toLowerCase() + s.slice(1)))), `every ${n.every} min`, n.bright === 'medium' && 'medium brightness', n.clock ? 'clock on' : 'no clock']
    .filter(Boolean).join(', ')
}
