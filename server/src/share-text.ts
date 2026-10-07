// Reading what the "Add to Kinwall" Shortcut sends as text (POST /api/share, routes/share.ts): an
// ISBN, a book's title and author, or an event off a flyer, invite or screenshot. The text is either
// what Extract Text from Image read or a Use Model answer in "Title: …" lines; both are handled.
// Pure, so test/share-text.test.ts covers it.

const NOTHING = /^(unknown|none|n\/?a|not (found|listed|available|visible|shown|given)|tbd|-+)\.?$/i;
/** "Label: value" lines (any order, markdown bold and bullets ignored), keyed by lowercase label. */
function headerLines(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.replace(/\*\*/g, '').split('\n')) {
    const m = /^[-•*\s]*([a-z]+)\s*:\s*(.*)$/i.exec(raw.trim());
    if (m && !out.has(m[1].toLowerCase())) out.set(m[1].toLowerCase(), NOTHING.test(m[2].trim()) ? '' : m[2].trim());
  }
  return out;
}
const header = (h: Map<string, string>, ...keys: string[]) => keys.map((k) => h.get(k)).find((v) => v !== undefined);

// --- Books ---------------------------------------------------------------------------------------

const isbn13Check = (d: string) => (10 - ([...d.slice(0, 12)].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0) % 10)) % 10;
/** The first valid ISBN in the text (ISBN-10 or -13, dashes or spaces allowed), as an ISBN-13. */
export function findIsbn(text: string): string | null {
  for (const m of text.matchAll(/(?:\d[\s-]?){9,12}[\dXx]/g)) {
    const d = m[0].replace(/[\s-]/g, '').toUpperCase();
    if (d.length === 13 && /^97[89]\d{10}$/.test(d) && isbn13Check(d) === Number(d[12])) return d;
    if (d.length === 10 && /^\d{9}[\dX]$/.test(d)) {
      const sum = [...d].reduce((s, c, i) => s + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
      if (sum % 11 === 0) { const t = `978${d.slice(0, 9)}`; return t + isbn13Check(t); }
    }
  }
  return null;
}

/** A book's title and author: "Title:"/"Author:" lines, "Wool by Hugh Howey", or a cover's text
 * (the first line, with a "by …" line right under it as the author). */
export function bookQuery(text: string): { title: string | null; author: string | null } {
  const h = headerLines(text);
  const t = header(h, 'title', 'book');
  if (t !== undefined) return { title: t || null, author: header(h, 'author', 'by') || null };
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const byAt = lines.findIndex((l) => /^by\s+\S/i.test(l));
  if (byAt > 0) return { title: lines[byAt - 1], author: lines[byAt].replace(/^by\s+/i, '') };
  const one = /^(.+?)\s+by\s+(.+)$/i.exec(lines[0] ?? '');
  if (one) return { title: one[1], author: one[2] };
  return { title: lines[0] ?? null, author: null };
}

// --- Events --------------------------------------------------------------------------------------

export type EventDraft = { title: string | null; date: string | null; time: string | null; end: string | null; place: string | null };

const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_PREFIX = '(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\.?,?[ \\t]+)?';
const DATES: { re: RegExp; read: (m: RegExpExecArray) => { y: number | null; mo: number; d: number } }[] = [
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/, read: (m) => ({ y: +m[1], mo: +m[2], d: +m[3] }) },
  { re: new RegExp(`\\b${WEEKDAY_PREFIX}${MONTH}[ \\t]+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?[ \\t]+(\\d{4})\\b)?`, 'i'), read: (m) => ({ y: m[3] ? +m[3] : null, mo: monthOf(m[1]), d: +m[2] }) },
  { re: new RegExp(`\\b${WEEKDAY_PREFIX}(\\d{1,2})(?:st|nd|rd|th)?[ \\t]+(?:of[ \\t]+)?${MONTH}(?:,?[ \\t]+(\\d{4})\\b)?`, 'i'), read: (m) => ({ y: m[3] ? +m[3] : null, mo: monthOf(m[2]), d: +m[1] }) },
  { re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/, read: (m) => ({ y: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null, mo: +m[1], d: +m[2] }) },
];
function monthOf(s: string): number {
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(s.slice(0, 3).toLowerCase()) + 1;
}
const iso = (y: number, mo: number, d: number) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const real = (y: number, mo: number, d: number) => { const t = new Date(Date.UTC(y, mo - 1, d)); return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d; };

/** The first date in the text, as YYYY-MM-DD and the text it was read from. No year: the next one
 * on or after today. A weekday alone ("Saturday"): the next one, today included. */
function findDate(text: string, today: string): { date: string; match: string } | null {
  const [ty, tm, td] = today.split('-').map(Number);
  let best: { date: string; match: string; at: number } | null = null;
  for (const { re, read } of DATES) {
    const m = re.exec(text);
    if (!m || (best && best.at <= m.index)) continue;
    const { y, mo, d } = read(m);
    if (mo < 1 || mo > 12) continue;
    const year = y ?? (iso(ty, mo, d) >= today ? ty : ty + 1);
    if (real(year, mo, d)) best = { date: iso(year, mo, d), match: m[0], at: m.index };
  }
  if (best) return best;
  const w = new RegExp(`\\b(${WEEKDAYS.join('|')})\\b`, 'i').exec(text);
  if (!w) return null;
  const now = new Date(Date.UTC(ty, tm - 1, td));
  now.setUTCDate(now.getUTCDate() + ((WEEKDAYS.indexOf(w[1].toLowerCase()) - now.getUTCDay() + 7) % 7));
  return { date: now.toISOString().slice(0, 10), match: w[0] };
}

const AMPM = '(?:[ \\t]*([ap])\\.?[ \\t]?m\\b\\.?)';
const CLOCK = `(\\d{1,2})(?:[:.](\\d{2}))?${AMPM}?`;
const to24 = (h: number, min: number, ap: string | undefined) => (ap ? (h % 12) + (ap.toLowerCase() === 'p' ? 12 : 0) : h) * 60 + min;
const hhmm = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** A start time and maybe an end ("10am - 2pm", "6:30-8:30pm", "11-2pm", "7 p.m.", "noon",
 * "18:00"). Free text needs an am/pm or a colon; a "Time:" line (`lenient`) also takes bare hours. */
function findTime(text: string, lenient: boolean): { time: string; end: string | null; match: string } | null {
  const range = new RegExp(`\\b${CLOCK}[ \\t]*(?:-|–|—|to|until|till)[ \\t]*${CLOCK}`, 'i').exec(text);
  if (range) {
    const [, h1, m1, ap1, h2, m2, ap2] = range;
    if (+h1 <= 24 && +h2 <= 24 && (ap1 || ap2 || lenient || (m1 && m2))) {
      const end = to24(+h2, +(m2 ?? 0), ap2 ?? ap1);
      let start = to24(+h1, +(m1 ?? 0), ap1 ?? ap2);
      if (!ap1 && ap2 && start > end) start = to24(+h1, +(m1 ?? 0), ap2.toLowerCase() === 'p' ? 'a' : 'p'); // "11-2pm"
      return { time: hhmm(start), end: hhmm(end > start ? end : end + 12 * 60), match: range[0] };
    }
  }
  const noon = /\b(?:12[ \t]*)?(noon|midnight)\b/i.exec(text);
  const one = new RegExp(`\\b${CLOCK}`, 'gi');
  for (const m of text.matchAll(one)) {
    if (noon && noon.index < m.index!) break;
    const [, h, min, ap] = m;
    if (ap ? +h >= 1 && +h <= 12 : (min !== undefined || lenient) && +h <= 23) return { time: hhmm(to24(+h, +(min ?? 0), ap)), end: null, match: m[0] };
  }
  return noon ? { time: noon[1].toLowerCase() === 'noon' ? '12:00' : '00:00', end: null, match: noon[0] } : null;
}

const VENUE = /\b(school|elementary|academy|park|church|temple|library|center|centre|hall|gym|field|cafeteria|auditorium|club|ymca|museum|arena|stadium|theater|theatre|pool|street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln)\b/i;
const EVENT_WORD = /\b(birthday|party|celebration|shower|wedding|reception|fair|festival|carnival|night|show|recital|concert|play|game|match|tournament|meet|dinner|lunch|brunch|picnic|bbq|cookout|potluck|sleepover|playdate|graduation|ceremony|parade|sale|fundraiser|open house|camp|class|practice)\b/i;
const GENERIC = /^(you('|’)?re invited|you are invited|save the date|join us|please join us|all are welcome|come one,? come all)\W*$/i;
const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,–—:@-]+|[\s,–—:@-]+$/g, '').replace(/\s+(at|on|from|this|next|in|@)$/i, '').trim();

/** An event's title, date, time (and end) and place, for the person to check. Anything not found is
 * null; nothing is invented. `today` (YYYY-MM-DD, the household's) places a date without a year. */
export function parseEventText(text: string, today: string): EventDraft {
  const clean = text.replace(/\r/g, '').replace(/\*\*/g, '');
  const h = headerLines(clean);
  const whenLine = header(h, 'when');
  const dateLine = header(h, 'date') ?? whenLine;
  const timeLine = header(h, 'time') ?? whenLine;
  const date = findDate(dateLine ?? clean, today) ?? (dateLine === undefined ? null : findDate(clean, today));
  const blank = (s: string, m: { match: string } | null) => (m ? s.replace(m.match, ' ') : s);
  const time = timeLine !== undefined ? findTime(blank(timeLine, date), true) : findTime(blank(clean, date), false);

  let place: string | null = header(h, 'place', 'location', 'where', 'address', 'venue') ?? null;
  let placeMatch: string | null = null;
  // "at The Rivers Residence" with the street on the next line: both make the place.
  if (place === null) {
    const two = /^(?:at|@)[ \t]+(.+)\n[ \t]*(\d+[ \t]+\p{L}.*)$/imu.exec(clean);
    if (two) { place = `${tidy(two[1])}, ${tidy(two[2])}`; placeMatch = two[0].split('\n')[0]; }
  }
  if (place === null) {
    const at = new RegExp(`\\b(?:at|@)[ \\t]+([^,\\n]*${VENUE.source}[^,\\n]*)`, 'i').exec(clean);
    if (at) { place = tidy(at[1]); placeMatch = at[0]; }
  }

  let title = header(h, 'title', 'event', 'what', 'name') ?? null;
  // An invite names its party with whose and which one ("Maya's 6th Birthday"); that line beats the first
  // line, which on a photo is often decoration ("IN MY BIRTHDAY ERA").
  if (title === null) {
    const named = clean.split('\n').map((l) => l.trim()).find((l) => EVENT_WORD.test(l) && /\p{L}['’]s\b|\b\d+(st|nd|rd|th)\b/iu.test(l) && !/^rsvp\b/i.test(l));
    if (named) title = tidy(named).slice(0, 200);
  }
  if (title === null) {
    for (const raw of clean.split('\n')) {
      const line = raw.replace(/^[-•*#\s]+/, '').trim();
      if (!line || GENERIC.test(line) || /^rsvp\b/i.test(line) || /^[a-z]+\s*:/i.test(line)) continue;
      let rest = line;
      for (const m of [date?.match, time?.match, placeMatch]) if (m) rest = rest.replace(m, ' ');
      rest = tidy(rest);
      if (/\p{L}.*\p{L}/u.test(rest)) { title = rest.slice(0, 200); break; }
    }
  }
  if (place === null) {
    const line = clean.split('\n').map((l) => l.trim()).find((l) => l && l !== title && !l.startsWith(title ?? '\u0000') && VENUE.test(l) && !/^rsvp\b/i.test(l));
    if (line) place = tidy(line.replace(/^(at|in|@)\s+/i, ''));
  }
  // Shouted on the card ("MAYA'S 6th BIRTHDAY"): title case reads better on the calendar.
  if (title && !/\p{Ll}{2}/u.test(title.replace(/\b\d+(st|nd|rd|th)\b/gi, ''))) title = title.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  return { title: title || null, date: date?.date ?? null, time: time?.time ?? null, end: time?.end ?? null, place: place ? place.slice(0, 500) : null };
}
