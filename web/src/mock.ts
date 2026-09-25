// Dev-only in-memory fixture, used when VITE_MOCK=1. Excluded from prod by the env check in api.ts.
import type {
  Account, ApiKey, AppNotification, CalendarEntry, Category, Chore, ChoreDay, EventInstance, LeaderboardEntry, LeaderboardPeriod, List, ListGroup,
  GeocodeResult, ListItem, ListItemInput, ListItemStep, Member, Note, NoteTarget, Providers, RemoteCalendar, Settings, Snapshot, SnapshotBirthday, StickerPack, StickerPatch, StickerPlacement, Webhook,
} from './types.ts'
import { compareItems } from './types.ts'
import { dateKey } from './date.ts'

const uid = () => crypto.randomUUID()
const todayISO = () => new Date().toISOString().slice(0, 10)

let rev = 1
const bump = () => { rev++ }

const settings: Settings = {
  familyName: 'Our Family',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  weekStart: 0,
  themeMode: 'light',
  darkFrom: '20:00',
  darkTo: '07:00',
  quietFrom: null,
  quietTo: null,
  accent: '#FF9E7A',
  backgroundLight: 'warm',
  backgroundDark: 'cocoa',
  textScale: 'm',
  density: 'comfortable',
  defaultReminderMinutes: [30],
  lateCompletionCredit: 50,
  streakGraceDays: 1,
  leaderboardEnabled: true,
  stickersEnabled: true,
  stickerPriceScale: 100,
  location: { name: 'Portland', lat: 45.5152, lon: -122.6784, countryCode: 'US' },
  temperatureUnit: 'fahrenheit',
}

const members: Member[] = [
  { id: 'm1', name: 'Alex', color: '#7AB8FF', avatar: '🦊', birthday: '1988-03-14', sort: 0, pointsToday: 10, pointsWeek: 40, balance: 12 },
  { id: 'm2', name: 'Sam', color: '#FF8FA3', avatar: '🐰', birthday: null, sort: 1, pointsToday: 5, pointsWeek: 25, balance: 30 },
  { id: 'm3', name: 'Maya', color: '#7ED9A6', avatar: '🦄', birthday: '--11-02', sort: 2, pointsToday: 0, pointsWeek: 15, balance: 42 },
  // Leo turns 6 tomorrow, so the snapshot's 🎂 always has something to show.
  { id: 'm4', name: 'Leo', color: '#F5A65B', avatar: '🦖', birthday: (t => `${t.getFullYear() - 6}${dateKey(t).slice(4)}`)(new Date(Date.now() + 86_400_000)), sort: 3, pointsToday: 5, pointsWeek: 20, balance: 18 },
]

// Mirrors server/src/stickers.ts (the real list comes from GET /api/stickers/packs).
const STICKER_PACKS: Omit<StickerPack, 'price' | 'unlocked'>[] = [
  { id: 'animals', name: 'Animals', cover: '🐾', basePrice: 0, stickers: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔'] },
  { id: 'sweets', name: 'Sweets', cover: '🍩', basePrice: 15, stickers: ['🍩', '🍪', '🧁', '🍰', '🎂', '🍭', '🍬', '🍫', '🍦', '🍨', '🥞', '🍓', '🍒', '🍉'] },
  { id: 'sports', name: 'Sports', cover: '⚽', basePrice: 15, stickers: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏓', '🏸', '🥅', '🏆', '🥇', '🛹', '⛸️', '🚴'] },
  { id: 'dinosaurs', name: 'Dinosaurs', cover: '🦖', basePrice: 20, stickers: ['🦖', '🦕', '🐊', '🦎', '🐢', '🥚', '🌋', '🌿', '🦴', '🌴', '🪨', '☄️'] },
  { id: 'ocean', name: 'Ocean', cover: '🐙', basePrice: 20, stickers: ['🐙', '🦑', '🐠', '🐟', '🐡', '🦈', '🐬', '🐳', '🦀', '🦞', '🐚', '🪸', '🌊', '🏝️'] },
  { id: 'space', name: 'Space', cover: '🚀', basePrice: 25, stickers: ['🚀', '🌍', '🌙', '⭐', '🌟', '☀️', '🪐', '🌠', '🛸', '👽', '🛰️', '👩‍🚀', '🔭', '🌌'] },
  { id: 'robots', name: 'Robots', cover: '🤖', basePrice: 25, stickers: ['🤖', '👾', '🦾', '🦿', '⚙️', '🔧', '🔩', '🔋', '💡', '🕹️', '💾', '📡', '🧲', '🖥️'] },
  { id: 'unicorns', name: 'Unicorns & Rainbows', cover: '🦄', basePrice: 30, stickers: ['🦄', '🌈', '✨', '💖', '🦋', '🌸', '🌺', '🧚', '👑', '💎', '🎀', '🍄', '🌷', '🪄'] },
]
const unlockedPacks = new Map<string, Set<string>>([['m3', new Set(['dinosaurs', 'space'])], ['m4', new Set(['ocean'])]])
const sticker = (memberId: string, s: string, x: number, y: number, scale: number, rotation: number, z: number): StickerPlacement =>
  ({ id: uid(), memberId, sticker: s, x, y, scale, rotation, z, placedAt: new Date().toISOString() })
const scrapbook: StickerPlacement[] = [
  sticker('m3', '🦖', 0.3, 0.55, 1.6, -8, 1), sticker('m3', '🌋', 0.72, 0.4, 1.3, 0, 2), sticker('m3', '🚀', 0.8, 0.18, 1, 30, 3),
  sticker('m3', '⭐', 0.15, 0.15, 0.7, 0, 4), sticker('m3', '🐱', 0.55, 0.8, 1, 12, 5),
  sticker('m4', '🐙', 0.4, 0.5, 1.8, 0, 1), sticker('m4', '🐠', 0.7, 0.3, 1, -15, 2), sticker('m4', '🐶', 0.2, 0.8, 1, 0, 3),
]
const packFor = (memberId: string) => (p: (typeof STICKER_PACKS)[number]): StickerPack =>
  ({ ...p, price: Math.round(p.basePrice * settings.stickerPriceScale / 100), unlocked: p.basePrice === 0 || !!unlockedPacks.get(memberId)?.has(p.id) })

const accounts: Account[] = [{ id: 'demo-google', kind: 'google', name: 'Demo Google', createdAt: new Date().toISOString() }]

const calendars: CalendarEntry[] = [
  { id: 'c1', kind: 'local', accountId: null, remoteId: null, name: 'Family', color: '#B39DFF', memberId: null, memberIds: [], categoryId: null, writable: true, enabled: true, lastSyncedAt: null, lastError: null },
  { id: 'c2', kind: 'ics', accountId: null, remoteId: null, name: 'School (ICS)', color: '#FFD166', memberId: null, memberIds: [], categoryId: null, writable: false, enabled: true, lastSyncedAt: new Date().toISOString(), lastError: null },
  { id: 'c3', kind: 'google', accountId: 'demo-google', remoteId: 'remote-1', name: 'Work', color: '#7AB8FF', memberId: null, memberIds: [], categoryId: null, writable: true, enabled: true, lastSyncedAt: new Date().toISOString(), lastError: null },
]

const categories: Category[] = [
  { id: 'cat1', name: 'Birthdays', emoji: '🎂', color: '#FF9E7A', keywords: ['birthday', 'bday', 'b-day'], sort: 0, createdAt: new Date().toISOString() },
  { id: 'cat2', name: 'Sports', emoji: '⚽', color: '#7ED9A6', keywords: ['practice', 'game', 'soccer'], sort: 1, createdAt: new Date().toISOString() },
]

function at(daysFromToday: number, hh: number, mm = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + daysFromToday)
  d.setHours(hh, mm, 0, 0)
  return d.toISOString()
}
/** Now + `min` minutes, rounded to 5 so the demo reads like real times. */
function fromNow(min: number) {
  const t = Date.now() + min * 60000
  return new Date(Math.round(t / 300000) * 300000).toISOString()
}
function dateOnly(daysFromToday: number) {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return d.toISOString().slice(0, 10)
}

// seriesId/memberScope: mock data has no synced recurring events, so every fixture is 'none'/null
// (matches how a local event or a non-recurring synced event reports these fields for real).
// e1/e7 demo a keyword auto-match (Sports/Birthdays); the rest have no category.
const events: EventInstance[] = [
  { id: 'e1', calendarId: 'c1', title: 'Soccer Practice', start: at(0, 16), end: at(0, 17, 30), allDay: false, location: 'Park field', description: null, memberIds: ['m2'], color: '#FF8FA3', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: 'cat2', categorySource: 'keyword', reminders: null, travelMinutes: 20, leaveAt: null, remindBeforeLeave: true },
  { id: 'e2', calendarId: 'c1', title: 'Team Meeting', start: at(0, 16, 30), end: at(0, 17), allDay: false, location: null, description: null, memberIds: ['m1'], color: '#7AB8FF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e3', calendarId: 'c2', title: 'Teacher In-Service (No School)', start: dateOnly(1), end: dateOnly(2), allDay: true, location: null, description: null, memberIds: ['m3'], color: '#FFD166', rrule: null, occurrenceStart: null, readOnly: true, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e4', calendarId: 'c1', title: 'Family Dinner', start: at(2, 18), end: at(2, 19), allDay: false, location: 'Home', description: null, memberIds: [], color: '#B39DFF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e5', calendarId: 'c1', title: 'Piano Lesson', start: at(3, 15), end: at(3, 15, 45), allDay: false, location: null, description: null, memberIds: ['m3'], color: '#7ED9A6', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e6', calendarId: 'c1', title: 'Book Club', start: at(-1, 19), end: at(-1, 20), allDay: false, location: null, description: null, memberIds: ['m1'], color: '#7AB8FF', rrule: 'FREQ=WEEKLY', occurrenceStart: at(-1, 19), readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e7', calendarId: 'c1', title: "Sam's Birthday", start: dateOnly(4), end: dateOnly(5), allDay: true, location: null, description: null, memberIds: ['m2'], color: '#FF8FA3', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: 'cat1', categorySource: 'keyword', reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  // A fuller two weeks around today so the demo never opens on an empty calendar.
  { id: 'e8', calendarId: 'c1', title: 'Dentist - Alex', start: at(-3, 10), end: at(-3, 11), allDay: false, location: 'Main St Dental', description: null, memberIds: ['m1'], color: '#7AB8FF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e9', calendarId: 'c1', title: 'Swim Lessons', start: at(-2, 17), end: at(-2, 17, 45), allDay: false, location: 'Community pool', description: null, memberIds: ['m4'], color: '#F5A65B', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: 'cat2', categorySource: 'keyword', reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e10', calendarId: 'c1', title: 'Grocery Run', start: at(-1, 10), end: at(-1, 11), allDay: false, location: null, description: null, memberIds: ['m1', 'm2'], color: '#7AB8FF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e11', calendarId: 'c1', title: 'Movie Night', start: at(1, 19), end: at(1, 21), allDay: false, location: 'Home', description: null, memberIds: [], color: '#B39DFF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e12', calendarId: 'c1', title: 'Grandma Visits', start: dateOnly(2), end: dateOnly(4), allDay: true, location: null, description: null, memberIds: [], color: '#B39DFF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e13', calendarId: 'c2', title: 'Parent-Teacher Conference', start: at(5, 15, 30), end: at(5, 16), allDay: false, location: 'Room 12', description: null, memberIds: ['m1', 'm3'], color: '#FFD166', rrule: null, occurrenceStart: null, readOnly: true, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e14', calendarId: 'c1', title: 'Soccer Game vs. Eagles', start: at(6, 9), end: at(6, 10, 30), allDay: false, location: 'Riverside fields', description: null, memberIds: ['m2'], color: '#FF8FA3', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: 'cat2', categorySource: 'keyword', reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e15', calendarId: 'c1', title: 'Dinner with the Nguyens', start: at(7, 18), end: at(7, 20), allDay: false, location: null, description: null, memberIds: [], color: '#B39DFF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e16', calendarId: 'c1', title: 'Vet - Biscuit', start: at(8, 11), end: at(8, 11, 30), allDay: false, location: 'Oak Animal Clinic', description: null, memberIds: ['m3'], color: '#7ED9A6', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e17', calendarId: 'c1', title: 'Date Night', start: at(9, 19), end: at(9, 22), allDay: false, location: null, description: null, memberIds: ['m1'], color: '#7AB8FF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e18', calendarId: 'c2', title: 'School Picture Day', start: dateOnly(10), end: dateOnly(11), allDay: true, location: null, description: null, memberIds: ['m3', 'm4'], color: '#FFD166', rrule: null, occurrenceStart: null, readOnly: true, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e19', calendarId: 'c1', title: 'Library Storytime', start: at(-5, 10, 30), end: at(-5, 11), allDay: false, location: 'Public library', description: null, memberIds: ['m4'], color: '#F5A65B', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e20', calendarId: 'c1', title: 'Car Service', start: at(-4, 8), end: at(-4, 9), allDay: false, location: null, description: null, memberIds: ['m1'], color: '#7AB8FF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e23', calendarId: 'c1', title: "Leo's playdate with Theo", start: at(1, 14), end: at(1, 16), allDay: false, location: null, description: null, memberIds: ['m4'], color: '#F5A65B', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  // Relative to now, so the Now / Next card always has something to show in the demo.
  { id: 'e21', calendarId: 'c1', title: 'Reading Time', start: fromNow(-20), end: fromNow(25), allDay: false, location: null, description: null, memberIds: ['m3'], color: '#7ED9A6', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e22', calendarId: 'c1', title: 'Piano Lesson', start: fromNow(70), end: fromNow(115), allDay: false, location: 'Music school', description: null, memberIds: ['m2'], color: '#FF8FA3', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: 20, leaveAt: null, remindBeforeLeave: true },
]

// Mirrors the server: leaveAt = start - travelMinutes, only for timed events.
const withLeave = (e: EventInstance): EventInstance =>
  ({ ...e, leaveAt: e.travelMinutes && !e.allDay ? new Date(new Date(e.start).getTime() - e.travelMinutes * 60000).toISOString() : null })

const chores: Chore[] = [
  { id: 'ch1', title: 'Make bed', emoji: '🛏️', memberId: 'm2', points: 5, rrule: 'FREQ=DAILY', dueDate: null, dueTime: null, active: true, sort: 0 },
  { id: 'ch2', title: 'Feed the dog', emoji: '🐕', memberId: 'm3', points: 5, rrule: 'FREQ=DAILY', dueDate: null, dueTime: null, active: true, sort: 1 },
  { id: 'ch3', title: 'Take out trash', emoji: '🗑️', memberId: 'm1', points: 10, rrule: 'FREQ=WEEKLY;BYDAY=MO,TH', dueDate: null, dueTime: null, active: true, sort: 2 },
  { id: 'ch4', title: 'Water plants', emoji: '🪴', memberId: null, points: 5, rrule: null, dueDate: todayISO(), dueTime: null, active: true, sort: 3 },
  { id: 'ch5', title: 'Vacuum living room', emoji: '🧹', memberId: 'm2', points: 15, rrule: 'FREQ=WEEKLY', dueDate: null, dueTime: null, active: true, sort: 4 },
  { id: 'ch6', title: 'Tidy toys', emoji: '🧸', memberId: 'm4', points: 5, rrule: 'FREQ=DAILY', dueDate: null, dueTime: null, active: true, sort: 5 },
]
const completions = new Map<string, { completedAt: string; memberId: string | null }>() // key `${choreId}:${date}`

const lists: List[] = [
  { id: 'l1', name: 'Groceries', emoji: '🛒', color: '#7ED9A6', kind: 'shopping', memberIds: [], groupBy: 'category', sortBy: 'manual', sort: 0, archived: false, createdAt: new Date().toISOString(), itemCount: 5, openCount: 4 },
  { id: 'l2', name: 'Weekend To-Dos', emoji: '✅', color: '#7AB8FF', kind: 'todo', memberIds: ['m1'], groupBy: 'none', sortBy: 'due', sort: 1, archived: false, createdAt: new Date().toISOString(), itemCount: 5, openCount: 4 },
  { id: 'l3', name: 'Camping Packing List', emoji: '🎒', color: '#FFD166', kind: 'reusable', memberIds: [], groupBy: 'none', sortBy: 'manual', sort: 2, archived: false, createdAt: new Date().toISOString(), itemCount: 4, openCount: 4 },
  { id: 'l4', name: 'Living room reset', emoji: '🛋️', color: '#C9A7FF', kind: 'reusable', memberIds: [], groupBy: 'none', sortBy: 'manual', sort: 3, archived: false, createdAt: new Date().toISOString(), itemCount: 3, openCount: 3 },
]
type SeedItem = Omit<ListItem, 'priority' | 'steps' | 'stepsDone' | 'stepsTotal'> & { priority?: ListItem['priority']; steps?: string[] | ListItemStep[] }
const seedItem = (i: SeedItem): ListItem => withStepCounts({
  ...i, priority: i.priority ?? 'normal',
  steps: (i.steps ?? []).map((st, sort) => typeof st === 'string' ? { id: uid(), title: st, done: false, sort } : st),
  stepsDone: 0, stepsTotal: 0,
})
function withStepCounts(i: ListItem) { i.stepsDone = i.steps.filter(st => st.done).length; i.stepsTotal = i.steps.length; return i }
const iso = () => new Date().toISOString()
const inDays = (n: number) => dateKey(new Date(Date.now() + n * 86_400_000))
let listItems: ListItem[] = ([
  { id: 'li1', listId: 'l1', title: 'Milk', notes: null, quantity: '1', store: null, category: 'Dairy', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 0, createdAt: new Date().toISOString(), priority: 'urgent', updatedAt: new Date().toISOString() },
  { id: 'li2', listId: 'l1', title: 'Eggs', notes: null, quantity: '1 dozen', store: null, category: 'Dairy', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li3', listId: 'l1', title: 'Bread', notes: null, quantity: null, store: null, category: 'Bakery', memberId: null, dueDate: null, eventId: null, done: true, doneAt: new Date().toISOString(), doneBy: 'm1', sort: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li4', listId: 'l1', title: 'Apples', notes: null, quantity: '6', store: null, category: 'Produce', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 3, createdAt: new Date().toISOString(), priority: 'low', updatedAt: new Date().toISOString() },
  { id: 'li5', listId: 'l1', title: 'Paper towels', notes: null, quantity: null, store: null, category: 'Household', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 4, createdAt: new Date().toISOString(), priority: 'high', updatedAt: new Date().toISOString() },
  { id: 'li6', listId: 'l2', title: 'Mow the lawn', notes: null, quantity: null, store: null, category: null, memberId: 'm1', dueDate: todayISO(), eventId: null, done: false, doneAt: null, doneBy: null, sort: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li7', listId: 'l2', title: 'Return library books', notes: null, quantity: null, store: null, category: null, memberId: 'm2', dueDate: inDays(-3), eventId: null, done: false, doneAt: null, doneBy: null, sort: 1, createdAt: new Date().toISOString(), priority: 'high', updatedAt: new Date().toISOString() },
  { id: 'li8', listId: 'l2', title: 'Book dentist appointment', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, eventId: null, done: true, doneAt: new Date().toISOString(), doneBy: 'm1', sort: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li13', listId: 'l2', title: 'Pack shin guards + water bottle', notes: null, quantity: null, store: null, category: null, memberId: 'm2', dueDate: null, eventId: 'e1', done: false, doneAt: null, doneBy: null, sort: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li14', listId: 'l2', title: 'Clean out backpack', notes: null, quantity: null, store: null, category: null, memberId: 'm4', dueDate: inDays(4), eventId: null, done: false, doneAt: null, doneBy: null, sort: 4, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li9', listId: 'l3', title: 'Tent', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li10', listId: 'l3', title: 'Sleeping bags', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li11', listId: 'l3', title: 'Flashlight', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li12', listId: 'l3', title: 'Bug spray', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li15', listId: 'l4', title: 'Tidy the couch and put every blanket back in the basket by the window', notes: 'The grey throw goes in the hall closet, not the basket.', quantity: null, store: null, category: null, memberId: 'm3', dueDate: todayISO(), eventId: null, done: false, doneAt: null, doneBy: null, sort: 0, createdAt: iso(), updatedAt: iso(), priority: 'urgent',
    steps: [{ id: uid(), title: 'Fold the blankets', done: true, sort: 0 }, { id: uid(), title: 'Fluff the cushions', done: false, sort: 1 }, { id: uid(), title: 'Find the remote', done: false, sort: 2 }] },
  { id: 'li16', listId: 'l4', title: 'Toys back in their bins', notes: null, quantity: null, store: null, category: null, memberId: 'm4', dueDate: inDays(2), eventId: null, done: false, doneAt: null, doneBy: null, sort: 1, createdAt: iso(), updatedAt: iso(),
    steps: ['Blocks in the red bin', 'Cars in the blue bin', 'Books on the shelf', 'Stuffies on the bed', 'Check under the couch'] },
  { id: 'li17', listId: 'l4', title: 'Clear the coffee table', notes: null, quantity: null, store: null, category: null, memberId: 'm2', dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 2, createdAt: iso(), priority: 'low', updatedAt: iso() },
] as SeedItem[]).map(seedItem)
let listGroups: ListGroup[] = []
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
let notes: Note[] = [
  { id: 'n1', targetType: 'event', targetId: 'e1', memberId: 'm1', body: 'Coach says bring a light and a dark shirt.', createdAt: minsAgo(300), updatedAt: minsAgo(300) },
  { id: 'n2', targetType: 'event', targetId: 'e1', memberId: 'm2', body: 'I can drive this week!\nPickup is by the north gate.', createdAt: minsAgo(95), updatedAt: minsAgo(40) },
  { id: 'n3', targetType: 'event', targetId: 'e1', memberId: 'm3', body: 'Snack sign-up: https://example.com/snacks', createdAt: minsAgo(12), updatedAt: minsAgo(12) },
  { id: 'n4', targetType: 'list_item', targetId: 'li15', memberId: 'm3', body: 'Remote was under the cushion again 🙃', createdAt: minsAgo(60), updatedAt: minsAgo(60) },
  { id: 'n5', targetType: 'list_item', targetId: 'li15', memberId: null, body: 'Thanks Maya!', createdAt: minsAgo(20), updatedAt: minsAgo(20) },
]
const noteCount = (type: Note['targetType'], id: string) => notes.filter(n => n.targetType === type && n.targetId === id).length
let webhooks: Webhook[] = []


/** Mirrors the server: an item with steps is done exactly when every step is. */
function syncFromSteps(i: ListItem) {
  withStepCounts(i)
  if (i.stepsTotal === 0) return
  const allDone = i.stepsDone === i.stepsTotal
  if (allDone !== i.done) { i.done = allDone; i.doneAt = allDone ? iso() : null; i.doneBy = null }
  i.updatedAt = iso()
  recomputeListCounts(i.listId)
}
const findItem = (listId: string, itemId: string) => { const i = listItems.find(x => x.id === itemId && x.listId === listId); if (!i) throw new Error('not found'); return i }

function recomputeListCounts(id: string) {
  const l = lists.find(x => x.id === id); if (!l) return
  const items = listItems.filter(i => i.listId === id)
  l.itemCount = items.length
  l.openCount = items.filter(i => !i.done).length
}

// Notification feed: a few days of what the server would have recorded (newest first).
const notifications: AppNotification[] = [
  { id: 'n1', at: fromNow(-10), kind: 'reminder', title: '⚽ Soccer Practice', body: 'Leave by 3:40 PM for Soccer Practice · starts 4:00 PM\n📍 Park field\n👥 Sam', url: `/#/calendar?event=e1&at=${encodeURIComponent(at(0, 16))}`, memberIds: ['m2'], source: 'system' },
  { id: 'n2', at: fromNow(-95), kind: 'message', title: 'Dinner at 6', body: 'Tacos tonight 🌮 - wash up by 5:50', url: null, memberIds: [], source: 'api' },
  { id: 'n3', at: fromNow(-180), kind: 'list', title: 'List updated', body: 'Groceries has new items', url: '/lists', memberIds: [], source: 'system' },
  { id: 'n4', at: at(0, 8), kind: 'chore', title: '3 chores left today', body: 'Make bed, Feed Biscuit, Unload dishwasher', url: '/chores', memberIds: ['m3', 'm4'], source: 'system' },
  { id: 'n5', at: at(0, 7, 30), kind: 'summary', title: 'Today', body: '3 events · 4 chores — Soccer Practice, Team Meeting…', url: '/', memberIds: [], source: 'system' },
  { id: 'n6', at: at(-1, 18, 30), kind: 'reminder', title: 'Book Club', body: 'In 30 minutes · 7:00 PM\n👥 Alex', url: `/#/calendar?event=e6&at=${encodeURIComponent(at(-1, 19))}`, memberIds: ['m1'], source: 'system' },
  { id: 'n7', at: at(-1, 12, 15), kind: 'message', title: 'Pick-up change', body: 'Grandma is getting the kids from school today', url: null, memberIds: ['m3', 'm4'], source: 'mcp' },
  { id: 'n8', at: at(-2, 7, 30), kind: 'summary', title: 'Today', body: '2 events · 3 chores — Swim Lessons', url: '/', memberIds: [], source: 'system' },
  { id: 'n9', at: at(-2, 16, 30), kind: 'reminder', title: '⚽ Swim Lessons', body: 'In 30 minutes · 5:00 PM\n📍 Community pool\n👥 Leo', url: `/#/calendar?event=e9&at=${encodeURIComponent(at(-2, 17))}`, memberIds: ['m4'], source: 'system' },
].sort((a, b) => b.at.localeCompare(a.at)) as AppNotification[]

export const mock = {
  getRev: async () => ({ rev }),
  getNotifications: async () => [...notifications],
  deleteNotification: async (id: string) => { const i = notifications.findIndex(n => n.id === id); if (i >= 0) notifications.splice(i, 1); bump(); return { ok: true } },
  clearNotifications: async () => { const deleted = notifications.length; notifications.length = 0; bump(); return { ok: true as const, deleted } },
  sendNotification: async (b: { title: string; body: string; memberIds?: string[]; url?: string }) => {
    notifications.unshift({ id: uid(), at: new Date().toISOString(), kind: 'message', title: b.title, body: b.body, url: b.url ?? null, memberIds: b.memberIds ?? [], source: 'api' })
    bump()
    return { ok: true, sent: 0 }
  },

  getSettings: async (): Promise<Settings> => ({ ...settings }),
  updateSettings: async (patch: Partial<Settings>) => { Object.assign(settings, patch); bump(); return { ...settings } },

  getMembers: async () => [...members].sort((a, b) => a.sort - b.sort),
  createMember: async (m: Partial<Member>) => {
    const nm: Member = { id: uid(), name: m.name ?? 'New', color: m.color ?? '#FF9E7A', avatar: m.avatar ?? '🙂', birthday: m.birthday ?? null, sort: members.length, pointsToday: 0, pointsWeek: 0, balance: 0 }
    members.push(nm); bump(); return nm
  },
  updateMember: async (id: string, patch: Partial<Member>) => {
    const m = members.find(x => x.id === id); if (!m) throw new Error('not found')
    Object.assign(m, patch); bump(); return m
  },
  deleteMember: async (id: string) => { const i = members.findIndex(x => x.id === id); if (i >= 0) members.splice(i, 1); bump() },

  getSnapshot: async (memberId: string, range: 'day' | 'week'): Promise<Snapshot> => mockSnapshot(memberId, range),
  geocode: async (q: string): Promise<GeocodeResult[]> => DEMO_PLACES.filter(p => p.label.toLowerCase().includes(q.trim().toLowerCase())),

  getCalendars: async () => [...calendars],
  createCalendar: async (c: Partial<CalendarEntry>) => {
    const memberIds = c.memberIds ?? (c.memberId ? [c.memberId] : [])
    const nc: CalendarEntry = {
      id: uid(), kind: c.kind ?? 'local', accountId: c.accountId ?? null, remoteId: c.remoteId ?? null,
      name: c.name ?? 'New Calendar', color: c.color ?? '#7AB8FF', memberId: memberIds[0] ?? null, memberIds, categoryId: c.categoryId ?? null,
      writable: c.writable ?? (c.kind === 'local' || c.kind === undefined), enabled: true, lastSyncedAt: null, lastError: null,
    }
    calendars.push(nc); bump(); return nc
  },
  updateCalendar: async (id: string, patch: Partial<CalendarEntry>) => {
    const c = calendars.find(x => x.id === id); if (!c) throw new Error('not found')
    Object.assign(c, patch); bump(); return c
  },
  deleteCalendar: async (id: string) => { const i = calendars.findIndex(x => x.id === id); if (i >= 0) calendars.splice(i, 1); bump() },
  syncCalendar: async (id: string) => { const c = calendars.find(x => x.id === id); if (c) c.lastSyncedAt = new Date().toISOString(); return { ok: true, count: events.filter(e => e.calendarId === id).length } },

  getProviders: async (): Promise<Providers> => ({
    publicUrl: { value: location.origin, source: null },
    redirectUris: { google: `${location.origin}/api/oauth/google/callback`, microsoft: `${location.origin}/api/oauth/microsoft/callback` },
    google: { configured: false, source: null, secretSet: false },
    microsoft: { configured: false, source: null, secretSet: false },
  }),
  saveProvider: async (_kind: 'google' | 'microsoft', _body: { clientId: string; clientSecret?: string; tenant?: string }): Promise<Providers['google']> => ({ configured: true, source: 'ui', clientId: _body.clientId, tenant: _body.tenant, secretSet: true }),
  deleteProvider: async (_kind: 'google' | 'microsoft') => { bump() },
  savePublicUrl: async (value: string): Promise<{ value: string; warning?: string }> => ({ value }),

  // Open the account calendar picker with #/settings?account=demo-google (or + CalDAV in Settings).
  getAccounts: async (): Promise<Account[]> => [...accounts],
  deleteAccount: async (_id: string) => { bump() },
  createCaldavAccount: async (_body: { name: string; serverUrl: string; username: string; password: string }): Promise<Account> => {
    const a: Account = { id: uid(), kind: 'caldav', name: _body.name, createdAt: new Date().toISOString() }
    accounts.push(a); return a
  },
  getRemoteCalendars: async (_accountId: string): Promise<RemoteCalendar[]> => ([
    { remoteId: 'remote-1', name: 'Work', color: '#7AB8FF', writable: true },
    { remoteId: 'remote-2', name: 'Holidays', color: '#FFD166', writable: false },
    { remoteId: 'remote-3', name: 'Kids activities', color: '#7BD389', writable: true },
    { remoteId: 'remote-4', name: 'Birthdays', color: '#FF8FA3', writable: false },
  ]),

  getEvents: async (from: string, to: string) => events.filter(e => e.start < to && e.end > from)
    .map(e => ({ ...withLeave(e), linkedItemCount: listItems.filter(i => i.eventId === e.id && !i.done).length, noteCount: noteCount('event', e.id) })),
  getEventItems: async (eventId: string) => listItems.filter(i => i.eventId === eventId)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.sort - b.sort)
    .map(i => ({ ...i, listName: lists.find(l => l.id === i.listId)?.name ?? '' })),
  getEvent: async (id: string) => { const e = events.find(x => x.id === id); if (!e) throw new Error('not found'); return e },
  createEvent: async (body: Partial<EventInstance>) => {
    const cal = calendars.find(c => c.id === body.calendarId)
    const ev: EventInstance = {
      id: uid(), calendarId: body.calendarId!, title: body.title ?? 'Untitled',
      start: body.start!, end: body.end!, allDay: !!body.allDay,
      location: body.location ?? null, description: body.description ?? null,
      memberIds: body.memberIds ?? [], color: (body.memberIds?.length && members.find(m => m.id === body.memberIds![0])?.color) || cal?.color || '#888',
      rrule: body.rrule ?? null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none',
      categoryId: body.categoryId ?? null, categorySource: body.categoryId ? 'event' : null,
      reminders: body.reminders ?? null,
      travelMinutes: body.travelMinutes ?? null, leaveAt: null, remindBeforeLeave: !!body.remindBeforeLeave,
    }
    events.push(ev); bump(); return withLeave(ev)
  },
  updateEvent: async (id: string, patch: Partial<EventInstance>) => {
    const e = events.find(x => x.id === id); if (!e) throw new Error('not found')
    Object.assign(e, patch); bump(); return withLeave(e)
  },
  deleteEvent: async (id: string) => { const i = events.findIndex(x => x.id === id); if (i >= 0) events.splice(i, 1); bump() },

  getChoresDay: async (date: string): Promise<ChoreDay[]> => chores.filter(c => c.active).map(c => {
    const comp = completions.get(`${c.id}:${date}`)
    return { ...c, completed: !!comp, completedAt: comp?.completedAt ?? null, completedBy: comp?.memberId ?? null }
  }),
  createChore: async (body: Partial<Chore>) => {
    const nc: Chore = { id: uid(), title: body.title ?? 'New chore', emoji: body.emoji ?? '⭐', memberId: body.memberId ?? null, points: body.points ?? 5, rrule: body.rrule ?? null, dueDate: body.dueDate ?? null, dueTime: body.dueTime ?? null, active: true, sort: chores.length }
    chores.push(nc); bump(); return nc
  },
  updateChore: async (id: string, patch: Partial<Chore>) => {
    const c = chores.find(x => x.id === id); if (!c) throw new Error('not found')
    Object.assign(c, patch); bump(); return c
  },
  deleteChore: async (id: string) => { const i = chores.findIndex(x => x.id === id); if (i >= 0) chores.splice(i, 1); bump() },
  completeChore: async (id: string, date: string, memberId?: string) => { completions.set(`${id}:${date}`, { completedAt: new Date().toISOString(), memberId: memberId ?? null }); bump() },
  uncompleteChore: async (id: string, date: string) => { completions.delete(`${id}:${date}`); bump() },

  // Dev fixture only - period filtering is approximate (day-count windows, no real tz/weekStart
  // math) and streak is derived from how many of the last few days have any completion for that
  // member, just enough to make the widget look alive in `npm run dev -- --mode mock`.
  getLeaderboard: async (period: LeaderboardPeriod): Promise<LeaderboardEntry[]> => {
    const days = period === 'today' ? 1 : period === 'week' ? 7 : 30
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days + 1); cutoff.setHours(0, 0, 0, 0)
    const entries = members.map(m => {
      let points = 0, completed = 0, streak = 0
      for (const [k, v] of completions) {
        const [choreId, date] = k.split(':')
        if (v.memberId !== m.id) continue
        if (new Date(date) < cutoff) continue
        const chore = chores.find(c => c.id === choreId)
        if (!chore) continue
        points += chore.points; completed++
      }
      for (let i = 0; i < 30; i++) {
        const d = new Date(); d.setDate(d.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        const any = [...completions.entries()].some(([k, v]) => k.endsWith(`:${key}`) && v.memberId === m.id)
        if (any) streak++
        else if (i > 0) break
      }
      return { memberId: m.id, name: m.name, color: m.color, avatar: m.avatar, points, completed, streak }
    })
    entries.sort((a, b) => b.points - a.points || b.completed - a.completed || a.name.localeCompare(b.name))
    let rank = 1
    return entries.map((e, i) => {
      if (i > 0 && !(e.points === entries[i - 1].points && e.completed === entries[i - 1].completed)) rank = i + 1
      return { ...e, rank }
    })
  },

  getStickerPacks: async (memberId: string) => STICKER_PACKS.map(packFor(memberId)),
  buyStickerPack: async (packId: string, memberId: string) => {
    const m = members.find(x => x.id === memberId)
    const base = STICKER_PACKS.find(p => p.id === packId)
    if (!m || !base) throw new Error('not found')
    const pack = packFor(memberId)(base)
    if (pack.unlocked) throw new Error('Already unlocked')
    if (m.balance < pack.price) throw new Error('Not enough points')
    m.balance -= pack.price
    unlockedPacks.set(memberId, new Set([...unlockedPacks.get(memberId) ?? [], packId]))
    bump()
    return { pack: { ...pack, unlocked: true }, balance: m.balance }
  },
  getScrapbook: async (memberId: string) => scrapbook.filter(s => s.memberId === memberId).sort((a, b) => a.z - b.z).map(s => ({ ...s })),
  placeSticker: async (memberId: string, body: StickerPatch & { sticker: string }) => {
    const top = Math.max(0, ...scrapbook.filter(s => s.memberId === memberId).map(s => s.z))
    const s = { ...sticker(memberId, body.sticker, 0.5, 0.5, 1, 0, top + 1), ...body }
    scrapbook.push(s); bump(); return { ...s }
  },
  updateSticker: async (_memberId: string, id: string, body: StickerPatch) => {
    const s = scrapbook.find(x => x.id === id); if (!s) throw new Error('not found')
    Object.assign(s, body); bump(); return { ...s }
  },
  removeSticker: async (_memberId: string, id: string) => { const i = scrapbook.findIndex(x => x.id === id); if (i >= 0) scrapbook.splice(i, 1); bump() },

  getCategories: async () => [...categories].sort((a, b) => a.sort - b.sort),
  createCategory: async (body: Partial<Category>): Promise<Category> => {
    const nc: Category = { id: uid(), name: body.name ?? 'New category', emoji: body.emoji ?? null, color: body.color ?? '#FF9E7A', keywords: body.keywords ?? [], sort: categories.length, createdAt: new Date().toISOString() }
    categories.push(nc); bump(); return nc
  },
  updateCategory: async (id: string, patch: Partial<Category>) => {
    const c = categories.find(x => x.id === id); if (!c) throw new Error('not found')
    Object.assign(c, patch); bump(); return c
  },
  deleteCategory: async (id: string) => {
    const i = categories.findIndex(x => x.id === id); if (i >= 0) categories.splice(i, 1)
    events.forEach(e => { if (e.categoryId === id) { e.categoryId = null; e.categorySource = null } })
    calendars.forEach(c => { if (c.categoryId === id) c.categoryId = null })
    bump()
  },
  reorderCategories: async (ids: string[]) => {
    ids.forEach((id, idx) => { const c = categories.find(x => x.id === id); if (c) c.sort = idx })
    bump(); return { ok: true }
  },

  getKeys: async (): Promise<ApiKey[]> => [{ id: 'k1', name: 'iPad Wall Display', prefix: 'kw_ab12', scope: 'display', createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() }],
  createKey: async (name: string) => ({ id: uid(), name, key: 'kw_' + uid().replace(/-/g, '').slice(0, 24) }),
  deleteKey: async (_id: string) => {},

  getLists: async (archived?: boolean) => lists.filter(l => archived ? true : !l.archived).sort((a, b) => a.sort - b.sort),
  createList: async (body: Partial<List>): Promise<List> => {
    const nl: List = {
      id: uid(), name: body.name ?? 'New list', emoji: body.emoji ?? '📝', color: body.color ?? '#FF9E7A',
      kind: body.kind ?? 'todo', memberIds: body.memberIds ?? [], groupBy: body.groupBy ?? (body.kind === 'shopping' ? 'category' : 'none'), sortBy: body.sortBy ?? 'manual',
      sort: lists.length, archived: false, createdAt: new Date().toISOString(), itemCount: 0, openCount: 0,
    }
    lists.push(nl); bump(); return nl
  },
  getList: async (id: string) => {
    const l = lists.find(x => x.id === id); if (!l) throw new Error('not found')
    const items = listItems.filter(i => i.listId === id).sort(compareItems(l.sortBy, dateKey(new Date()))).map(i => ({ ...i, noteCount: noteCount('list_item', i.id) }))
    const groups = listGroups.filter(g => g.name) // per-list groups aren't keyed by list in this fixture; kept simple for demo
    const stores = [...new Set(listItems.map(i => i.store).filter((v): v is string => !!v))].sort()
    const categories = [...new Set(listItems.map(i => i.category).filter((v): v is string => !!v))].sort()
    return { list: l, items, groups, suggestions: { stores, categories } }
  },
  updateList: async (id: string, patch: Partial<List>) => {
    const l = lists.find(x => x.id === id); if (!l) throw new Error('not found')
    Object.assign(l, patch); bump(); return l
  },
  deleteList: async (id: string) => {
    const i = lists.findIndex(x => x.id === id); if (i >= 0) lists.splice(i, 1)
    listItems = listItems.filter(x => x.listId !== id); bump()
  },
  addListItems: async (listId: string, body: ListItemInput | ListItemInput[]): Promise<ListItem[]> => {
    const inputs = Array.isArray(body) ? body : [body]
    const maxSort = Math.max(-1, ...listItems.filter(i => i.listId === listId).map(i => i.sort))
    const created = inputs.map((input, idx) => {
      // "remembers where things go": omitted store/category (undefined) inherit from the most
      // recently updated same-title item anywhere; explicit null means "none".
      const remembered = [...listItems].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .find(i => i.title.trim().toLowerCase() === input.title.trim().toLowerCase())
      const item: ListItem = {
        id: uid(), listId, title: input.title.trim(), notes: input.notes ?? null,
        quantity: input.quantity ?? null,
        store: input.store !== undefined ? input.store : (remembered?.store ?? null),
        category: input.category !== undefined ? input.category : (remembered?.category ?? null),
        memberId: input.memberId ?? null, dueDate: input.dueDate ?? null, eventId: input.eventId ?? null,
        priority: input.priority ?? 'normal',
        done: false, doneAt: null, doneBy: null, sort: maxSort + 1 + idx,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        steps: (input.steps ?? []).map((title, sort) => ({ id: uid(), title: title.trim(), done: false, sort })), stepsDone: 0, stepsTotal: 0,
      }
      return withStepCounts(item)
    })
    listItems.push(...created); recomputeListCounts(listId); bump(); return created
  },
  updateListItem: async (listId: string, itemId: string, patch: Partial<ListItem>) => {
    const i = listItems.find(x => x.id === itemId && x.listId === listId); if (!i) throw new Error('not found')
    if (patch.done !== undefined) {
      i.doneAt = patch.done ? new Date().toISOString() : null
      i.doneBy = patch.done ? (patch.doneBy ?? null) : null
    }
    Object.assign(i, patch, { updatedAt: new Date().toISOString() })
    if (patch.done !== undefined) { i.steps.forEach(st => { st.done = !!patch.done }); withStepCounts(i) }
    recomputeListCounts(listId); bump(); return i
  },
  getNotes: async (target: NoteTarget) => notes.filter(n => `${n.targetType}:${n.targetId}` === target),
  addNote: async (target: NoteTarget, body: string, memberId: string | null): Promise<Note> => {
    const [targetType, targetId] = target.split(/:(.*)/) as [Note['targetType'], string]
    const n: Note = { id: uid(), targetType, targetId, memberId, body: body.trim(), createdAt: iso(), updatedAt: iso() }
    notes.push(n); bump(); return n
  },
  updateNote: async (id: string, body: string) => {
    const n = notes.find(x => x.id === id); if (!n) throw new Error('not found')
    Object.assign(n, { body: body.trim(), updatedAt: iso() }); bump(); return n
  },
  deleteNote: async (id: string) => { notes = notes.filter(n => n.id !== id); bump() },
  deleteListItem: async (listId: string, itemId: string) => {
    const i = listItems.findIndex(x => x.id === itemId && x.listId === listId)
    if (i >= 0) listItems.splice(i, 1)
    recomputeListCounts(listId); bump()
  },
  clearListCompleted: async (listId: string) => {
    const before = listItems.length
    listItems = listItems.filter(i => !(i.listId === listId && i.done))
    recomputeListCounts(listId); bump()
    return { deleted: before - listItems.length }
  },
  resetList: async (listId: string) => {
    const items = listItems.filter(i => i.listId === listId && i.done)
    items.forEach(i => { i.done = false; i.doneAt = null; i.doneBy = null })
    listItems.filter(i => i.listId === listId).forEach(i => { i.steps.forEach(st => { st.done = false }); withStepCounts(i) })
    recomputeListCounts(listId); bump()
    return { reset: items.length }
  },
  reorderListItems: async (_listId: string, itemIds: string[]) => {
    itemIds.forEach((id, idx) => { const i = listItems.find(x => x.id === id); if (i) i.sort = idx })
    bump(); return { ok: true }
  },
  addListItemStep: async (listId: string, itemId: string, title: string) => {
    const i = findItem(listId, itemId)
    i.steps.push({ id: uid(), title: title.trim(), done: false, sort: Math.max(-1, ...i.steps.map(st => st.sort)) + 1 })
    syncFromSteps(i); bump(); return { ...i } // a copy, so React sees a new item
  },
  updateListItemStep: async (listId: string, itemId: string, stepId: string, patch: { title?: string; done?: boolean }) => {
    const i = findItem(listId, itemId)
    const st = i.steps.find(x => x.id === stepId); if (!st) throw new Error('not found')
    Object.assign(st, patch)
    syncFromSteps(i); bump(); return { ...i } // a copy, so React sees a new item
  },
  deleteListItemStep: async (listId: string, itemId: string, stepId: string) => {
    const i = findItem(listId, itemId)
    i.steps = i.steps.filter(st => st.id !== stepId)
    syncFromSteps(i); bump(); return { ...i } // a copy, so React sees a new item
  },
  reorderListItemSteps: async (listId: string, itemId: string, stepIds: string[]) => {
    const i = findItem(listId, itemId)
    stepIds.forEach((id, sort) => { const st = i.steps.find(x => x.id === id); if (st) st.sort = sort })
    i.steps.sort((a, b) => a.sort - b.sort); bump(); return { ...i }
  },
  setListGroups: async (_listId: string, groups: { kind: 'store' | 'category'; name: string }[]) => {
    listGroups = groups.map((g, idx) => ({ ...g, sort: idx }))
    bump(); return listGroups
  },

  getWebhooks: async (): Promise<Webhook[]> => webhooks.map(h => ({ ...h })),
  createWebhook: async (url: string, evs: string[]) => { const h = { id: uid(), url, events: evs, enabled: true, createdAt: new Date().toISOString() }; webhooks.push(h); return { ...h, secret: crypto.randomUUID() } },
  rotateWebhookSecret: async (id: string) => ({ ...webhooks.find(h => h.id === id)!, secret: crypto.randomUUID() }),
  updateWebhook: async (id: string, patch: Partial<Webhook>) => ({ id, url: patch.url ?? '', events: patch.events ?? [], enabled: patch.enabled ?? true, createdAt: new Date().toISOString() }),
  deleteWebhook: async (id: string) => { webhooks = webhooks.filter(h => h.id !== id) },
}

const DEMO_PLACES: GeocodeResult[] = [
  { name: 'Portland', label: 'Portland, Oregon, United States', lat: 45.5152, lon: -122.6784, countryCode: 'US' },
  { name: 'Portland', label: 'Portland, Maine, United States', lat: 43.6591, lon: -70.2568, countryCode: 'US' },
  { name: 'Springfield', label: 'Springfield, Illinois, United States', lat: 39.8017, lon: -89.6437, countryCode: 'US' },
  { name: 'London', label: 'London, England, United Kingdom', lat: 51.5085, lon: -0.1257, countryCode: 'GB' },
  { name: 'Toronto', label: 'Toronto, Ontario, Canada', lat: 43.7001, lon: -79.4163, countryCode: 'CA' },
]

// Mirrors GET /api/snapshot over the fixtures above (browser-local days); the forecast is fixed.
function mockSnapshot(memberId: string, range: 'day' | 'week'): Snapshot {
  const m = members.find(x => x.id === memberId)
  if (!m) throw new Error('not found')
  const today = inDays(0), tomorrow = inDays(1)
  const dates = Array.from({ length: range === 'week' ? 7 : 2 }, (_, i) => inDays(i))
  const last = dates[dates.length - 1], to = range === 'week' ? last : today
  const dayOf = (e: EventInstance) => { const d = e.allDay ? e.start.slice(0, 10) : dateKey(new Date(e.start)); return d < today ? today : d }
  const isBday = (e: EventInstance) => e.categoryId === 'cat1'
  const all = events.map(e => ({ ...withLeave(e), date: dayOf(e) }))
    .filter(e => e.date <= last && (e.allDay ? e.end.slice(0, 10) > today : dateKey(new Date(e.end)) >= today))
    .sort((a, b) => a.start.localeCompare(b.start))
  const mine = all.filter(e => !isBday(e) && (e.memberIds.length === 0 || e.memberIds.includes(memberId)))
  const birthdays: SnapshotBirthday[] = []
  for (const x of members) {
    const md = x.birthday?.slice(-5)
    const date = md && dates.find(d => d.slice(5) === md)
    if (date) birthdays.push({ memberId: x.id, eventId: null, name: x.name, avatar: x.avatar, date, age: x.birthday!.startsWith('--') ? null : Number(date.slice(0, 4)) - Number(x.birthday!.slice(0, 4)) })
  }
  for (const e of all.filter(isBday)) birthdays.push({ memberId: null, eventId: e.id, name: e.title, avatar: null, date: e.date, age: null })
  birthdays.sort((a, b) => a.date.localeCompare(b.date))
  const dueOn = (c: Chore, d: string) => {
    if (!c.rrule) return c.dueDate === d
    const day = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(`${d}T12:00`).getDay()]
    const byDay = /BYDAY=([A-Z,]+)/.exec(c.rrule)?.[1]
    return c.rrule.includes('DAILY') || (byDay ? byDay.split(',').includes(day) : d === today)
  }
  const choreRows = (range === 'week' ? dates : [today]).flatMap(date => chores.filter(c => c.active && (c.memberId === memberId || !c.memberId) && dueOn(c, date))
    .map(c => ({ id: c.id, title: c.title, emoji: c.emoji, points: c.points, dueTime: c.dueTime, date, done: completions.has(`${c.id}:${date}`), shared: !c.memberId })))
  const rank = { urgent: 0, high: 1, normal: 2, low: 3 }
  const open = listItems.filter(i => i.memberId === memberId && !i.done && !lists.find(l => l.id === i.listId)?.archived)
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || rank[a.priority] - rank[b.priority])
    .map(i => { const l = lists.find(x => x.id === i.listId)!; return { ...i, listName: l.name, listEmoji: l.emoji ?? null, overdue: !!i.dueDate && i.dueDate < today } })
  const items = open.filter(i => (i.dueDate && i.dueDate <= to) || i.priority === 'high' || i.priority === 'urgent')
  const h = new Date().getHours()
  const f = settings.temperatureUnit === 'fahrenheit', t = (n: number) => f ? n : Math.round((n - 32) * 5 / 9)
  const forecast: [number, number, number, number][] = [[2, 68, 52, 10], [61, 61, 50, 80], [0, 72, 54, 0], [3, 66, 51, 5], [80, 63, 49, 60], [0, 70, 53, 0], [1, 71, 55, 5]]
  const WX: Record<number, [string, string]> = { 0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Cloudy'], 61: ['🌧️', 'Light rain'], 80: ['🌦️', 'Showers'] }
  return {
    greeting: birthdays.some(b => b.memberId === memberId && b.date === today) ? `Happy birthday, ${m.name}! 🎉`
      : `${h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening'}, ${m.name}`,
    member: { id: m.id, name: m.name, color: m.color, avatar: m.avatar, birthday: m.birthday },
    range, from: today, to, generatedAt: new Date().toISOString(),
    weather: settings.location && {
      location: settings.location.name, unit: settings.temperatureUnit,
      now: { temp: t(64), code: 2, emoji: '⛅', text: 'Partly cloudy', rainChance: 10 },
      days: dates.map((date, i) => { const [code, hi, lo, rain] = forecast[i]; return { date, code, emoji: WX[code][0], text: WX[code][1], high: t(hi), low: t(lo), rainChance: rain } }),
    },
    events: mine.filter(e => e.date <= to),
    chores: choreRows, items,
    birthdays: birthdays.filter(b => b.date <= to),
    tomorrow: range === 'day' ? { date: tomorrow, events: mine.filter(e => e.date === tomorrow), items: open.filter(i => i.dueDate === tomorrow), birthdays: birthdays.filter(b => b.date === tomorrow) } : null,
  }
}
