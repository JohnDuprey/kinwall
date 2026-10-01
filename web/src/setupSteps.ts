// The setup wizard's (Setup.tsx) choices, resume and error copy. Pure, so it's tested in
// test/setupSteps.test.ts.
import type { Member } from './types.ts'

export type Step = 'welcome' | 'passkey' | 'recovery' | 'household' | 'members' | 'owner' | 'calendars' | 'chores' | 'done'
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
