// What the iPhone app shows in its Live Activities (kinwall-mobile: Lock Screen and Dynamic
// Island), built here from what the page already has and sent with tellAppActivity (native.ts).
// Pure, so web/test/liveActivity.test.ts covers them. The app draws them; the text is decided here.
import { leadOf } from './leadTime.ts'
import { mealName, pickNudge, rememberNudge, type Nudge, type NudgeSeen } from './nudges.ts'
import { ANY_STORE, anyStoreView, tripView } from './trip.ts'
import { warningTimes, type TransitionReminders } from './transitions.ts'
import type { AisleOrder, EventInstance, ListItem } from './types.ts'

const MIN = 60000

// ---- Cooking timers (CookingMode) ----

export type CookingTimer = { label: string; step: number; endsAt: number; done: boolean }
export type CookingActivity = { recipe: string; timer: string; step: string; endsAt: number; done: boolean; more: number }

/** "Rice · 15 min" (a named timer) -> "Rice"; an unnamed "10 min" stays as it is. */
export const timerName = (label: string) => label.split(' · ')[0]

/** The soonest running timer, with how many others are on; once none is running, the one that
 * rang ("Done: Rice") until it's dismissed. Null when there are none. */
export function cookingActivity(recipe: string, timers: CookingTimer[], stepTitle: (step: number) => string | null | undefined): CookingActivity | null {
  const running = timers.filter(t => !t.done).sort((a, b) => a.endsAt - b.endsAt)
  const shown = running[0] ?? timers.filter(t => t.done).sort((a, b) => b.endsAt - a.endsAt)[0]
  if (!shown) return null
  const title = stepTitle(shown.step)
  return { recipe, timer: timerName(shown.label), step: `Step ${shown.step + 1}${title ? ` · ${title}` : ''}`, endsAt: shown.endsAt, done: shown.done, more: running.filter(t => t !== shown).length }
}

// ---- A shopping trip (Lists, shopping mode) ----

type TripItem = Pick<ListItem, 'id' | 'title' | 'done' | 'store' | 'aisle' | 'places'> & { category?: string | null }
export type ShoppingEntry = { id: string; title: string; aisle: string | null }
export type ShoppingActivity = { listId: string; store: string; left: number; next: ShoppingEntry | null; upcoming: ShoppingEntry[] }

/** How many are left and what's next, in the trip's walking order (trip.ts): so "Got it" on the
 * Lock Screen can tick the next one and show the one after without the page, `upcoming` carries
 * the next few. Items planned for other stores aren't on this trip. */
export function shoppingActivity(listId: string, store: string, items: TripItem[], order: AisleOrder, storeAisles: string[] = []): ShoppingActivity {
  const view = store === ANY_STORE ? anyStoreView(items, order) : tripView(items, store, order, storeAisles)
  const walk = [...view.aisles.flatMap(g => g.items.map(i => ({ i, aisle: store === ANY_STORE ? i.aisle ?? null : g.aisle }))), ...view.unknown.map(i => ({ i, aisle: null }))].filter(x => !x.i.done)
  const upcoming = walk.slice(0, 5).map(({ i, aisle }) => ({ id: i.id, title: i.title, aisle }))
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
    if (e.allDay || !lead || (!lead.prep && !cfg!.leaveBy)) return []
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
