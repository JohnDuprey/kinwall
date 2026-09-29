// Writes src/mock-insights.ts: Maya's six weeks of made-up check-ins for the demo, and what the
// server's own analysis (server/src/insights.ts) says about them for each range, so the demo's
// Insights page shows real charts, summaries and connections with no server. Also her energy
// battery (server/src/battery.ts) for the last week and the days ahead, with a full day tomorrow, and
// her evening "How drained do you feel?" answers (a bit lower than it guessed, so it adjusts).
// Fictional, and the same every run (a fixed seed). Run after changing the analysis or the battery:
// node scripts/demo-insights.mjs
import { writeFileSync } from 'node:fs'
import { analyze } from '../../server/src/insights.ts'
import { battery, calibrate, CALIBRATE_DAYS, FORECAST_DAYS, HISTORY_DAYS, RECENT_DAYS } from '../../server/src/battery.ts'

const DAYS = 42
let seed = 8
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (list) => list[Math.floor(rand() * list.length)]

// The three newest days match the demo's journal (src/mock.ts).
const FIXED = {
  0: { sleep: 'good', feelings: ['good', 'excited'], goalSet: true, goalOutcome: null },
  1: { sleep: 'great', feelings: ['great'], goalSet: true, goalOutcome: 'yes', journalEntries: 1, journalMoods: ['🌈'] },
  2: { sleep: 'ok', feelings: ['tired'], goalSet: true, goalOutcome: 'partly' },
}
const days = []
for (let ago = DAYS - 1; ago >= 0; ago--) {
  const lateBefore = !!days.at(-1)?.lastEventEnd && days.at(-1).lastEventEnd > '20:00'
  const weekday = (7 + 6 - (ago % 7)) % 7 // 0 = the day a week before today
  // Soccer practice two evenings a week runs late; most days have a thing or two on.
  const late = weekday === 1 || weekday === 4
  const events = late ? 2 : Math.floor(rand() * 3)
  const skipped = ago > 2 && rand() < 0.12 // some days she doesn't check in
  const sleep = skipped ? null : pick(['great', 'good', 'good', 'great', 'ok', 'poorly'])
  const well = sleep === 'great' || sleep === 'good'
  const feelings = skipped ? [] : lateBefore ? pick([['tired'], ['tired', 'ok'], ['fine'], ['tired', 'good']]) : pick([['good'], ['great'], ['good', 'excited'], ['fine'], ['great', 'excited'], ['ok']])
  const goalSet = !skipped && rand() < 0.85
  const goalOutcome = goalSet ? (well ? pick(['yes', 'yes', 'yes', 'partly']) : pick(['yes', 'partly', 'no', 'no'])) : null
  const journal = !skipped && rand() < 0.2
  days.push({
    ago, checkedIn: !skipped, sleep, feelings, goalSet, goalOutcome, journalEntries: journal ? 1 : 0, journalMoods: journal ? [pick(['🙂', '😄', '🤩', '😴'])] : [],
    chores: 1 + Math.floor(rand() * 3), points: 0, // a chore or more every day
    activityMinutes: pick([0, 0, 10, 15, 20, 30, 45]), booksFinished: ago === 30 || ago === 9 ? 1 : 0,
    events, lastEventEnd: late ? '20:30' : events ? pick(['15:30', '17:00', '18:15']) : null,
    ...FIXED[ago],
  })
  const d = days.at(-1)
  d.points = d.chores * 5
  d.checkedIn = !!(d.sleep || d.feelings.length || d.goalSet)
}

const RANGES = { '4w': 28, '3m': 91, '1y': 364 }
const blank = (ago) => ({ ago, checkedIn: false, sleep: null, feelings: [], goalSet: false, goalOutcome: null, journalEntries: 0, journalMoods: [], chores: 0, points: 0, activityMinutes: 0, booksFinished: 0, events: 0, lastEventEnd: null })
const dated = (list) => list.map((d) => ({ ...d, date: new Date(Date.UTC(2026, 0, 1) - d.ago * 86_400_000).toISOString().slice(0, 10) }))
const analysis = Object.fromEntries(Object.entries(RANGES).map(([range, n]) => {
  const series = Array.from({ length: n }, (_, i) => days.find((d) => d.ago === n - 1 - i) ?? blank(n - 1 - i))
  return [range, analyze(dated(series))]
}))

// The battery: her days' events rebuilt from the counts (the last one ends at lastEventEnd), then a
// full day tomorrow and calmer ones after. `ago` below 0 is a day ahead.
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
const rebuilt = (d) => Array.from({ length: d.events }, (_, k) => (k === d.events - 1
  ? { title: d.lastEventEnd > '20:00' ? 'Soccer practice' : 'Piano lesson', start: hm(mins(d.lastEventEnd) - 60), end: d.lastEventEnd }
  : { title: 'Library', start: '10:00', end: '11:00' }))
const AHEAD = {
  [-1]: [{ title: 'Swim lesson', start: '09:00', end: '10:00' }, { title: 'Library', start: '11:00', end: '12:00' }, { title: 'Birthday party', start: '13:00', end: '15:00' },
    { title: 'Art class', start: '15:10', end: '16:00' }, { title: 'Soccer practice', start: '19:00', end: '20:30' }],
  [-2]: [{ title: 'Piano lesson', start: '16:00', end: '17:00' }],
  [-3]: [],
}
const batteryAgo = Array.from({ length: CALIBRATE_DAYS + RECENT_DAYS + FORECAST_DAYS }, (_, i) => CALIBRATE_DAYS + RECENT_DAYS - 1 - i)
// Chore points: what she did on days gone; today, one chore (5) still to do; 10 due each day ahead.
const batteryInputs = dated(batteryAgo.map((ago) => ({ ago }))).map(({ ago, date }) => {
  const d = days.find((x) => x.ago === ago)
  return d
    ? { date, sleep: d.sleep, feelings: d.feelings, goalSet: d.goalSet, chores: d.chores, choreDone: ago ? d.points : d.points - 5, choreDue: ago ? 0 : 5, events: rebuilt(d) }
    : { date, sleep: null, feelings: [], goalSet: false, chores: 2, choreDone: 0, choreDue: 10, events: AHEAD[ago] }
})
const batteryToday = dated([{ ago: 0 }])[0].date
const agoOf = (date) => Math.round((Date.parse(batteryToday) - Date.parse(date)) / 86_400_000)
// How drained she felt: the evenings she checked in over the last 3 weeks, about 20 lower than it guessed.
const word = (level) => (level >= 75 ? 'full' : level >= 50 ? 'ok' : level >= 25 ? 'low' : 'empty')
const felt = Object.fromEntries(battery(batteryInputs, batteryToday).days
  .filter((d) => { const ago = agoOf(d.date); return ago >= 1 && ago <= 20 && days.find((x) => x.ago === ago)?.checkedIn })
  .map((d) => [d.date, word(Math.max(0, d.level - 20))]))
const b = battery(batteryInputs, batteryToday, calibrate(battery(batteryInputs, batteryToday).days, felt, batteryToday))
const mayaBattery = {
  days: b.days.slice(-(HISTORY_DAYS + FORECAST_DAYS)).map(({ date, ...d }) => ({ ago: agoOf(date), ...d, felt: felt[date] ?? null })),
  warnings: b.warnings.map(({ date, ...w }) => ({ ago: agoOf(date), ...w })),
}

const out = `// Generated by scripts/demo-insights.mjs (fictional demo data): don't edit by hand.
// Maya's last ${DAYS} days (ago: days before today) and the server's analysis of them per range.
import type { BatteryDay, BatteryWarning, InsightDay, InsightRange, Insights } from './types.ts'

export const MAYA_DAYS: (Omit<InsightDay, 'date'> & { ago: number })[] = ${JSON.stringify(days)}
export const MAYA_ANALYSIS: Record<InsightRange, Pick<Insights, 'summary' | 'topFeelings' | 'connections'>> = ${JSON.stringify(analysis)}
// Her energy battery: the last 7 days and 3 ahead (ago below 0), and its heads-ups.
export const MAYA_BATTERY: { days: (Omit<BatteryDay, 'date'> & { ago: number })[]; warnings: (Omit<BatteryWarning, 'date'> & { ago: number })[] } = ${JSON.stringify(mayaBattery)}
`
writeFileSync(new URL('../src/mock-insights.ts', import.meta.url), out)
for (const [range, a] of Object.entries(analysis)) console.log(range, a.connections.daysWithCheckIns, a.connections.list.map((c) => `${c.text} [${c.confidence}]`))
console.log('battery', mayaBattery.days.map((d) => `${d.ago}:${d.level}`).join(' '), mayaBattery.warnings.map((w) => w.text))
