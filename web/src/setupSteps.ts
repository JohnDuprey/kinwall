// The setup wizard's (Setup.tsx) choices, resume and error copy. Pure, so it's tested in
// test/setupSteps.test.ts.
import type { Features, Member } from './types.ts'

export type Step = 'welcome' | 'passkey' | 'recovery' | 'household' | 'members' | 'owner' | 'features' | 'calendars' | 'chores' | 'done'
export type DeviceRole = 'admin'
export interface SetupResume { step: Step; deviceRole: DeviceRole }

/** The first person added is usually the parent doing setup; everyone after, a kid. */
export const defaultGrownUp = (added: number) => added === 0

/** "Whose device is this?": a full-access device only ever belongs to a grown-up. */
export const ownerChoices = (members: Member[]) => members.filter(m => m.grownUp)

/** What a reload reopens. Once claimed (a role is set) setup always continues, since claiming
 * again can't work. */
export function resumeFor(step: Step, deviceRole: DeviceRole | null): SetupResume | null {
  if (!deviceRole || step === 'welcome' || step === 'done') return null
  return { step, deviceRole }
}

/** Wizard error copy from an API error's status: never the server's raw words. */
export function setupErrorText(status: number | undefined, fallback: string): string {
  if (status === 0) return "You're offline. Check your connection and try again."
  if (status === 401 || status === 403) return "This device can't do this part of setup. Skip it for now and finish it later in Settings."
  if (status === 409) return 'This Kinwall is already set up. Reload the page to sign in.'
  if (status === 429) return 'Too many tries. Wait a few minutes and try again.'
  return fallback
}

/** How long a passkey step handed to a new tab (Setup.tsx handOffPasskeyStep) stays valid. A
 * handoff the new tab never picked up (the link opened in another browser, setup finished in the
 * panel) must not reopen the wizard on a later visit. */
export const HANDOFF_MS = 10 * 60_000

/** The handed-off place, if it's still fresh; null for none, an old one or anything unreadable. */
export function freshHandoff(raw: string | null, now: number): SetupResume | null {
  if (!raw) return null
  try {
    const h = JSON.parse(raw) as SetupResume & { at?: number }
    if (typeof h.at !== 'number' || now - h.at > HANDOFF_MS || h.at > now) return null
    const { at: _at, ...resume } = h
    return resume
  } catch { return null }
}

/** The steps after the passkey and recovery codes, in order. */
const ORDER: Step[] = ['household', 'members', 'owner', 'features', 'calendars', 'chores', 'done']
/** Steps only for a feature: skipped while it's off. */
const skipped = (step: Step, f: Features | null) => step === 'chores' && f?.chores === false

/** The step Next goes to, past any for a feature that's off. */
export function nextStep(step: Step, f: Features | null): Step {
  let i = ORDER.indexOf(step)
  while (++i < ORDER.length - 1 && skipped(ORDER[i], f)) { /* skip */ }
  return ORDER[Math.min(i, ORDER.length - 1)]
}
/** The step Back goes to, past any for a feature that's off. */
export function prevStep(step: Step, f: Features | null): Step {
  let i = ORDER.indexOf(step)
  while (--i > 0 && skipped(ORDER[i], f)) { /* skip */ }
  return ORDER[Math.max(i, 0)]
}
/** A resumed step for a feature that's since been turned off moves on. */
export const landOn = (step: Step, f: Features | null): Step => skipped(step, f) ? nextStep(step, f) : step
/** The progress dots: the owner step shares the members dot; skipped steps have none. */
export const progressSteps = (f: Features | null): Step[] => ORDER.filter(s => s !== 'owner' && !skipped(s, f))

/** The features step's cards: what a family wants Kinwall for, in their words. Together they cover
 * every switch in Features, each exactly once, so the cards and "Show all features" never disagree. */
export interface FeatureCard { id: string; emoji: string; title: string; sub: string; keys: (keyof Features)[]; kids?: boolean }
export const FEATURE_CARDS: readonly FeatureCard[] = [
  { id: 'chores', emoji: '🧹', title: 'Chores and rewards for the kids', sub: 'Chores, points, rewards and the sticker book.', keys: ['chores'], kids: true },
  { id: 'meals', emoji: '🍽️', title: 'Meal planning and recipes', sub: "The week's meals, recipes, cooking mode and restaurant nights.", keys: ['meals'] },
  { id: 'lists', emoji: '🛒', title: 'Shopping and to-do lists', sub: 'Groceries, shopping mode and lists for anything.', keys: ['lists'] },
  { id: 'health', emoji: '🩺', title: 'Doctor visits and health', sub: 'Checkups, vaccines and growth. Only on phones and computers, never the wall.', keys: ['trackersHealth'] },
  { id: 'reading', emoji: '📚', title: 'Reading log and library', sub: "Who's reading what, and the books you own or borrowed.", keys: ['trackersReading'] },
  { id: 'paint', emoji: '🎨', title: 'Painting and coloring', sub: 'Drawing and coloring pages in Activities.', keys: ['paint'], kids: true },
  { id: 'polls', emoji: '🗳️', title: 'Family polls', sub: 'Everyone votes, like "Which movie tonight?"', keys: ['polls'] },
  { id: 'photos', emoji: '📸', title: 'Photos and memories', sub: 'Family photos on the wall and moments worth keeping.', keys: ['photos', 'trackersMemories'] },
  { id: 'news', emoji: '📰', title: 'Family news and messages', sub: "Newscast, messages and notes on events and lists.", keys: ['newscast', 'messages', 'notes'] },
  { id: 'checkIns', emoji: '💭', title: 'Check-ins and journals', sub: 'How everyone feels today, goals and private journals.', keys: ['checkIns'] },
  { id: 'contacts', emoji: '📇', title: 'Family contacts', sub: 'Doctors, sitters, schools and friends in one place.', keys: ['contacts'] },
]
/** A card is on when every switch it stands for is on. */
export const cardOn = (f: Features, c: FeatureCard) => c.keys.every(k => f[k])
/** Tapping a card turns all its switches on, or all off when it was on. */
export const toggleCard = (f: Features, c: FeatureCard): Features => {
  const on = !cardOn(f, c)
  return { ...f, ...Object.fromEntries(c.keys.map(k => [k, on])) }
}
/** What the step starts with: the family's switches, with kid-only cards off when no one's a kid. */
export function suggestedFeatures(f: Features, members: Pick<Member, 'grownUp'>[]): Features {
  if (members.length === 0 || members.some(m => !m.grownUp)) return f
  return FEATURE_CARDS.filter(c => c.kids).reduce((acc, c) => ({ ...acc, ...Object.fromEntries(c.keys.map(k => [k, false])) }), f)
}
