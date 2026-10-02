// Dev-only in-memory fixture, used when VITE_MOCK=1. Excluded from prod by the env check in api.ts.
import type { Actor, OnlineTidbits, Plugin, PluginCatalogEntry,
  Account, ApiKey, AppNotification, SecurityEvent, CalendarEntry, Category, Chore, ChoreDay, LibraryChore, LibraryChoreInput, EventInstance, HiddenEvent, LeaderboardEntry, LeaderboardPeriod, List, ListGroup,
  Newscast, NewscastItem, NewscastPostInput, NewscastReaction,
  Photo, PhotoQuota, FamilyColoringPage, GooglePhotos, TrackerEntry, TrackerInput, TrackerKind, GeocodeResult, BookResult, BarcodeLookup, ReadingDay, LibraryBook, LibraryBookInput, ReadingData, ListItem, ListItemInput, ListItemPatch, ListItemStep, ListCatalog, Member, RememberedItem, RememberedItemInput, Note, NoteTarget, Providers, RemoteCalendar, Settings, Snapshot, SnapshotBirthday, Board, StickerPack, StickerPatch, StickerPlacement, Webhook, Reward, Redemption, TempCheck, TempCheckInput, Journal, JournalEntry, Insights, InsightDay, InsightRange, Battery, Medication, MedicationInput, MedicationsDue, MedicationDose, MedicationHistory, DoseStatus, MedTime,
} from './types.ts'
import { eveningPending, FEELINGS, lastNightDate, TEMP_CHECK_OFF } from './tempCheck.ts'
import { aisleOrderMap, compareItems } from './types.ts'
import { itemKey } from './itemSuggest.ts'
import { tagsInput } from './catalog.ts'
import { byListOrder, reorderWithin } from './listSections.ts'
import { dateKey } from './date.ts'
import { DEMO_DRAWINGS, drawingPhoto } from './mock-drawings.ts'
import { SECURITY_PAGE, matchesSecurityQuery } from './securityActivity.ts'
import { FILTER_PRESETS, NO_FILTER, filterShows } from './calendarFilter.ts'
import { MAYA_ANALYSIS, MAYA_BATTERY, MAYA_DAYS } from './mock-insights.ts'
import type { Contact, ContactCategory, ContactInput, ImportPreviewEntry } from './contact-types.ts'
import { emptyContact } from './contact-types.ts'
import { duplicateScore, parseVCards } from './vcard.ts'

const uid = () => crypto.randomUUID()
const todayISO = () => new Date().toISOString().slice(0, 10)

let rev = 1
const checkIns = new Set<string>() // `${memberId}:${date}` - the demo's daily check-ins
const tempChecks = new Map<string, Omit<TempCheck, 'settings' | 'private' | 'custom' | 'answered' | 'followupOpen' | 'drainedOpen' | 'lastNight'>>() // `${memberId}:${date}`
const lastNightSkips = new Set<string>() // `${memberId}:${date}`: last night's check-in skipped
const customFeelings = new Map<string, string[]>([['m3', ['excited']]]) // Maya added "excited" with "Other"
// Maya's journal: a goal today (the evening check shows any time of day in the demo), two past days and one entry.
// Before noon it's all a day earlier: she hasn't checked in yet, and last night's check-in is waiting.
const demoShift = lastNightDate(new Date()) ? -1 : 0
const demoDay = (n: number) => dateKey(new Date(Date.now() + n * 86_400_000))
const noNotes = { helped: null, hindered: null, next: null }
for (const [n, sleep, feelings, goal, followup] of [
  [0, 'good', ['good', 'excited'], 'Finish my book report', null],
  [-1, 'great', ['great'], 'Practice piano for 15 minutes', { outcome: 'yes', ...noNotes, helped: 'I did it right after snack' }],
  [-2, 'ok', ['tired'], 'Tidy my room', { outcome: 'partly', helped: 'Music on', hindered: 'Too many Legos', next: 'Start with the Legos' }],
] as const) tempChecks.set(`m3:${demoDay(n + demoShift)}`, { memberId: 'm3', date: demoDay(n + demoShift), sleep, feelings: [...feelings], goal, goalSkipped: false, followup })
const journalEntries: JournalEntry[] = [
  { id: 'je1', memberId: 'm3', date: demoDay(-1 + demoShift), text: 'We saw a double rainbow on the way home from soccer!', mood: '🌈', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
]
// Maya's six weeks of check-ins before that (mock-insights.ts, made up), so her journal and Insights have history.
const DEMO_GOALS = ['Read for 20 minutes', 'Practice piano for 15 minutes', 'Tidy my room', 'Finish my homework before dinner', 'Help make dinner', 'Ride my bike to the park']
const DEMO_LINES = ['Played tag at recess', 'Soccer practice was fun', 'Made pancakes with Dad', 'Built a fort with Leo', 'Finished a chapter of my book']
for (const d of MAYA_DAYS) {
  if (d.ago < 3 - demoShift || !d.checkedIn) continue
  const date = demoDay(-d.ago)
  tempChecks.set(`m3:${date}`, { memberId: 'm3', date, sleep: d.sleep, feelings: d.feelings.length ? [...d.feelings] : null, goal: d.goalSet ? DEMO_GOALS[d.ago % DEMO_GOALS.length] : null, goalSkipped: false, followup: d.goalOutcome ? { outcome: d.goalOutcome, ...noNotes } : null })
  // A few written while her journal was private (a parent's device sees the mood only).
  d.journalMoods.forEach((mood, i) => journalEntries.push({ id: `je-${d.ago}-${i}`, memberId: 'm3', date, text: DEMO_LINES[d.ago % DEMO_LINES.length], mood, private: d.ago % 4 === 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
}
journalEntries.push({ id: 'je-alex', memberId: 'm1', date: demoDay(-1), text: 'Long week. Glad the weekend is here.', mood: '😌', private: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
// Private journals: grown-ups private by default; Maya is allowed one (and has it off now). The demo is a parent's device that
// belongs to no one until "This is my device".
const journalPrivate = new Map<string, boolean>()
const journalAllowed = new Set(['m3'])
let demoOwner: string | null = null
const privacyOf = (m: Member) => ({ on: m.grownUp ? journalPrivate.get(m.id) ?? true : journalAllowed.has(m.id) && !!journalPrivate.get(m.id), allowed: !!m.grownUp || journalAllowed.has(m.id) })
const INSIGHT_DAYS: Record<InsightRange, number> = { '4w': 28, '3m': 91, '1y': 364 }
const blankInsightDay = (date: string): InsightDay => ({ date, checkedIn: false, sleep: null, feelings: [], goalSet: false, goalOutcome: null, journalEntries: 0, journalMoods: [], chores: 0, points: 0, activityMinutes: 0, booksFinished: 0, events: 0, lastEventEnd: null })
// Medication reminders: Leo's allergy medicine, Sam's vitamin and Sam's "When I start my day" medicine
// (his day started at 9:40 AM), with a week of history; Sam's vitamin wasn't marked yesterday, for the
// catch-up buttons. The demo is a parent's device, and today's doses are due any time of day so the
// Take now card always shows.
const medications: Medication[] = [
  { id: 'med1', memberId: 'm4', name: 'Allergy medicine', dose: '1 tablet', times: ['08:00'], days: [0, 1, 2, 3, 4, 5, 6], endDate: null, totalDoses: null, lateWindow: 'evening', dosesLeft: null, createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), updatedAt: new Date().toISOString() },
  { id: 'med3', memberId: 'm2', name: 'Morning medicine', dose: '1 tablet', times: [{ wake: true, latest: '12:00' }], days: [0, 1, 2, 3, 4, 5, 6], endDate: null, totalDoses: null, lateWindow: '3h', dosesLeft: null, createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), updatedAt: new Date().toISOString() },
  { id: 'med2', memberId: 'm2', name: 'Daily vitamin', dose: '1 capsule', times: ['08:00'], days: [0, 1, 2, 3, 4, 5, 6], endDate: null, totalDoses: null, lateWindow: 'endOfDay', dosesLeft: null, createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), updatedAt: new Date().toISOString() },
]
type MockDose = { status?: 'taken' | 'skipped'; at?: string; by?: string; snoozedUntil?: string; startedAt?: string }
const timeKey = (t: MedTime) => (typeof t === 'string' ? t : 'wake')
const startedAt = (daysAgo: number) => { const d = new Date(Date.now() - daysAgo * 86_400_000); d.setHours(9, 40 - daysAgo * 7, 0, 0); return d.toISOString() }
const medLog = new Map<string, Record<string, MockDose>>() // `${medicationId}:${date}`
for (let n = 1; n <= 6; n++) {
  const at = new Date(Date.now() - n * 86_400_000).toISOString()
  if (n !== 4) medLog.set(`med1:${demoDay(-n)}`, { '08:00': { status: n === 2 ? 'skipped' : 'taken', at, by: 'Kitchen wall' } }) // 4 days ago: not marked
  if (n !== 1) medLog.set(`med2:${demoDay(-n)}`, { '08:00': { status: 'taken', at, by: "Sam's phone" } }) // yesterday: not marked
  medLog.set(`med3:${demoDay(-n)}`, { wake: { startedAt: startedAt(n), status: 'taken', at: startedAt(n), by: "Sam's phone" } })
}
medLog.set(`med3:${demoDay(0)}`, { wake: { startedAt: startedAt(0) } })
const doseStatus = (date: string, e: MockDose | undefined): DoseStatus => e?.status ?? (date < dateKey(new Date()) ? 'missed' : 'due')
const bump = () => { rev++ }

let quietPin: string | null = null
const settings: Settings = {
  familyName: 'Our Family',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  weekStart: 0,
  themeMode: 'auto',
  darkFrom: '20:00',
  darkTo: '07:00',
  quietFrom: null,
  quietTo: null,
  nightRest: true,
  nightHoldReminders: true,
  darkWithNight: false,
  quietPin: false,
  accent: '#FF9E7A',
  colorScheme: 'eucalyptus',
  customColors: null,
  customSchemes: [],
  backgroundLight: 'warm',
  backgroundDark: 'cocoa',
  textScale: 'm',
  density: 'comfortable',
  typeface: 'default',
  timeFormat: 'auto',
  defaultReminderMinutes: [30],
  mealTimes: { breakfast: '07:30', lunch: '12:00', dinner: '18:00', snack: '15:00' },
  lateCompletionCredit: 50,
  streakGraceDays: 1,
  checkInPoints: 3, // on in the demo so the daily check-in can be tried
  leaderboardEnabled: true,
  stickersEnabled: true,
  stickerPriceScale: 100,
  aiHealthAccess: false,
  medications: true, // on in the demo, with samples for Leo and Sam
  medicationNamesOnWalls: false,
  location: { name: 'Portland', lat: 45.5152, lon: -122.6784, countryCode: 'US' },
  temperatureUnit: 'fahrenheit',
  boardPresets: [],
  nightLook: { sources: [], every: 5, brightness: 'low', clock: true, clockPosition: null },
  tidbits: { sources: ['quotes', 'facts', 'onthisday', 'trivia'], factCategories: [], tipCategories: [], onThisDay: ['holidays', 'births'], birthsAfter: 1900, triviaCategories: [27, 17, 22, 9], triviaDifficulties: ['easy'] },
  features: { chores: true, lists: true, contacts: true, paint: true, photos: true, notes: true, messages: true, trackersReading: true, trackersMemories: true, trackersHealth: true, meals: true, newscast: true },
  newscastNotFeatured: [],
  newscastPostingPaused: [],
}

const members: Member[] = [
  { id: 'm1', name: 'Alex', color: '#7AB8FF', avatar: '🦊', birthday: '1988-03-14', grownUp: true, sort: 0, pointsToday: 10, pointsWeek: 40, balance: 12 },
  { id: 'm2', name: 'Sam', color: '#FF8FA3', avatar: '🐰', birthday: null, grownUp: true, sort: 1, pointsToday: 5, pointsWeek: 25, balance: 30 },
  { id: 'm3', name: 'Maya', color: '#7ED9A6', avatar: '🦄', birthday: '2018-11-02', grownUp: false, sort: 2, pointsToday: 0, pointsWeek: 15, balance: 42, tempCheck: { on: true, sleep: true, feelings: true, goal: true, showGoal: true, evening: true, eveningTime: '21:00', journal: true, battery: true } },
  // Leo turns 6 tomorrow, so the snapshot's 🎂 always has something to show.
  { id: 'm4', name: 'Leo', color: '#F5A65B', avatar: '🦖', birthday: (t => `${t.getFullYear() - 6}${dateKey(t).slice(4)}`)(new Date(Date.now() + 86_400_000)), grownUp: false, sort: 3, pointsToday: 5, pointsWeek: 20, balance: 18 },
]

const contactStamp = new Date().toISOString()
const demoContact = (record: { id: string; name: string } & Partial<ContactInput>): Contact => ({
  kind: 'person', organization: null, relationship: null, phones: [], emails: [], notes: null,
  favorite: false, emergency: false, wallVisible: false, addresses: [], websites: [], dates: [],
  givenName: null, familyName: null, nickname: null, title: null, sourceMetadata: { source: 'kinwall-demo' },
  privateFields: [], categoryIds: [], tags: [], memberIds: [], serviceHours: null, serviceArea: null,
  alwaysOpen: false, emergencyVisible: false, phoneVisibleOnWall: false,
  addressVisibleOnWall: false, visibility: 'household', selectedMemberIds: [], ...record,
  createdAt: contactStamp, updatedAt: contactStamp,
})
const contacts: Contact[] = [
  demoContact({ id: 'contact-school', kind: 'organization', name: 'Maple Grove School', organization: 'Maple Grove School', relationship: 'School office', title: 'Main office', phones: [{ label: 'Office', value: '555-010-2200' }], emails: [{ label: 'Office', value: 'office@example.org' }], notes: 'Front desk hours: 8–4. Call before pickup changes.', favorite: true, emergency: false, wallVisible: true, phoneVisibleOnWall: true, categoryIds: ['contact-category-8'], memberIds: ['m3', 'm4'], tags: ['school', 'pickup'], serviceHours: 'Mon–Fri, 8:00am–4:00pm', serviceArea: 'Maple Grove district', addresses: [{ label: 'Office', street: '124 Maple Street', city: 'Maple Grove', region: 'OR', postalCode: '97205', country: 'US' }], websites: [{ label: 'Website', value: 'https://maplegrove.example.org' }] }),
  demoContact({ id: 'contact-doctor', kind: 'person', name: 'Dr. Rivera', organization: 'Northside Pediatrics', relationship: 'Pediatrician', title: 'MD', phones: [{ label: 'Office', value: '555-010-3300' }, { label: 'Nurse line', value: '555-010-3301' }], emails: [{ label: 'Office', value: 'doctor@example.org' }], notes: 'Bring current medication list to visits.', favorite: true, emergency: true, wallVisible: true, phoneVisibleOnWall: true, categoryIds: ['contact-category-2'], memberIds: ['m3', 'm4'], tags: ['health', 'kids'], addresses: [{ label: 'Clinic', street: '42 Cedar Avenue', city: 'Maple Grove', region: 'OR', postalCode: '97205', country: 'US' }], websites: [{ label: 'Patient portal', value: 'https://northside.example.org' }] }),
  demoContact({ id: 'contact-neighbor', kind: 'person', name: 'Jordan Lee', organization: null, relationship: 'Neighbor', phones: [{ label: 'Mobile', value: '555-010-4400' }], emails: [{ label: 'Personal', value: 'jordan@example.org' }], notes: 'Has a spare house key and can help with school pickup.', favorite: false, emergency: false, categoryIds: ['contact-category-6', 'contact-category-7'], memberIds: ['m1', 'm2', 'm3', 'm4'], tags: ['nearby', 'backup-pickup'], addresses: [{ label: 'Home', street: '18 Willow Lane', city: 'Maple Grove', region: 'OR', postalCode: '97205', country: 'US' }] }),
  demoContact({ id: 'contact-babysitter', kind: 'person', name: 'Avery Chen', organization: null, relationship: 'Babysitter', phones: [{ label: 'Mobile', value: '555-010-5500' }], emails: [{ label: 'Personal', value: 'avery@example.org' }], notes: 'Available after school on Tuesdays and occasional date nights.', favorite: true, emergency: false, categoryIds: ['contact-category-4'], memberIds: ['m3', 'm4'], tags: ['childcare', 'pickup'], addresses: [{ label: 'Home', street: '7 Oak Street', city: 'Maple Grove', region: 'OR', postalCode: '97205', country: 'US' }] }),
  demoContact({ id: 'contact-grandparent', kind: 'person', name: 'Grandma Rosa', organization: null, relationship: 'Grandparent', phones: [{ label: 'Mobile', value: '555-010-6600' }], emails: [{ label: 'Personal', value: 'rosa@example.org' }], notes: 'Favorite Sunday dinner guest.', favorite: true, emergency: false, categoryIds: ['contact-category-5'], memberIds: ['m1', 'm2', 'm3', 'm4'], tags: ['family', 'backup-care'], addresses: [{ label: 'Home', street: '91 Rose Avenue', city: 'Maple Grove', region: 'OR', postalCode: '97205', country: 'US' }] }),
  demoContact({ id: 'contact-aunt', kind: 'person', name: 'Aunt Priya', givenName: 'Priya', familyName: 'Patel', nickname: 'Pia', organization: null, relationship: 'Aunt', phones: [{ label: 'Mobile', value: '555-010-7700' }], emails: [{ label: 'Personal', value: 'priya@example.org' }], notes: 'Sends birthday cards early.', favorite: false, emergency: false, categoryIds: ['contact-category-5'], memberIds: ['m1', 'm2', 'm3', 'm4'], tags: ['family'], dates: [{ label: 'Birthday', date: '1989-07-12' }], addresses: [{ label: 'Home', street: '203 Hawthorne Boulevard', city: 'Maple Grove', region: 'OR', postalCode: '97205', country: 'US' }] }),
  demoContact({ id: 'contact-uncle', kind: 'person', name: 'Uncle Mateo', givenName: 'Mateo', familyName: 'Garcia', organization: null, relationship: 'Uncle', phones: [{ label: 'Mobile', value: '555-010-8800' }], emails: [{ label: 'Personal', value: 'mateo@example.org' }], notes: 'The family photographer.', favorite: false, emergency: false, categoryIds: ['contact-category-5'], memberIds: ['m1', 'm2', 'm3', 'm4'], tags: ['family', 'photos'], addresses: [{ label: 'Home', street: '55 Alder Court', city: 'Maple Grove', region: 'OR', postalCode: '97205', country: 'US' }] }),
  demoContact({ id: 'contact-poison', kind: 'service', name: 'Poison Control', organization: 'National Poison Control Center', relationship: 'Emergency service', title: '24-hour hotline', phones: [{ label: 'Hotline', value: '555-010-1222' }], emails: [], notes: 'For suspected poison exposure. Call immediately; do not wait for symptoms.', favorite: true, emergency: true, alwaysOpen: true, wallVisible: true, emergencyVisible: true, phoneVisibleOnWall: true, categoryIds: ['contact-category-1'], tags: ['urgent', 'medical'], serviceHours: '24/7', serviceArea: 'United States' }),
  demoContact({ id: 'contact-fire', kind: 'service', name: 'Maple Grove Fire Department', organization: 'City emergency services', relationship: 'Emergency service', phones: [{ label: 'Emergency', value: '911' }, { label: 'Non-emergency', value: '555-010-9110' }], emails: [], notes: 'Call 911 for immediate danger, fire, or medical emergencies.', favorite: true, emergency: true, alwaysOpen: true, wallVisible: true, emergencyVisible: true, phoneVisibleOnWall: true, categoryIds: ['contact-category-1'], tags: ['urgent', 'fire'], serviceHours: '24/7', serviceArea: 'Maple Grove area', addresses: [{ label: 'Office', street: '55 Harbor Way', city: 'Maple Grove', region: 'OR', postalCode: '97205', country: 'US' }] }),
  demoContact({ id: 'contact-vet', kind: 'service', name: 'Oak Animal Clinic', organization: 'Oak Animal Clinic', relationship: 'Veterinarian', phones: [{ label: 'Office', value: '555-010-9900' }], emails: [{ label: 'Office', value: 'care@example.vet' }], notes: 'Biscuit is due for a wellness visit this fall.', favorite: true, emergency: false, categoryIds: ['contact-category-3'], memberIds: ['m4'], tags: ['pet', 'Biscuit'], serviceHours: 'Mon–Sat, 8:00am–6:00pm', serviceArea: 'Maple Grove area', addresses: [{ label: 'Clinic', street: '88 Oak Avenue', city: 'Maple Grove', region: 'OR', postalCode: '97205', country: 'US' }], websites: [{ label: 'Website', value: 'https://oak-animal.example.org' }] }),
  demoContact({ id: 'contact-pharmacy', kind: 'service', name: 'Rose City Pharmacy', organization: 'Rose City Pharmacy', relationship: 'Pharmacy', phones: [{ label: 'Pharmacy', value: '555-010-4455' }], emails: [{ label: 'Refills', value: 'refills@example.pharmacy' }], notes: 'Ask for the family pickup bin.', favorite: false, emergency: false, categoryIds: ['contact-category-2'], memberIds: ['m3', 'm4'], tags: ['medical', 'prescriptions'], serviceHours: 'Mon–Sun, 8:00am–9:00pm', serviceArea: 'Maple Grove area', websites: [{ label: 'Refill portal', value: 'https://rose-city.example.org' }], addresses: [{ label: 'Office', street: '210 Main Street', city: 'Maple Grove', region: 'OR', postalCode: '97205', country: 'US' }] }),
  demoContact({ id: 'contact-locksmith', kind: 'service', name: 'Harbor Locksmith', organization: 'Harbor Locksmith', relationship: 'Home service', phones: [{ label: 'Dispatch', value: '555-010-7788' }], emails: [{ label: 'Dispatch', value: 'dispatch@example.locksmith' }], notes: 'Trusted after-hours lockout service.', favorite: false, emergency: false, categoryIds: ['contact-category-10'], tags: ['home', 'after-hours'], serviceHours: 'Mon–Sun, 7:00am–10:00pm', serviceArea: 'Maple Grove area', addresses: [{ label: 'Office', street: '12 Industrial Way', city: 'Maple Grove', region: 'OR', postalCode: '97205', country: 'US' }] }),
  demoContact({ id: 'contact-utilities', kind: 'organization', name: 'Rose City Utilities', organization: 'Rose City Utilities', relationship: 'Utility company', phones: [{ label: 'Customer service', value: '555-010-1212' }], emails: [{ label: 'Support', value: 'support@example.utilities' }], notes: 'Account is in Alex and Sam’s names.', favorite: false, emergency: false, categoryIds: ['contact-category-10'], tags: ['home', 'account'], serviceHours: 'Mon–Fri, 7:00am–7:00pm', serviceArea: 'Maple Grove', websites: [{ label: 'Account portal', value: 'https://utilities.example.org' }], addresses: [{ label: 'Office', street: '400 Civic Plaza', city: 'Maple Grove', region: 'OR', postalCode: '97205', country: 'US' }] }),
  demoContact({ id: 'contact-library', kind: 'place', name: 'Maple Grove Library', organization: 'Maple Grove Library', relationship: 'Community place', phones: [{ label: 'Front desk', value: '555-010-3131' }], emails: [{ label: 'Info', value: 'library@example.org' }], notes: 'Story time is Saturdays at 10:30am.', favorite: false, emergency: false, categoryIds: ['contact-category-12'], tags: ['community', 'books'], serviceHours: 'Mon–Sat, 9:00am–6:00pm', serviceArea: 'Maple Grove neighborhood', websites: [{ label: 'Events', value: 'https://library.example.org' }], addresses: [{ label: 'Office', street: '600 Pine Street', city: 'Maple Grove', region: 'OR', postalCode: '97205', country: 'US' }] }),
]
const contactCategories: ContactCategory[] = ['Emergency services', 'Medical', 'Veterinary', 'Childcare', 'Family', 'Friends', 'Neighbors', 'School', 'Work', 'Home services', 'Transportation', 'Organizations', 'Other'].map((name, sort) => ({ id: `contact-category-${sort + 1}`, name, color: null, sort, createdAt: contactStamp, updatedAt: contactStamp }))

// Rewards (demo only): a few examples, Maya saving for movie night and a request of Leo's waiting.
const reward = (id: string, emoji: string, title: string, cost: number, extra: Partial<Reward> = {}): Reward =>
  ({ id, emoji, title, cost, memberIds: [], needsApproval: true, limit: null, active: true, sort: rewards.length, createdAt: '2026-01-01T00:00:00.000Z', ...extra })
const rewards: Reward[] = []
rewards.push(
  reward('rw1', '🍿', 'Movie night pick', 100),
  reward('rw2', '🍦', 'Ice cream trip', 50, { limit: { count: 1, period: 'week' } }),
  reward('rw3', '📺', '15 min screen time', 10, { needsApproval: false, limit: { count: 3, period: 'day' } }),
  reward('rw4', '🌙', 'Stay up 30 min late', 40, { memberIds: ['m3', 'm4'] }),
)
const redemption = (r: Reward, memberId: string, status: Redemption['status'], daysAgo: number): Redemption => {
  const at = new Date(Date.now() - daysAgo * 86_400_000)
  return { id: uid(), rewardId: r.id, memberId, title: r.title, emoji: r.emoji, cost: r.cost, status, note: null, date: dateKey(at), requestedAt: at.toISOString(), decidedAt: status === 'pending' ? null : at.toISOString(), givenAt: status === 'given' ? at.toISOString() : null }
}
const redemptions: Redemption[] = [
  redemption(rewards[2], 'm4', 'pending', 0),
  redemption(rewards[2], 'm3', 'given', 1),
  redemption(rewards[1], 'm3', 'given', 6),
]
const goals = new Map<string, string | null>([['m3', 'rw1'], ['m4', 'rw2']])
const goalOf = (memberId: string) => {
  const r = rewards.find(x => x.id === goals.get(memberId) && x.active)
  return r ? { rewardId: r.id, title: r.title, emoji: r.emoji, cost: r.cost } : null
}
const usedOf = (r: Reward, memberId: string) => {
  const from = new Date(); from.setDate(from.getDate() - (r.limit?.period === 'week' ? (from.getDay() - settings.weekStart + 7) % 7 : 0))
  return redemptions.filter(x => x.rewardId === r.id && x.memberId === memberId && x.status !== 'declined' && x.date >= dateKey(from)).length
}

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

// Demo photos: public Picsum images (the CSP already allows them for the screensaver).
const demoPhoto = (pic: number, caption: string | null, memberId: string | null, daysAgo: number): Photo => ({
  id: `photo${pic}`, caption, mime: 'image/webp', width: 1280, height: 853, bytes: 180_000 + pic * 97, memberId,
  createdAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), url: `https://picsum.photos/id/${pic}/1280/853`,
})
const photos: Photo[] = [
  demoPhoto(1015, 'River trip', null, 1), demoPhoto(1025, 'Our dog', 'm3', 3), demoPhoto(1043, null, null, 6),
  demoPhoto(1039, 'Waterfall hike', 'm4', 9), demoPhoto(1080, 'Strawberry picking', null, 14), demoPhoto(1062, null, 'm3', 20),
  // Paint drawings saved to family photos, credited to the artist (mock-drawings.ts).
  ...DEMO_DRAWINGS.map(d => ({ id: d.id, caption: d.caption, mime: 'image/webp', width: 800, height: 600, bytes: 60_000, memberId: d.memberId, createdAt: new Date(Date.now() - d.daysAgo * 86_400_000).toISOString(), url: d.url })),
].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) // newest first, like the server
// Demo Google Photos: a pretend connection (nothing goes to Google) that steps through signing in
// and picking albums on a timer, then shows Picsum pictures captioned as the demo.
const DEMO_GOOGLE = [1018, 1036, 1044, 1050, 1069]
let googleAt = 0 // when Connect was tapped; 0 = not connected
let googleN = 0
// For screenshots of every state, sessionStorage 'kinwall.demoGooglePhotos' can pin one: 'reconnect',
// 'refused', or 'legacy' (connected before Kinwall kept the account).
const demoGoogle = () => { try { return sessionStorage.getItem('kinwall.demoGooglePhotos') } catch { return null } }
const googleState = (): GooglePhotos['state'] => {
  const pinned = demoGoogle()
  if (pinned === 'reconnect' || pinned === 'refused') return pinned
  return !googleAt ? 'off' : Date.now() - googleAt < 6000 ? 'signing-in' : Date.now() - googleAt < 16000 ? 'choosing' : 'ready'
}
const googleStatus = (): GooglePhotos => {
  const state = googleState()
  if (settings.googlePhotos !== state) { settings.googlePhotos = state; bump() }
  return {
    available: true, state, flow: 'web',
    ...(state === 'signing-in' ? { authUrl: 'https://accounts.google.com/', codeExpiresAt: new Date(googleAt + 600_000).toISOString() } : {}),
    ...(state === 'choosing' || state === 'ready' ? { settingsUri: 'https://photos.google.com/' } : {}),
    ...(state === 'ready' ? { photos: DEMO_GOOGLE.length } : {}),
    ...((state === 'choosing' || state === 'ready') && demoGoogle() !== 'legacy' ? { account: { name: 'Alex', email: 'alex@example.com' } } : {}),
  }
}

const coloringPages: FamilyColoringPage[] = [] // a parent adds one from a picture (Paint → Coloring pages → Add a page)

const PHOTO_LIMITS = { maxCount: 200, maxBytes: 104_857_600, maxPhotoBytes: 614_400 }

const accounts: Account[] = [{ id: 'demo-google', kind: 'google', name: 'Demo Google', createdAt: new Date().toISOString() }]

const calendars: CalendarEntry[] = [
  { id: 'c1', kind: 'local', accountId: null, remoteId: null, name: 'Family', color: '#B39DFF', memberId: null, memberIds: [], categoryId: null, writable: true, enabled: true, lastSyncedAt: null, lastError: null },
  { id: 'c2', kind: 'ics', accountId: null, remoteId: null, name: 'School (ICS)', color: '#FFD166', memberId: null, memberIds: [], categoryId: null, writable: false, enabled: true, lastSyncedAt: new Date().toISOString(), lastError: null },
  { id: 'c3', kind: 'google', accountId: 'demo-google', remoteId: 'remote-1', name: 'Work', color: '#7AB8FF', memberId: null, memberIds: [], categoryId: null, writable: true, enabled: true, lastSyncedAt: new Date().toISOString(), lastError: null },
  // A school's whole calendar, filtered down to days off and half days (Settings → Calendars → Filter).
  { id: 'c4', kind: 'ics', accountId: null, remoteId: null, name: 'Oak Hill Elementary', color: '#F5A65B', memberId: null, memberIds: ['m3', 'm4'], categoryId: null, writable: false, enabled: true, lastSyncedAt: new Date().toISOString(), lastError: null, filter: FILTER_PRESETS[0].filter },
]

const categories: Category[] = [
  { id: 'cat1', name: 'Birthdays', emoji: '🎂', color: '#FF9E7A', keywords: ['birthday', 'bday', 'b-day'], sort: 0, createdAt: new Date().toISOString() },
  { id: 'cat2', name: 'Sports', emoji: '⚽', color: '#7ED9A6', keywords: ['practice', 'game', 'soccer'], sort: 1, createdAt: new Date().toISOString() },
  // No emoji (one made through the API): the calendar shows its name instead.
  { id: 'cat3', name: 'Music', emoji: null, color: '#B39DFF', keywords: ['piano'], sort: 2, createdAt: new Date().toISOString() },
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
  { id: 'e1', calendarId: 'c1', title: 'Soccer Practice', start: at(0, 16), end: at(0, 17, 30), allDay: false, location: 'Park field', description: 'Bring shin guards and a water bottle.\nSnack: oranges (Alex)', memberIds: ['m2'], color: '#FF8FA3', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: 'cat2', categorySource: 'keyword', reminders: null, travelMinutes: 20, leaveAt: null, remindBeforeLeave: true },
  { id: 'e2', calendarId: 'c1', title: 'Team Meeting', start: at(0, 16, 30), end: at(0, 17), allDay: false, location: null, description: null, memberIds: ['m1'], color: '#7AB8FF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e3', calendarId: 'c2', title: 'Teacher In-Service (No School)', start: dateOnly(1), end: dateOnly(2), allDay: true, location: null, description: null, memberIds: ['m3'], color: '#FFD166', rrule: null, occurrenceStart: null, readOnly: true, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e4', calendarId: 'c1', title: 'Family Dinner', start: at(2, 18), end: at(2, 19), allDay: false, location: 'Home', description: null, memberIds: [], color: '#B39DFF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e5', calendarId: 'c1', title: 'Piano Lesson', start: at(3, 15), end: at(3, 15, 45), allDay: false, location: null, description: null, memberIds: ['m3'], color: '#7ED9A6', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: 'cat3', categorySource: 'keyword', reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
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
  // A delivery window shown as free: in the calendar, but never "Now" all day.
  // Day view: one shared event for everyone, and the same meeting synced from two calendars (shown once).
  { id: 'e25', calendarId: 'c1', title: 'Family Dinner', start: at(0, 18), end: at(0, 19), allDay: false, location: 'Home', description: null, memberIds: ['m1', 'm2', 'm3', 'm4'], color: '#B39DFF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e26', calendarId: 'c3', title: 'Team Meeting', start: at(0, 16, 30), end: at(0, 17), allDay: false, location: null, description: null, memberIds: ['m1'], color: '#7AB8FF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'calendar', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e24', calendarId: 'c1', title: '📦 Grocery delivery', start: at(0, 16), end: at(0, 18), allDay: false, location: null, description: 'Delivery window, 4 to 6 PM', memberIds: [], color: '#B39DFF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false, busy: false },
  { id: 'e21', calendarId: 'c1', title: 'Reading Time', start: fromNow(-20), end: fromNow(25), allDay: false, location: null, description: null, memberIds: ['m3'], color: '#7ED9A6', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false },
  { id: 'e22', calendarId: 'c1', title: 'Piano Lesson', start: fromNow(70), end: fromNow(115), allDay: false, location: 'Music school', description: null, memberIds: ['m2'], color: '#FF8FA3', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: 45, leaveAt: null, remindBeforeLeave: true },
]

// Oak Hill Elementary's feed: everything a school publishes, mostly all-day. Its filter keeps only
// days off and half days; the rest shows in Settings' preview and with Show hidden.
const SCHOOL_EVENTS: [number, string, number?, number?][] = [ // [days from today, title, start hour, length in days or hours]
  [0, 'Spirit Day: Pajamas'], [1, 'Breakfast with the Principal', 8], [3, 'Book Fair', undefined, 3], [4, 'PTA Meeting', 18],
  [6, 'Early Release – Half Day'], [8, 'Picture Day Retakes'], [11, 'Professional Development Day – No School'], [13, 'Science Fair', 17],
  [15, 'Field Trip: Science Museum'], [18, 'Teacher Workday – No School'], [20, 'Report Cards Go Home'], [22, 'Math Night', 18],
  [26, 'Fall Break – No School', undefined, 3], [33, 'Parent-Teacher Conferences – Half Day'], [36, 'Fall Concert', 18],
  [40, 'Spelling Bee'], [45, 'Mid-Term Break – No School', undefined, 5], [57, 'Classes Resume'], [60, 'Staff Development Day – No School'],
  [64, 'Winter Carnival', 17], [72, 'Snow Day Make-Up'], [80, 'Early Dismissal – Staff Training'], [86, 'Winter Recess – No School', undefined, 5],
]
for (const [i, [day, title, hour, length]] of SCHOOL_EVENTS.entries()) {
  const timed = hour !== undefined
  events.push({
    id: `s${i + 1}`, calendarId: 'c4', title, start: timed ? at(day, hour) : dateOnly(day), end: timed ? at(day, hour + (length ?? 1)) : dateOnly(day + (length ?? 1)),
    allDay: !timed, location: null, description: null, memberIds: ['m3', 'm4'], color: '#F5A65B', rrule: null, occurrenceStart: null, readOnly: true, seriesId: null,
    memberScope: 'calendar', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false,
  })
}

// Hidden one by one (Settings → Calendars → Hidden events): a make-up day is a school day, whatever the filter says.
const hiddenEvents: (HiddenEvent & { key: string })[] = []
const hideKeys = (e: EventInstance) => ({ occurrence: e.rrule ? `${e.id}@${e.occurrenceStart ?? e.start}` : e.id, series: e.seriesId ?? (e.rrule ? e.id : null) })
const hideInMock = (e: EventInstance, scope: 'occurrence' | 'series'): HiddenEvent => {
  const key = scope === 'series' ? hideKeys(e).series : hideKeys(e).occurrence
  if (!key) throw new Error('this event is not part of a series')
  const existing = hiddenEvents.find(h => h.calendarId === e.calendarId && h.scope === scope && h.key === key)
  if (existing) return existing
  const h = { id: uid(), calendarId: e.calendarId, scope, key, title: e.title, start: e.start, allDay: e.allDay, createdAt: new Date().toISOString() }
  hiddenEvents.push(h)
  return h
}
{ const makeUp = events.find(e => e.title === 'Snow Day Make-Up'); if (makeUp) hideInMock(makeUp, 'occurrence') }

/** Why the family doesn't see an event, like the server: hidden on its own or with its series, or by its calendar's filter (calendarFilter.ts). */
const hiddenWhy = (e: EventInstance): EventInstance['hidden'] => {
  const keys = hideKeys(e)
  const is = (scope: 'occurrence' | 'series', key: string | null) => !!key && hiddenEvents.some(h => h.calendarId === e.calendarId && h.scope === scope && h.key === key)
  if (is('series', keys.series)) return 'series'
  if (is('occurrence', keys.occurrence)) return 'event'
  return filterShows(calendars.find(c => c.id === e.calendarId)?.filter ?? NO_FILTER, e) ? null : 'filter'
}

// Mirrors the server: leaveAt = start - travelMinutes, only for timed events shown as busy.
const withLeave = (e: EventInstance): EventInstance =>
  ({ ...e, leaveAt: e.travelMinutes && !e.allDay && e.busy !== false ? new Date(new Date(e.start).getTime() - e.travelMinutes * 60000).toISOString() : null })

const chores: Chore[] = [
  { id: 'ch1', title: 'Make bed', emoji: '🛏️', memberId: 'm2', points: 5, rrule: 'FREQ=DAILY', dueDate: null, dueTime: null, active: true, sort: 0, listId: null, pluginId: null, pluginMinutes: null },
  { id: 'ch2', title: 'Feed the dog', emoji: '🐕', memberId: 'm3', points: 5, rrule: 'FREQ=DAILY', dueDate: null, dueTime: null, active: true, sort: 1, listId: null, pluginId: null, pluginMinutes: null },
  { id: 'ch3', title: 'Take out trash', emoji: '🗑️', memberId: 'm1', points: 10, rrule: 'FREQ=WEEKLY;BYDAY=MO,TH', dueDate: null, dueTime: null, active: true, sort: 2, listId: null, pluginId: null, pluginMinutes: null },
  { id: 'ch4', title: 'Water plants', emoji: '🪴', memberId: null, points: 5, rrule: null, dueDate: todayISO(), dueTime: null, active: true, sort: 3, listId: null, pluginId: null, pluginMinutes: null },
  { id: 'ch5', title: 'Vacuum living room', emoji: '🧹', memberId: 'm2', points: 15, rrule: 'FREQ=WEEKLY', dueDate: null, dueTime: null, active: true, sort: 4, listId: null, pluginId: null, pluginMinutes: null },
  { id: 'ch6', title: 'Tidy toys', emoji: '🧸', memberId: 'm4', points: 5, rrule: 'FREQ=DAILY', dueDate: null, dueTime: null, active: true, sort: 5, listId: 'l4', pluginId: null, pluginMinutes: null },
]
const completions = new Map<string, { completedAt: string; memberId: string | null }>() // key `${choreId}:${date}`

// The chore library: occasional jobs, a few due-ish, one already handed out (the dog's bath, Saturday).
const dayOffset = (n: number) => dateKey(new Date(Date.now() + n * 86_400_000))
const saturday = () => { const d = new Date(); return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + ((6 - d.getDay() + 7) % 7 || 0))) }
type DemoLibrary = Omit<LibraryChore, 'lastDone' | 'open' | 'timesAssigned' | 'lastMemberId'> & { seenDone: LibraryChore['lastDone']; seenMember: string | null; seenTimes: number }
const lib = (id: string, emoji: string, title: string, points: number, every: [number, LibraryChore['everyUnit']] | null, done: [number, string] | null, memberId: string | null = null, notes: string | null = null): DemoLibrary => ({
  id, title, emoji, points, listId: null, memberId, everyN: every?.[0] ?? null, everyUnit: every?.[1] ?? null, needsApproval: null, notes, createdAt: '2026-01-01T00:00:00.000Z',
  seenDone: done ? { date: dayOffset(-done[0]), memberId: done[1] } : null, seenMember: done?.[1] ?? null, seenTimes: done ? 3 : 0,
})
const library: DemoLibrary[] = [
  lib('lib-car', '🚗', 'Clean out the car', 10, [4, 'week'], [36, 'm3'], 'm3', 'Vacuum the mats and empty the cup holders.'),
  lib('lib-windows', '🪟', 'Wash the windows', 15, [3, 'month'], [100, 'm1'], 'm1'),
  lib('lib-baseboards', '🧽', 'Wipe the baseboards', 10, [2, 'month'], [58, 'm2']),
  lib('lib-fridge', '🧊', 'Deep-clean the fridge', 10, [2, 'month'], [20, 'm2'], 'm2'),
  lib('lib-dog', '🛁', 'Give the dog a bath', 10, [1, 'month'], [33, 'm3'], 'm3'),
  lib('lib-mattress', '🛏️', 'Flip the mattresses', 5, [6, 'month'], [150, 'm1']),
  lib('lib-garage', '🧰', 'Organize the garage', 20, [6, 'month'], null, 'm1'),
  lib('lib-leaves', '🍂', 'Rake leaves', 15, null, [340, 'm4'], 'm4'),
  lib('lib-toys', '🧸', 'Sort out old toys to give away', 10, null, null, 'm4'),
]
chores.push({ id: 'ch-lib-dog', title: 'Give the dog a bath', emoji: '🛁', memberId: 'm3', points: 10, rrule: null, dueDate: saturday(), dueTime: null, active: true, sort: 6, listId: null, pluginId: null, pluginMinutes: null, libraryId: 'lib-dog' })
function libraryView(l: DemoLibrary): LibraryChore {
  const { seenDone, seenMember, seenTimes, ...item } = l
  const made = chores.filter(c => c.libraryId === l.id)
  let lastDone = seenDone
  for (const [k, v] of completions) {
    const [choreId, date] = [k.slice(0, k.lastIndexOf(':')), k.slice(k.lastIndexOf(':') + 1)]
    const c = made.find(x => x.id === choreId)
    if (c && (!lastDone || date >= lastDone.date)) lastDone = { date, memberId: v.memberId ?? c.memberId }
  }
  const open = made.filter(c => c.active && (c.rrule || ![...completions.keys()].some(k => k.startsWith(`${c.id}:`)))).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0]
  return { ...item, lastDone, lastMemberId: made.length ? made[made.length - 1].memberId : seenMember, timesAssigned: seenTimes + made.length, open: open ? { choreId: open.id, dueDate: open.dueDate, memberId: open.memberId, repeats: !!open.rrule } : null }
}
const libraryRow = (body: LibraryChoreInput, from?: Chore): DemoLibrary => ({
  id: uid(), title: body.title ?? from?.title ?? 'New chore', emoji: body.emoji ?? from?.emoji ?? null, points: body.points ?? from?.points ?? 0, listId: body.listId ?? from?.listId ?? null,
  memberId: body.memberId !== undefined ? body.memberId : from?.memberId ?? null, everyN: body.everyN ?? null, everyUnit: body.everyUnit ?? null, needsApproval: body.needsApproval ?? from?.needsApproval ?? null,
  notes: body.notes?.trim() || null, createdAt: new Date().toISOString(), seenDone: null, seenMember: null, seenTimes: 0,
})

const lists: List[] = [
  { id: 'l1', name: 'Groceries', emoji: '🛒', color: '#7ED9A6', kind: 'shopping', catalog: 'groceries', memberIds: [], groupBy: 'store', sortBy: 'aisle', keepChecked: true, sort: 0, archived: false, createdAt: new Date().toISOString(), itemCount: 5, openCount: 4 },
  { id: 'l5', name: 'Hardware store', emoji: '🔨', color: '#FFB86B', kind: 'shopping', catalog: 'shopping', memberIds: [], groupBy: 'aisle', sortBy: 'aisle', keepChecked: true, sort: 4, archived: false, createdAt: new Date().toISOString(), itemCount: 5, openCount: 4 },
  { id: 'l2', name: 'Weekend To-Dos', emoji: '✅', color: '#7AB8FF', kind: 'todo', memberIds: ['m1'], groupBy: 'none', sortBy: 'due', keepChecked: false, sort: 1, archived: false, createdAt: new Date().toISOString(), itemCount: 5, openCount: 4 },
  { id: 'l3', name: 'Camping Packing List', emoji: '🎒', color: '#FFD166', kind: 'reusable', memberIds: [], groupBy: 'none', sortBy: 'manual', keepChecked: true, sort: 2, archived: false, createdAt: new Date().toISOString(), itemCount: 4, openCount: 4,
    lastDoneAt: new Date(Date.now() - 4 * 86_400_000 - 2 * 3_600_000).toISOString(), lastDoneBy: { memberId: 'm3' } },
  { id: 'l4', name: 'Living room reset', emoji: '🛋️', color: '#C9A7FF', kind: 'reusable', memberIds: [], groupBy: 'none', sortBy: 'manual', keepChecked: true, sort: 3, archived: false, createdAt: new Date().toISOString(), itemCount: 3, openCount: 3 },
]
type SeedItem = Omit<ListItem, 'priority' | 'steps' | 'stepsDone' | 'stepsTotal' | 'aisle'> & { priority?: ListItem['priority']; steps?: string[] | ListItemStep[]; aisle?: string | null }
const seedItem = (i: SeedItem): ListItem => withStepCounts({
  ...i, aisle: i.aisle ?? null, priority: i.priority ?? 'normal',
  steps: (i.steps ?? []).map((st, sort) => typeof st === 'string' ? { id: uid(), title: st, done: false, sort } : st),
  stepsDone: 0, stepsTotal: 0,
})
function withStepCounts(i: ListItem) { i.stepsDone = i.steps.filter(st => st.done).length; i.stepsTotal = i.steps.length; return i }
const iso = () => new Date().toISOString()
const inDays = (n: number) => dateKey(new Date(Date.now() + n * 86_400_000))
let listItems: ListItem[] = ([
  { id: 'li1', listId: 'l1', title: 'Milk', notes: null, quantity: '1 gal', store: 'Neighborhood market', aisle: 'Dairy', category: 'Dairy', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 0, createdAt: new Date().toISOString(), priority: 'urgent', updatedAt: new Date().toISOString() },
  { id: 'li2', listId: 'l1', title: 'Eggs', notes: null, quantity: '1 dozen', store: 'Neighborhood market', aisle: 'Dairy', category: 'Dairy', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li3', listId: 'l1', title: 'Bread', notes: null, quantity: null, store: 'Neighborhood market', aisle: 'Bakery', category: 'Bakery', memberId: null, dueDate: null, eventId: null, done: true, doneAt: new Date().toISOString(), doneBy: 'm1', sort: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li4', listId: 'l1', title: 'Apples', notes: null, quantity: '6', store: 'Neighborhood market', aisle: 'Produce', category: 'Produce', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 3, createdAt: new Date().toISOString(), priority: 'low', updatedAt: new Date().toISOString() },
  { id: 'li5', listId: 'l1', title: 'Paper towels', notes: null, quantity: '12 rolls', store: 'Warehouse club', aisle: 'Aisle 14', category: 'Household', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 4, createdAt: new Date().toISOString(), priority: 'high', updatedAt: new Date().toISOString() },
  { id: 'li6', listId: 'l2', title: 'Mow the lawn', notes: null, quantity: null, store: null, category: null, memberId: 'm1', dueDate: todayISO(), eventId: null, done: false, doneAt: null, doneBy: null, sort: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li7', listId: 'l2', title: 'Return library books', notes: null, quantity: null, store: null, category: null, memberId: 'm2', dueDate: inDays(-3), eventId: null, done: false, doneAt: null, doneBy: null, sort: 1, createdAt: new Date().toISOString(), priority: 'high', updatedAt: new Date().toISOString() },
  { id: 'li8', listId: 'l2', title: 'Book dentist appointment', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, eventId: null, done: true, doneAt: new Date().toISOString(), doneBy: 'm1', sort: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li13', listId: 'l2', title: 'Pack shin guards + water bottle', notes: null, quantity: null, store: null, category: null, memberId: 'm2', dueDate: null, eventId: 'e1', done: false, doneAt: null, doneBy: null, sort: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li14', listId: 'l2', title: 'Clean out backpack', notes: null, quantity: null, store: null, category: null, memberId: 'm4', dueDate: inDays(4), eventId: null, done: false, doneAt: null, doneBy: null, sort: 4, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li9', listId: 'l3', title: 'Tent', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li10', listId: 'l3', title: 'Sleeping bags', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li11', listId: 'l3', title: 'Flashlight', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li12', listId: 'l3', title: 'Bug spray', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li15', listId: 'l4', title: 'Tidy the couch and put every blanket back in the basket by the window', notes: 'The gray throw goes in the hall closet, not the basket.', quantity: null, store: null, category: null, memberId: 'm3', dueDate: todayISO(), eventId: null, done: false, doneAt: null, doneBy: null, sort: 0, createdAt: iso(), updatedAt: iso(), priority: 'urgent',
    steps: [{ id: uid(), title: 'Fold the blankets', done: true, sort: 0 }, { id: uid(), title: 'Fluff the cushions', done: false, sort: 1 }, { id: uid(), title: 'Find the remote', done: false, sort: 2 }] },
  { id: 'li16', listId: 'l4', title: 'Toys back in their bins', notes: null, quantity: null, store: null, category: null, memberId: 'm4', dueDate: inDays(2), eventId: null, done: false, doneAt: null, doneBy: null, sort: 1, createdAt: iso(), updatedAt: iso(),
    steps: ['Blocks in the red bin', 'Cars in the blue bin', 'Books on the shelf', 'Stuffies on the bed', 'Check under the couch'] },
  { id: 'li18', listId: 'l5', title: 'Wood screws', notes: null, quantity: '1 box', store: 'Home center', aisle: 'Aisle 12', category: 'Fasteners', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 0, createdAt: iso(), updatedAt: iso() },
  { id: 'li19', listId: 'l5', title: 'Furnace filter', notes: '16x25x1', quantity: '2', store: 'Home center', aisle: 'Aisle 21', category: 'Heating', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 1, createdAt: iso(), updatedAt: iso() },
  { id: 'li20', listId: 'l5', title: "Painter's tape", notes: null, quantity: null, store: 'Home center', aisle: 'Aisle 9', category: 'Paint', memberId: null, dueDate: null, eventId: null, done: true, doneAt: iso(), doneBy: 'm1', sort: 2, createdAt: iso(), updatedAt: iso() },
  // A supercenter trip walks both lists: a few things for each.
  { id: 'li21', listId: 'l1', title: 'Cereal', notes: null, quantity: '2 boxes', store: 'Supercenter', aisle: 'Aisle 7', category: 'Breakfast', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 30, createdAt: iso(), updatedAt: iso() },
  { id: 'li22', listId: 'l1', title: 'Sparkling water', notes: null, quantity: '12 pack', store: 'Supercenter', aisle: 'Aisle 12', category: 'Drinks', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 31, createdAt: iso(), updatedAt: iso() },
  { id: 'li23', listId: 'l5', title: 'Extension cord', notes: null, quantity: null, store: 'Supercenter', aisle: 'Aisle 21', category: 'Electrical', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 3, createdAt: iso(), updatedAt: iso() },
  { id: 'li24', listId: 'l5', title: 'Storage bins', notes: null, quantity: '3', store: 'Supercenter', aisle: 'Aisle 9', category: 'Storage', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 4, createdAt: iso(), updatedAt: iso() },
  { id: 'li17', listId: 'l4', title: 'Clear the coffee table', notes: null, quantity: null, store: null, category: null, memberId: 'm2', dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 2, createdAt: iso(), priority: 'low', updatedAt: iso() },
] as SeedItem[]).map(seedItem)
// Who added and checked off what (the item sheet's "Added by" line): kids add snacks, the wall adds
// staples, the Assistant planned a meal. Hours ago, so the times read like a real week.
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
for (const [id, addedBy, hours, checkedBy] of [
  ['li1', { label: 'Kitchen wall' }, 26], ['li2', { memberId: 'm2' }, 50], ['li3', { memberId: 'm1' }, 75, { memberId: 'm3' }],
  ['li4', { label: 'Assistant' }, 4], ['li21', { memberId: 'm4' }, 3], ['li22', { memberId: 'm3' }, 28],
  ['li8', { memberId: 'm2' }, 30, { memberId: 'm1' }], ['li15', { memberId: 'm1' }, 52], ['li20', { memberId: 'm1' }, 100, { label: 'Kitchen wall' }],
] as [string, Actor, number, Actor?][]) {
  const i = listItems.find(x => x.id === id)!
  Object.assign(i, { addedBy, createdAt: hoursAgo(hours), ...(checkedBy ? { checkedBy, doneAt: hoursAgo(1.5) } : {}) })
}
// A starter grocery run for the meal fixtures; projection can still add the week's full quantities.
const mealGroceries: [string, string, string, string, boolean, string, string[]][] = [
  ['Ground beef', '2.5 lb', 'Meat', 'Tuesday Tacos and Spaghetti Bolognese', false, 'Meat', ['Tuesday Tacos', 'Spaghetti Bolognese']],
  ['Corn tortillas', '18', 'Bakery', 'Tuesday Tacos, including leftovers for Wednesday', false, 'Bakery', ['Tuesday Tacos']],
  ['Tomatoes', '8', 'Produce', 'Tacos, wraps, and garden vegetable pizza', true, 'Produce', ['Tuesday Tacos', 'Garden vegetable pizza']],
  ['Chicken breast', '3 lb', 'Meat', 'Sunday and Saturday lemon chicken dinners', false, 'Meat', ['Lemon chicken with rice and broccoli']],
  ['Broccoli', '3 lb', 'Produce', 'Lemon chicken and tofu stir-fry', false, 'Produce', ['Lemon chicken with rice and broccoli', 'Tofu vegetable stir-fry']],
  ['Rice', '4.5 cup', 'Pantry', 'Chicken dinners and stir-fry', true, 'Aisle 5', ['Lemon chicken with rice and broccoli', 'Tofu vegetable stir-fry']],
  ['Blueberries', '3 pints', 'Produce', 'Pancakes and yogurt parfaits', false, 'Produce', ['Blueberry pancakes', 'Berry yogurt parfaits']],
  ['Salmon', '1.5 lb', 'Seafood', 'Thursday dinner; buy fresh or keep frozen', false, 'Seafood', ['Salmon with potatoes and green beans']],
  ['Frozen peas', '2 bags', 'Frozen', 'Tofu stir-fry', false, 'Frozen', ['Tofu vegetable stir-fry']],
]
listItems.push(...mealGroceries.map(([title, quantity, category, notes, done, aisle, meals], sort) => ({ ...seedItem({
  id: `demo-grocery-${sort}`, listId: 'l1', title, quantity, category, notes, store: 'Neighborhood market', aisle, memberId: 'm1',
  dueDate: null, eventId: null, done, doneAt: done ? iso() : null, doneBy: done ? 'm1' : null,
  sort: sort + 5, createdAt: iso(), updatedAt: iso(),
}), meals })))
// The market's walking order (Frozen sits between the numbered aisles), and remembered places:
// what a checked-out item leaves behind so the next "milk" lands in the right spot.
let aisleOrder: { store: string | null; aisles: string[] }[] = [
  { store: 'Neighborhood market', aisles: ['Produce', 'Bakery', 'Deli', 'Meat', 'Seafood', 'Aisle 3', 'Aisle 4', 'Aisle 5', 'Frozen', 'Aisle 6', 'Dairy'] },
]
let remembered: ListItem[] = []
// Each shopping list type keeps its own catalog: an item (on a list, or remembered from one) belongs to its list's.
const catalogOf = (listId: string): ListCatalog => lists.find(l => l.id === listId)?.catalog ?? 'groceries'
const inCatalog = (catalog: ListCatalog) => (i: ListItem) => (lists.find(l => l.id === i.listId)?.kind ?? 'shopping') === 'shopping' && catalogOf(i.listId) === catalog
const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/s$/, '') === b.trim().toLowerCase().replace(/s$/, '')
// Where an item has been kept, per store, newest first (the server's item_memory, roughly).
const placesOf = (title: string, catalog: ListCatalog = 'groceries') => {
  const seen = new Map<string | null, string | null>()
  for (const i of [...listItems, ...remembered].filter(inCatalog(catalog)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    if (sameName(i.title, title) && !seen.has(i.store)) seen.set(i.store, i.aisle)
  }
  return [...seen].map(([store, aisle]) => ({ store, aisle }))
}
// The market's usual spots for things on the list that are planned for "anywhere" or the club.
const seenAt = (title: string, store: string, aisle: string | null, listId = 'l1') => remembered.push(seedItem({ id: uid(), listId, title, notes: null, quantity: null, store, aisle, category: null, memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 0, createdAt: minsAgo(9000), updatedAt: minsAgo(9000) }))
// Autocomplete: every shopping name seen (the server's item_names, roughly), most used first,
// plus a few from past trips.
const pastGroceries = ['Bananas', 'Banana milk', 'Bagels', 'Baby spinach', 'Basil', 'Blueberries', 'Butter', 'Cheddar', 'Coffee', 'Oat milk', 'Yogurt', 'Tortillas', 'Rice', 'Pasta']
const forgotten = new Set<string>()
function nameSuggestions(catalog: ListCatalog) {
  const out = new Map<string, { title: string; key: string; uses: number; category?: string; place?: { store: string; aisle: string | null } }>()
  for (const i of [...remembered, ...listItems].filter(inCatalog(catalog)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    const key = itemKey(i.title), was = out.get(key)
    out.set(key, { title: i.title, key, uses: (was?.uses ?? 0) + 1, category: i.category ?? was?.category, place: i.store ? { store: i.store, aisle: i.aisle ?? null } : was?.place })
  }
  if (catalog === 'groceries') pastGroceries.forEach((title, n) => { const key = itemKey(title); if (!out.has(key)) out.set(key, { title, key, uses: pastGroceries.length - n }) })
  return [...out.values()].filter(s => !forgotten.has(`${catalog}:${s.key}`)).sort((a, b) => b.uses - a.uses)
}
const catalogItems = new Map<ListCatalog, Map<string, RememberedItem>>()
function mockCatalog(catalog: ListCatalog) {
  if (!catalogItems.has(catalog)) catalogItems.set(catalog, new Map(nameSuggestions(catalog).map(s => {
    const places = placesOf(s.title, catalog).filter((p): p is { store: string; aisle: string | null } => !!p.store)
    return [s.key, { key: s.key, title: s.title, uses: s.uses, lastUsed: iso(), category: s.category ?? DEMO_DEPARTMENT[s.title] ?? null, lastStore: places[0]?.store ?? null,
      places: places.map(p => ({ ...p, updatedAt: iso() })).sort((a, b) => a.store.localeCompare(b.store)), tags: DEMO_TAGS[s.title] ?? [] }]
  })))
  return catalogItems.get(catalog)!
}
// The demo family's own catalog categories.
const DEMO_TAGS: Record<string, string[]> = {
  Bananas: ['Breakfast', 'Snacks', 'Lunchbox'], Bagels: ['Breakfast'], Yogurt: ['Breakfast', 'Lunchbox'], 'Oat milk': ['Breakfast'], Coffee: ['Breakfast', 'Pantry staples'],
  Blueberries: ['Snacks', 'Breakfast'], Cheddar: ['Lunchbox', 'Snacks'], Tortillas: ['Lunchbox'], Rice: ['Pantry staples'], Pasta: ['Pantry staples'],
  'Paper towels': ['Cleaning'], 'Dish soap': ['Cleaning'], Milk: ['Breakfast'], Eggs: ['Breakfast'],
  'Light bulbs': ['Around the house'], Batteries: ['Around the house'], 'Furnace filter': ['Seasonal'], 'Wood screws': ['Projects'], "Painter's tape": ['Projects'],
}
const DEMO_DEPARTMENT: Record<string, string> = {
  Bananas: 'Produce', 'Baby spinach': 'Produce', Basil: 'Produce', Blueberries: 'Produce', Butter: 'Dairy', Cheddar: 'Dairy', Yogurt: 'Dairy', 'Oat milk': 'Dairy', 'Banana milk': 'Dairy',
  Coffee: 'Pantry', Rice: 'Pantry', Pasta: 'Pantry', Tortillas: 'Bakery', Bagels: 'Bakery', 'Paper towels': 'Household',
  'Light bulbs': 'Lighting', Batteries: 'Electrical',
}
recomputeListCounts('l1')
let listGroups: ListGroup[] = []
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
seenAt('Paper towels', 'Neighborhood market', 'Aisle 6')
seenAt('Dish soap', 'Neighborhood market', 'Aisle 6')
// Past trips for the grocery catalog: where things are found at each store.
for (const [title, store, aisle] of [
  ['Milk', 'Warehouse club', 'Aisle 12'], ['Eggs', 'Warehouse club', 'Aisle 12'], ['Coffee', 'Warehouse club', 'Aisle 7'], ['Rice', 'Warehouse club', 'Aisle 9'],
  ['Bananas', 'Neighborhood market', 'Produce'], ['Baby spinach', 'Neighborhood market', 'Produce'], ['Butter', 'Neighborhood market', 'Dairy'], ['Cheddar', 'Neighborhood market', 'Dairy'],
  ['Yogurt', 'Neighborhood market', 'Dairy'], ['Oat milk', 'Neighborhood market', 'Dairy'], ['Coffee', 'Neighborhood market', 'Aisle 4'], ['Pasta', 'Neighborhood market', 'Aisle 3'],
  ['Bagels', 'Neighborhood market', 'Bakery'], ['Tortillas', 'Neighborhood market', 'Aisle 5'], ['Pasta', 'Warehouse club', 'Aisle 9'],
] as const) seenAt(title, store, aisle)
listItems.push(seedItem({ id: 'demo-grocery-anywhere', listId: 'l1', title: 'Dish soap', notes: null, quantity: null, store: null, category: 'Household', memberId: null, dueDate: null, eventId: null, done: false, doneAt: null, doneBy: null, sort: 20, createdAt: iso(), updatedAt: iso() }))
recomputeListCounts('l1')
// The hardware store's own catalog: past trips there.
seenAt('Light bulbs', 'Home center', 'Aisle 18', 'l5')
seenAt('Batteries', 'Home center', 'Aisle 1', 'l5')
recomputeListCounts('l5')
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
  const today = new Date().toLocaleDateString('en-CA')
  l.overdueCount = items.filter(i => !i.done && i.dueDate && i.dueDate < today).length
}
for (const l of lists) recomputeListCounts(l.id)

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

// Security activity (Settings → Access): what the server would have logged, newest first, over a
// couple of months and every filter chip, so the sheet has days to group and pages to scroll.
const securityEvents: SecurityEvent[] = [
  { id: 's1', at: fromNow(-25), kind: 'passkey.added', summary: 'Passkey "Alex\'s iPhone" added', by: { memberId: 'm1' }, device: "Alex's iPhone", detail: null },
  { id: 's2', at: fromNow(-140), kind: 'device.paired', summary: '"Kitchen wall" paired as a wall screen', by: { memberId: 'm2' }, device: 'Kitchen wall', detail: { kind: 'wall' } },
  { id: 's3', at: at(-1, 19, 40), kind: 'device.owner', summary: '"Sam\'s laptop" now belongs to Sam (a grown-up\'s device)', by: null, device: "Sam's laptop", detail: null },
  { id: 's4', at: at(-1, 16, 12), kind: 'signin.recovery', summary: 'Recovery code used to sign in (7 left)', by: null, device: null, detail: { remaining: 7 } },
  { id: 's5', at: at(-2, 20, 5), kind: 'app.connected', summary: 'Claude connected with full access', by: { memberId: 'm1' }, device: 'Claude', detail: { scope: 'admin' } },
  { id: 's6', at: at(-2, 9, 30), kind: 'journal.privacy', summary: 'Maya can keep a private journal', by: { memberId: 'm2' }, device: null, detail: null },
  { id: 's7', at: at(-3, 18, 0), kind: 'pin.set', summary: 'Night PIN changed', by: { memberId: 'm1' }, device: null, detail: null },
  { id: 's8', at: at(-4, 8, 15), kind: 'key.created', summary: 'Full-access API key "Home Assistant" created', by: { memberId: 'm1' }, device: 'Home Assistant', detail: { scope: 'admin' } },
  { id: 's9', at: at(-5, 21, 0), kind: 'passkey.removed', summary: 'Passkey "Old iPad" removed; its sign-ins ended', by: { memberId: 'm2' }, device: 'Old iPad', detail: null },
  { id: 's10', at: at(-6, 17, 45), kind: 'device.paired', summary: '"Leo\'s tablet" paired as Leo\'s device', by: { memberId: 'm2' }, device: "Leo's tablet", detail: { kind: 'kid' } },
  { id: 's11', at: at(0, 7, 10), kind: 'signin.passkey', summary: 'Signed in with passkey "Sam\'s Pixel"', by: { memberId: 'm2' }, device: "Sam's Pixel", detail: null },
  { id: 's12', at: at(-1, 8, 2), kind: 'widgets.added', summary: 'Widgets key "Kitchen widgets" added', by: { label: 'Kitchen wall' }, device: 'Kitchen widgets', detail: null },
  { id: 's13', at: at(-6, 18, 5), kind: 'signout', summary: 'Signed out (passkey "Old iPad")', by: { memberId: 'm2' }, device: 'Old iPad', detail: null },
  { id: 's14', at: at(-4, 8, 0), kind: 'recovery.generated', summary: 'Recovery codes made', by: { memberId: 'm1' }, device: null, detail: null },
  { id: 's15', at: at(-8, 19, 30), kind: 'app.disconnected', summary: 'Old assistant disconnected', by: { memberId: 'm1' }, device: 'Old assistant', detail: null },
  { id: 's16', at: at(-9, 12, 0), kind: 'passkey.renamed', summary: 'Passkey "iPhone" renamed to "Alex\'s iPhone"', by: { memberId: 'm1' }, device: "Alex's iPhone", detail: null },
  { id: 's17', at: at(-12, 20, 15), kind: 'key.removed', summary: 'API key "Test script" removed and signed out', by: { memberId: 'm2' }, device: 'Test script', detail: null },
  { id: 's18', at: at(-15, 21, 10), kind: 'pin.removed', summary: 'Night PIN removed', by: { memberId: 'm2' }, device: null, detail: null },
  { id: 's19', at: at(-20, 10, 0), kind: 'widgets.removed', summary: 'Widgets key "Hall widgets" signed out', by: { memberId: 'm1' }, device: 'Hall widgets', detail: null },
  // Alex signs in every few days on the same phone, so scrolling loads more pages.
  ...Array.from({ length: 30 }, (_, i): SecurityEvent => ({ id: `s${20 + i}`, at: at(-5 - i * 2, 7, 50), kind: 'signin.passkey', summary: 'Signed in with passkey "Alex\'s iPhone"', by: { memberId: 'm1' }, device: "Alex's iPhone", detail: null })),
].sort((a, b) => b.at.localeCompare(a.at))

// Trackers: a few books, memories and one checkup (dates relative to today, so "On this day" has a year-ago entry).
const daysAgo = (n: number) => dateKey(new Date(Date.now() - n * 86_400_000))
const tracker = (kind: TrackerKind, memberId: string | null, date: string, title: string | null, data: Record<string, unknown>, photoId: string | null = null): TrackerEntry =>
  ({ id: uid(), kind, memberId, formerMember: null, date, title, photoId, photoOwned: false, photoFamily: photoId ? true : null, data: data as never, createdAt: `${date}T18:00:00.000Z`, updatedAt: `${date}T18:00:00.000Z` })
// The family's library: Maya's Charlotte's Web and Matilda were started from it (bookId).
const libraryBook = (id: string, title: string, author: string, d: Partial<LibraryBook> = {}): LibraryBook => ({
  id, title, author, isbn: null, pages: null, coverUrl: null, year: null, series: null, seriesNumber: null, lexile: null, description: null, genres: [], location: null, lentTo: null, lentOn: null, borrowedFrom: null, dueOn: null, returnedOn: null,
  addedBy: { memberId: 'm1' }, readers: [], createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), updatedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), ...d,
})
const bookLibrary: LibraryBook[] = [
  libraryBook('book-charlotte', "Charlotte's Web", 'E. B. White', { isbn: '9780064400558', pages: 184, year: 1952, lexile: 680, genres: ['Fantasy', 'Animals'], location: "Maya's room", coverUrl: 'https://picsum.photos/seed/kinwall-charlotte/120/180', description: 'Some pig! A runt piglet, a clever spider and a promise to save his life.' }),
  libraryBook('book-matilda', 'Matilda', 'Roald Dahl', { isbn: '9780142410370', pages: 240, year: 1988, lexile: 840, genres: ['Fantasy', 'Humor'], location: 'Living room shelf', lentTo: 'Grandma', lentOn: daysAgo(9), coverUrl: 'https://picsum.photos/seed/kinwall-matilda/120/180' }),
  libraryBook('book-holes', 'Holes', 'Louis Sachar', { isbn: '9780440414803', pages: 233, year: 1998, lexile: 660, genres: ['Adventure', 'Mystery'], location: 'Living room shelf', description: 'There is no lake at Camp Green Lake.' }),
  libraryBook('book-warriors-1', 'Into the Wild', 'Erin Hunter', { pages: 272, year: 2003, series: 'Warriors', seriesNumber: '1', lexile: 970, genres: ['Fantasy', 'Animals'], description: 'Fire alone can save our Clan. For generations, four Clans of wild cats have shared the forest according to the laws laid down by their ancestors. But the warrior code is threatened, and the ThunderClan cats are in grave danger. When an ordinary housecat named Rusty wanders into the woods, he is invited to join the Clan as an apprentice and given a new name. Under the eye of his mentor, he learns to hunt, to fight and to keep the code, and he finds friends, rivals and a mystery that reaches back to the death of a deputy. Is he brave enough to become a true warrior, and can he find out who among the Clan cannot be trusted before it is too late?' }),
  libraryBook('book-warriors-2', 'Fire and Ice', 'Erin Hunter', { pages: 320, year: 2003, series: 'Warriors', seriesNumber: '2', lexile: 1010, genres: ['Fantasy', 'Animals'] }),
  libraryBook('book-frog', 'Frog and Toad Are Friends', 'Arnold Lobel', { pages: 64, year: 1970, lexile: 400 }),
  libraryBook('book-wonder', 'Wonder', 'R. J. Palacio', { pages: 310, year: 2012, lexile: 790, genres: ['Realistic fiction'], borrowedFrom: 'Town library', dueOn: inDays(3), location: "Maya's room" }),
  libraryBook('book-wild-robot', 'The Wild Robot', 'Peter Brown', { pages: 279, year: 2016, lexile: 740, genres: ['Science fiction', 'Animals'], wanted: true }),
  libraryBook('book-hatchet', 'Hatchet', 'Gary Paulsen', { pages: 195, year: 1987, lexile: 1020, genres: ['Adventure'], borrowedFrom: 'Town library', dueOn: daysAgo(12), returnedOn: daysAgo(14) }),
]
const withReaders = (b: LibraryBook): LibraryBook => ({
  ...b, readers: trackers.filter(t => t.kind === 'reading' && (t.data as ReadingData).bookId === b.id)
    .map(t => ({ entryId: t.id, memberId: t.memberId, status: (t.data as ReadingData).status })),
})

const trackers: TrackerEntry[] = [
  tracker('reading', 'm3', daysAgo(12), "Charlotte's Web", { author: 'E. B. White', status: 'reading', bookId: 'book-charlotte', pagesRead: 83, totalPages: 184, log: [{ date: daysAgo(9), amount: 12 }, { date: daysAgo(8), amount: 9 }, { date: daysAgo(6), amount: 15 }, { date: daysAgo(4), amount: 11 }, { date: daysAgo(3), amount: 14 }, { date: daysAgo(1), amount: 10 }, { date: daysAgo(0), amount: 12 }], coverUrl: 'https://picsum.photos/seed/kinwall-charlotte/120/180' }),
  tracker('reading', 'm3', daysAgo(40), 'Matilda', { author: 'Roald Dahl', status: 'finished', pagesRead: 240, totalPages: 240, finishedOn: daysAgo(20), rating: 5, notes: 'Loved Miss Honey.', bookId: 'book-matilda', coverUrl: 'https://picsum.photos/seed/kinwall-matilda/120/180' }),
  tracker('reading', 'm3', daysAgo(70), 'The Wild Robot', { author: 'Peter Brown', status: 'finished', pagesRead: 288, totalPages: 288, finishedOn: daysAgo(45), rating: 4 }),
  tracker('reading', 'm3', daysAgo(6), 'The Mouse and the Motorcycle', { format: 'audiobook', author: 'Beverly Cleary', narrator: 'Nora Bell', status: 'reading', minutesListened: 95, totalMinutes: 225 }),
  tracker('reading', 'm3', daysAgo(35), 'Ramona the Pest', { format: 'audiobook', author: 'Beverly Cleary', narrator: 'Nora Bell', status: 'finished', minutesListened: 250, totalMinutes: 250, finishedOn: daysAgo(28), rating: 5 }),
  tracker('reading', 'm3', daysAgo(2), 'Wonder', { author: 'R. J. Palacio', status: 'want', totalPages: 310 }),
  tracker('reading', 'm4', daysAgo(5), 'Dragon Masters', { author: 'Tracey West', status: 'reading', pagesRead: 45, totalPages: 90 }),
  tracker('reading', 'm4', daysAgo(30), 'Frog and Toad Are Friends', { author: 'Arnold Lobel', status: 'finished', pagesRead: 64, totalPages: 64, finishedOn: daysAgo(25), rating: 5 }),
  tracker('reading', 'm1', daysAgo(8), 'Project Hail Mary', { author: 'Andy Weir', status: 'reading', pagesRead: 210, totalPages: 476 }),
  tracker('memory', null, daysAgo(0), 'Pancake Saturday', { text: 'Leo flipped his first pancake and it landed in the pan!', mood: '🥞' }),
  tracker('memory', 'm3', daysAgo(1), 'Lost a tooth', { text: 'Maya lost her top tooth at lunch. The tooth fairy owes her one.', mood: '🦷' }),
  tracker('memory', null, daysAgo(3), 'River walk', { text: 'Found a heron standing on one leg.', mood: '😊' }, 'photo1015'),
  tracker('memory', 'm4', daysAgo(365), 'First day of kindergarten', { text: 'Leo waved from the door and did not look back.', mood: '🎒' }),
  tracker('health', 'm4', daysAgo(14), 'Six-year checkup', { type: 'checkup', provider: 'Dr. Patel', time: '09:30', height: { value: 45.5, unit: 'in' }, weight: { value: 46, unit: 'lb' }, notes: 'All good. Next checkup in a year.', followUp: daysAgo(-351) }),
  tracker('health', 'm3', daysAgo(-9), 'Cleaning', { type: 'dentist', provider: 'Bright Smiles Dental', time: '15:40' }),
]
// Mirrors the server: a memory owns a photo uploaded for it (family false), which the toggle shares.
const settleMockPhoto = (t: TrackerEntry, family?: boolean) => {
  const p = photos.find(x => x.id === t.photoId)
  if (!p) { t.photoOwned = false; t.photoFamily = null; return }
  if (p.family === false && !t.photoOwned) t.photoOwned = true
  if (t.photoOwned && family !== undefined) p.family = family
  t.photoFamily = p.family !== false
}
// Mirrors the server: a finished book gets today's date and its last page (or minute); null clears a field.
// The server's daily reading log (server/src/reading.ts logReading), simplified: forward progress adds to today.
const demoLog = (kind: TrackerKind, old: Record<string, unknown>, next: Record<string, unknown>) => {
  if (kind !== 'reading') return next
  const field = next.format === 'audiobook' ? 'minutesListened' : 'pagesRead'
  const delta = Number(next[field] ?? 0) - Number(old[field] ?? 0)
  const log = [...((old.log as ReadingDay[] | undefined) ?? [])]
  if (delta > 0) { const today = todayISO(); if (log.at(-1)?.date === today) log[log.length - 1] = { date: today, amount: log.at(-1)!.amount + delta }; else log.push({ date: today, amount: delta }) }
  return { ...next, ...(log.length ? { log } : {}) }
}
const trackerData = (kind: TrackerKind, data: Record<string, unknown>) => {
  const d = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined))
  return kind === 'reading' && d.status === 'finished' ? { ...d, finishedOn: d.finishedOn ?? todayISO(), ...(d.totalPages ? { pagesRead: d.totalPages } : {}), ...(d.totalMinutes ? { minutesListened: d.totalMinutes } : {}) } : d
}

// Newscast: a lively week for Our Family, laid out like the server's (routes/newscast.ts), plus
// whatever is posted or reacted in the demo. Times are hours before now, so today always has some.
type DemoPost = { id: string; memberId: string; text: string; emoji: string | null; photo: { id: string; url: string } | null; audience: 'everyone' | 'grownups'; removed: boolean; at: string }
const pic = (n: number) => ({ id: `news${n}`, url: `https://picsum.photos/id/${n}/640/480` })
const NIGHT_GARDEN = drawingPhoto('drawing-garden'), ROCKET = drawingPhoto('drawing-rocket')
const newsPosts: DemoPost[] = [
  { id: 'np1', memberId: 'm2', text: 'Pizza night is moving to Friday so we can all be home. Pick your toppings on the Groceries list!', emoji: '🍕', photo: null, audience: 'everyone', removed: false, at: hoursAgo(0.6) },
  { id: 'np2', memberId: 'm4', text: 'I lost my first tooth!!!', emoji: '🦷', photo: null, audience: 'everyone', removed: false, at: hoursAgo(22) },
  { id: 'np3', memberId: 'm1', text: "Leo's birthday is coming up. Gift ideas are on the Gifts list, shh!", emoji: '🎁', photo: null, audience: 'grownups', removed: false, at: hoursAgo(26) },
  { id: 'np4', memberId: 'm1', text: 'Grandma lands at 3 on Saturday. Who wants to come to the airport?', emoji: '✈️', photo: null, audience: 'everyone', removed: false, at: hoursAgo(4 * 24 + 3) },
  { id: 'np5', memberId: 'm3', text: 'Our class hatched ducklings today', emoji: '🐣', photo: pic(1074), audience: 'everyone', removed: false, at: hoursAgo(11 * 24) },
]
type DemoNews = Omit<NewscastItem, 'reactions' | 'post' | 'date' | 'at' | 'count' | 'photos' | 'detail'> & { ago: number; count?: number; detail?: string | null; photos?: { id: string; url: string }[]; allDay?: boolean }
const DEMO_NEWS: DemoNews[] = [
  { key: 'chores:m4:0', kind: 'chores', ago: 1, memberId: 'm4', emoji: '✅', title: 'Leo finished 4 chores', detail: 'Feed the cat · Make bed · Toys away · Water plants', count: 4 },
  { key: 'drawings:m3:0', kind: 'drawings', ago: 2.5, memberId: 'm3', emoji: '🎨', title: 'Maya saved a drawing: “Our garden at night”', photos: [NIGHT_GARDEN] },
  { key: 'book:demo1', kind: 'book', ago: 3.5, memberId: 'm3', emoji: '📚', title: "Maya finished Charlotte's Web", detail: '⭐⭐⭐⭐⭐' },
  { key: 'chores:m1:0', kind: 'chores', ago: 5, memberId: 'm1', emoji: '✅', title: 'Alex finished 2 chores', detail: 'Mow the lawn · Fix the gate', count: 2 },
  { key: 'reward:demo1', kind: 'reward', ago: 21, memberId: 'm4', emoji: '🎁', title: 'Leo got a reward: 🍦 Ice cream trip' },
  { key: 'photos:m1:1', kind: 'photos', ago: 23, memberId: 'm1', emoji: '📸', title: 'Alex added 3 photos', detail: '“Apple picking at the orchard”', count: 3, photos: [pic(1080), pic(1043), pic(1015)] },
  { key: 'chores:m3:1', kind: 'chores', ago: 25, memberId: 'm3', emoji: '✅', title: 'Maya finished 3 chores', detail: 'Set the table · Fold laundry · Feed the cat', count: 3 },
  { key: 'memory:demo1', kind: 'memory', ago: 2 * 24 + 2, memberId: 'm2', emoji: '📝', title: 'Sam added a memory', detail: '“First frost on the pumpkins”' },
  { key: 'book:demo2', kind: 'book', ago: 2 * 24 + 4, memberId: 'm4', emoji: '📚', title: 'Leo finished Frog and Toad Are Friends', detail: '⭐⭐⭐⭐' },
  { key: 'chores:m4:2', kind: 'chores', ago: 2 * 24 + 5, memberId: 'm4', emoji: '✅', title: 'Leo finished 3 chores', detail: 'Make bed · Toys away · Brush teeth', count: 3 },
  { key: 'chores:m2:2', kind: 'chores', ago: 2 * 24 + 6, memberId: 'm2', emoji: '✅', title: 'Sam finished 2 chores', detail: 'Laundry · Pay the water bill', count: 2 },
  { key: 'photos:family:3', kind: 'photos', ago: 3 * 24 + 1, memberId: null, emoji: '📸', title: '2 new photos', detail: '“Soccer Saturday”', count: 2, photos: [pic(1058), pic(1011)] },
  { key: 'reward:demo2', kind: 'reward', ago: 3 * 24 + 3, memberId: 'm3', emoji: '🎁', title: 'Maya got a reward: 🎬 Movie night pick' },
  { key: 'chores:m3:3', kind: 'chores', ago: 3 * 24 + 4, memberId: 'm3', emoji: '✅', title: 'Maya finished 5 chores', detail: 'Feed the cat · Set the table · Make bed · Piano practice · Fold laundry', count: 5 },
  { key: 'chores:m4:4', kind: 'chores', ago: 4 * 24 + 2, memberId: 'm4', emoji: '✅', title: 'Leo finished Feed the cat', count: 1 },
  { key: 'drawings:m4:5', kind: 'drawings', ago: 5 * 24 + 1, memberId: 'm4', emoji: '🎨', title: 'Leo saved a drawing: “Rocket to the moon”', photos: [ROCKET] },
  { key: 'chores:m1:5', kind: 'chores', ago: 5 * 24 + 3, memberId: 'm1', emoji: '✅', title: 'Alex finished Clean the gutters', count: 1 },
  { key: 'memory:demo2', kind: 'memory', ago: 6 * 24 + 2, memberId: null, emoji: '📝', title: 'The family added a memory', detail: '“Beach day with the cousins”', photos: [pic(1050)] },
  { key: 'chores:m3:6', kind: 'chores', ago: 6 * 24 + 4, memberId: 'm3', emoji: '✅', title: 'Maya finished 2 chores', detail: 'Feed the cat · Make bed', count: 2 },
  { key: 'book:demo3', kind: 'book', ago: 9 * 24, memberId: 'm2', emoji: '📚', title: 'Sam finished The Night Circus', detail: '⭐⭐⭐⭐⭐' },
  { key: 'chores:m4:12', kind: 'chores', ago: 12 * 24, memberId: 'm4', emoji: '✅', title: 'Leo finished 3 chores', detail: 'Make bed · Toys away · Feed the cat', count: 3 },
  { key: 'reward:demo3', kind: 'reward', ago: 16 * 24, memberId: 'm4', emoji: '🎁', title: 'Leo got a reward: 🛝 Park after school' },
]
const newsReactions = new Map<string, Map<NewscastReaction, string[]>>([
  ['post:np1', new Map([['🎉', ['m1', 'm4']], ['❤️', ['m3']]])],
  ['chores:m4:0', new Map([['👏', ['m1', 'm2']]])],
  ['drawings:m3:0', new Map([['❤️', ['m2', 'm1']]])],
  ['book:demo1', new Map([['🎉', ['m1', 'm2', 'm4']]])],
  ['post:np2', new Map([['🎉', ['m1', 'm2', 'm3']], ['❤️', ['m2']]])],
  ['photos:m1:1', new Map([['❤️', ['m2', 'm3', 'm4']]])],
  ['reward:demo1', new Map([['🎉', ['m3']]])],
] as [string, Map<NewscastReaction, string[]>][])
const NEWS_REACTIONS: NewscastReaction[] = ['👏', '❤️', '🎉']
const newsReactionsOf = (key: string) => NEWS_REACTIONS.flatMap(emoji => newsReactions.get(key)?.get(emoji)?.length ? [{ emoji, memberIds: [...newsReactions.get(key)!.get(emoji)!] }] : [])
const NEWS_FEATURE: Partial<Record<NewscastItem['kind'], () => boolean>> = {
  chores: () => settings.features.chores, reward: () => settings.features.chores, photos: () => settings.features.photos,
  drawings: () => settings.features.photos && settings.features.paint, book: () => settings.features.trackersReading, memory: () => settings.features.trackersMemories,
}
function mockNewscast(q: { days?: number; before?: string }): Newscast {
  const today = dateKey(new Date())
  const shift = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number); return dateKey(new Date(y, m - 1, dd + n)) }
  const oldest = shift(today, -29)
  const to = q.before && q.before <= today ? shift(q.before, -1) : today
  const from = [shift(to, -((q.days ?? 7) - 1)), oldest].sort()[1]
  const hidden = new Set(settings.newscastNotFeatured ?? [])
  const items: NewscastItem[] = [
    ...DEMO_NEWS.filter(d => (!d.memberId || !hidden.has(d.memberId)) && (NEWS_FEATURE[d.kind]?.() ?? true)).map(({ ago, ...d }): NewscastItem => {
      const at = hoursAgo(ago)
      return { detail: null, count: 1, photos: [], ...d, date: dateKey(new Date(at)), at, post: null, reactions: [] }
    }),
    ...newsPosts.map((p): NewscastItem => ({
      key: `post:${p.id}`, kind: 'post', date: dateKey(new Date(p.at)), at: p.at, memberId: p.memberId, emoji: '📣', title: p.removed ? 'Removed by a parent' : p.text, detail: null, count: 1,
      photos: p.photo && !p.removed ? [p.photo] : [], post: { id: p.id, text: p.removed ? null : p.text, emoji: p.removed ? null : p.emoji, audience: p.audience, removed: p.removed }, reactions: [],
    })),
  ].filter(i => i.date >= from && i.date <= to)
  for (const i of items) i.reactions = newsReactionsOf(i.key)
  items.sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? '').localeCompare(a.at ?? ''))
  return { today, from, to, earlier: from > oldest, items }
}

export const mock = {
  getContacts: async () => contacts.map(c => ({ ...c, phones: [...c.phones], emails: [...c.emails] })),
  getContactCategories: async () => [...contactCategories],
  createContact: async (body: ContactInput): Promise<Contact> => {
    const now = new Date().toISOString()
    const contact = { ...body, id: uid(), createdAt: now, updatedAt: now }
    contacts.push(contact); bump(); return contact
  },
  updateContact: async (id: string, patch: Partial<ContactInput>): Promise<Contact> => {
    const contact = contacts.find(c => c.id === id)
    if (!contact) throw new Error('Contact not found')
    Object.assign(contact, patch, { updatedAt: new Date().toISOString() }); bump(); return { ...contact }
  },
  deleteContact: async (id: string) => {
    const index = contacts.findIndex(c => c.id === id)
    if (index < 0) throw new Error('Contact not found')
    contacts.splice(index, 1); bump()
  },
  // The server's parser and duplicate rule (vcard.ts), with the API's defaults filled in.
  previewContactImport: async (body: { vcard: string } | { contacts: ContactInput[] }): Promise<{ entries: ImportPreviewEntry[] }> => {
    const drafts = 'contacts' in body ? body.contacts : parseVCards(body.vcard).map(draft => ({ ...emptyContact(), ...draft }))
    const kinded = (c: ContactInput) => ({ ...c, kind: c.kind ?? 'person' })
    return { entries: drafts.map(contact => ({ contact, duplicateIds: contacts.filter(c => duplicateScore(kinded(contact), kinded(c)) > 0).map(c => c.id) })) }
  },
  importContacts: async (body: { contacts: ContactInput[]; strategy: 'create' | 'merge'; mergeTargets?: string[] }) => {
    const ids = body.contacts.map((input, i) => {
      const target = body.strategy === 'merge' ? contacts.find(c => c.id === body.mergeTargets?.[i]) : undefined
      if (target) { Object.assign(target, { phones: [...target.phones, ...input.phones.filter(p => !target.phones.some(t => t.value === p.value))] }); return target.id }
      const contact = { ...input, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      contacts.push(contact); return contact.id
    })
    bump()
    return { created: body.strategy === 'create' ? ids.length : 0, merged: body.strategy === 'merge' ? ids.length : 0, skipped: 0, ids }
  },
  getRev: async () => ({ rev }),
  getNewscast: async (q: { days?: number; before?: string }) => mockNewscast(q),
  postNewscast: async (b: NewscastPostInput): Promise<NewscastItem> => {
    const memberId = b.memberId ?? demoOwner ?? 'm1'
    if (settings.newscastPostingPaused?.includes(memberId)) throw new Error(`${members.find(m => m.id === memberId)?.name} is taking a break from posting for now. A parent can turn it back on in Settings.`)
    const photo = b.photoId ? photos.find(p => p.id === b.photoId) : undefined
    newsPosts.push({ id: uid(), memberId, text: b.text.trim(), emoji: b.emoji ?? null, photo: photo ? { id: photo.id, url: photo.url } : null, audience: b.audience ?? 'everyone', removed: false, at: new Date().toISOString() })
    bump()
    return mockNewscast({ days: 1 }).items.find(i => i.key === `post:${newsPosts[newsPosts.length - 1].id}`)!
  },
  removeNewscastPost: async (id: string, alsoPhoto: boolean) => {
    const p = newsPosts.find(x => x.id === id)
    if (!p) throw new Error('not found')
    if (alsoPhoto && p.photo) { const i = photos.findIndex(x => x.id === p.photo!.id); if (i >= 0) photos.splice(i, 1); p.photo = null }
    // The demo is a parent's device: its own posts go, anyone else's show "Removed by a parent" to them.
    const mine = !!demoOwner && p.memberId === demoOwner
    if (mine) newsPosts.splice(newsPosts.indexOf(p), 1); else p.removed = true
    bump()
    return { ok: true as const, removed: mine ? 'deleted' as const : 'hidden' as const }
  },
  reactNewscast: async (b: { itemKey: string; emoji: NewscastReaction; on: boolean; memberId?: string }) => {
    const who = b.memberId ?? demoOwner
    if (!who) throw new Error("Pick who's reacting.")
    const byEmoji = newsReactions.get(b.itemKey) ?? new Map<NewscastReaction, string[]>()
    const ids = (byEmoji.get(b.emoji) ?? []).filter(id => id !== who)
    byEmoji.set(b.emoji, b.on ? [...ids, who] : ids)
    newsReactions.set(b.itemKey, byEmoji)
    bump()
    return { reactions: newsReactionsOf(b.itemKey) }
  },
  getNotifications: async () => [...notifications],
  // Like the server: ?before= is a cursor into the whole log, then ?kinds= and ?q= narrow it.
  getSecurityEvents: async ({ before, q = '', kinds = [] }: { before?: string; q?: string; kinds?: readonly string[] } = {}) => {
    const from = before ? securityEvents.findIndex(e => e.id === before) + 1 : 0
    return securityEvents.slice(from).filter(e => (!kinds.length || kinds.includes(e.kind)) && matchesSecurityQuery(e, q, members)).slice(0, SECURITY_PAGE)
  },
  deleteNotification: async (id: string) => { const i = notifications.findIndex(n => n.id === id); if (i >= 0) notifications.splice(i, 1); bump(); return { ok: true } },
  clearNotifications: async () => { const deleted = notifications.length; notifications.splice(0); bump(); return { ok: true as const, deleted } },
  sendNotification: async (b: { title: string; body: string; memberIds?: string[]; url?: string }) => {
    notifications.unshift({ id: uid(), at: new Date().toISOString(), kind: 'message', title: b.title, body: b.body, url: b.url ?? null, memberIds: b.memberIds ?? [], source: 'api' })
    bump()
    return { ok: true, sent: 0 }
  },

  getSettings: async (): Promise<Settings> => ({ ...settings }),
  updateSettings: async (patch: Partial<Settings>) => {
    Object.assign(settings, patch)
    if (settings.darkWithNight && settings.quietFrom && settings.quietTo) Object.assign(settings, { darkFrom: settings.quietFrom, darkTo: settings.quietTo }) // like the server
    bump(); return { ...settings }
  },
  // Demo only: the PIN is kept in memory as typed; the real server keeps only a salted hash.
  setQuietPin: async (pin: string | null) => { quietPin = pin; settings.quietPin = !!pin; bump(); return { ok: true } },
  verifyQuietPin: async (pin: string) => ({ ok: !quietPin || pin === quietPin }),

  getMembers: async () => [...members].sort((a, b) => a.sort - b.sort).map(m => {
    const tc = m.tempCheck ?? TEMP_CHECK_OFF
    return { ...m, rewardGoal: goalOf(m.id), tempCheck: tc, todayGoal: tc.on && tc.goal ? tempChecks.get(`${m.id}:${dateKey(new Date())}`)?.goal ?? null : null, privateJournal: privacyOf(m) }
  }),
  // The demo is a parent's device: it sees every answer.
  getTempCheck: async (memberId: string, date = dateKey(new Date())): Promise<TempCheck> => {
    const m = members.find(x => x.id === memberId); if (!m) throw new Error('member not found')
    const row = tempChecks.get(`${memberId}:${date}`) ?? { memberId, date, sleep: null, feelings: null, goal: null, goalSkipped: false, followup: null }
    const s = { ...TEMP_CHECK_OFF, ...m.tempCheck }
    // Last night's check-in (as the server): open until noon, a morning answer or a skip.
    const today = dateKey(new Date()), night = lastNightDate(new Date())
    const t = tempChecks.get(`${memberId}:${today}`)
    const nightRow = night ? tempChecks.get(`${memberId}:${night}`) : undefined
    const nightOpen = !!night && !lastNightSkips.has(`${memberId}:${night}`) && !(t && (t.sleep || t.feelings?.length || t.goal || t.goalSkipped))
    const asks = nightOpen && s.on && (!!s.battery || (s.goal && s.evening && !!nightRow?.goal && !nightRow.goalSkipped))
    const evening = (date === today && !asks) || (date === night && nightOpen) // any time of day in the demo, once last night's is done
    return {
      ...row, drained: row.drained ?? null, settings: s, private: false, custom: customFeelings.get(memberId) ?? [], answered: { sleep: !!row.sleep, feelings: !!row.feelings?.length, goal: !!row.goal || row.goalSkipped, followup: !!row.followup, drained: !!row.drained },
      followupOpen: s.on && s.goal && s.evening && !!row.goal && evening,
      drainedOpen: s.on && !!s.battery && evening,
      lastNight: date === today && asks ? { date: night!, pending: eveningPending(s, nightRow ?? { goal: null, goalSkipped: false, followup: null }) } : null,
    }
  },
  putTempCheck: async (memberId: string, body: TempCheckInput, date = dateKey(new Date())): Promise<TempCheck> => {
    const prev = await mock.getTempCheck(memberId, date)
    if (!prev.settings.on) throw new Error('Temp check is off for them (Settings → Family)')
    if (body.lastNightSkipped) { lastNightSkips.add(`${memberId}:${date}`); bump(); return mock.getTempCheck(memberId, date) }
    const goal = body.goalSkipped ? null : body.goal !== undefined ? body.goal?.trim() || null : prev.goal
    const feelings = body.feelings !== undefined ? (body.feelings?.length ? body.feelings : null) : prev.feelings
    const f = body.followup
    const followup = f ? (prev.settings.journal ? { outcome: f.outcome, helped: f.helped?.trim() || null, hindered: f.hindered?.trim() || null, next: f.next?.trim() || null } : { outcome: f.outcome, ...noNotes }) : prev.followup
    tempChecks.set(`${memberId}:${date}`, { memberId, date, sleep: body.sleep !== undefined ? body.sleep : prev.sleep, feelings, goal, goalSkipped: !goal && (body.goalSkipped ?? prev.goalSkipped), followup, drained: body.drained ?? prev.drained })
    const custom = body.custom ?? prev.custom ?? []
    customFeelings.set(memberId, [...custom, ...(body.feelings ?? []).filter(f => ![...FEELINGS, ...custom].some(k => k.toLowerCase() === f.toLowerCase()))])
    bump()
    return mock.getTempCheck(memberId, date)
  },
  // The demo is a parent's device: every journal opens.
  getJournal: async (memberId: string, opts: { to?: string; days?: number } = {}): Promise<Journal> => {
    const to = opts.to ?? dateKey(new Date())
    const from = dateKey(new Date(Date.parse(`${to}T12:00:00Z`) - ((opts.days ?? 60) - 1) * 86_400_000))
    const days = new Map<string, Journal['days'][number]>()
    const day = (date: string) => days.get(date) ?? days.set(date, { date, tempCheck: null, entries: [] }).get(date)!
    for (const t of tempChecks.values()) if (t.memberId === memberId && t.date >= from && t.date <= to) day(t.date).tempCheck = { sleep: t.sleep, feelings: t.feelings, goal: t.goal, goalSkipped: t.goalSkipped, followup: t.followup }
    const mine = demoOwner === memberId
    for (const e of [...journalEntries].reverse()) if (e.memberId === memberId && e.date >= from && e.date <= to) day(e.date).entries.push({ ...e, text: e.private && !mine ? null : e.text })
    const m = members.find(x => x.id === memberId)
    const p = m ? privacyOf(m) : { on: false, allowed: false }
    return { memberId, from, to, privacy: { ...p, mine, canChange: mine && p.allowed }, days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)) }
  },
  setJournalPrivacy: async (memberId: string, b: { private?: boolean; allowed?: boolean }) => {
    const m = members.find(x => x.id === memberId); if (!m) throw new Error('member not found')
    if (b.allowed !== undefined) { if (b.allowed) journalAllowed.add(memberId); else { journalAllowed.delete(memberId); journalPrivate.delete(memberId) } }
    if (b.private !== undefined) journalPrivate.set(memberId, b.private)
    bump()
    const mine = demoOwner === memberId
    const p = privacyOf(m)
    return { ...p, mine, canChange: mine && p.allowed }
  },
  myOwner: () => demoOwner,
  setMyOwner: async (owner: string) => { demoOwner = owner === 'shared' ? null : owner; bump(); return { owner } },
  // Insights: Maya's made-up history with the server's own analysis of it (mock-insights.ts); nothing yet for everyone else.
  getInsights: async (memberId: string, range: InsightRange): Promise<Insights> => {
    const n = INSIGHT_DAYS[range]
    const days = Array.from({ length: n }, (_, i) => {
      const ago = n - 1 - i
      const date = demoDay(-ago)
      const d = memberId === 'm3' ? MAYA_DAYS.find(x => x.ago === ago) : undefined
      if (!d) return blankInsightDay(date)
      const { ago: _ago, ...rest } = d
      return { ...rest, date, feelings: [...d.feelings], journalMoods: [...d.journalMoods] }
    })
    const analysis = memberId === 'm3' ? MAYA_ANALYSIS[range] : { summary: [{ id: 'checkins', text: `Checked in on 0 of ${n} days` }], topFeelings: [], connections: { ready: false, daysWithCheckIns: 0, needed: 21, list: [] } }
    return { memberId, range, from: days[0].date, to: days[n - 1].date, days, ...analysis }
  },
  // Energy battery: Maya's made-up week and a full day tomorrow (mock-insights.ts, the server's own model); off for everyone else.
  getBattery: async (memberId: string): Promise<Battery> => {
    const on = memberId === 'm3'
    return {
      memberId, on, today: demoDay(0),
      days: on ? MAYA_BATTERY.days.map(({ ago, ...d }) => ({ ...d, date: demoDay(-ago), reasons: d.reasons.map(r => ({ ...r })) })) : [],
      warnings: on ? MAYA_BATTERY.warnings.map(({ ago, ...w }) => ({ ...w, date: demoDay(-ago), suggestions: [...w.suggestions] })) : [],
    }
  },
  addJournalEntry: async (memberId: string, b: { date?: string; text: string; mood?: string | null }): Promise<JournalEntry> => {
    const now = new Date().toISOString()
    const m = members.find(x => x.id === memberId)
    const e: JournalEntry = { id: uid(), memberId, date: b.date ?? dateKey(new Date()), text: b.text.trim(), mood: b.mood ?? null, private: !!m && privacyOf(m).on, createdAt: now, updatedAt: now }
    journalEntries.push(e); bump(); return { ...e }
  },
  updateJournalEntry: async (memberId: string, id: string, b: { date?: string; text?: string; mood?: string | null }): Promise<JournalEntry> => {
    const e = journalEntries.find(x => x.id === id && x.memberId === memberId); if (!e) throw new Error('entry not found')
    Object.assign(e, { date: b.date ?? e.date, text: b.text?.trim() ?? e.text, mood: b.mood !== undefined ? b.mood : e.mood, updatedAt: new Date().toISOString() }); bump(); return { ...e }
  },
  deleteJournalEntry: async (memberId: string, id: string): Promise<void> => {
    const i = journalEntries.findIndex(x => x.id === id && x.memberId === memberId); if (i >= 0) journalEntries.splice(i, 1); bump()
  },
  getMedications: async (memberId?: string): Promise<Medication[]> => medications.filter(m => !memberId || m.memberId === memberId).map(m => ({ ...m })),
  addMedication: async (b: MedicationInput): Promise<Medication> => {
    const now = new Date().toISOString()
    const m: Medication = { id: uid(), endDate: null, totalDoses: null, lateWindow: '3h', ...b, dosesLeft: b.totalDoses ?? null, name: b.name.trim(), dose: b.dose.trim(), times: b.times, days: [...new Set(b.days)].sort(), createdAt: now, updatedAt: now }
    medications.push(m); bump(); return { ...m }
  },
  updateMedication: async (id: string, b: Partial<Omit<MedicationInput, 'memberId'>>): Promise<Medication> => {
    const m = medications.find(x => x.id === id); if (!m) throw new Error('not found')
    Object.assign(m, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)), { updatedAt: new Date().toISOString() }); if (b.totalDoses !== undefined) m.dosesLeft = b.totalDoses; bump(); return { ...m } // ponytail: the demo doesn't count doses taken
  },
  deleteMedication: async (id: string): Promise<void> => {
    const i = medications.findIndex(x => x.id === id); if (i >= 0) medications.splice(i, 1)
    for (const k of [...medLog.keys()]) if (k.startsWith(`${id}:`)) medLog.delete(k)
    bump()
  },
  deleteAllMedications: async (): Promise<{ deleted: number }> => { const deleted = medications.length; medications.length = 0; medLog.clear(); bump(); return { deleted } },
  getMedicationsDue: async (): Promise<MedicationsDue> => {
    if (!settings.medications) throw new Error('Medications are turned off')
    const date = dateKey(new Date()), now = Date.now()
    const doses = medications.flatMap(m => m.days.includes(new Date().getDay()) ? m.times.flatMap(t => {
      const time = timeKey(t)
      const e = medLog.get(`${m.id}:${date}`)?.[time]
      if (doseStatus(date, e) !== 'due' || (e?.snoozedUntil && Date.parse(e.snoozedUntil) > now)) return []
      return [{ medicationId: m.id, memberId: m.memberId, date, time, dueAt: e?.startedAt ?? new Date().toISOString(), startedAt: e?.startedAt ?? null, until: new Date(now + 3 * 3_600_000).toISOString(), name: m.name, dose: m.dose }]
    }) : [])
    const order = (id: string) => members.findIndex(x => x.id === id)
    return { names: true, doses: doses.sort((a, b) => order(a.memberId) - order(b.memberId) || a.time.localeCompare(b.time)) }
  },
  markDose: async (medicationId: string, b: { date: string; time: string; action: 'taken' | 'skipped' | 'snooze'; at?: string }): Promise<MedicationDose> => {
    const log = medLog.get(`${medicationId}:${b.date}`) ?? {}
    const kept = log[b.time]?.startedAt ? { startedAt: log[b.time].startedAt } : {}
    log[b.time] = b.action === 'snooze' ? { ...kept, snoozedUntil: new Date(Date.now() + 10 * 60_000).toISOString() } : { ...kept, status: b.action, at: b.at ?? new Date().toISOString(), by: 'This device' }
    medLog.set(`${medicationId}:${b.date}`, log); bump()
    const e = log[b.time]
    return { medicationId, date: b.date, time: b.time, status: doseStatus(b.date, e), startedAt: e.startedAt ?? null, at: e.at ?? null, late: false, by: e.by ?? null, snoozedUntil: e.snoozedUntil ?? null }
  },
  getMedicationHistory: async (memberId: string, n = 7): Promise<MedicationHistory> => {
    const mine = medications.filter(m => m.memberId === memberId)
    const days = Array.from({ length: n }, (_, i) => demoDay(i - n + 1)).map(date => ({
      date,
      doses: mine.flatMap(m => m.days.includes(new Date(`${date}T12:00:00`).getDay()) ? m.times.map(t => {
        const time = timeKey(t)
        const e = medLog.get(`${m.id}:${date}`)?.[time]
        const dueAt = e?.startedAt ?? new Date(`${date}T${typeof t === 'string' ? t : t.latest}:00`).toISOString()
        const late = e?.status === 'taken' && !!e.at && Date.parse(e.at) > Date.parse(dueAt) + 3 * 3_600_000 // ponytail: the demo's late window is always 3 hours
        return { medicationId: m.id, time, dueAt, status: doseStatus(date, e), startedAt: e?.startedAt ?? null, at: e?.at ?? null, late, by: e?.by ?? null }
      }) : []).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    }))
    return { memberId, today: dateKey(new Date()), medications: mine.map(m => ({ ...m })), days }
  },
  createMember: async (m: Partial<Member>) => {
    const nm: Member = { id: uid(), name: m.name ?? 'New', color: m.color ?? '#FF9E7A', avatar: m.avatar ?? '🙂', birthday: m.birthday ?? null, grownUp: !!m.grownUp, needsApproval: !m.grownUp && !!m.needsApproval, sort: members.length, pointsToday: 0, pointsWeek: 0, balance: 0 }
    members.push(nm); bump(); return nm
  },
  updateMember: async (id: string, patch: Partial<Member>) => {
    const m = members.find(x => x.id === id); if (!m) throw new Error('not found')
    Object.assign(m, patch); if (m.grownUp) m.needsApproval = false; bump(); return m
  },
  deleteMember: async (id: string) => {
    const i = members.findIndex(x => x.id === id)
    for (const t of trackers) if (t.memberId === id) Object.assign(t, { memberId: null, formerMember: members[i]?.name ?? null }) // kept under their name
    if (i >= 0) members.splice(i, 1); bump()
  },

  getSnapshot: async (memberId: string, range: 'day' | 'week'): Promise<Snapshot> => mockSnapshot(memberId, range),
  getBoard: async (days: number): Promise<Board> => mockBoard(days),
  // The demo shows the online sources with a fixed sample (it never calls Wikipedia or Open Trivia DB).
  getTidbits: async (): Promise<OnlineTidbits> => ({
    date: new Date().toISOString().slice(0, 10),
    onThisDay: [
      { kind: 'holidays', text: 'European Day of Languages', year: null },
      { kind: 'births', text: 'George Gershwin, American composer and pianist', year: 1898 },
      { kind: 'births', text: 'Serena Williams, American tennis player', year: 1981 },
    ],
    trivia: [
      { question: 'Wombats are native to which country?', answer: 'Australia', choices: ['New Zealand', 'Australia', 'Papua New Guinea', 'Palau'], category: 'Animals' },
      { question: 'What is the closest planet to the Sun?', answer: 'Mercury', choices: ['Venus', 'Mars', 'Mercury', 'Earth'], category: 'Science & Nature' },
    ],
  }),
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

  getEvents: async (from: string, to: string, calendarId?: string, includeHidden?: boolean) => events
    .filter(e => e.start < to && e.end > from && (!calendarId || e.calendarId === calendarId))
    .map(e => ({ ...e, hidden: hiddenWhy(e) })).filter(e => includeHidden || !e.hidden)
    .sort((a, b) => a.start.localeCompare(b.start))
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
      busy: body.busy !== false,
    }
    events.push(ev); bump(); return withLeave(ev)
  },
  updateEvent: async (id: string, patch: Partial<EventInstance>) => {
    const e = events.find(x => x.id === id); if (!e) throw new Error('not found')
    Object.assign(e, patch); bump(); return withLeave(e)
  },
  deleteEvent: async (id: string) => { const i = events.findIndex(x => x.id === id); if (i >= 0) events.splice(i, 1); bump() },
  hideEvent: async (id: string, scope: 'occurrence' | 'series', occurrenceStart?: string | null): Promise<HiddenEvent> => {
    const e = events.find(x => x.id === id); if (!e) throw new Error('not found')
    const h = hideInMock({ ...e, occurrenceStart: occurrenceStart ?? e.occurrenceStart }, scope); bump(); return h
  },
  unhideEvent: async (id: string, scope: 'occurrence' | 'series', occurrenceStart?: string | null) => {
    const e = events.find(x => x.id === id); if (!e) throw new Error('not found')
    const keys = hideKeys({ ...e, occurrenceStart: occurrenceStart ?? e.occurrenceStart })
    const i = hiddenEvents.findIndex(h => h.calendarId === e.calendarId && h.scope === scope && h.key === (scope === 'series' ? keys.series : keys.occurrence))
    if (i >= 0) hiddenEvents.splice(i, 1)
    bump(); return { ok: true }
  },
  getHiddenEvents: async (calendarId: string): Promise<HiddenEvent[]> => hiddenEvents.filter(h => h.calendarId === calendarId).sort((a, b) => a.start.localeCompare(b.start)).map(({ key: _, ...h }) => h),
  showHiddenEvent: async (_calendarId: string, hiddenId: string) => { const i = hiddenEvents.findIndex(h => h.id === hiddenId); if (i >= 0) hiddenEvents.splice(i, 1); bump(); return { ok: true } },

  getChoresDay: async (date: string): Promise<ChoreDay[]> => chores.filter(c => c.active && (c.rrule || !c.dueDate || c.dueDate === date)).map(c => {
    const comp = completions.get(`${c.id}:${date}`)
    const list = c.listId ? lists.find(l => l.id === c.listId) : undefined
    const its = list ? listItems.filter(i => i.listId === list.id && (!c.memberId || !i.memberId || i.memberId === c.memberId)) : []
    return { ...c, completed: !!comp, completedAt: comp?.completedAt ?? null, completedBy: comp?.memberId ?? null, checklist: list ? { listId: list.id, name: list.name, total: its.length, done: its.filter(i => i.done).length } : null, activity: null }
  }),
  createChore: async (body: Partial<Chore>) => {
    const nc: Chore = { id: uid(), title: body.title ?? 'New chore', emoji: body.emoji ?? '⭐', memberId: body.memberId ?? null, points: body.points ?? 5, rrule: body.rrule ?? null, dueDate: body.dueDate ?? null, dueTime: body.dueTime ?? null, active: true, sort: chores.length, listId: body.listId ?? null, pluginId: body.pluginId ?? null, pluginMinutes: body.pluginId ? body.pluginMinutes ?? 5 : null, needsApproval: body.needsApproval ?? null, libraryId: body.libraryId ?? null }
    chores.push(nc); bump(); return nc
  },
  updateChore: async (id: string, patch: Partial<Chore>) => {
    const c = chores.find(x => x.id === id); if (!c) throw new Error('not found')
    Object.assign(c, patch); bump(); return c
  },
  deleteChore: async (id: string) => { const i = chores.findIndex(x => x.id === id); if (i >= 0) chores.splice(i, 1); bump() },
  getChoreLibrary: async () => library.map(libraryView).sort((a, b) => a.title.localeCompare(b.title)),
  createLibraryChore: async (body: LibraryChoreInput) => {
    const from = body.fromChoreId ? chores.find(c => c.id === body.fromChoreId) : undefined
    const row = libraryRow(body, from); library.push(row)
    if (from) from.libraryId = row.id
    bump(); return libraryView(row)
  },
  updateLibraryChore: async (id: string, body: LibraryChoreInput) => {
    const row = library.find(l => l.id === id); if (!row) throw new Error('not found')
    Object.assign(row, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))); bump(); return libraryView(row)
  },
  deleteLibraryChore: async (id: string) => {
    const i = library.findIndex(l => l.id === id); if (i >= 0) library.splice(i, 1)
    for (const c of chores) if (c.libraryId === id) c.libraryId = null
    bump(); return { ok: true }
  },
  assignLibraryChore: async (id: string, body: { date: string; memberId?: string | null; rrule?: string | null }) => {
    const l = library.find(x => x.id === id); if (!l) throw new Error('not found')
    const c: Chore = { id: uid(), title: l.title, emoji: l.emoji ?? '⭐', memberId: body.memberId !== undefined ? body.memberId : l.memberId, points: l.points, rrule: body.rrule ?? null, dueDate: body.date, dueTime: null, active: true, sort: chores.length, listId: l.listId, pluginId: null, pluginMinutes: null, needsApproval: l.needsApproval, libraryId: l.id }
    chores.push(c); bump(); return c
  },
  completeChore: async (id: string, date: string, memberId?: string) => {
    const c = chores.find(x => x.id === id)
    if (c?.listId) {
      const mine = (i: ListItem) => i.listId === c.listId && (!c.memberId || !i.memberId || i.memberId === c.memberId)
      const open = listItems.filter(i => mine(i) && !i.done)
      if (open.length) throw new Error(`Checklist not finished (${open.length} left)`)
      if (lists.find(l => l.id === c.listId)?.kind === 'reusable') listItems = listItems.map(i => mine(i) ? { ...i, done: false, doneAt: null, doneBy: null } : i)
    }
    completions.set(`${id}:${date}`, { completedAt: new Date().toISOString(), memberId: memberId ?? null }); bump()
  },
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

  getRewards: async ({ memberId, archived }: { memberId?: string; archived?: boolean } = {}) =>
    rewards.filter(r => (archived || r.active) && (!memberId || !r.memberIds.length || r.memberIds.includes(memberId)))
      .map(r => ({ ...r, used: memberId && r.limit ? usedOf(r, memberId) : 0 })),
  createReward: async (body: Partial<Reward>) => {
    const r: Reward = { id: uid(), title: body.title ?? 'Reward', emoji: body.emoji ?? null, cost: body.cost ?? 10, memberIds: body.memberIds ?? [], needsApproval: body.needsApproval ?? true, limit: body.limit ?? null, active: body.active ?? true, sort: rewards.length, createdAt: new Date().toISOString() }
    rewards.push(r); bump(); return r
  },
  updateReward: async (id: string, patch: Partial<Reward>) => {
    const r = rewards.find(x => x.id === id); if (!r) throw new Error('not found')
    Object.assign(r, patch); bump(); return { ...r }
  },
  deleteReward: async (id: string) => { rewards.splice(rewards.findIndex(r => r.id === id), 1); bump() },
  redeemReward: async (id: string, memberId: string) => {
    const r = rewards.find(x => x.id === id), m = members.find(x => x.id === memberId)
    if (!r || !m) throw new Error('not found')
    if (m.balance < r.cost) throw new Error('Not enough points')
    if (r.limit && usedOf(r, memberId) >= r.limit.count) throw new Error(`That's all for ${r.limit.period === 'day' ? 'today' : 'this week'}`)
    m.balance -= r.cost
    const red = redemption(r, memberId, r.needsApproval ? 'pending' : 'approved', 0)
    redemptions.unshift(red); bump()
    return { redemption: red, balance: m.balance }
  },
  getRedemptions: async ({ memberId, status }: { memberId?: string; status?: string } = {}) =>
    redemptions.filter(r => (!memberId || r.memberId === memberId) && (!status || status.split(',').includes(r.status))),
  decideRedemption: async (id: string, action: 'approve' | 'decline' | 'given', note?: string) => {
    const r = redemptions.find(x => x.id === id); if (!r) throw new Error('not found')
    if (action === 'decline') { members.find(m => m.id === r.memberId)!.balance += r.cost; Object.assign(r, { status: 'declined', note: note ?? null }) }
    else Object.assign(r, { status: action === 'approve' ? 'approved' : 'given' })
    bump(); return { ...r }
  },
  cancelRedemption: async (id: string) => {
    const i = redemptions.findIndex(x => x.id === id && x.status === 'pending'); if (i < 0) throw new Error('Not waiting any more')
    const m = members.find(x => x.id === redemptions[i].memberId)!
    m.balance += redemptions[i].cost; redemptions.splice(i, 1); bump()
    return { ok: true, balance: m.balance }
  },
  setRewardGoal: async (memberId: string, rewardId: string | null) => { goals.set(memberId, rewardId); bump(); return { rewardId } },

  getStickerPacks: async (memberId: string) => STICKER_PACKS.map(packFor(memberId)),
  checkIn: async (memberId: string) => {
    const m = members.find(x => x.id === memberId); if (!m) throw new Error('not found')
    if (!settings.checkInPoints) throw new Error('Daily check-ins are turned off')
    const date = dateKey(new Date()), key = `${memberId}:${date}`
    const awarded = checkIns.has(key) ? 0 : settings.checkInPoints
    if (awarded) { checkIns.add(key); m.balance += awarded; bump() }
    return { date, points: settings.checkInPoints, awarded, balance: m.balance }
  },
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
  getGooglePhotos: async () => googleStatus(),
  connectGooglePhotos: async () => { googleAt = Date.now(); return googleStatus() },
  disconnectGooglePhotos: async () => { googleAt = 0; return googleStatus() },
  nextGooglePhoto: async (w: number, h: number) => {
    if (googleState() !== 'ready') throw new Error('Google Photos is not ready')
    return { src: `https://picsum.photos/id/${DEMO_GOOGLE[googleN++ % DEMO_GOOGLE.length]}/${w}/${h}`, revoke: false, caption: 'Demo Google Photos' }
  },
  getPhotos: async () => photos.filter(p => p.family !== false),
  photoUrl: (id: string) => photos.find(p => p.id === id)?.url ?? '',
  getPhotoQuota: async (): Promise<PhotoQuota> => ({ count: photos.length, bytes: photos.reduce((n, p) => n + p.bytes, 0), memoryPhotos: photos.filter(p => p.family === false).length, ...PHOTO_LIMITS }),
  uploadPhoto: async (blob: Blob, width: number, height: number, caption?: string, family = true) => {
    const p: Photo = { id: uid(), caption: caption?.trim() || null, mime: blob.type, width, height, bytes: blob.size, memberId: null, createdAt: new Date().toISOString(), url: URL.createObjectURL(blob), family }
    photos.unshift(p); bump(); return p
  },
  updatePhoto: async (id: string, body: { caption?: string | null; memberId?: string | null }) => {
    const p = photos.find(x => x.id === id); if (!p) throw new Error('not found')
    if (body.caption !== undefined) p.caption = body.caption?.trim() || null
    if (body.memberId !== undefined) p.memberId = body.memberId
    bump(); return { ...p }
  },
  importPhotos: async () => ({ imported: 0, skipped: 0 }),
  getColoringPages: async () => [...coloringPages],
  addColoringPage: async (png: Blob, width: number, height: number, name: string) => {
    const p: FamilyColoringPage = { id: uid(), name: name.trim() || 'Coloring page', width, height, createdAt: new Date().toISOString(), url: URL.createObjectURL(png) }
    coloringPages.unshift(p); bump(); return p
  },
  deleteColoringPage: async (id: string) => { const i = coloringPages.findIndex(x => x.id === id); if (i >= 0) coloringPages.splice(i, 1); bump(); return { ok: true } },
  deletePhoto: async (id: string) => { const i = photos.findIndex(x => x.id === id); if (i >= 0) photos.splice(i, 1); bump(); return { ok: true } },
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

  getKeys: async (): Promise<ApiKey[]> => [
    { id: 'k1', name: 'Kitchen wall', prefix: 'kw_ab12', scope: 'display', createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString(), owner: 'shared', kind: 'wall' },
    { id: 'k2', name: "Leo's tablet", prefix: 'kw_cd34', scope: 'display', createdAt: new Date().toISOString(), lastUsedAt: null, owner: 'm4', kind: 'kid' },
    { id: 'k3', name: 'Widgets on Android', prefix: 'kw_ef56', scope: 'display', createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString(), owner: 'm4', kind: 'widgets', parentKeyId: 'k2' },
  ],
  createKey: async (name: string) => ({ id: uid(), name, key: 'kw_' + uid().replace(/-/g, '').slice(0, 24) }),
  deleteKey: async (_id: string) => {},

  getLists: async (archived?: boolean) => lists.filter(l => archived ? true : !l.archived).sort(byListOrder),
  reorderLists: async (ids: string[]) => {
    reorderWithin(lists, ids).forEach((id, i) => { lists.find(l => l.id === id)!.sort = i })
    bump(); return { ok: true }
  },
  createList: async (body: Partial<List>): Promise<List> => {
    const nl: List = {
      id: uid(), name: body.name ?? 'New list', emoji: body.emoji ?? '📝', color: body.color ?? '#FF9E7A',
      kind: body.kind ?? 'todo', catalog: body.kind === 'shopping' ? body.catalog ?? 'groceries' : null, memberIds: body.memberIds ?? [], groupBy: body.groupBy ?? (body.kind === 'shopping' ? 'aisle' : 'none'), sortBy: body.sortBy ?? (body.kind === 'shopping' ? 'aisle' : 'manual'),
      keepChecked: body.keepChecked ?? body.kind !== 'todo',
      sort: Math.max(-1, ...lists.map(l => l.sort)) + 1, archived: false, createdAt: new Date().toISOString(), itemCount: 0, openCount: 0,
    }
    lists.push(nl); bump(); return nl
  },
  getList: async (id: string, store?: string) => {
    const l = lists.find(x => x.id === id); if (!l) throw new Error('not found')
    const order = aisleOrderMap({ aisleOrder })
    const items = listItems.filter(i => i.listId === id).sort(compareItems(l.sortBy, dateKey(new Date()), { keepChecked: l.keepChecked, aisleOrder: order }))
      .map(i => ({ ...i, noteCount: noteCount('list_item', i.id), ...(l.kind === 'shopping' ? { places: placesOf(i.title, catalogOf(id)) } : {}) }))
    const groups = listGroups.filter(g => g.name) // per-list groups aren't keyed by list in this fixture; kept simple for demo
    const known = [...listItems, ...remembered].filter(inCatalog(catalogOf(id)))
    const uniq = (v: (string | null)[]) => [...new Set(v.filter((x): x is string => !!x))].sort()
    const stores = uniq([...known.map(i => i.store), ...aisleOrder.map(o => o.store)])
    const categories = uniq(known.map(i => i.category))
    const aisles = [...new Map([...known.filter(i => i.aisle).map(i => ({ store: i.store, aisle: i.aisle! })), ...aisleOrder.flatMap(o => o.aisles.map(aisle => ({ store: o.store, aisle })))]
      .map(a => [`${a.store}|${a.aisle}`, a])).values()]
    // Like the server: suggestions only on shopping lists.
    const suggestions = l.kind === 'shopping' ? { stores, categories, aisles, items: nameSuggestions(catalogOf(id)) } : { stores: [], categories: [], aisles: [] }
    // A one-store trip: the other type's lists' items for that store (the server's alsoAtStore, roughly).
    const alsoAtStore = !store || l.kind !== 'shopping' ? undefined : lists
      .filter(o => o.id !== id && o.kind === 'shopping' && !o.archived && catalogOf(o.id) !== catalogOf(id))
      .flatMap(o => listItems.filter(i => i.listId === o.id && (i.store === store || (!i.store && placesOf(i.title, catalogOf(o.id)).some(p => p.store === store))))
        .map(i => ({ ...i, listName: o.name, places: placesOf(i.title, catalogOf(o.id)).filter(p => p.store === store) })))
    return { list: l, items, groups, suggestions, aisleOrder, ...(alsoAtStore ? { alsoAtStore } : {}) }
  },
  updateList: async (id: string, patch: Partial<List>) => {
    const l = lists.find(x => x.id === id); if (!l) throw new Error('not found')
    // One default per shopping type, like the server.
    if (patch.isDefault) for (const o of lists) if (o.id !== id && o.kind === 'shopping' && (o.catalog ?? 'groceries') === (l.catalog ?? 'groceries')) o.isDefault = false
    Object.assign(l, patch, patch.kind && patch.kind !== 'shopping' ? { catalog: null } : patch.kind === 'shopping' && !l.catalog ? { catalog: patch.catalog ?? 'groceries' } : {}); bump(); return l
  },
  deleteList: async (id: string) => {
    const i = lists.findIndex(x => x.id === id); if (i >= 0) lists.splice(i, 1)
    listItems = listItems.filter(x => x.listId !== id); bump()
  },
  // Demo scanning: the family's names learned from adds, else a few products standing in for Open Food Facts.
  lookupBarcode: async (_listId: string, code: string): Promise<BarcodeLookup | null> =>
    demoBarcodes.has(code) ? { title: demoBarcodes.get(code)!, source: 'family' } : DEMO_PRODUCTS[code] ? { title: DEMO_PRODUCTS[code][0], source: DEMO_PRODUCTS[code][1] } : null,
  addListItems: async (listId: string, body: ListItemInput | ListItemInput[]): Promise<ListItem[]> => {
    const inputs = Array.isArray(body) ? body : [body]
    for (const input of inputs) if (input.barcode) demoBarcodes.set(input.barcode, input.title.trim())
    const maxSort = Math.max(-1, ...listItems.filter(i => i.listId === listId).map(i => i.sort))
    const created = inputs.map((input, idx) => {
      // "remembers where things go" (shopping lists): omitted store/category/aisle (undefined) come
      // from the most recently updated same-name item, even a checked-out one; null means "none".
      const shopping = lists.find(l => l.id === listId)?.kind === 'shopping'
      const known = shopping ? [...listItems, ...remembered].filter(inCatalog(catalogOf(listId))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter(i => sameName(i.title, input.title)) : []
      const store = input.store !== undefined ? input.store : (known[0]?.store ?? null)
      const item: ListItem = {
        id: input.id ?? uid(), listId, title: input.title.trim(), notes: input.notes ?? null,
        quantity: input.quantity ?? null,
        store,
        category: input.category !== undefined ? input.category : (known[0]?.category ?? null),
        aisle: input.aisle !== undefined ? input.aisle : (known.find(i => i.store === store)?.aisle ?? null),
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
  updateListItem: async (listId: string, itemId: string, { aisleStore, ...patch }: ListItemPatch) => {
    const i = listItems.find(x => x.id === itemId && x.listId === listId); if (!i) throw new Error('not found')
    // A trip's aisle: remembered for that store; the item takes it only if planned there or anywhere.
    if (aisleStore && patch.aisle !== undefined) {
      if (patch.aisle) { seenAt(i.title, aisleStore, patch.aisle, listId); remembered.at(-1)!.updatedAt = iso() }
      const planned = patch.store !== undefined ? patch.store : i.store
      if (planned && planned !== aisleStore) delete patch.aisle
    }
    if (patch.done !== undefined) {
      i.doneAt = patch.done ? new Date().toISOString() : null
      i.doneBy = patch.done ? (patch.doneBy ?? null) : null
      i.checkedBy = patch.done && patch.doneBy ? { memberId: patch.doneBy } : null // the demo doesn't know whose device this is
    }
    Object.assign(i, patch, { updatedAt: new Date().toISOString() })
    if (patch.done !== undefined) { i.steps.forEach(st => { st.done = !!patch.done }); withStepCounts(i) }
    recomputeListCounts(listId); bump(); return i
  },
  // Demo lookup: a few classics, no network. picsum stands in for the covers (the demo CSP allows it).
  searchBooks: async (q: string): Promise<BookResult[]> => DEMO_BOOKS.filter(b => `${b.title} ${b.author} ${b.isbn ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())).map(({ isbn: _isbn, ...b }) => b),
  getTrackers: async (kind: TrackerKind) => trackers.filter(t => t.kind === kind).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
  addTracker: async (body: TrackerInput & { kind: TrackerKind }) => {
    const t = tracker(body.kind, body.memberId ?? null, body.date ?? todayISO(), body.title?.trim() || null, trackerData(body.kind, body.data ?? {}), body.photoId ?? null)
    t.createdAt = t.updatedAt = new Date().toISOString()
    trackers.push(t); settleMockPhoto(t, body.photoFamily); bump(); return t
  },
  updateTracker: async (id: string, body: TrackerInput) => {
    const t = trackers.find(x => x.id === id)
    if (!t) throw new Error('not found')
    Object.assign(t, {
      ...(body.memberId !== undefined && { memberId: body.memberId }), ...(body.date && { date: body.date }),
      ...(body.title !== undefined && { title: body.title?.trim() || null }), ...(body.photoId !== undefined && { photoId: body.photoId }),
      ...(body.memberId !== undefined && { formerMember: null }),
      data: demoLog(t.kind, t.data as unknown as Record<string, unknown>, trackerData(t.kind, { ...t.data, ...body.data })), updatedAt: new Date().toISOString(),
    })
    settleMockPhoto(t, body.photoFamily); bump(); return { ...t }
  },
  getLibrary: async (q?: { q?: string; unread?: boolean; lent?: boolean; borrowed?: boolean; returned?: boolean; wanted?: boolean; location?: string }): Promise<LibraryBook[]> => {
    const needle = q?.q?.trim().toLowerCase()
    const books = bookLibrary.map(withReaders)
      .filter(b => (q?.returned ? !!b.returnedOn : !b.returnedOn) && (q?.wanted ? !!b.wanted : !b.wanted) && (!q?.borrowed || !!b.borrowedFrom))
      .filter(b => !needle || [b.title, b.author, b.series, b.location, b.lentTo, b.borrowedFrom, ...b.genres].some(v => v?.toLowerCase().includes(needle)))
      .filter(b => (!q?.unread || !b.readers.length) && (!q?.lent || b.lentTo) && (!q?.location || b.location === q.location))
      .sort((a, b) => (a.series ?? a.title).localeCompare(b.series ?? b.title, undefined, { sensitivity: 'base' }) || Number(a.seriesNumber ?? 0) - Number(b.seriesNumber ?? 0) || a.title.localeCompare(b.title))
    return q?.borrowed ? books.sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999')) : books
  },
  // Demo lookups by ISBN come from the demo book search's ISBNs.
  addToLibrary: async (input: LibraryBookInput): Promise<LibraryBook> => {
    const have = input.isbn ? bookLibrary.find(b => b.isbn === input.isbn) : undefined
    if (have) throw new Error(`Already in the library: ${have.title}`)
    const found = !input.title && input.isbn ? DEMO_BOOKS.find(b => b.isbn === input.isbn) : undefined
    if (!input.title && !found) throw new Error("Couldn't find that book")
    const { workKey: _w, ...fields } = input
    const book = libraryBook(uid(), (input.title ?? found!.title).trim(), input.author ?? found?.author ?? '', { ...(found && { pages: found.pages ?? null, coverUrl: found.coverUrl ?? null, year: found.year ?? null }), ...fields, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    bookLibrary.push(book); bump(); return book
  },
  updateLibraryBook: async (id: string, changes: LibraryBookInput): Promise<LibraryBook> => {
    const b = bookLibrary.find(x => x.id === id); if (!b) throw new Error('not found')
    const { workKey: _w, ...fields } = changes
    // Lent: dated today unless given; back home clears the date, like the server.
    const lentOn = changes.lentTo === null || changes.lentTo === '' ? null : changes.lentOn ?? (changes.lentTo && changes.lentTo !== b.lentTo ? todayISO() : b.lentOn)
    Object.assign(b, fields, { lentTo: changes.lentTo !== undefined ? changes.lentTo || null : b.lentTo, lentOn, updatedAt: new Date().toISOString() })
    if (changes.borrowedFrom === null || changes.borrowedFrom === '') Object.assign(b, { borrowedFrom: null, dueOn: null, returnedOn: null }) // made our own
    if (changes.borrowedFrom) b.wanted = false // borrowing it: had, for now
    bump(); return withReaders(b)
  },
  deleteLibraryBook: async (id: string) => { const i = bookLibrary.findIndex(x => x.id === id); if (i >= 0) bookLibrary.splice(i, 1); bump() },
  deleteTracker: async (id: string) => { const i = trackers.findIndex(x => x.id === id); if (i >= 0) trackers.splice(i, 1); bump() },
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
  moveListItems: async (listId: string, itemIds: string[], toListId: string) => {
    const moved = listItems.filter(i => i.listId === listId && itemIds.includes(i.id))
    const top = Math.max(-1, ...listItems.filter(i => i.listId === toListId).map(i => i.sort))
    moved.forEach((i, n) => Object.assign(i, { listId: toListId, sort: top + 1 + n, updatedAt: iso() }))
    recomputeListCounts(listId); recomputeListCounts(toListId); bump(); return moved
  },
  deleteListItem: async (listId: string, itemId: string) => {
    const i = listItems.findIndex(x => x.id === itemId && x.listId === listId)
    if (i >= 0) listItems.splice(i, 1)
    recomputeListCounts(listId); bump()
  },
  clearListCompleted: async (listId: string, itemIds?: string[], store?: string) => {
    const before = listItems.length
    const gone = (i: ListItem) => i.listId === listId && i.done && (!itemIds || itemIds.includes(i.id))
    // Bought on a trip: remembered at that store, keeping the aisle known there.
    remembered.push(...listItems.filter(gone).map(i => ({ ...i, updatedAt: iso(), ...(store ? { store, aisle: placesOf(i.title, catalogOf(listId)).find(p => p.store === store)?.aisle ?? null } : {}) })))
    listItems = listItems.filter(i => !gone(i))
    recomputeListCounts(listId); bump()
    return { deleted: before - listItems.length }
  },
  renameListValue: async ({ field, from, to, store, catalog }: { field: 'store' | 'category' | 'aisle'; from: string; to: string | null; store?: string | null; catalog?: ListCatalog }) => {
    let updated = 0
    for (const i of [...listItems, ...remembered].filter(i => field !== 'category' || !catalog || inCatalog(catalog)(i))) {
      if (i[field] !== from || (field === 'aisle' && i.store !== (store ?? null))) continue
      i[field] = to; if (listItems.includes(i)) updated++
    }
    if (field === 'store') aisleOrder = to ? aisleOrder.map(o => o.store === from ? { ...o, store: to } : o) : aisleOrder.filter(o => o.store !== from)
    if (field === 'aisle') aisleOrder = aisleOrder.map(o => o.store !== (store ?? null) ? o : { ...o, aisles: to ? o.aisles.map(a => a === from ? to : a) : o.aisles.filter(a => a !== from) })
    bump(); return { updated }
  },
  // The catalogs (one per shopping list type): seeded from what's remembered above, then edited on their own (roughly the server's).
  getRemembered: async (catalog: ListCatalog) => [...mockCatalog(catalog).values()].sort((a, b) => a.title.localeCompare(b.title)).map(i => ({ ...i, places: [...i.places] })),
  addRemembered: async (catalog: ListCatalog, body: RememberedItemInput & { title: string }) => {
    const key = itemKey(body.title), cat = mockCatalog(catalog)
    if (cat.has(key)) throw new Error(`Already in the catalog as ${cat.get(key)!.title}`)
    cat.set(key, { key, title: body.title.trim(), uses: 0, lastUsed: iso(), category: null, places: [], lastStore: null, tags: [] })
    return mock.updateRemembered(catalog, key, body)
  },
  updateRemembered: async (catalog: ListCatalog, key: string, body: RememberedItemInput) => {
    const cat = mockCatalog(catalog), was = cat.get(key)
    if (!was) throw new Error('not found')
    const to = body.title ? itemKey(body.title) : key
    if (to !== key && cat.has(to)) throw new Error(`Already in the catalog as ${cat.get(to)!.title}`)
    const places = body.places ? body.places.map(p => ({ ...p, updatedAt: was.places.find(w => w.store === p.store)?.updatedAt ?? iso() })).sort((a, b) => a.store.localeCompare(b.store)) : was.places
    const item: RememberedItem = { ...was, key: to, title: body.title?.trim() ?? was.title, category: body.category !== undefined ? body.category : was.category, places,
      tags: body.tags ? tagsInput(body.tags, [...cat.values()].filter(i => i.key !== key).flatMap(i => i.tags)) : was.tags,
      lastStore: places.some(p => p.store === was.lastStore) ? was.lastStore : places[0]?.store ?? null }
    cat.delete(key); cat.set(to, item)
    const listId = lists.find(l => l.kind === 'shopping' && catalogOf(l.id) === catalog)?.id ?? 'l1'
    for (const p of item.places) seenAt(item.title, p.store, p.aisle, listId) // so adds and the aisle pickers use it
    remembered.forEach(r => { if (itemKey(r.title) === to && item.category && inCatalog(catalog)(r)) r.category = item.category })
    bump(); return item
  },
  renameCatalogTag: async (catalog: ListCatalog, from: string, to: string | null) => {
    let updated = 0
    for (const i of mockCatalog(catalog).values()) {
      if (!i.tags.some(t => t.toLowerCase() === from.toLowerCase())) continue
      updated++
      i.tags = tagsInput(i.tags.map(t => (t.toLowerCase() === from.toLowerCase() ? to ?? '' : t)), [])
    }
    bump(); return { updated }
  },
  forgetItemName: async (catalog: ListCatalog, key: string) => {
    forgotten.add(`${catalog}:${key}`); mockCatalog(catalog).delete(key); remembered = remembered.filter(i => itemKey(i.title) !== key || !inCatalog(catalog)(i)); bump(); return { ok: true }
  },
  setStoreAisles: async (store: string | null, aisles: string[]) => {
    aisleOrder = [...aisleOrder.filter(o => o.store !== store), ...(aisles.length ? [{ store, aisles }] : [])]
    bump(); return { store, aisles }
  },
  resetList: async (listId: string, itemIds?: string[]) => {
    const items = listItems.filter(i => i.listId === listId && i.done && (!itemIds || itemIds.includes(i.id)))
    items.forEach(i => { i.done = false; i.doneAt = null; i.doneBy = null; i.checkedBy = null })
    const list = lists.find(l => l.id === listId)
    if (list?.kind === 'reusable' && !itemIds && items.length) Object.assign(list, { lastDoneAt: new Date().toISOString(), lastDoneBy: null })
    ;(itemIds ? items : listItems.filter(i => i.listId === listId)).forEach(i => { i.steps.forEach(st => { st.done = false }); withStepCounts(i) })
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

const DEMO_PRODUCTS: Record<string, [string, BarcodeLookup['source']]> = { '0016000275287': ['Honey Nut Cheerios', 'openfoodfacts'], '0041196910759': ['Organic Whole Milk', 'openfoodfacts'], '0037000862246': ['Bounty Paper Towels', 'openproductsfacts'] }
const demoBarcodes = new Map<string, string>()

const DEMO_BOOKS: (BookResult & { isbn?: string })[] = [
  { title: "Charlotte's Web", author: 'E. B. White', year: 1952, pages: 184, isbn: '9780064400558', coverUrl: 'https://picsum.photos/seed/kinwall-charlotte/120/180' },
  { title: 'Matilda', author: 'Roald Dahl', year: 1988, pages: 240, coverUrl: 'https://picsum.photos/seed/kinwall-matilda/120/180' },
  { title: 'The Wild Robot', author: 'Peter Brown', year: 2016, pages: 288, isbn: '9780316381994', coverUrl: 'https://picsum.photos/seed/kinwall-robot/120/180' },
  { title: 'Holes', author: 'Louis Sachar', year: 1998, pages: 233 },
]

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
  const all = eventsThrough(last)
  const mine = all.filter(e => !isBday(e) && (e.memberIds.length === 0 || e.memberIds.includes(memberId)))
  const birthdays = birthdaysOn(dates, all)
  const choreRows = (range === 'week' ? dates : [today]).flatMap(date => chores.filter(c => c.active && (c.memberId === memberId || !c.memberId) && dueOn(c, date, today))
    .map(c => ({ id: c.id, title: c.title, emoji: c.emoji, points: c.points, dueTime: c.dueTime, date, done: completions.has(`${c.id}:${date}`), doneBy: completions.get(`${c.id}:${date}`)?.memberId ?? null, shared: !c.memberId })))
  const open = openItems(today, i => i.memberId === memberId)
  const items = open.filter(i => (i.dueDate && i.dueDate <= to) || i.priority === 'high' || i.priority === 'urgent')
  const h = new Date().getHours()
  return {
    greeting: birthdays.some(b => b.memberId === memberId && b.date === today) ? `Happy birthday, ${m.name}! 🎉`
      : `${h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening'}, ${m.name}`,
    member: { id: m.id, name: m.name, color: m.color, avatar: m.avatar, birthday: m.birthday },
    range, from: today, to, generatedAt: new Date().toISOString(),
    weather: mockWeather(dates),
    events: mine.filter(e => e.date <= to),
    chores: choreRows, items,
    birthdays: birthdays.filter(b => b.date <= to),
    meals: [], // api.ts adds the demo menu (mock-meals.ts)
    tomorrow: range === 'day' ? { date: tomorrow, events: mine.filter(e => e.date === tomorrow), items: open.filter(i => i.dueDate === tomorrow), birthdays: birthdays.filter(b => b.date === tomorrow), meals: [] } : null,
    checkedIn: checkIns.has(`${memberId}:${today}`), checkInPoints: settings.checkInPoints,
  }
}

const isBday = (e: EventInstance) => e.categoryId === 'cat1'

/** Members' birthdays on `dates`, plus birthday-category events, by date. */
function birthdaysOn(dates: string[], all: (EventInstance & { date: string })[]): SnapshotBirthday[] {
  const birthdays: SnapshotBirthday[] = []
  for (const x of members) {
    const md = x.birthday?.slice(-5)
    const date = md && dates.find(d => d.slice(5) === md)
    if (date) birthdays.push({ memberId: x.id, eventId: null, name: x.name, avatar: x.avatar, date, age: x.birthday!.startsWith('--') ? null : Number(date.slice(0, 4)) - Number(x.birthday!.slice(0, 4)) })
  }
  for (const e of all.filter(isBday)) birthdays.push({ memberId: null, eventId: e.id, name: e.title, avatar: null, date: e.date, age: null })
  birthdays.sort((a, b) => a.date.localeCompare(b.date))
  return birthdays
}

/** Every event from today through `last` (browser-local days), listed under its start day (or today). */
function eventsThrough(last: string) {
  const today = inDays(0)
  const dayOf = (e: EventInstance) => { const d = e.allDay ? e.start.slice(0, 10) : dateKey(new Date(e.start)); return d < today ? today : d }
  return events.filter(e => !hiddenWhy(e)).map(e => ({ ...withLeave(e), date: dayOf(e) }))
    .filter(e => e.date <= last && (e.allDay ? e.end.slice(0, 10) > today : dateKey(new Date(e.end)) >= today))
    .sort((a, b) => a.start.localeCompare(b.start))
}

function dueOn(c: Chore, d: string, today: string) {
  if (!c.rrule) return c.dueDate === d
  const day = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(`${d}T12:00`).getDay()]
  const byDay = /BYDAY=([A-Z,]+)/.exec(c.rrule)?.[1]
  return c.rrule.includes('DAILY') || (byDay ? byDay.split(',').includes(day) : d === today)
}

/** Open, unarchived list items, soonest due first (so overdue leads), undated last. */
function openItems(today: string, keep: (i: ListItem) => boolean) {
  const rank = { urgent: 0, high: 1, normal: 2, low: 3 }
  return listItems.filter(i => keep(i) && !i.done && !lists.find(l => l.id === i.listId)?.archived)
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || rank[a.priority] - rank[b.priority])
    .map(i => { const l = lists.find(x => x.id === i.listId)!; return { ...i, listName: l.name, listEmoji: l.emoji ?? null, overdue: !!i.dueDate && i.dueDate < today } })
}

/** A fixed week of forecast, starting today. */
function mockWeather(dates: string[]) {
  if (!settings.location) return null
  const f = settings.temperatureUnit === 'fahrenheit', t = (n: number) => f ? n : Math.round((n - 32) * 5 / 9)
  const forecast: [number, number, number, number][] = [[2, 68, 52, 10], [61, 61, 50, 80], [0, 72, 54, 0], [3, 66, 51, 5], [80, 63, 49, 60], [0, 70, 53, 0], [1, 71, 55, 5]]
  const WX: Record<number, [string, string]> = { 0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Cloudy'], 61: ['🌧️', 'Light rain'], 80: ['🌦️', 'Showers'] }
  return {
    location: settings.location.name, unit: settings.temperatureUnit,
    now: { temp: t(64), code: 2, emoji: '⛅', text: 'Partly cloudy', rainChance: 10 },
    days: dates.slice(0, forecast.length).map((date, i) => { const [code, hi, lo, rain] = forecast[i]; return { date, code, emoji: WX[code][0], text: WX[code][1], high: t(hi), low: t(lo), rainChance: rain } }),
  }
}

// Mirrors GET /api/board: everyone's week, from the same fixtures as the snapshot.
function mockBoard(days: number): Board {
  const today = inDays(0)
  const dates = Array.from({ length: Math.max(1, days) }, (_, i) => inDays(i))
  const to = dates[dates.length - 1]
  const all = eventsThrough(to)
  const birthdays = birthdaysOn(dates, all)
  const todays = chores.filter(c => c.active && dueOn(c, today, today))
  const owners = [...members.map(m => m.id), null]
  return {
    today, to, generatedAt: new Date().toISOString(),
    weather: mockWeather(dates),
    events: all.filter(e => !isBday(e)),
    items: openItems(today, () => true).filter(i => (i.dueDate && i.dueDate <= to) || i.priority === 'high' || i.priority === 'urgent'),
    chores: owners.map(id => {
      const mine = todays.filter(c => c.memberId === id)
      const m = members.find(x => x.id === id)
      return { memberId: id, name: m?.name ?? null, avatar: m?.avatar ?? null, color: m?.color ?? null, total: mine.length, remaining: mine.filter(c => !completions.has(`${c.id}:${today}`)).length }
    }).filter(c => c.total > 0),
    birthdays,
    meals: [], // api.ts adds the demo menu (mock-meals.ts)
    booksDue: bookLibrary.filter(b => b.borrowedFrom && b.dueOn && !b.returnedOn && b.dueOn <= to)
      .map(b => ({ id: b.id, title: b.title, borrowedFrom: b.borrowedFrom!, dueOn: b.dueOn!, date: b.dueOn! < today ? today : b.dueOn!, overdue: b.dueOn! < today })),
  }
}

// Activity plugins: the reviewed ones baked into the demo build (scripts/demo-plugins.mjs), all
// installed at first; install/remove/on-off and saved progress live in memory like everything else.
type DemoPlugin = PluginCatalogEntry & { entry: string }
let pluginCatalog: Promise<DemoPlugin[]> | null = null
let installed: Map<string, boolean> | null = null // id -> on
const pluginData = new Map<string, Record<string, unknown>>() // `${id}:${member}`
const catalog = () => (pluginCatalog ??= fetch('plugins/catalog.json').then(r => (r.ok ? r.json() : { plugins: [] })).then(c => c.plugins as DemoPlugin[]).catch(() => []))
const asPlugin = (e: DemoPlugin, enabled: boolean): Plugin => ({
  id: e.id, name: e.name, version: e.version, description: e.description, entry: e.entry, emoji: e.emoji, color: e.color, categories: e.categories, ages: e.ages,
  source: e.repo, enabled, installedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), url: `/plugins/${e.id}/${e.entry}`,
})
async function installedPlugins() {
  const list = await catalog()
  installed ??= new Map(list.map(e => [e.id, true]))
  return list.filter(e => installed!.has(e.id)).map(e => asPlugin(e, installed!.get(e.id)!))
}
export const mockPlugins = {
  catalog: async () => ({ catalogOnly: true, plugins: await catalog() as PluginCatalogEntry[] }), // the demo adds reviewed ones only
  list: installedPlugins,
  install: async (url: string) => {
    const e = (await catalog()).find(p => url.toLowerCase().endsWith(p.repo.toLowerCase()))
    if (!e) throw new Error('The demo can add Kinwall\'s reviewed activities only.')
    await installedPlugins(); installed!.set(e.id, true); rev++
    return asPlugin(e, true)
  },
  setEnabled: async (id: string, on: boolean) => { await installedPlugins(); installed!.set(id, on); rev++; return (await installedPlugins()).find(p => p.id === id)! },
  remove: async (id: string) => { await installedPlugins(); installed!.delete(id); for (const k of pluginData.keys()) if (k.startsWith(`${id}:`)) pluginData.delete(k); rev++ },
  load: async (id: string, member: string) => ({ ...pluginData.get(`${id}:${member}`) }),
  save: async (id: string, member: string, key: string, value: unknown) => {
    const d = pluginData.get(`${id}:${member}`) ?? {}
    if (value === null || value === undefined) delete d[key]; else d[key] = value
    pluginData.set(`${id}:${member}`, d)
  },
}
