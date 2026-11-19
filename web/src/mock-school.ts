// In-memory School for VITE_MOCK only (the server: routes/school.ts). The demo family (all made up):
// Maya goes to school and logs her reading practice; Leo is homeschooled, and the two did a science
// project together. Leo's time logged on the wall waits for a grown-up, so the demo shows approval.
import { mock } from './mock.ts'
import { dateKey } from './date.ts'
import { addDayKeys } from './library.ts'
import { ApiError } from './apiError.ts'
import { DEFAULT_YEAR_START, onDay, schoolYearOf, schoolYearRange, weekOf } from './school.ts'
import type { Chore, SchoolDay, SchoolDayKind, SchoolGrade, SchoolKid, SchoolLog, SchoolSubject } from './types.ts'

const today = dateKey(new Date())
const copy = <T,>(x: T): T => structuredClone(x)
const stamp = (d: string, h: number) => `${d}T${String(h).padStart(2, '0')}:00:00.000Z`

let subjects: SchoolSubject[] = ([
  ['ss-math', 'Math', '🔢', '#5B8DEF'], ['ss-reading', 'Reading', '📖', '#E86A92'], ['ss-writing', 'Writing', '✏️', '#C8610F'], ['ss-science', 'Science', '🔬', '#2BAE8E'],
  ['ss-history', 'History', '🏛️', '#B07A3B'], ['ss-art', 'Art', '🎨', '#A06BE0'], ['ss-music', 'Music', '🎵', '#3B9FC8'], ['ss-pe', 'PE', '⚽', '#E0A431'],
] as const).map(([id, name, emoji, color], sort) => ({ id, name, emoji, color, sort, archived: false }))

const kidBase = { dayStart: null, dayEnd: null, schoolDays: [1, 2, 3, 4, 5], calendarIds: [] as string[], halfDayEnd: null, halfFromSchoolTime: null, lastDay: null, schoolContactId: null, teacherName: null, teacherEmail: null, teacherLink: null, contactIds: [], terms: 3, yearGoalHours: null, yearGoalDays: null, dailyGoalMinutes: null, yearStart: DEFAULT_YEAR_START, toSchoolBy: null, toSchoolTime: null, fromSchoolBy: null, fromSchoolTime: null }
let kids: SchoolKid[] = [
  { ...kidBase, memberId: 'm3', mode: 'enrolled', grade: '3rd', approveLogs: false, dayStart: '08:15', dayEnd: '15:05', calendarIds: ['c2'], halfDayEnd: '12:05', halfFromSchoolTime: '12:15', lastDay: `${schoolYearOf(today, '08-24') + 1}-06-11`, schoolContactId: 'contact-school', teacherName: 'Ms. Okafor', teacherEmail: 'okafor@example.org', teacherLink: 'https://www.classdojo.com/', contactIds: [], yearStart: '08-24', toSchoolBy: 'bus', toSchoolTime: '07:35', fromSchoolBy: 'm1', fromSchoolTime: '15:05' },
  { ...kidBase, memberId: 'm4', mode: 'home', grade: '1st', approveLogs: true, yearGoalHours: 600, yearGoalDays: 180, dailyGoalMinutes: 180 },
]
// Maya's first-term report card (grownups only; the demo is a parent's device unless kinwall.demoKid says otherwise).
const firstYear = schoolYearOf(today, '08-24') // Maya's school starts August 24
let grades: SchoolGrade[] = ([['ss-math', 'A-'], ['ss-reading', 'A'], ['ss-science', 'B+'], ['ss-history', 'A']] as const)
  .map(([subjectId, grade]) => ({ id: `sg-${subjectId}`, memberId: 'm3', year: firstYear, term: 1, subjectId, grade, updatedAt: stamp(addDayKeys(today, -10), 18) }))

const row = (id: string, groupId: string, memberId: string, subjectId: string, daysAgo: number, minutes: number, title: string | null, pending = false, hour = 15): SchoolLog => {
  const date = addDayKeys(today, -daysAgo)
  return { id, groupId, memberId, subjectId, date, minutes, title, notes: null, pending, createdBy: null, createdAt: stamp(date, hour), updatedAt: stamp(date, hour) }
}
let logs: SchoolLog[] = [
  row('sl-1', 'sg-1', 'm3', 'ss-science', 0, 30, 'Seed sprouting jars'), row('sl-2', 'sg-1', 'm4', 'ss-science', 0, 30, 'Seed sprouting jars'),
  row('sl-3', 'sg-2', 'm4', 'ss-math', 0, 20, 'Counting by 5s', false, 10),
  row('sl-4', 'sg-3', 'm4', 'ss-pe', 0, 45, 'Park games', true, 13),
  row('sl-5', 'sg-4', 'm3', 'ss-reading', 1, 25, 'Read-aloud, chapter 4'),
  row('sl-6', 'sg-5', 'm4', 'ss-reading', 1, 20, 'Phonics: short vowels', false, 10),
  row('sl-7', 'sg-6', 'm4', 'ss-math', 1, 25, null, false, 11),
  row('sl-8', 'sg-7', 'm3', 'ss-music', 2, 20, 'Recorder practice'),
  row('sl-9', 'sg-8', 'm4', 'ss-art', 2, 40, 'Watercolor leaves', false, 11),
  row('sl-10', 'sg-9', 'm3', 'ss-history', 3, 60, 'Museum visit'), row('sl-11', 'sg-9', 'm4', 'ss-history', 3, 60, 'Museum visit'),
]

/** Like the server's schoolFromChore: a schoolwork tick logs its minutes, once per chore and day. */
export function logFromChore(c: Chore, date: string, memberId: string | null) {
  if (!memberId || !kids.some(k => k.memberId === memberId)) return
  const previous = logs.find(l => l.choreId === c.id && l.choreDate === date)
  if (previous) {
    if (previous.memberId !== memberId) { previous.memberId = memberId; previous.pending = !!mock.demoKid() && !!kids.find(k => k.memberId === memberId)?.approveLogs; previous.updatedAt = new Date().toISOString() }
    return
  }
  const now = new Date().toISOString(), id = crypto.randomUUID()
  logs.push({ id, groupId: id, memberId, subjectId: c.schoolSubjectId ?? null, date, minutes: c.schoolMinutes ?? c.timerMinutes ?? 30, title: c.title, notes: null, pending: !!mock.demoKid() && !!kids.find(k => k.memberId === memberId)?.approveLogs, createdBy: null, createdAt: now, updatedAt: now, choreId: c.id, choreDate: date })
}
export function unlogFromChore(choreId: string, date: string) { logs = logs.filter(l => !(l.choreId === choreId && l.choreDate === date)) }

// The demo's schoolwork, made the first time School is opened (this module loads only then), so the
// Board stays calm while School is off: Leo's daily lessons, Maya's spelling test on the week's last
// school day, and a science project the two share.
const friday = addDayKeys(weekOf(today, 1).from, 4)
void (async () => {
  const lesson = { schoolKind: 'lesson' as const, rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', dueDate: addDayKeys(today, -14), points: 0 }
  const math = await mock.createChore({ ...lesson, title: 'Math lesson', emoji: '🔢', memberId: 'm4', schoolSubjectId: 'ss-math', schoolMinutes: 20 })
  await mock.createChore({ ...lesson, title: 'Phonics', emoji: '📖', memberId: 'm4', schoolSubjectId: 'ss-reading', schoolMinutes: 20 })
  await mock.createChore({ title: 'Reading log', emoji: '📖', memberId: 'm3', dueDate: today, schoolSubjectId: 'ss-reading', schoolKind: 'homework', schoolMinutes: 20, points: 3, needsApproval: true })
  await mock.createChore({ title: 'Spelling test', emoji: '📝', memberId: 'm3', dueDate: friday, schoolSubjectId: 'ss-reading', schoolKind: 'test', schoolMinutes: 15, points: 0 })
  await mock.createChore({ title: 'Volcano model', emoji: '🌋', memberIds: ['m3', 'm4'], dueDate: addDayKeys(today, 10), schoolSubjectId: 'ss-science', schoolKind: 'project', schoolMinutes: 45, points: 5 })
  const day = new Date(`${today}T12:00:00`).getDay()
  if (day >= 1 && day <= 5) await mock.completeChore(math.id, today)
})()

let cards: { memberId: string; year: number; term: number; photoId: string }[] = []

const groupIds = (id: string, all: boolean) => {
  const l = logs.find(x => x.id === id)
  if (!l) throw new ApiError(404, 'log not found')
  return all ? logs.filter(x => x.groupId === l.groupId).map(x => x.id) : [id]
}

export async function mockSchoolRequest(path: string, options: RequestInit) {
  const url = new URL(path, 'https://demo.invalid')
  const [, , , what, id, action] = url.pathname.split('/') // /api/school/logs/{id}/approve
  const q = url.searchParams, all = q.get('all') === '1'
  const method = options.method ?? 'GET', body = options.body ? JSON.parse(String(options.body)) : {}
  if (!(await mock.getSettings()).features.school) throw new ApiError(404, 'School is turned off in Settings → General → Features')
  const now = new Date().toISOString()
  if (what === 'subjects') {
    if (method === 'GET') return copy(subjects.filter(s => q.get('archived') === 'all' || !s.archived).sort((a, b) => a.sort - b.sort))
    if (method === 'POST') { const s: SchoolSubject = { id: crypto.randomUUID(), name: body.name, emoji: body.emoji || null, color: body.color, sort: subjects.length, archived: false }; subjects.push(s); return copy(s) }
    const s = subjects.find(x => x.id === id)
    if (!s) throw new ApiError(404, 'subject not found')
    if (method === 'PATCH') { Object.assign(s, body); return copy(s) }
    subjects = subjects.filter(x => x.id !== id); logs.forEach(l => { if (l.subjectId === id) l.subjectId = null }); return { ok: true }
  }
  if (what === 'days') {
    // A grown-up's mark for a kid's day: PUT /api/school/days/{memberId}/{date}.
    if (method === 'PUT') { const key = `${id}:${action}`; if (body.kind) marks[key] = body.kind; else delete marks[key]; return { ok: true } }
    return schoolDays(q.get('from')!, q.get('to')!)
  }
  if (what === 'kids') {
    if (action === 'terms-used') return { highestTerm: Math.max(0, ...grades.filter(g => g.memberId === id).map(g => g.term), ...cards.filter(c => c.memberId === id).map(c => c.term)) }
    if (method === 'GET') return copy(mock.demoKid() ? kids.map(k => ({ ...k, teacherEmail: null, teacherLink: null })) : kids) // like the server: parents' devices only
    if (method === 'PUT') {
      const was = kids.find(x => x.memberId === id); const k: SchoolKid = { ...kidBase, grade: null, approveLogs: false, ...was, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)), mode: body.mode, memberId: id }
      // Like the server (routes/school.ts shareSchool): kids at the same school share its schedule, and its bus times among those on the bus.
      const others = k.mode === 'enrolled' && k.schoolContactId ? kids.filter(x => x.memberId !== id && x.mode === 'enrolled' && x.schoolContactId === k.schoolContactId) : []
      const shared = ['dayStart', 'dayEnd', 'halfDayEnd', 'schoolDays', 'calendarIds', 'yearStart', 'lastDay', 'terms'] as const
      const bus = [['toSchoolTime', 'toSchoolBy'], ['fromSchoolTime', 'fromSchoolBy'], ['halfFromSchoolTime', 'fromSchoolBy']] as const
      const joined = was?.schoolContactId !== k.schoolContactId || was?.mode !== 'enrolled'
      if (others.length) {
        if (joined) { for (const f of shared) if (body[f] === undefined) Object.assign(k, { [f]: others[0][f] }) }
        else for (const o of others) for (const f of shared) if (body[f] !== undefined) Object.assign(o, { [f]: k[f] })
        for (const [time, by] of bus) {
          if (k[by] !== 'bus') continue
          const riders = others.filter(o => o[by] === 'bus')
          if (body[time] !== undefined && !joined) riders.forEach(o => Object.assign(o, { [time]: k[time] }))
          else if (body[time] === undefined && (joined || body[by] !== undefined) && riders.length) Object.assign(k, { [time]: riders[0][time] })
        }
      }
      kids = [...kids.filter(x => x.memberId !== id), k]; return copy(k)
    }
    kids = kids.filter(x => x.memberId !== id); return { ok: true }
  }
  if (what === 'grades') {
    if (mock.demoKid()) throw new ApiError(403, 'Only a parent can see report cards.')
    if (method === 'GET') return copy(grades.filter(g => g.memberId === q.get('memberId') && g.year === Number(q.get('year'))))
    const same = (g: SchoolGrade) => g.memberId === body.memberId && g.year === body.year && g.term === body.term && g.subjectId === body.subjectId
    grades = grades.filter(g => !same(g))
    if (!body.grade) return null
    const g: SchoolGrade = { id: crypto.randomUUID(), memberId: body.memberId, year: body.year, term: body.term, subjectId: body.subjectId, grade: body.grade, updatedAt: now }
    grades.push(g); return copy(g)
  }
  if (what === 'records') { // like the server's readRecords: the kid's school year, approved time only
    if (mock.demoKid()) throw new ApiError(403, 'Only a parent can see records.')
    const memberId = q.get('memberId')!, year = Number(q.get('year')), { from, to } = schoolYearRange(year, kids.find(k => k.memberId === memberId)?.yearStart)
    const mine = logs.filter(l => l.memberId === memberId && !l.pending && l.date >= from && l.date <= to)
    const sum = (ls: SchoolLog[]) => ls.reduce((n, l) => n + l.minutes, 0)
    const bySubject = [...new Set(mine.map(l => l.subjectId))].map(subjectId => ({ subjectId, minutes: sum(mine.filter(l => l.subjectId === subjectId)) })).sort((a, b) => b.minutes - a.minutes)
    const byMonth = [...new Set(mine.map(l => l.date.slice(0, 7)))].sort().map(month => { const m = mine.filter(l => l.date.startsWith(month)); return { month, minutes: sum(m), days: new Set(m.map(l => l.date)).size } })
    return { year, from, to, minutes: sum(mine), days: new Set(mine.map(l => l.date)).size, bySubject, byMonth, photos: mine.filter(l => l.photoId).map(l => ({ photoId: l.photoId!, logId: l.id, date: l.date, title: l.title, subjectId: l.subjectId })), reportCards: cards.filter(c => c.memberId === memberId && c.year === year).map(c => ({ term: c.term, photoId: c.photoId })) }
  }
  if (what === 'report-cards') {
    cards = cards.filter(c => !(c.memberId === body.memberId && c.year === body.year && c.term === body.term))
    if (body.photoId) cards.push({ memberId: body.memberId, year: body.year, term: body.term, photoId: body.photoId })
    return { ok: true }
  }
  if (what === 'summary') return { from: q.get('from'), to: q.get('to'), rows: [] } // the screen totals the week's logs itself
  if (method === 'GET') return copy(logs.filter(l => (!q.get('from') || l.date >= q.get('from')!) && (!q.get('to') || l.date <= q.get('to')!) && (q.get('pending') !== '1' || l.pending)))
  if (method === 'POST' && !id) {
    const kid = mock.demoKid()
    if (kid && body.memberIds.some((m: string) => m !== kid)) throw new ApiError(403, 'This device can only do that for its owner.')
    const groupId = crypto.randomUUID()
    const made: SchoolLog[] = body.memberIds.map((memberId: string) => ({ id: crypto.randomUUID(), groupId, memberId, subjectId: body.subjectId ?? null, date: body.date ?? today, minutes: body.minutes, title: body.title || null, notes: body.notes || null, pending: !!kid && !!kids.find(k => k.memberId === memberId)?.approveLogs, createdBy: kid, createdAt: now, updatedAt: now }))
    logs.push(...made)
    return { logs: copy(made) }
  }
  const ids = groupIds(id, all)
  if (method === 'PATCH') { logs.filter(l => ids.includes(l.id)).forEach(l => Object.assign(l, body, { updatedAt: now })); return { logs: copy(logs.filter(l => ids.includes(l.id))) } }
  if (action === 'approve') { logs.filter(l => ids.includes(l.id)).forEach(l => { l.pending = false }); return { ok: true } }
  logs = logs.filter(l => !ids.includes(l.id))
  return { ok: true }
}

// School days, simplified from the server's school-days.ts: the family's day rules over each kid's
// school calendars, a grown-up's marks, weekends, summer after the last day, and the countdown.
let marks: Record<string, 'school' | 'half' | 'off'> = {}
const norm = (x: string) => ` ${x.toLowerCase().normalize('NFKD').replace(/\b1\s*[/⁄]\s*2\b/g, 'half').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `
async function schoolDays(from: string, to: string) {
  const { rules } = (await mock.getSettings()).school ?? { rules: [] }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const all = await mock.getEvents(`${addDayKeys(today, -400)}T00:00:00Z`, `${addDayKeys(today, 400)}T00:00:00Z`)
  const classify = (k: SchoolKid, d: string): SchoolDay => {
    const found = (kind: string) => all.find(e => k.calendarIds.includes(e.calendarId) && onDay(e, d, tz) && rules.some(r => r.kind === kind && norm(e.title).includes(norm(r.words))))
    const year = schoolYearRange(schoolYearOf(d, k.yearStart), k.yearStart)
    const lastDay = k.lastDay && k.lastDay >= year.from && k.lastDay <= year.to ? k.lastDay : null
    const base = { memberId: k.memberId, date: d, last: d === lastDay, reason: null, marked: false }
    const mark = marks[`${k.memberId}:${d}`]
    if (mark) return { ...base, kind: mark, marked: true }
    if (lastDay && d > lastDay) return { ...base, kind: 'summer' }
    if (!k.schoolDays.includes(new Date(`${d}T12:00:00`).getDay())) return { ...base, kind: 'weekend' }
    const off = found('off'), half = found('half')
    if (half) return { ...base, kind: 'half', reason: half.title }
    if (off) return { ...base, kind: 'off', reason: off.title }
    return { ...base, kind: 'school' as SchoolDayKind }
  }
  const days: SchoolDay[] = [], left: { memberId: string; lastDay: string; left: number }[] = []
  for (const k of kids) {
    for (let d = from; d <= to; d = addDayKeys(d, 1)) days.push(classify(k, d))
    if (k.lastDay && k.lastDay >= today) { let n = 0; for (let d = today; d <= k.lastDay; d = addDayKeys(d, 1)) { const c = classify(k, d).kind; if (c === 'school' || c === 'half') n++ } left.push({ memberId: k.memberId, lastDay: k.lastDay, left: n }) }
  }
  return { days, left }
}
