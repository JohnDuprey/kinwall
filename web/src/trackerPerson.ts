// Whose entries a tracker shows (Trackers.tsx). Pure, so web/test/trackerPerson.test.ts covers it.

/** Trackers → Health's own person switcher, per device: '' is everyone. */
export const HEALTH_PERSON_KEY = 'kinwall.healthPerson'

/** Who the Health tab starts on: the header's member filter when it's set, else this device's last pick. */
export const startPerson = (header: string | null, saved: string | null): string | null => header || saved || null

/** The pick while that person is still in the family, else everyone (null). */
export const personIn = (id: string | null, memberIds: string[]): string | null => (id && memberIds.includes(id) ? id : null)

/** One person's entries plus the family's (no member, not a removed member's); null: everyone's. */
export const forPerson = <T extends { memberId: string | null; formerMember: string | null }>(entries: T[], personId: string | null): T[] =>
  entries.filter(e => !personId || e.memberId === personId || (e.memberId === null && !e.formerMember))
