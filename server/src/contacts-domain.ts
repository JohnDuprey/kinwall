import type { z } from '@hono/zod-openapi';
import { ContactInputSchema } from './schemas.ts';
import { clean, duplicateScore, parseVCards as parseDrafts, phoneKey } from './vcard.ts';

export { duplicateScore };

export type ContactInput = z.infer<typeof ContactInputSchema>;

function unionValues<T>(a: T[], b: T[], key: (v: T) => string): T[] {
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((v) => { const k = key(v); if (seen.has(k)) return false; seen.add(k); return true; })];
}

// A merged contact is shown to no one who couldn't see both copies: the stricter visibility, every
// wall switch only if both had it on, and every private field of either.
const RANK = { household: 0, adults: 1, selected_members: 1, private: 2 } as const;
function stricter(a: ContactInput, b: ContactInput): Pick<ContactInput, 'visibility' | 'selectedMemberIds'> {
  if (a.visibility === b.visibility) {
    if (a.visibility !== 'selected_members') return { visibility: a.visibility, selectedMemberIds: [...new Set([...a.selectedMemberIds, ...b.selectedMemberIds])] };
    const both = a.selectedMemberIds.filter((id) => b.selectedMemberIds.includes(id));
    return both.length ? { visibility: 'selected_members', selectedMemberIds: both } : { visibility: 'private', selectedMemberIds: [] };
  }
  // adults and selected_members don't nest, so neither is safe for the other's audience.
  if (RANK[a.visibility] === RANK[b.visibility]) return { visibility: 'private', selectedMemberIds: [] };
  const strict = RANK[a.visibility] > RANK[b.visibility] ? a : b;
  return { visibility: strict.visibility, selectedMemberIds: strict.selectedMemberIds };
}

export function mergeContacts(existing: ContactInput, incoming: ContactInput): ContactInput {
  return {
    ...existing,
    kind: existing.kind || incoming.kind,
    givenName: existing.givenName || incoming.givenName,
    familyName: existing.familyName || incoming.familyName,
    nickname: existing.nickname || incoming.nickname,
    relationship: existing.relationship || incoming.relationship,
    organization: existing.organization || incoming.organization,
    title: existing.title || incoming.title,
    notes: existing.notes || incoming.notes,
    phones: unionValues(existing.phones, incoming.phones, (v) => phoneKey(v.value)),
    emails: unionValues(existing.emails, incoming.emails, (v) => clean(v.value)),
    addresses: unionValues(existing.addresses, incoming.addresses, (v) => JSON.stringify(v)),
    websites: unionValues(existing.websites, incoming.websites, (v) => clean(v.value)),
    dates: unionValues(existing.dates, incoming.dates, (v) => `${v.label}:${v.date}`),
    categoryIds: [...new Set([...existing.categoryIds, ...incoming.categoryIds])],
    tags: [...new Set([...existing.tags, ...incoming.tags])],
    memberIds: [...new Set([...existing.memberIds, ...incoming.memberIds])],
    serviceHours: existing.serviceHours || incoming.serviceHours,
    serviceArea: existing.serviceArea || incoming.serviceArea,
    alwaysOpen: existing.alwaysOpen || incoming.alwaysOpen,
    wallVisible: existing.wallVisible && incoming.wallVisible,
    emergencyVisible: existing.emergencyVisible && incoming.emergencyVisible,
    phoneVisibleOnWall: existing.phoneVisibleOnWall && incoming.phoneVisibleOnWall,
    addressVisibleOnWall: existing.addressVisibleOnWall && incoming.addressVisibleOnWall,
    ...stricter(existing, incoming),
    sourceMetadata: existing.sourceMetadata || incoming.sourceMetadata,
    favorite: existing.favorite || incoming.favorite,
    emergency: existing.emergency || incoming.emergency,
    privateFields: [...new Set([...existing.privateFields, ...incoming.privateFields])],
  };
}

/** Parse vCards (vcard.ts) and validate each as a contact, with the API's defaults filled in. */
export function parseVCards(input: string): ContactInput[] {
  return parseDrafts(input).map((draft) => {
    const parsed = ContactInputSchema.safeParse(draft);
    if (!parsed.success) throw new Error(`invalid vCard: ${parsed.error.issues[0]?.message}`);
    return parsed.data;
  });
}
