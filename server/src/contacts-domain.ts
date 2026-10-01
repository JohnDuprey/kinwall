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

// Type words that say nothing a person reads as a label ("pref" is the default number, "voice"
// a phone, "internet" an email); the rest map to the words Contacts apps show.
const NOISE = new Set(['pref', 'voice', 'internet', 'x400', 'msg', 'text', 'video', 'dom', 'intl', 'postal', 'parcel', 'bbs', 'modem', 'isdn', 'pcs', 'uri', 'textphone', 'charset', 'encoding']);
const WORDS: Record<string, string> = { cell: 'Mobile', mobile: 'Mobile', iphone: 'iPhone', home: 'Home', work: 'Work', main: 'Main', pager: 'Pager', other: 'Other', school: 'School', car: 'Car', fax: 'Fax' };

/** A readable label: Apple's X-ABLabel ("_$!<HomePage>!$_" → "Home page", or the person's own
 * words), else the TYPE words ("work,fax" → "Work fax", "cell" → "Mobile"). */
function readableLabel(types: string[], abLabel: string | undefined): string {
  if (abLabel) {
    const builtIn = /^_\$!<(.+)>!\$_$/.exec(abLabel)?.[1];
    if (!builtIn) return abLabel.trim().slice(0, 50);
    const words = builtIn.replace(/FAX$/i, ' fax').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    return (words[0].toUpperCase() + words.slice(1)).slice(0, 50);
  }
  const t = types.map((x) => x.toLowerCase()).filter((x) => x && !NOISE.has(x));
  if (t.includes('fax')) { const where = t.find((x) => x === 'home' || x === 'work'); return where ? `${WORDS[where]} fax` : 'Fax'; }
  const word = t.includes('iphone') ? 'iphone' : t[0];
  if (!word) return '';
  const own = word.replace(/^x-/, '');
  return (WORDS[word] ?? own[0].toUpperCase() + own.slice(1)).slice(0, 50);
}

/** A vCard date as Kinwall keeps it: YYYY-MM-DD, or --MM-DD without a year (vCard 4's --MMDD, or
 * Apple's placeholder year 1604 with X-APPLE-OMIT-YEAR); null when it isn't a date. */
function readDate(value: string, params: string[]): string | null {
  const m = /^(\d{4}|--)-?(\d{2})-?(\d{2})(?:T.*)?$/.exec(value.trim());
  if (!m) return null;
  const noYear = m[1] === '--' || m[1] === '1604' || params.some((p) => /^X-APPLE-OMIT-YEAR=/i.test(p));
  return `${noYear ? '-' : m[1]}-${m[2]}-${m[3]}`;
}

/** The colon that ends a property's name and parameters: not escaped, not inside a quoted parameter. */
function valueStart(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted && line[i - 1] !== '\\') return i;
  }
  return -1;
}

const KEYS = new Set(['FN', 'N', 'NICKNAME', 'KIND', 'ORG', 'TITLE', 'TEL', 'EMAIL', 'ADR', 'URL', 'BDAY', 'ANNIVERSARY', 'X-ABDATE', 'CATEGORIES', 'NOTE', 'X-ABLABEL', 'X-ABSHOWAS']);
type Prop = { key: string; group: string; params: string[]; types: string[]; value: string };

/** Parse text vCards 2.1, 3.0 and 4.0 (Apple, Google and Android exports). Photos and other binary
 * properties are skipped: Kinwall has no contact photos. */
export function parseVCards(input: string): ContactInput[] {
  if (input.length > 2_000_000) throw new Error('vCard file is too large');
  // Folded lines begin with whitespace. Quoted-printable (2.1) also continues a line that ends
  // in a soft break '=', but only inside such a property: base64 PHOTO data and URLs end in '=' too.
  const physical = input.replace(/\r\n?/g, '\n').split('\n');
  const lines: string[] = [];
  const quotedPrintable = (line: string) => /;(?:ENCODING=)?QUOTED-PRINTABLE[;:]/i.test(line.slice(0, valueStart(line) + 1));
  for (const part of physical) {
    const last = lines.at(-1);
    if (last !== undefined && /^[ \t]/.test(part)) lines[lines.length - 1] += part.slice(1);
    else if (last !== undefined && last.endsWith('=') && quotedPrintable(last)) lines[lines.length - 1] = last.slice(0, -1) + part;
    else lines.push(part);
  }
  const out: ContactInput[] = [];
  let props: Prop[] | null = null;
  for (const line of lines) {
    if (/^BEGIN:VCARD$/i.test(line.trim())) { if (props) throw new Error('nested vCard'); props = []; continue; }
    if (/^END:VCARD$/i.test(line.trim())) {
      if (!props) throw new Error('unexpected END:VCARD');
      out.push(toContact(props)); props = null; continue;
    }
    if (!props) { if (line.trim()) throw new Error('text outside vCard'); continue; }
    const colon = valueStart(line);
    if (colon < 0) continue;
    const header = line.slice(0, colon).split(';');
    const name = header[0].split('.');
    const key = name.at(-1)!.toUpperCase();
    if (!KEYS.has(key)) continue;
    const params = header.slice(1);
    const charset = params.find((p) => /^CHARSET=/i.test(p))?.split('=')[1] ?? 'utf-8';
    const encoded = params.some((p) => /^(?:ENCODING=)?QUOTED-PRINTABLE$/i.test(p));
    const value = encoded ? decodeQuotedPrintable(line.slice(colon + 1), charset) : line.slice(colon + 1);
    // TYPE=a,b (3.0/4.0, possibly quoted, possibly repeated), bare words (2.1), and Android's
    // X-CUSTOM(CHARSET=…,ENCODING=…,Own label).
    const types = params.flatMap((p) => {
      const custom = /^X-CUSTOM\((?:.*,)?([^,]*)\)$/i.exec(p)?.[1];
      if (custom) return [custom];
      if (/^TYPE=/i.test(p)) return p.slice(5).replaceAll('"', '').split(',');
      return p.includes('=') ? [] : [p];
    });
    props.push({ key, group: name.length > 1 ? name[0].toLowerCase() : '', params, types, value });
  }
  if (props) throw new Error('unterminated vCard');
  if (!out.length) throw new Error('no vCards found');
  if (out.length > 1000) throw new Error('too many vCards');
  return out;
}

function toContact(props: Prop[]): ContactInput {
  const all = (key: string) => props.filter((p) => p.key === key);
  const first = (key: string) => unescapeValue(all(key)[0]?.value ?? '').trim();
  const abLabels = new Map(all('X-ABLABEL').filter((p) => p.group).map((p) => [p.group, unescapeValue(p.value)]));
  const label = (p: Prop) => readableLabel(p.types, p.group ? abLabels.get(p.group) : undefined);
  const n = splitEscaped(all('N')[0]?.value ?? '', ';').map((x) => x.trim());
  const org = splitEscaped(all('ORG')[0]?.value ?? '', ';').map((x) => x.trim()).filter(Boolean).join(', ');
  const name = (first('FN') || [n[3], n[1], n[2], n[0], n[4]].filter(Boolean).join(' ') || org).slice(0, 200);
  if (!name) throw new Error('vCard is missing a name');
  const kind = first('KIND').toLowerCase();
  const values = (key: string, clean: (v: string) => string = (v) => v) => all(key)
    .map((p) => ({ label: label(p), value: clean(unescapeValue(p.value).trim()).slice(0, 500) }))
    .filter((v) => v.value).slice(0, 30);
  const addresses = all('ADR').map((p) => {
    const a = splitEscaped(p.value, ';').map((x) => x.trim());
    return { label: label(p), street: [a[1], a[2]].filter(Boolean).join('\n').slice(0, 500), city: (a[3] ?? '').slice(0, 200), region: (a[4] ?? '').slice(0, 200), postalCode: (a[5] ?? '').slice(0, 50), country: (a[6] ?? '').slice(0, 200) };
  }).filter((a) => a.street || a.city || a.region || a.postalCode || a.country).slice(0, 20);
  const dates = [
    ...all('BDAY').map((p) => ({ label: 'birthday', p })),
    ...all('ANNIVERSARY').map((p) => ({ label: 'anniversary', p })),
    ...all('X-ABDATE').map((p) => { const l = label(p); return { label: /^anniversary$/i.test(l) ? 'anniversary' : l, p }; }),
  ].flatMap(({ label, p }) => { const date = readDate(p.value, p.params); return date ? [{ label, date }] : []; }).slice(0, 30);
  const tags = [...new Set(all('CATEGORIES').flatMap((p) => splitEscaped(p.value, ',')).map((tag) => tag.trim().slice(0, 50)).filter(Boolean))].slice(0, 50);
  const parsed = ContactInputSchema.safeParse({
    kind: kind === 'org' || kind === 'organization' || first('X-ABSHOWAS').toUpperCase() === 'COMPANY' || (!n.some(Boolean) && !!org) ? 'organization' : kind === 'location' ? 'place' : 'person',
    name, givenName: n[1] || null, familyName: n[0] || null, nickname: first('NICKNAME').slice(0, 200) || null,
    organization: org.slice(0, 200) || null, title: first('TITLE').slice(0, 200) || null,
    phones: values('TEL', (v) => v.replace(/^tel:/i, '').replace(/;ext=/i, ' ext. ')),
    emails: values('EMAIL', (v) => v.replace(/^mailto:/i, '')),
    addresses, websites: values('URL'), dates, tags,
    notes: first('NOTE').slice(0, 10_000) || null,
  });
  if (!parsed.success) throw new Error(`invalid vCard: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}
