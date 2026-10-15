// Nudges: the headline of a transition reminder push and of the app's leave-by / start-prep Live
// Activity. The same words every time get tuned out, so the line varies, kindly (kids read these,
// so nothing that shames), and escalates as time runs out. Every line says what (the event or
// meal) and when (minutes, a time, or "now"), and stays short enough for a lock screen.
//
// A line is composed from parts: an opener ("Heads up:", "Maya!", none), a core with the facts,
// a hint ("Grab your bag", or one for the event: "Cleats on?" for soccer, the recipe's first step
// for a meal) and an emoji. Hundreds of combinations per stage, each grammatical by construction.
// Too long for a lock screen: the hint goes first, then the opener.
//
// Deterministic: candidates come in an order fixed by a seed (person, event, day), the stage and
// the warning's ordinal; the first that isn't in the person's recent history (NudgeSeen, the last
// NUDGE_MEMORY lines: its core and hint, and the opener of the last one) wins. The history is
// part indexes, never text: members.nudges on the server (pushes), localStorage on the device
// (the Live Activity).
//
// One file for the server's pushes and the web app's Live Activity (web/src/nudges.ts re-exports
// it; the Docker web stage copies it in), so it imports nothing. Its English is marked with its own
// msg() (the i18n check collects it); a caller passes a translator (`NudgeWords`, i18n.ts words(lang))
// to write a line in another language. Which line is picked never depends on the language: the
// choice is made in English, then that same opener, core and hint are written in the language.

export type NudgeKind = 'leave' | 'prep' | 'start';
export type NudgeStage = 'early' | 'mid' | 'soon' | 'now';

/** Marks English for the i18n check (this file can't import i18n.ts). */
const msg = (text: string) => text;
type Vars = Record<string, string | number>;
const fillVars = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : s);
/** A translator: server/src/i18n.ts words(lang).t and its language. Without one, English. */
export type NudgeWords = { t: (text: string, vars?: Vars) => string; lang: string };
const EN: NudgeWords = { t: fillVars, lang: 'en' };
/** "15 min" (the {m} in a core). */
const MIN = msg('{n} min');

/** How many recent lines a person's next one avoids. */
export const NUDGE_MEMORY = 10;
const MAX = 60;

// Openers, before the core. `lower`: the core after it starts lowercase ("Heads up: leave…").
// `now`: short enough for the last, plainest stage. {n} ones only when there's a name.
export const OPENERS: { text: string; lower: boolean; now?: boolean }[] = [
  { text: '', lower: false, now: true },
  { text: msg('Heads up:'), lower: true },
  { text: msg('Psst,'), lower: true },
  { text: msg('Quick one:'), lower: true },
  { text: msg('Friendly reminder:'), lower: true },
  { text: msg('Okay,'), lower: true, now: true },
  { text: msg('{n}!'), lower: false, now: true },
  { text: msg('Hey {n},'), lower: true },
];

// Cores: the facts. {t} the event or meal, {m} minutes left ("15 min"), {at} the leave-by /
// prep-by / start time. No colons (an opener may have one) and no name (openers carry it).
// Each stage has at least two without {m}, for a Live Activity (its own countdown ticks).
export const CORES: Record<NudgeKind, Record<NudgeStage, string[]>> = {
  leave: {
    early: [msg('Leave for {t} at {at}'), msg('{m} until you leave for {t}'), msg('Leave at {at} for {t}'), msg('You leave for {t} at {at}'), msg('{t} is in {m}. Leave at {at}'), msg('Plan to leave at {at} for {t}')],
    mid: [msg('{m} to leave for {t}'), msg('Leave in {m} for {t}'), msg('Leave at {at} for {t}'), msg('Out the door at {at} for {t}'), msg('Get ready for {t}. Leave at {at}'), msg('Leave for {t} in {m}')],
    soon: [msg('{m} left to leave for {t}'), msg('Leave for {t} in {m}!'), msg('Almost go time! {t} at {at}'), msg('Nearly there! Leave for {t} in {m}'), msg('Leave at {at} for {t}!'), msg('Go time for {t} is {at}')],
    now: [msg('Leave now for {t}!'), msg('Out the door now for {t}!'), msg('Time to go to {t} now!'), msg('Go now for {t}!'), msg('Head out now for {t}')],
  },
  prep: {
    early: [msg('Start prep for {t} at {at}'), msg('{t} prep starts at {at}'), msg('Chef time for {t} in {m}'), msg('{m} until {t} prep'), msg('Cooking {t} starts at {at}'), msg('Plan to start {t} at {at}')],
    mid: [msg('Start {t} in {m}'), msg('Chef time in {m} for {t}'), msg('Prep for {t} starts at {at}'), msg('{t} prep in {m}'), msg('Kitchen time at {at} for {t}'), msg('Start {t} at {at}')],
    soon: [msg('{m} to prep time for {t}'), msg('Almost chef time! {t} in {m}'), msg('{t} prep starts in {m}'), msg('Nearly chef time! {t} at {at}'), msg('Start {t} at {at}!'), msg('Kitchen in {m} for {t}')],
    now: [msg('Start prep now for {t}!'), msg('Chef time! Start {t} now'), msg('Time to cook {t} now'), msg('{t} prep starts now'), msg('Start {t} now!')],
  },
  start: {
    early: [msg('{t} in {m}'), msg('{t} starts at {at}'), msg('{t} is at {at}'), msg('{m} until {t}'), msg('Next up at {at} is {t}'), msg('{t} is coming up at {at}')],
    mid: [msg('{m} until {t}'), msg('{t} starts in {m}'), msg('{t} at {at}. Finish up soon'), msg('Finish up soon for {t} at {at}'), msg('{t} is in {m}'), msg('Get ready for {t} at {at}')],
    soon: [msg('{t} in {m}!'), msg('Almost time! {t} in {m}'), msg('Nearly there! {t} at {at}'), msg('Get ready, {t} starts at {at}'), msg('{t} starts in {m}'), msg('{t} is almost here, at {at}')],
    now: [msg('{t} starts now'), msg('Time for {t} now!'), msg('Here we go! {t} now'), msg('{t} is starting now'), msg('{t}, starting now')],
  },
};

export const EMOJI: Record<NudgeKind, string[]> = {
  leave: ['🚗', '👟', '🎒', '⏰', '🙌', '🚙'],
  prep: ['🍳', '🥄', '🧑‍🍳', '🥕', '🍅', '⏲️'],
  start: ['⏰', '✨', '🌟', '👋', '🎈'],
};

// Hints: a sentence after the core. Always kind, and nothing medical past "Insurance card?".
export const GENERAL_HINTS: Record<NudgeKind, string[]> = {
  leave: [msg('Find your shoes'), msg('Grab your bag'), msg('Water bottle?'), msg('Shoes on?'), msg('Jacket?'), msg('Bathroom stop first?')],
  prep: [msg('Wash your hands'), msg('Apron on'), msg('Clear the counter'), msg('Pans out?'), msg('Hands washed?')],
  start: [msg('Time to wrap up'), msg('Find a stopping spot'), msg('Bathroom break?'), msg('Water bottle?'), msg('Save your game')],
};

// The event's hints: the first set whose words match its category (name and emoji) or title, in
// English or German (a family's own names for things).
// Leave and start only; a meal's prep is about cooking (and its recipe's first step).
export const HINT_SETS: { key: string; match: RegExp; hints: string[]; emoji: string[] }[] = [
  { key: 'soccer', match: /soccer|fu(ß|ss)ball|⚽/iu, hints: [msg('Cleats on?'), msg('Shin guards?'), msg('Water bottle?'), msg('Ball in the bag?')], emoji: ['⚽', '🥅', '👟'] },
  { key: 'swim', match: /\bswim|\bpool\b|schwimm|hallenbad|freibad|🏊/iu, hints: [msg('Swimsuit packed?'), msg('Towel and goggles?'), msg('Water bottle?')], emoji: ['🏊', '🩱', '🥽'] },
  { key: 'sports', match: /sport|practice|basketball|baseball|softball|football|hockey|tennis|lacrosse|karate|gymnastics|dance|\bgym\b|training|turnen|tanz|handball|🏀|⚾|🏈|🏒|🎾|🥋|🤸|🏃/iu, hints: [msg('Water bottle?'), msg('Gear bag packed?'), msg('Uniform on?'), msg('Snack for after?')], emoji: ['🏃', '🏅', '👟'] },
  { key: 'music', match: /music|piano|guitar|violin|viola|cello|drum|\bband\b|orchestra|choir|recital|lesson|musik|klavier|gitarre|geige|schlagzeug|orchester|\bchor\b|🎹|🎸|🎻|🎵|🎶|🥁|🎺/iu, hints: [msg('Bring your music'), msg('Instrument packed?'), msg('Music book in the bag?')], emoji: ['🎶', '🎹', '🎻', '🎵'] },
  { key: 'school', match: /school|class|\bbus\b|homework|schule|hausaufgabe|\bkita\b|kindergarten|📚|🏫|🚌/iu, hints: [msg('Backpack and lunch?'), msg('Homework in the bag?'), msg('Lunch packed?'), msg('Jacket for recess?')], emoji: ['🎒', '🚌', '📚'] },
  { key: 'dentist', match: /dentist|dental|orthodont|zahnarzt|kieferorthop|🦷/iu, hints: [msg('Brush first'), msg('Insurance card?')], emoji: ['🦷', '🪥'] },
  { key: 'doctor', match: /doctor|\bdr\b|pediatric|checkup|check-up|clinic|appointment|arzt|ärztin|praxis|🩺|🏥/iu, hints: [msg('Insurance card?'), msg('Book for the waiting room?')], emoji: ['🪪', '🚗'] },
  { key: 'party', match: /party|birthday|geburtstag|feier|🎂|🎉|🥳/iu, hints: [msg('Gift wrapped?'), msg('Card signed?'), msg('Gift in the car?')], emoji: ['🎉', '🎁', '🎈'] },
];

export function hintSet(kind: NudgeKind, title: string, category?: string | null) {
  if (kind === 'prep') return null;
  const text = `${category ?? ''} ${title}`;
  return HINT_SETS.find((s) => s.match.test(text)) ?? null;
}

/** A recipe's first step as a hint ("Brown the beef"): its title, else its first bullet, else its
 * first sentence, when that's short enough to fit beside a meal's title. Null otherwise. */
export function stepHint(step: { title?: string | null; text: string; bullets?: string[] } | null | undefined): string | null {
  const first = (step?.title || step?.bullets?.[0] || step?.text || '').split(/[.;!\n]/)[0].trim().replace(/[,:]$/, '');
  return first && first.length <= 18 ? first[0].toUpperCase() + first.slice(1) : null;
}

/** A meal's event title without its slot ("Dinner · Tuesday Tacos" -> "Tuesday Tacos"), for when
 * the meal's own name isn't at hand. */
export const mealName = (title: string) => title.replace(/^(Breakfast|Lunch|Dinner|Snack) · /, '');

// Low stimulation: whole sentences, so each language words them its own way.
const CALM: Record<NudgeKind, { now: string; at: string; in: string }> = {
  leave: { now: msg('Leave for {t} now'), at: msg('Leave for {t} at {at}'), in: msg('Leave for {t} in {m}') },
  prep: { now: msg('Start prep for {t} now'), at: msg('Start prep for {t} at {at}'), in: msg('Start prep for {t} in {m}') },
  start: { now: msg('{t} starts now'), at: msg('{t} at {at}'), in: msg('{t} in {m}') },
};

/** Low-stimulation: one plain line, the same every time. With `at`, the time instead of minutes left. */
export function calmNudge(kind: NudgeKind, title: string, minutes: number, at?: string, w: NudgeWords = EN): string {
  return w.t(CALM[kind][minutes <= 0 ? 'now' : at ? 'at' : 'in'], { t: title, at: at ?? '', m: w.t(MIN, { n: minutes }) });
}

/** More than 15 minutes out, 6 to 15, 1 to 5, or time's up. */
export function nudgeStage(minutes: number): NudgeStage {
  return minutes <= 0 ? 'now' : minutes <= 5 ? 'soon' : minutes <= 15 ? 'mid' : 'early';
}

// FNV-1a: small, stable across runtimes.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** One line: its parts, then shortened to fit (hint dropped, then opener). `hint` and `emoji` are the
 * text (the hint already in the line's language). `w` writes the opener and core in a language;
 * German keeps the core's capital after an opener (its openers end in ":" or "!"). */
export function compose(kind: NudgeKind, stage: NudgeStage, parts: { opener: number; core: number; hint: string; emoji: string }, v: { t: string; m: string; at: string; n: string }, w: NudgeWords = EN) {
  const english = CORES[kind][stage][parts.core];
  const core = w.t(english);
  // Never two "!" in a line: an excited opener before an excited core goes (no opener instead).
  // Decided in English, so the same parts are kept in every language.
  const opener = OPENERS[parts.opener].text.includes('!') && english.includes('!') ? OPENERS[0] : OPENERS[parts.opener];
  const said = (o: { text: string }) => (o.text ? w.t(o.text) : '');
  const fill = (s: string) => fillVars(s, { t: v.t, m: v.m, at: v.at, n: v.n });
  const lower = (s: string) => (opener.lower && w.lang === 'en' && !s.startsWith('{') ? s[0].toLowerCase() + s.slice(1) : s);
  const render = (o: string, h: string) => `${o ? `${fill(o)} ${fill(lower(core))}` : fill(core)}${h ? `${/[!?.]$/.test(core) ? ' ' : '. '}${h}` : ''} ${parts.emoji}`;
  let hint = parts.hint, o = said(opener);
  if ([...render(o, hint)].length > MAX) hint = '';
  if ([...render(o, hint)].length > MAX) o = '';
  return { line: render(o, hint), hint, opener: o ? parts.opener : 0, whole: hint === parts.hint && o === said(OPENERS[parts.opener]) };
}

export type Nudge = {
  kind: NudgeKind;
  title: string;
  /** Minutes left to the leave-by / prep-by / start time; 0 or less is "now". */
  minutes: number;
  /** That time, formatted ("5:15 PM"). */
  at: string;
  /** Person, event and day ("m1:e7:2030-03-04"): the same seed and history give the same line. */
  seed: string;
  /** Which warning this is (0, 1, 2 …). */
  ordinal?: number;
  /** The person's first name, used by some openers. */
  name?: string | null;
  /** The event's category, name and emoji ("Soccer ⚽"): picks its hints, with the title. */
  category?: string | null;
  /** A meal's first recipe step as a hint (stepHint). */
  step?: string | null;
  calm?: boolean;
  /** A Live Activity's headline: it stays up while its own countdown ticks, so no "15 min" in it
   * (only cores with the time); it holds for its stage. */
  live?: boolean;
};

/** A line the person saw: `id` names the warning it was for, `combo` its core and hint, `opener` its opener. */
export type NudgeSeen = { id: string; combo: string; opener: number };

/** The history with `entry` added (once per id), the last NUDGE_MEMORY kept. */
export function rememberNudge(seen: NudgeSeen[], entry: NudgeSeen): NudgeSeen[] {
  return [...seen.filter((s) => s.id !== entry.id), entry].slice(-NUDGE_MEMORY);
}

/** The line, and what to remember (null for low stimulation). `fresh`: not already in `seen`
 * (a Live Activity's headline for the same stage comes back as it was). */
export function pickNudge(n: Nudge, seen: NudgeSeen[] = [], w: NudgeWords = EN): { line: string; seen: NudgeSeen | null; fresh: boolean } {
  if (n.calm) return { line: calmNudge(n.kind, n.title, n.minutes, n.live ? n.at : undefined, w), seen: null, fresh: false };
  const stage = nudgeStage(n.minutes);
  const set = hintSet(n.kind, n.title, n.category);
  const openers = OPENERS.map((o, i) => ({ o, i })).filter(({ o }) => (n.name || !o.text.includes('{n}')) && (stage !== 'now' || o.now)).map(({ i }) => i);
  const cores = CORES[n.kind][stage].map((c, i) => ({ c, i })).filter(({ c }) => !(n.live && c.includes('{m}'))).map(({ i }) => i);
  // The event's own hints (and a recipe's first step) are listed twice: they're the useful ones.
  const own = [...(n.kind === 'prep' && n.step ? [{ key: 'step', text: n.step }] : []), ...(set?.hints.map((text, i) => ({ key: `${set.key}.${i}`, text })) ?? [])];
  const hints = [
    ...own,
    ...own,
    ...GENERAL_HINTS[n.kind].map((text, i) => ({ key: `${n.kind}.${i}`, text })),
    { key: '-', text: '' },
  ].filter((h) => stage !== 'now' || h.text.length <= 16); // "now": short and punchy
  const emoji = set?.emoji ?? EMOJI[n.kind];
  const id = String(hash(`${n.seed}:${n.kind}:${stage}:${n.live ? 'live' : n.ordinal ?? 0}`));
  const v = { t: n.title, m: fillVars(MIN, { n: n.minutes }), at: n.at, n: n.name ?? '' };

  const candidate = (k: number) => {
    const h = (salt: string) => hash(`${id}:${k}:${salt}`);
    const core = cores[h('c') % cores.length], hint = hints[h('h') % hints.length];
    const parts = { opener: openers[h('o') % openers.length], core, hint: hint.text, emoji: emoji[h('e') % emoji.length] };
    const c = compose(n.kind, stage, parts, v);
    // The line in w's language: the parts the English kept (a recipe's step is the family's words).
    const said = () => w.lang === 'en' ? c.line : compose(n.kind, stage, { ...parts, opener: c.opener, hint: !c.hint ? '' : hint.key === 'step' ? hint.text : w.t(hint.text) }, { ...v, m: w.t(MIN, { n: n.minutes }) }, w).line;
    return { line: c.line, said, whole: c.whole, seen: { id, combo: `${n.kind}.${stage}.${core}.${c.hint ? hint.key : '-'}`, opener: c.opener } };
  };
  const recent = seen.slice(-NUDGE_MEMORY), last = recent[recent.length - 1];
  const tries = Array.from({ length: 64 }, (_, k) => candidate(k));
  const held = recent.find((s) => s.id === id);
  if (held) {
    const same = tries.find((c) => c.seen.combo === held.combo && c.seen.opener === held.opener);
    if (same) return { line: same.said(), seen: same.seen, fresh: false };
  }
  const others = recent.filter((s) => s.id !== id);
  const newCombo = (c: (typeof tries)[number]) => !others.some((s) => s.combo === c.seen.combo);
  // Best: whole (nothing dropped to fit) with a hint not in the last 3; then whole; then a new
  // opener; then just a new core and hint.
  const hintOf = (combo: string) => combo.split('.').slice(3).join('.');
  const recentHints = others.slice(-3).map((s) => hintOf(s.combo)).filter((h) => h !== '-');
  const fresh = (c: (typeof tries)[number]) => newCombo(c) && c.seen.opener !== last?.opener;
  const pick = tries.find((c) => c.whole && fresh(c) && !recentHints.includes(hintOf(c.seen.combo))) ?? tries.find((c) => c.whole && fresh(c)) ?? tries.find(fresh) ?? tries.find(newCombo) ?? tries[0];
  return { line: pick.said(), seen: pick.seen, fresh: true };
}

// Medicine follow-ups (notify.ts runMedicationReminders): one more push partway through a late window
// longer than 3 hours. Same tone as the rest: kind, never "missed" or "late", and nothing urgent.
// {n} the person, {at} when the window closes ("8 PM"). Never the medicine: that's the push body,
// and only on a device that opted into names. One per dose, picked by the dose (the seed), whatever
// the language. (German says "die Medikamente von {n}": no English possessive.)
export const MED_FOLLOWUPS = [
  msg("Still time for {n}'s medicine (until {at})"),
  msg("No rush: {n}'s medicine is good until {at}"),
  msg("{n}'s medicine can still be taken until {at}"),
  msg("Whenever you're ready: {n}'s medicine, until {at}"),
  msg("A gentle nudge for {n}'s medicine (until {at})"),
];
export const medFollowup = (name: string, at: string, seed: string, w: NudgeWords = EN) => w.t(MED_FOLLOWUPS[hash(seed) % MED_FOLLOWUPS.length], { n: name, at });

export function nudge(n: Nudge, seen: NudgeSeen[] = [], w: NudgeWords = EN): string {
  return pickNudge(n, seen, w).line;
}
