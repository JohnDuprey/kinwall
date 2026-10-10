// What the iPhone app shows in its Live Activities (kinwall-mobile: Lock Screen and Dynamic
// Island), built here from what the page already has and sent with tellAppActivity (native.ts).
// Pure, so web/test/liveActivity.test.ts covers them. The app draws them; the text is decided here.
import { blocksTime, leadOf } from './leadTime.ts'
import { mealName, pickNudge, rememberNudge, type Nudge, type NudgeSeen } from './nudges.ts'
import { ANY_STORE, anyStoreView, tripView } from './trip.ts'
import { warningTimes, type TransitionReminders } from './transitions.ts'
import { cardLabel } from './medications.ts'
import { formatTime } from './timeFormat.ts'
import type { AisleOrder, DueDose, EventInstance, ListItem } from './types.ts'

const MIN = 60000

// ---- Timers (timers.ts: quick timers and cooking mode's) ----

export type ActivityTimer = { label: string; title?: string; detail?: string; endsAt: number; done: boolean; paused?: boolean }
/** The app's "cooking" activity, whatever the timer is for: `recipe` is what it's for (a quick
 * timer's is "Timer"), `step` its detail. `alarms`: every running timer's finish, for the app to
 * ring as a notification with the phone locked. */
export type TimerActivity = { recipe: string; timer: string; step: string; endsAt: number; done: boolean; more: number; alarms: { at: number; title: string; body: string }[] }

/** "Rice · 15 min" (a named timer) -> "Rice"; an unnamed "10 min" stays as it is. */
export const timerName = (label: string) => label.split(' · ')[0]

/** The soonest running timer, with how many others are on; once none is running, the one that
 * rang ("Done: Rice") until it's dismissed. Null when there are none. */
export function timerActivity(timers: ActivityTimer[]): TimerActivity | null {
  // A paused timer isn't counting down, so it's not on the Lock Screen and doesn't ring.
  const running = timers.filter(t => !t.done && !t.paused).sort((a, b) => a.endsAt - b.endsAt)
  const shown = running[0] ?? timers.filter(t => t.done).sort((a, b) => b.endsAt - a.endsAt)[0]
  if (!shown) return null
  const title = (t: ActivityTimer) => t.title ?? 'Timer'
  const alarms = running.map(t => ({ at: t.endsAt, title: `Time's up: ${timerName(t.label)}`, body: [title(t), t.detail].filter(Boolean).join(' · ') }))
  return { recipe: title(shown), timer: timerName(shown.label), step: shown.detail ?? '', endsAt: shown.endsAt, done: shown.done, more: running.filter(t => t !== shown).length, alarms }
}

// ---- A shopping trip (Lists, shopping mode) ----

type TripItem = Pick<ListItem, 'id' | 'title' | 'done' | 'store' | 'aisle' | 'places'> & { category?: string | null; listId?: string }
/** listId: set on an item from another list (a combined Groceries + Shopping trip): tick it there. */
export type ShoppingEntry = { id: string; title: string; aisle: string | null; listId?: string }
export type ShoppingActivity = { listId: string; store: string; left: number; next: ShoppingEntry | null; upcoming: ShoppingEntry[] }

/** How many are left and what's next, in the trip's walking order (trip.ts): so "Got it" on the
 * Lock Screen can tick the next one and show the one after without the page, `upcoming` carries
 * the next few. Items planned for other stores aren't on this trip. `reverse`: the store walked backwards. */
export function shoppingActivity(listId: string, store: string, items: TripItem[], order: AisleOrder, storeAisles: string[] = [], reverse = false): ShoppingActivity {
  const view = store === ANY_STORE ? anyStoreView(items, order) : tripView(items, store, order, storeAisles, reverse)
  const walk = [...view.aisles.flatMap(g => g.items.map(i => ({ i, aisle: store === ANY_STORE ? i.aisle ?? null : g.aisle }))), ...view.unknown.map(i => ({ i, aisle: null }))].filter(x => !x.i.done)
  const upcoming = walk.slice(0, 5).map(({ i, aisle }) => ({ id: i.id, title: i.title, aisle, ...(i.listId && i.listId !== listId ? { listId: i.listId } : {}) }))
  return { listId, store: store === ANY_STORE ? 'Any store' : store, left: walk.length, next: upcoming[0] ?? null, upcoming }
}

// ---- The next leave-by or start-prep time (transition reminders) ----

/** After the leave-by or start-prep time, the Activity stays (saying "Leave now") until the event
 * starts, and at least this long. */
export const GRACE_MIN = 5

/** `activity`: its name for the server's push (server/src/notify.ts runLiveActivities), so the app
 * registers its update token under it and the server doesn't start a second one. */
export type LeaveByActivity = { activity: string; eventId: string; title: string; prep: boolean; at: string; startsAt: string; endsAt: string; headline: string; urgent: string }

/** How a headline is picked: the event's category text (name and emoji) for its hints, the
 * person's recent headlines on this device, and where to add a new one (NowNext keeps them). */
export type NudgeMemory = { category?: (id: string | null) => string | null; seen?: NudgeSeen[]; remember?: (e: NudgeSeen) => void }

/** The person's next leave-by or start-prep time, from their first transition warning before it
 * until the event starts (or GRACE_MIN after the time, if later). Only their events: tagged with
 * them or nobody, and a meal's event only for its cook when it has one. Null when nothing is due. */
export function leaveByActivity(events: EventInstance[], me: { id: string; name: string; transitionReminders?: TransitionReminders }, now: number, time: (iso: string) => string, calm = false, memory: NudgeMemory = {}): LeaveByActivity | null {
  const cfg = me.transitionReminders
  const first = cfg?.on ? warningTimes(cfg.minutes, cfg.repeat)[0] : undefined
  if (!first) return null
  const mine = (ids: string[]) => ids.length === 0 || ids.includes(me.id)
  const due = events.flatMap(e => {
    const lead = leadOf(e)
    if (!blocksTime(e) || !lead || (!lead.prep && !cfg!.leaveBy)) return []
    if (!(lead.prep && e.cookId ? e.cookId === me.id : mine(e.memberIds))) return []
    const at = Date.parse(lead.at), end = Math.max(Date.parse(e.start), at + GRACE_MIN * MIN)
    return now >= at - first * MIN && now < end ? [{ e, lead, at, end }] : []
  }).sort((a, b) => a.at - b.at)[0]
  if (!due) return null
  const { e, lead, at, end } = due
  const words = { kind: lead.prep ? 'prep' as const : 'leave' as const, title: lead.prep ? mealName(e.title) : e.title, at: time(lead.at), seed: `${me.id}:${e.id}:${e.start.slice(0, 10)}`, name: me.name.split(' ')[0], category: memory.category?.(e.categoryId) ?? null, calm, live: true }
  let seen = memory.seen ?? []
  const line = (n: Nudge) => {
    const p = pickNudge(n, seen)
    if (p.fresh && p.seen) { seen = rememberNudge(seen, p.seen); memory.remember?.(p.seen) }
    return p.line
  }
  return {
    activity: `leaveBy:${e.id}@${new Date(e.start).toISOString()}`, eventId: e.id, title: e.title, prep: lead.prep, at: new Date(at).toISOString(), startsAt: e.start, endsAt: new Date(end).toISOString(),
    headline: line({ ...words, minutes: Math.ceil((at - now) / MIN) }), urgent: line({ ...words, minutes: 0 }),
  }
}

// ---- A medicine dose that's due (Take now) ----

/** A late window past this gets the follow-up (as server/src/notify.ts: halfway through it). */
const FOLLOW_UP_AFTER_MS = 3 * 60 * MIN

/** medicationId, date and time: what the app's Taken and Snooze buttons send to
 * POST /api/medications/{medicationId}/doses. label: "Maya's medicine" unless this device turned on
 * medicine names (it's on the Lock Screen). stage 'late': from the follow-up point. */
export type MedicationActivity = {
  medicationId: string; date: string; time: string; memberName: string; label: string; headline: string
  dueAt: string; windowEndsAt: string; stage: 'due' | 'late'
}

type Person = { id: string; name: string; grownUp?: boolean }

/** Whose doses this phone's medicine Live Activity follows: its person's own, and on a grown-up's
 * own full-access phone that turned on "Show the kids' doses on this phone", the kids' too. Nobody
 * on a wall (no person) or on a kid's own device beyond themselves. */
export function activityPeople(me: Person | undefined, members: Person[], parentDevice: boolean, kidsOn: boolean): Person[] {
  if (!me) return []
  return kidsOn && parentDevice && me.grownUp ? [me, ...members.filter(m => !m.grownUp && m.id !== me.id)] : [me]
}

/** The earliest dose that's due now (a "When I start my day" dose once their day started) for
 * `me` or the kids in `kids` (activityPeople), until it's marked or its late window closes, with
 * "+1 more" when others are due too. A kid's says whose and when ("Leo · 8:00 AM medicine"); names
 * only when this device turned them on. */
export function medicationActivity(doses: DueDose[], me: { id: string; name: string }, now: number, names: boolean, kids: Person[] = []): MedicationActivity | null {
  const whose = (id: string) => (id === me.id ? me : kids.find(k => k.id === id))
  const due = doses.filter(x => whose(x.memberId) && Date.parse(x.dueAt) <= now && now < Date.parse(x.until)).sort((a, b) => a.dueAt.localeCompare(b.dueAt))
  const d = due[0]
  if (!d) return null
  const start = Date.parse(d.dueAt), end = Date.parse(d.until)
  const late = end - start > FOLLOW_UP_AFTER_MS && now >= start + (end - start) / 2
  const who = whose(d.memberId)!.name.split(' ')[0]
  const named = names && !!d.name
  const more = due.length > 1 ? ` · +${due.length - 1} more` : ''
  const headline = d.memberId === me.id
    ? (late ? `Still time for ${who}'s medicine` : `Time for ${who}'s medicine`)
    : `${who} · ${named ? cardLabel(d) : d.time === 'wake' ? 'Start-of-day medicine' : `${formatTime(d.time)} medicine`}`
  return {
    medicationId: d.medicationId, date: d.date, time: d.time, memberName: who,
    label: named ? cardLabel(d) : `${who}'s medicine`,
    headline: headline + more,
    dueAt: d.dueAt, windowEndsAt: d.until, stage: late ? 'late' : 'due',
  }
}
