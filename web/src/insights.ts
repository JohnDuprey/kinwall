// The Insights page's chart helpers (Insights.tsx). Pure, so web/test/insights.test.ts covers them.
// The numbers themselves come from the server (server/src/insights.ts); these only bucket and scale.
import type { InsightDay, InsightRange } from './types.ts'

export const RANGES: { key: InsightRange; label: string }[] = [
  { key: '4w', label: 'Last 4 weeks' }, { key: '3m', label: 'Last 3 months' }, { key: '1y', label: 'Last year' },
]
export const SLEEP_LEVEL = { terrible: 0, poorly: 1, ok: 2, good: 3, great: 4 } as const

export type Week = {
  from: string; to: string; days: InsightDay[]
  goals: { set: number; met: number; partly: number; no: number; open: number }
  chores: number; activityMinutes: number
  feelings: Record<string, number> // days each feeling came up (lowercase)
}

/** Weeks of 7 days ending on the last day (a short first week if the days aren't whole weeks). */
export function weekly(days: InsightDay[]): Week[] {
  const out: Week[] = []
  for (let end = days.length; end > 0; end -= 7) {
    const chunk = days.slice(Math.max(0, end - 7), end)
    const count = (f: (d: InsightDay) => boolean) => chunk.filter(f).length
    const sum = (f: (d: InsightDay) => number) => chunk.reduce((s, d) => s + f(d), 0)
    const set = count(d => d.goalSet)
    const met = count(d => d.goalSet && d.goalOutcome === 'yes')
    const partly = count(d => d.goalSet && d.goalOutcome === 'partly')
    const no = count(d => d.goalSet && d.goalOutcome === 'no')
    const feelings: Record<string, number> = {}
    for (const d of chunk) for (const f of new Set(d.feelings.map(f => f.toLowerCase()))) feelings[f] = (feelings[f] ?? 0) + 1
    out.unshift({
      from: chunk[0].date, to: chunk[chunk.length - 1].date, days: chunk, goals: { set, met, partly, no, open: set - met - partly - no },
      chores: sum(d => d.chores), activityMinutes: sum(d => d.activityMinutes), feelings,
    })
  }
  return out
}

/** The top of a chart's scale: the value itself up to 10, then rounded up to a half power of ten. Never 0. */
export function chartMax(n: number): number {
  if (n <= 10) return Math.max(1, Math.ceil(n))
  const step = 10 ** Math.floor(Math.log10(n)) / 2
  return Math.ceil(n / step) * step
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** An SVG path of sleep over the days, `w` by `h`: great at the top, terrible at the bottom, each
 * day in the middle of its slot. Nights without an answer break the line; a lone night is a dot. */
export function sleepPath(days: InsightDay[], w: number, h: number): string {
  let path = ''
  let run: string[] = []
  const flush = () => { if (run.length) path += `M${run[0]}${run.length === 1 ? `L${run[0]}` : run.slice(1).map(p => `L${p}`).join('')}`; run = [] }
  days.forEach((d, i) => {
    if (!d.sleep) return flush()
    run.push(`${r1(((i + 0.5) * w) / days.length)} ${r1(((4 - SLEEP_LEVEL[d.sleep]) / 4) * h)}`)
  })
  flush()
  return path
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-09-03" -> "Sep 3". */
export const shortDate = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`

export const confidenceLabel = (c: 'early' | 'clear') => (c === 'clear' ? 'Clear pattern' : 'Early sign')

export const keepCheckingIn = (n: number) => `Keep checking in: patterns show up after about 3 weeks (${n} ${n === 1 ? 'day' : 'days'} so far).`
