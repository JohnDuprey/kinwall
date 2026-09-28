import type { z } from '@hono/zod-openapi';
import { ContactInputSchema } from './schemas.ts';

export type ContactInput = z.infer<typeof ContactInputSchema>;

const clean = (s: string) => s.normalize('NFKC').trim().toLocaleLowerCase();
const phoneKey = (s: string) => s.replace(/[^\d+]/g, '').replace(/^00/, '+');
export function duplicateScore(a: ContactInput, b: ContactInput): number {
  const emails = new Set(a.emails.map((x) => clean(x.value)));
  if (b.emails.some((x) => emails.has(clean(x.value)))) return 100;
  const phones = new Set(a.phones.map((x) => phoneKey(x.value)).filter((x) => x.length >= 7));
  if (b.phones.some((x) => phones.has(phoneKey(x.value)))) return 90;
  return a.kind === b.kind && clean(a.name) === clean(b.name) && (!a.organization || !b.organization || clean(a.organization) === clean(b.organization)) ? 60 : 0;
}

function unionValues<T>(a: T[], b: T[], key: (v: T) => string): T[] {
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((v) => { const k = key(v); if (seen.has(k)) return false; seen.add(k); return true; })];
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
    wallVisible: existing.wallVisible || incoming.wallVisible,
    emergencyVisible: existing.emergencyVisible || incoming.emergencyVisible,
    phoneVisibleOnWall: existing.phoneVisibleOnWall || incoming.phoneVisibleOnWall,
    addressVisibleOnWall: existing.addressVisibleOnWall || incoming.addressVisibleOnWall,
    selectedMemberIds: [...new Set([...existing.selectedMemberIds, ...incoming.selectedMemberIds])],
    sourceMetadata: existing.sourceMetadata || incoming.sourceMetadata,
    favorite: existing.favorite || incoming.favorite,
    emergency: existing.emergency || incoming.emergency,
    visibility: existing.visibility,
    privateFields: [...new Set([...existing.privateFields, ...incoming.privateFields])],
  };
}

function unescapeValue(value: string): string {
  return value.replace(/\\([nN,;:\\])/g, (_, c: string) => c.toLowerCase() === 'n' ? '\n' : c);
}

function splitEscaped(value: string, separator: string): string[] {
  return value.split(new RegExp(`(?<!\\\\)${separator}`)).map(unescapeValue);
}

function decodeQuotedPrintable(value: string, charset: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '=' && /^[0-9a-f]{2}$/i.test(value.slice(i + 1, i + 3))) { bytes.push(parseInt(value.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(value.charCodeAt(i));
  }
  try { return new TextDecoder(charset).decode(new Uint8Array(bytes)); } catch { return new TextDecoder().decode(new Uint8Array(bytes)); }
}

/** Parse text vCards 2.1, 3.0 and 4.0. Binary PHOTO/LOGO/KEY properties are ignored. */
export function parseVCards(input: string): ContactInput[] {
  if (input.length > 2_000_000) throw new Error('vCard file is too large');
  // Folded lines begin with whitespace. Quoted-printable (2.1) also continues a line that ends
  // in a soft break '=', but only inside such a property: base64 PHOTO data and URLs end in '=' too.
  const physical = input.replace(/\r\n?/g, '\n').split('\n');
  const lines: string[] = [];
  const quotedPrintable = (line: string) => /;(?:ENCODING=)?QUOTED-PRINTABLE[;:]/i.test(line.slice(0, line.search(/(?<!\\):/) + 1));
  for (const part of physical) {
    const last = lines.at(-1);
    if (last !== undefined && /^[ \t]/.test(part)) lines[lines.length - 1] += part.slice(1);
    else if (last !== undefined && last.endsWith('=') && quotedPrintable(last)) lines[lines.length - 1] = last.slice(0, -1) + part;
    else lines.push(part);
  }
  const out: ContactInput[] = [];
  let fields: Record<string, { value: string; label: string }[]> | null = null;
  for (const line of lines) {
    if (/^BEGIN:VCARD$/i.test(line)) { if (fields) throw new Error('nested vCard'); fields = {}; continue; }
    if (/^END:VCARD$/i.test(line)) {
      if (!fields) throw new Error('unexpected END:VCARD');
      const first = (key: string) => fields?.[key]?.[0]?.value ?? '';
      const n = splitEscaped(first('N'), ';');
      const name = first('FN') || [n[3], n[1], n[2], n[0], n[4]].filter(Boolean).join(' ') || first('ORG');
      if (!name) throw new Error('vCard is missing a name');
      const vals = (key: string) => (fields?.[key] ?? []).map((v) => ({ label: v.label, value: v.value }));
      const addresses = (fields.ADR ?? []).map((v) => { const p = splitEscaped(v.value, ';'); return { label: v.label, street: [p[1], p[2]].filter(Boolean).join('\n'), city: p[3] ?? '', region: p[4] ?? '', postalCode: p[5] ?? '', country: p[6] ?? '' }; });
      const dates = [...(fields.BDAY ?? []).map((v) => ({ label: 'birthday', date: v.value })), ...(fields.ANNIVERSARY ?? []).map((v) => ({ label: 'anniversary', date: v.value }))].filter((v) => /^(?:\d{4}-\d{2}-\d{2}|--\d{2}-\d{2})$/.test(v.date));
      const tags = (fields.CATEGORIES ?? []).flatMap((v) => splitEscaped(v.value, ',')).map((tag) => tag.trim()).filter(Boolean);
      const parsed = ContactInputSchema.safeParse({ kind: first('KIND').toLowerCase() === 'org' || (!first('N') && !!first('ORG')) ? 'organization' : 'person', name, nickname: first('NICKNAME') || null, organization: splitEscaped(first('ORG'), ';')[0] || null, title: first('TITLE') || null, phones: vals('TEL'), emails: vals('EMAIL'), addresses, websites: vals('URL'), dates, tags, notes: first('NOTE') || null });
      if (!parsed.success) throw new Error(`invalid vCard: ${parsed.error.issues[0]?.message}`);
      out.push(parsed.data); fields = null; continue;
    }
    if (!fields) { if (line.trim()) throw new Error('text outside vCard'); continue; }
    const colon = line.search(/(?<!\\):/);
    if (colon < 0) continue;
    const header = line.slice(0, colon).split(';');
    const key = header[0].split('.').at(-1)!.toUpperCase();
    const params = header.slice(1);
    if (!['FN', 'N', 'NICKNAME', 'KIND', 'ORG', 'TITLE', 'TEL', 'EMAIL', 'ADR', 'URL', 'BDAY', 'ANNIVERSARY', 'CATEGORIES', 'NOTE'].includes(key)) continue;
    const charset = params.find((p) => /^CHARSET=/i.test(p))?.split('=')[1] ?? 'utf-8';
    const encoded = params.some((p) => /^(?:ENCODING=)?QUOTED-PRINTABLE$/i.test(p));
    const raw = encoded ? decodeQuotedPrintable(line.slice(colon + 1), charset) : line.slice(colon + 1);
    const type = params.find((p) => /^TYPE=/i.test(p))?.slice(5) ?? params.find((p) => /^(HOME|WORK|CELL|FAX)$/i.test(p)) ?? '';
    (fields[key] ??= []).push({ value: key === 'N' || key === 'ADR' || key === 'ORG' ? raw : unescapeValue(raw), label: type.replaceAll('"', '').split(',')[0].toLowerCase() });
  }
  if (fields) throw new Error('unterminated vCard');
  if (!out.length) throw new Error('no vCards found');
  if (out.length > 1000) throw new Error('too many vCards');
  return out;
}
