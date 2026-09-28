// Demo build only (VITE_MOCK=1): GET /api/members/{id}/stats over a made-up history per person, so
// profiles look lived-in. Seeded, so a reload shows the same numbers. Server logic lives in
// server/src/routes/member-stats.ts; this only mirrors its shape.
import type { MemberStats, StatsPeriod } from './types.ts'
import { dateKey } from './date.ts'

type Book = [title: string, pages: number, daysAgo: number, rating: number]
type Profile = {
  joinedDaysAgo: number; seed: number
  chores: [title: string, emoji: string, points: number, odds: number][]
  books: Book[]; reading: [string, number][]; packs: number; placed: number; kid: boolean
}

const PROFILES: Record<string, Profile> = {
  m3: { // Maya
    joinedDaysAgo: 568, seed: 7, packs: 5, placed: 23, kid: true,
    chores: [['Feed Pepper', '🐶', 2, 0.9], ['Make bed', '🛏️', 1, 0.82], ['Unload dishwasher', '🍽️', 3, 0.55], ['Reading time', '📚', 3, 0.75], ['Tidy room', '🧸', 2, 0.5]],
    books: [['Pip and the Lighthouse', 96, 533, 5], ['The Moon Garden', 128, 495, 4], ['Owls After Dark', 88, 451, 5], ['Dragons Don’t Do Dishes', 110, 252, 5], ['Starlight Stables', 156, 217, 4],
      ['The Secret Tree Fort', 132, 181, 5], ['A Whale Named Wednesday', 98, 154, 4], ['Rainy Day Detectives', 176, 112, 5], ['The Pancake Planet', 84, 87, 4], ['Lost in the Library', 188, 49, 5], ['Sunny and the Storm', 120, 14, 4], ['Comet Club', 104, 3, 5]],
    reading: [['The Clockwork Fox', 63]],
  },
  m4: { // Leo
    joinedDaysAgo: 483, seed: 11, packs: 3, placed: 11, kid: true,
    chores: [['Feed the fish', '🐠', 1, 0.88], ['Put toys away', '🧸', 2, 0.66], ['Brush teeth', '🪥', 1, 0.93], ['Set the table', '🍴', 2, 0.55]],
    books: [['Big Truck, Little Truck', 24, 422, 5], ['Goodnight, Dino', 32, 317, 5], ['The Hungry Snail', 28, 229, 4], ['Rocket to the Moon', 40, 131, 5], ['Ten Little Frogs', 24, 28, 4]],
    reading: [['Dino Detectives', 38]],
  },
  m1: { // Alex
    joinedDaysAgo: 575, seed: 3, packs: 1, placed: 0, kid: false,
    chores: [['Take out trash', '🗑️', 3, 0.4], ['Cook dinner', '🍳', 4, 0.5], ['Walk Pepper', '🐶', 3, 0.6]],
    books: [['The Long Harbor', 344, 454, 4], ['Maps of Small Towns', 288, 281, 5], ['A Quiet Engine', 410, 175, 3], ['Salt and Cedar', 256, 35, 4]],
    reading: [['The Night Ferry', 36]],
  },
  m2: { // Sam
    joinedDaysAgo: 575, seed: 5, packs: 1, placed: 0, kid: false,
    chores: [['Grocery run', '🛒', 4, 0.3], ['Pack lunches', '🥪', 3, 0.55], ['Water garden', '🌻', 2, 0.45]],
    books: [['Garden Year', 212, 510, 5], ['The Lantern Keeper', 368, 378, 4], ['Northbound', 302, 241, 4], ['Weekend Bread', 180, 21, 4]],
    reading: [],
  },
}
const ACTIVITIES = [['word-garden', 'Word Garden', '🌱'], ['math-stars', 'Math Stars', '🔢']] as const
const BADGES: [string, string, string][] = [['first-chore', '🌱', 'First chore'], ['chores-10', '⭐', '10 chores'], ['chores-50', '🏅', '50 chores'], ['chores-100', '💯', '100 chores'], ['chores-500', '🏆', '500 chores'],
  ['streak-7', '🔥', '7-day streak'], ['streak-30', '🌟', '30-day streak'], ['first-reward', '🎁', 'First reward'], ['first-pack', '🎨', 'First sticker pack'], ['all-packs', '📒', 'Every sticker pack'], ['first-book', '📖', 'First book'], ['books-10', '📚', '10 books']]

function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const shift = (key: string, n: number) => { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate() + n); return dateKey(d) }

type Day = { done: number[]; points: number; spentStickers: number; spentRewards: number; play: number[] }
const histories = new Map<string, Map<string, Day>>()
function history(id: string, p: Profile, today: string) {
  const cached = histories.get(id)
  if (cached) return cached
  const r = rng(p.seed)
  const days = new Map<string, Day>()
  let slump = 0
  for (let key = shift(today, -p.joinedDaysAgo); key <= today; key = shift(key, 1)) {
    if (slump > 0) slump--; else if (r() < 0.012) slump = 3 + Math.floor(r() * 5) // a trip or a sick week
    const recent = key > shift(today, -12) // a good run lately, so the streak has something to show
    const odds = recent ? (key === today ? 0.6 : 1.8) : (slump ? 0.25 : 1)
    const done = p.chores.flatMap((c, i) => (r() < c[3] * odds ? [i] : []))
    days.set(key, {
      done, points: done.reduce((s, i) => s + p.chores[i][2], 0),
      spentStickers: p.kid && r() < 0.03 ? 20 : 0, spentRewards: p.kid && r() < 0.12 ? 15 : 0,
      play: ACTIVITIES.map(() => (p.kid && r() < 0.38 ? 240 + Math.floor(r() * 900) : 0)),
    })
  }
  histories.set(id, days)
  return days
}

export function mockMemberStats(id: string, period: StatsPeriod, birthdayOn: string | null): MemberStats {
  const p = PROFILES[id] ?? { ...PROFILES.m2, seed: id.length, books: [], reading: [] }
  const today = dateKey(new Date())
  const days = history(id, p, today)
  const joined = shift(today, -p.joinedDaysAgo)
  const dow = new Date(`${today}T12:00:00`).getDay()
  const [y, m] = today.split('-')
  const prevMonth = dateKey(new Date(Number(y), Number(m) - 2, 1))
  const ranges: Record<StatsPeriod, [string, [string, string] | null]> = {
    today: [today, [shift(today, -1), shift(today, -1)]],
    week: [shift(today, -dow), [shift(today, -dow - 7), shift(today, -7)]],
    month: [`${y}-${m}-01`, [prevMonth, `${prevMonth.slice(0, 8)}${today.slice(8)}`]],
    year: [`${y}-01-01`, [`${Number(y) - 1}-01-01`, `${Number(y) - 1}${today.slice(4)}`]],
    all: [joined, null],
  }
  const [from, prev] = ranges[period]
  const within = (a: string, b: string) => [...days].filter(([k]) => k >= a && k <= b)
  const tally = (a: string, b: string) => within(a, b).reduce((t, [, d]) => ({ choresDone: t.choresDone + d.done.length, pointsEarned: t.pointsEarned + d.points }), { choresDone: 0, pointsEarned: 0 })
  const now = within(from, today)

  const chart = period === 'today' ? [] : period === 'week' || period === 'month'
    ? Array.from({ length: period === 'week' ? 7 : new Date(Number(y), Number(m), 0).getDate() }, (_, i) => shift(from, i)).map(key => ({ key, count: days.get(key)?.done.length ?? 0 }))
    : (() => {
      const out: { key: string; count: number }[] = []
      const end = period === 'year' ? `${y}-12` : today.slice(0, 7)
      for (let d = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1); dateKey(d).slice(0, 7) <= end; d.setMonth(d.getMonth() + 1)) {
        const key = dateKey(d).slice(0, 7)
        out.push({ key, count: now.filter(([k]) => k.startsWith(key)).reduce((s, [, x]) => s + x.done.length, 0) })
      }
      return out
    })()
  const weekdays = [0, 0, 0, 0, 0, 0, 0]
  const perChore = p.chores.map(() => 0)
  for (const [k, d] of now) { weekdays[new Date(`${k}T12:00:00`).getDay()] += d.done.length; d.done.forEach(i => perChore[i]++) }
  const fav = perChore.indexOf(Math.max(...perChore))

  // A good day: at least half their chores. The streak forgives today until it's over.
  const good = (k: string) => (days.get(k)?.done.length ?? 0) >= Math.ceil(p.chores.length / 2)
  let current = 0
  for (let k = good(today) ? today : shift(today, -1); good(k); k = shift(k, -1)) current++
  let best = 0, run = 0
  for (const k of days.keys()) { run = good(k) ? run + 1 : 0; best = Math.max(best, run) }

  const books = p.books.map(([title, pages, ago, rating]) => ({ id: title, title, pages, rating, finishedOn: shift(today, -ago) }))
  const inPeriod = books.filter(b => b.finishedOn >= (period === 'all' ? '' : from))
  const shelf = period === 'all' ? books : books.filter(b => b.finishedOn.startsWith(y))
  const all = tally('', today)
  const earned = new Set(['first-chore', ...(all.choresDone >= 10 ? ['chores-10'] : []), ...(all.choresDone >= 50 ? ['chores-50'] : []), ...(all.choresDone >= 100 ? ['chores-100'] : []), ...(all.choresDone >= 500 ? ['chores-500'] : []),
    ...(best >= 7 ? ['streak-7'] : []), ...(best >= 30 ? ['streak-30'] : []), ...(p.kid ? ['first-reward'] : []), ...(p.packs > 1 ? ['first-pack'] : []), ...(p.packs >= 8 ? ['all-packs'] : []),
    ...(books.length ? ['first-book'] : []), ...(books.length >= 10 ? ['books-10'] : [])])

  let birthday: MemberStats['birthday'] = null
  if (birthdayOn) {
    const next = new Date(`${y}${birthdayOn.slice(-6)}T12:00:00`)
    if (dateKey(next) < today) next.setFullYear(next.getFullYear() + 1)
    birthday = { date: birthdayOn, daysUntil: Math.round((next.getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000), turning: birthdayOn.startsWith('--') ? null : next.getFullYear() - Number(birthdayOn.slice(0, 4)) }
  }

  return {
    memberId: id, period, from, to: today, joined, ...tally(from, today),
    previous: prev && { from: prev[0], to: prev[1], ...tally(prev[0], prev[1]) },
    pointsSpent: now.reduce((s, [, d]) => ({ stickers: s.stickers + d.spentStickers, rewards: s.rewards + d.spentRewards }), { stickers: 0, rewards: 0 }),
    streak: { current, best },
    chart,
    busiestWeekday: now.some(([, d]) => d.done.length) ? weekdays.indexOf(Math.max(...weekdays)) : null,
    favoriteChore: perChore[fav] ? { choreId: `c${fav}`, title: p.chores[fav][0], emoji: p.chores[fav][1], count: perChore[fav] } : null,
    books: {
      finished: inPeriod.length, pages: inPeriod.reduce((s, b) => s + b.pages, 0), shelfScope: period === 'all' ? 'all' : 'year', shelf,
      reading: p.reading.map(([title, percent]) => ({ id: title, title, percent })),
    },
    stickers: { packsOwned: p.packs, packsTotal: 8, placed: p.placed },
    activities: p.kid ? ACTIVITIES.map(([pluginId, name, emoji], i) => ({ pluginId, name, emoji, seconds: now.reduce((s, [, d]) => s + d.play[i], 0) })).filter(a => a.seconds).sort((a, b) => b.seconds - a.seconds) : [],
    badges: BADGES.map(([bid, emoji, title]) => ({ id: bid, emoji, title, earned: earned.has(bid) })),
    birthday,
  }
}
