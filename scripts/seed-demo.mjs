#!/usr/bin/env node
// Fills a fresh Kinwall instance with a fictional family - members, calendars, a busy week of
// events, categories, chores with a few days of history, and lists - so there's something to look at.
//
//   KINWALL_URL=http://localhost:8080 KINWALL_KEY=<admin key> node scripts/seed-demo.mjs
//
// Dates are relative to today (in this machine's timezone, which is also set as the household's),
// so the demo always looks current. Refuses to run against an instance that already has members.

const BASE = (process.env.KINWALL_URL || 'http://localhost:8080').replace(/\/$/, '')
const KEY = process.env.KINWALL_KEY || process.env.ADMIN_API_KEY
if (!KEY) { console.error('Set KINWALL_KEY to an admin API key.'); process.exit(1) }

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

const pad = n => String(n).padStart(2, '0')
const today = new Date(); today.setHours(0, 0, 0, 0)
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const weekStart = addDays(today, -today.getDay()) // Sunday
/** Day `offset` of this week (0 = Sunday) at h:m local, as ISO. */
const at = (offset, h, m = 0) => { const d = addDays(weekStart, offset); d.setHours(h, m, 0, 0); return d.toISOString() }
const plusMin = (iso, min) => new Date(new Date(iso).getTime() + min * 60000).toISOString()

if ((await api('GET', '/api/members')).length) {
  console.error('This instance already has members - seed a fresh one instead.')
  process.exit(1)
}

await api('PATCH', '/api/settings', {
  familyName: 'Our Family',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  weekStart: 0,
})

const M = {}
for (const [key, name, color, avatar] of [
  ['alex', 'Alex', '#6BA4E7', '🧔🏻'],
  ['sam', 'Sam', '#B79CED', '👩🏽'],
  ['maya', 'Maya', '#F28DB2', '🦄'],
  ['leo', 'Leo', '#7BCB94', '🦖'],
]) M[key] = (await api('POST', '/api/members', { name, color, avatar })).id

const C = {}
for (const [key, name, emoji, color, keywords] of [
  ['bday', 'Birthdays', '🎂', '#F06BA8', ['birthday', 'bday']],
  ['sports', 'Sports', '⚽', '#3FB67B', ['soccer', 'swim', 'practice', 'game']],
  ['school', 'School', '🏫', '#4E8FE8', ['school', 'teacher', 'field trip', 'pta']],
  ['appt', 'Appointments', '🩺', '#16B3A8', ['dentist', 'doctor', 'checkup']],
]) C[key] = (await api('POST', '/api/categories', { name, emoji, color, keywords })).id

const family = await api('POST', '/api/calendars', { kind: 'local', name: 'Family', color: '#F2A27A' })
const work = await api('POST', '/api/calendars', { kind: 'local', name: 'Work', color: '#8A9BB0', memberIds: [M.alex, M.sam] })

const ev = (cal, title, start, minutes, memberIds = [], extra = {}) =>
  api('POST', '/api/events', { calendarId: cal.id, title, start, end: plusMin(start, minutes), allDay: false, memberIds, ...extra })
const allDay = (cal, title, fromOffset, days, memberIds = [], extra = {}) =>
  api('POST', '/api/events', { calendarId: cal.id, title, start: ymd(addDays(weekStart, fromOffset)), end: ymd(addDays(weekStart, fromOffset + days)), allDay: true, memberIds, ...extra })

// Weekly routines, started a month back so the month view is filled in whatever today's date is
const W = -28
await ev(work, 'Team sync', at(W + 1, 9), 30, [M.alex], { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' })
await ev(family, 'Piano lesson', at(W + 2, 16), 45, [M.maya], { rrule: 'FREQ=WEEKLY;BYDAY=TU', location: 'Harmony Music Studio' })
await ev(family, 'Swim lesson', at(W + 1, 16, 30), 45, [M.leo], { rrule: 'FREQ=WEEKLY;BYDAY=MO' })
await ev(family, 'Soccer practice', at(W + 3, 17, 30), 75, [M.maya], { rrule: 'FREQ=WEEKLY;BYDAY=WE' })
await ev(family, 'Yoga', at(W + 4, 19), 60, [M.sam], { rrule: 'FREQ=WEEKLY;BYDAY=TH' })
await ev(family, 'Pizza & movie night', at(W + 5, 18, 30), 150, [M.alex, M.sam, M.maya, M.leo], { rrule: 'FREQ=WEEKLY;BYDAY=FR' })

// Earlier weeks
await allDay(family, 'Beach weekend', -8, 2, [M.alex, M.sam, M.maya, M.leo], { location: 'Crescent Bay' })
await ev(family, 'Haircuts', at(-4, 15), 60, [M.maya, M.leo])
await ev(family, 'Book club', at(-10, 19, 30), 90, [M.sam])
await allDay(family, "Uncle Ben's birthday", -13, 1, [])
await ev(family, 'PTA meeting', at(-17, 18), 60, [M.sam])
await ev(family, 'Vet - Biscuit', at(-19, 11), 45, [M.alex])

// This week
await ev(family, 'Dentist checkup', at(2, 10, 30), 60, [M.sam, M.leo], { location: 'Bright Smiles Dental, 210 Oak St' })
await ev(work, 'Quarterly planning', at(2, 13), 120, [M.sam])
await ev(family, 'Parent-teacher conference', at(4, 15, 15), 30, [M.alex, M.sam], { location: 'Lincoln Elementary' })
await ev(family, 'Soccer game vs. Tigers', at(6, 9), 90, [M.maya, M.alex], { location: 'Riverside Park, Field 3' })
await ev(family, 'Farmers market', at(6, 11), 90, [])
await ev(family, 'Pancake breakfast', at(0, 9), 60, [])
await ev(family, "Leo's playdate with Theo", at(0, 14), 120, [M.leo])
await ev(work, 'Client call', at(3, 11), 60, [M.alex])
await ev(family, 'Library story time', at(3, 10), 45, [M.leo, M.sam])
await allDay(family, "Grandma Rose's birthday", 6, 1, [])
await allDay(family, 'School picture day', 4, 1, [M.maya])

// Later this month
await allDay(family, 'Camping at Pine Lake', 12, 3, [M.alex, M.sam, M.maya, M.leo], { location: 'Pine Lake State Park' })
await allDay(family, "Leo's birthday 🎉", 17, 1, [M.leo])
await ev(family, 'Field trip to the aquarium', at(9, 8, 30), 360, [M.maya])
await ev(family, 'Doctor - annual physical', at(15, 9), 45, [M.alex])

// Chores, with a few days of history so streaks and the leaderboard have something to show
const chores = []
for (const [title, emoji, member, points, rrule] of [
  ['Make bed', '🛏️', 'maya', 1, 'FREQ=DAILY'],
  ['Make bed', '🛏️', 'leo', 1, 'FREQ=DAILY'],
  ['Feed Biscuit', '🐶', 'maya', 2, 'FREQ=DAILY'],
  ['Tidy toys', '🧸', 'leo', 1, 'FREQ=DAILY'],
  ['Homework', '📚', 'maya', 2, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
  ['Empty dishwasher', '🍽️', 'alex', 2, 'FREQ=DAILY'],
  ['Water plants', '🪴', 'sam', 2, 'FREQ=WEEKLY;BYDAY=SU,WE'],
  ['Take out trash', '🗑️', 'alex', 3, 'FREQ=WEEKLY;BYDAY=TU,FR'],
  ['Fold laundry', '🧺', 'sam', 3, 'FREQ=DAILY'],
]) chores.push({ ...(await api('POST', '/api/chores', { title, emoji, memberId: M[member], points, rrule, dueDate: ymd(addDays(today, -7)) })), member }) // dueDate anchors the repeat a week back

for (let back = 6; back >= 0; back--) {
  const date = ymd(addDays(today, -back))
  const day = await api('GET', `/api/chores/day?date=${date}`)
  for (const c of day) {
    const seeded = chores.find(x => x.id === c.id)
    // Most chores done on past days; today about half, so there's something left to tick.
    const done = back === 0 ? ['Make bed', 'Feed Biscuit', 'Empty dishwasher'].includes(c.title) : Math.random() < 0.85
    if (seeded && done) await api('POST', `/api/chores/${c.id}/complete`, { date, memberId: M[seeded.member] })
  }
}

// Lists
const groceries = await api('POST', '/api/lists', { name: 'Groceries', kind: 'shopping', emoji: '🛒', color: '#F2A27A' })
await api('POST', `/api/lists/${groceries.id}/items`, [
  { title: 'Bananas', store: "Trader Joe's", category: 'Produce' },
  { title: 'Avocados', quantity: '4', store: "Trader Joe's", category: 'Produce' },
  { title: 'Strawberries', store: "Trader Joe's", category: 'Produce' },
  { title: 'Milk', quantity: '2 gal', store: 'Costco', category: 'Dairy' },
  { title: 'Greek yogurt', store: 'Costco', category: 'Dairy' },
  { title: 'Eggs', quantity: '2 dozen', store: 'Costco', category: 'Dairy' },
  { title: 'Paper towels', store: 'Costco', category: 'Household' },
  { title: 'Dish soap', store: 'Target', category: 'Household' },
  { title: 'Sourdough bread', store: "Trader Joe's", category: 'Bakery' },
  { title: 'Pasta', quantity: '3', category: 'Pantry' },
  { title: 'Birthday candles', store: 'Target', category: 'Party' },
])
const projects = await api('POST', '/api/lists', { name: 'Weekend projects', kind: 'todo', emoji: '🔨', color: '#8A9BB0' })
await api('POST', `/api/lists/${projects.id}/items`, [
  { title: 'Fix the squeaky gate', memberId: M.alex, dueDate: ymd(addDays(weekStart, 6)) },
  { title: 'Plant tomato seedlings', memberId: M.sam },
  { title: "Build Leo's bookshelf", memberId: M.alex, dueDate: ymd(addDays(weekStart, 13)) },
  { title: 'Clean out the garage' },
])
const packing = await api('POST', '/api/lists', { name: 'Camping packing', kind: 'reusable', emoji: '🏕️', color: '#7BCB94' })
const packed = await api('POST', `/api/lists/${packing.id}/items`, [
  { title: 'Tent' }, { title: 'Sleeping bags' }, { title: 'Headlamps' }, { title: 'Sunscreen' },
  { title: 'Marshmallows' }, { title: 'First aid kit' }, { title: 'Rain jackets' },
])
for (const item of packed.slice(0, 3)) await api('PATCH', `/api/lists/${packing.id}/items/${item.id}`, { done: true })

console.log(`Seeded the demo family into ${BASE}`)
