import { freshHandoff, type SetupResume } from './setupSteps.ts'

// Persisted across the OAuth start->callback round trip (Google/Outlook connect from the
// Calendars step), which reloads the page. Only the step and role are stored, never a key.
const RESUME_KEY = 'kinwall.setupResume'
// A new tab doesn't share sessionStorage, so the passkey step's "open in its own tab" hands its
// place over through localStorage once; the new tab picks it up and clears it. Never a key.
const HANDOFF_KEY = 'kinwall.setupHandoff'
export function readSetupResume(): SetupResume | null {
  try {
    const handoff = freshHandoff(localStorage.getItem(HANDOFF_KEY), Date.now())
    localStorage.removeItem(HANDOFF_KEY) // used once, or stale: either way gone
    if (handoff) sessionStorage.setItem(RESUME_KEY, JSON.stringify(handoff))
    const raw = sessionStorage.getItem(RESUME_KEY)
    return raw ? JSON.parse(raw) as SetupResume : null
  } catch { return null }
}
export const handOffPasskeyStep = () => { try { localStorage.setItem(HANDOFF_KEY, JSON.stringify({ step: 'passkey', deviceRole: 'admin', at: Date.now() })) } catch { /* ignore */ } }
export function saveResume(r: SetupResume | null) {
  try {
    if (r) sessionStorage.setItem(RESUME_KEY, JSON.stringify(r))
    else { sessionStorage.removeItem(RESUME_KEY); localStorage.removeItem(HANDOFF_KEY) } // setup done here: drop an unused handoff too
  } catch { /* ignore */ }
}
/** Claimed but no passkey yet on a host that requires one (see App.tsx): reopen at that step. */
export const resumeAtPasskey = () => saveResume({ step: 'passkey', deviceRole: 'admin' })
