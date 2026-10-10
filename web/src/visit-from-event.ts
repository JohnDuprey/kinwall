// A health visit started from a calendar event ("Make it a health visit", docs/using/trackers.md):
// the visit's fields guessed from the event. Pure, no dependencies.
//
// Two copies, kept identical (a test checks): server/src/visit-from-event.ts (MCP add_tracker_entry
// with eventId) and web/src/visit-from-event.ts (the event sheet and Health's "Add from the calendar").
// The Docker and web builds each see only their own folder.

export type VisitType = 'checkup' | 'dentist' | 'specialist' | 'vaccine' | 'sick' | 'other';

// ponytail: English keywords only; add the family's language's words when the app is translated.
const RULES: [VisitType, RegExp][] = [
  ['dentist', /\b(dentist|dental|orthodont\w*|teeth cleaning|braces)\b/i],
  ['vaccine', /\b(vaccines?|vaccinations?|immuni[sz]ations?|shots?|flu|booster)\b/i],
  ['checkup', /\b(check-?ups?|physical(?! therap)|well[- ](child|visit|baby|check)|wellness|annual exam)\b/i],
  ['sick', /\b(sick|urgent care)\b/i],
  ['specialist', /(\bdr\b\.?|\bdoctor\b|\bspecialist\b|\b(dermatolog|cardiolog|orthop(a)?ed|allerg|ophthalm|optometr|audiolog|neurolog|endocrin|gastro|urolog|ent\b|eye doctor|therap|psychiatr|psycholog)\w*)/i],
]

/** The visit type a title suggests: dentist, vaccine, checkup, sick, a doctor or specialist, else other. */
export function guessVisitType(title: string): VisitType {
  return RULES.find(([, re]) => re.test(title))?.[0] ?? 'other'
}

/** Whether an event's title looks like a doctor's or dentist's visit (Health's "Add from the calendar"). */
export const looksMedical = (title: string) => guessVisitType(title) !== 'other'

/** Provider descriptions are often HTML: plain text, tags dropped, breaks kept. Only ever used as text. */
export function plainText(s: string): string {
  return s.replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim()
}

export interface EventFacts { title: string; start: string; allDay: boolean; location?: string | null; description?: string | null; memberIds: string[] }
export interface VisitDraft {
  date: string // YYYY-MM-DD, household time
  time: string | null // HH:MM, household time; null for an all-day event
  title: string // the visit's reason
  type: VisitType
  provider: string | null // doctor or office: the event's location
  notes: string | null
  memberId: string | undefined // the event's one member; undefined when it has none or several (ask)
}

/** The visit an event suggests. All-day events keep their date; timed ones are read in `tz`. */
export function visitFromEvent(e: EventFacts, tz: string): VisitDraft {
  let date = e.start.slice(0, 10)
  let time: string | null = null
  if (!e.allDay) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(e.start)).map((x) => [x.type, x.value]))
    date = `${p.year}-${p.month}-${p.day}`
    time = `${p.hour === '24' ? '00' : p.hour}:${p.minute}`
  }
  const notes = e.description ? plainText(e.description) : ''
  return {
    date, time, title: e.title.trim(), type: guessVisitType(e.title), provider: e.location?.trim() || null, notes: notes || null,
    memberId: e.memberIds.length === 1 ? e.memberIds[0] : undefined,
  }
}
