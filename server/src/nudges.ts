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
// Two copies, kept identical (a test checks): server/src/nudges.ts (pushes) and web/src/nudges.ts
// (the Live Activity payload). The Docker and web builds each see only their own folder.

export type NudgeKind = 'leave' | 'prep' | 'start';
export type NudgeStage = 'early' | 'mid' | 'soon' | 'now';

/** How many recent lines a person's next one avoids. */
export const NUDGE_MEMORY = 10;
const MAX = 60;

// Openers, before the core. `lower`: the core after it starts lowercase ("Heads up: leave…").
// `now`: short enough for the last, plainest stage. {n} ones only when there's a name.
export const OPENERS: { text: string; lower: boolean; now?: boolean }[] = [
  { text: '', lower: false, now: true },
  { text: 'Heads up:', lower: true },
  { text: 'Psst,', lower: true },
  { text: 'Quick one:', lower: true },
  { text: 'Friendly reminder:', lower: true },
  { text: 'Okay,', lower: true, now: true },
  { text: '{n}!', lower: false, now: true },
  { text: 'Hey {n},', lower: true },
];

// Cores: the facts. {t} the event or meal, {m} minutes left ("15 min"), {at} the leave-by /
// prep-by / start time. No colons (an opener may have one) and no name (openers carry it).
// Each stage has at least two without {m}, for a Live Activity (its own countdown ticks).
export const CORES: Record<NudgeKind, Record<NudgeStage, string[]>> = {
  leave: {
    early: ['Leave for {t} at {at}', '{m} until you leave for {t}', 'Leave at {at} for {t}', 'You leave for {t} at {at}', '{t} is in {m}. Leave at {at}', 'Plan to leave at {at} for {t}'],
    mid: ['{m} to leave for {t}', 'Leave in {m} for {t}', 'Leave at {at} for {t}', 'Out the door at {at} for {t}', 'Get ready for {t}. Leave at {at}', 'Leave for {t} in {m}'],
    soon: ['{m} left to leave for {t}', 'Leave for {t} in {m}!', 'Almost go time! {t} at {at}', 'Nearly there! Leave for {t} in {m}', 'Leave at {at} for {t}!', 'Go time for {t} is {at}'],
    now: ['Leave now for {t}!', 'Out the door now for {t}!', 'Time to go to {t} now!', 'Go now for {t}!', '{t} time! Leave now'],
  },
  prep: {
    early: ['Start prep for {t} at {at}', '{t} prep starts at {at}', 'Chef time for {t} in {m}', '{m} until {t} prep', 'Cooking {t} starts at {at}', 'Plan to start {t} at {at}'],
    mid: ['Start {t} in {m}', 'Chef time in {m} for {t}', 'Prep for {t} starts at {at}', '{t} prep in {m}', 'Kitchen time at {at} for {t}', 'Start {t} at {at}'],
    soon: ['{m} to prep time for {t}', 'Almost chef time! {t} in {m}', '{t} prep starts in {m}', 'Nearly chef time! {t} at {at}', 'Start {t} at {at}!', 'Kitchen in {m} for {t}'],
    now: ['Start prep now for {t}!', 'Chef time! Start {t} now', 'Time to cook {t} now', '{t} prep starts now', 'Start {t} now!'],
  },
  start: {
    early: ['{t} in {m}', '{t} starts at {at}', '{t} is at {at}', '{m} until {t}', 'Next up at {at} is {t}', '{t} is coming up at {at}'],
    mid: ['{m} until {t}', '{t} starts in {m}', '{t} at {at}. Finish up soon', 'Finish up soon for {t} at {at}', '{t} is in {m}', 'Get ready for {t} at {at}'],
    soon: ['{t} in {m}!', 'Almost time! {t} in {m}', 'Nearly there! {t} at {at}', 'Get ready, {t} starts at {at}', '{t} starts in {m}', '{t} is almost here, at {at}'],
    now: ['{t} starts now', 'Time for {t} now!', 'Here we go! {t} now', '{t} is starting now', "It's {t} time now!"],
  },
};

export const EMOJI: Record<NudgeKind, string[]> = {
  leave: ['🚗', '👟', '🎒', '⏰', '🙌', '🚙'],
  prep: ['🍳', '🥄', '🧑‍🍳', '🥕', '🍅', '⏲️'],
  start: ['⏰', '✨', '🌟', '👋', '🎈'],
};

// Hints: a sentence after the core. Always kind, and nothing medical past "Insurance card?".
export const GENERAL_HINTS: Record<NudgeKind, string[]> = {
  leave: ['Find your shoes', 'Grab your bag', 'Water bottle?', 'Shoes on?', 'Jacket?', 'Bathroom stop first?'],
  prep: ['Wash your hands', 'Apron on', 'Clear the counter', 'Pans out?', 'Hands washed?'],
  start: ['Time to wrap up', 'Find a stopping spot', 'Bathroom break?', 'Water bottle?', 'Save your game'],
};

// The event's hints: the first set whose words match its category (name and emoji) or title.
// Leave and start only; a meal's prep is about cooking (and its recipe's first step).
export const HINT_SETS: { key: string; match: RegExp; hints: string[]; emoji: string[] }[] = [
  { key: 'soccer', match: /soccer|⚽/iu, hints: ['Cleats on?', 'Shin guards?', 'Water bottle?', 'Ball in the bag?'], emoji: ['⚽', '🥅', '👟'] },
  { key: 'swim', match: /\bswim|\bpool\b|🏊/iu, hints: ['Swimsuit packed?', 'Towel and goggles?', 'Water bottle?'], emoji: ['🏊', '🩱', '🥽'] },
  { key: 'sports', match: /sport|practice|basketball|baseball|softball|football|hockey|tennis|lacrosse|karate|gymnastics|dance|\bgym\b|🏀|⚾|🏈|🏒|🎾|🥋|🤸|🏃/iu, hints: ['Water bottle?', 'Gear bag packed?', 'Uniform on?', 'Snack for after?'], emoji: ['🏃', '🏅', '👟'] },
  { key: 'music', match: /music|piano|guitar|violin|viola|cello|drum|\bband\b|orchestra|choir|recital|lesson|🎹|🎸|🎻|🎵|🎶|🥁|🎺/iu, hints: ['Bring your music', 'Instrument packed?', 'Music book in the bag?'], emoji: ['🎶', '🎹', '🎻', '🎵'] },
  { key: 'school', match: /school|class|\bbus\b|homework|📚|🏫|🚌/iu, hints: ['Backpack and lunch?', 'Homework in the bag?', 'Lunch packed?', 'Jacket for recess?'], emoji: ['🎒', '🚌', '📚'] },
  { key: 'dentist', match: /dentist|dental|orthodont|🦷/iu, hints: ['Brush first', 'Insurance card?'], emoji: ['🦷', '🪥'] },
  { key: 'doctor', match: /doctor|\bdr\b|pediatric|checkup|check-up|clinic|appointment|🩺|🏥/iu, hints: ['Insurance card?', 'Book for the waiting room?'], emoji: ['🪪', '🚗'] },
  { key: 'party', match: /party|birthday|🎂|🎉|🥳/iu, hints: ['Gift wrapped?', 'Card signed?', 'Gift in the car?'], emoji: ['🎉', '🎁', '🎈'] },
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

/** Low-stimulation: one plain line, the same every time. With `at`, the time instead of minutes left. */
export function calmNudge(kind: NudgeKind, title: string, minutes: number, at?: string): string {
  const when = minutes <= 0 ? 'now' : at ? `at ${at}` : `in ${minutes} min`;
  return kind === 'leave' ? `Leave for ${title} ${when}` : kind === 'prep' ? `Start prep for ${title} ${when}` : `${title} ${minutes > 0 ? when : 'starts now'}`;
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

/** One line: its parts, then shortened to fit (hint dropped, then opener). `hint` and `emoji` are the text. */
export function compose(kind: NudgeKind, stage: NudgeStage, parts: { opener: number; core: number; hint: string; emoji: string }, v: { t: string; m: string; at: string; n: string }) {
  const opener = OPENERS[parts.opener];
  const core = CORES[kind][stage][parts.core];
  const fill = (s: string) => s.replace('{t}', v.t).replace('{m}', v.m).replace('{at}', v.at).replace('{n}', v.n);
  const lower = (s: string) => (opener.lower && !s.startsWith('{') ? s[0].toLowerCase() + s.slice(1) : s);
  const render = (o: string, h: string) => `${o ? `${fill(o)} ${fill(lower(core))}` : fill(core)}${h ? `${/[!?.]$/.test(core) ? ' ' : '. '}${h}` : ''} ${parts.emoji}`;
  let hint = parts.hint, o = opener.text;
  if ([...render(o, hint)].length > MAX) hint = '';
  if ([...render(o, hint)].length > MAX) o = '';
  return { line: render(o, hint), hint, opener: o ? parts.opener : 0, whole: hint === parts.hint && o === opener.text };
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
export function pickNudge(n: Nudge, seen: NudgeSeen[] = []): { line: string; seen: NudgeSeen | null; fresh: boolean } {
  if (n.calm) return { line: calmNudge(n.kind, n.title, n.minutes, n.live ? n.at : undefined), seen: null, fresh: false };
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
  const v = { t: n.title, m: `${n.minutes} min`, at: n.at, n: n.name ?? '' };

  const candidate = (k: number) => {
    const h = (salt: string) => hash(`${id}:${k}:${salt}`);
    const core = cores[h('c') % cores.length], hint = hints[h('h') % hints.length];
    const c = compose(n.kind, stage, { opener: openers[h('o') % openers.length], core, hint: hint.text, emoji: emoji[h('e') % emoji.length] }, v);
    return { line: c.line, whole: c.whole, seen: { id, combo: `${n.kind}.${stage}.${core}.${c.hint ? hint.key : '-'}`, opener: c.opener } };
  };
  const recent = seen.slice(-NUDGE_MEMORY), last = recent[recent.length - 1];
  const tries = Array.from({ length: 64 }, (_, k) => candidate(k));
  const held = recent.find((s) => s.id === id);
  if (held) {
    const same = tries.find((c) => c.seen.combo === held.combo && c.seen.opener === held.opener);
    if (same) return { line: same.line, seen: same.seen, fresh: false };
  }
  const others = recent.filter((s) => s.id !== id);
  const newCombo = (c: (typeof tries)[number]) => !others.some((s) => s.combo === c.seen.combo);
  // Best: whole (nothing dropped to fit) with a hint not in the last 3; then whole; then a new
  // opener; then just a new core and hint.
  const hintOf = (combo: string) => combo.split('.').slice(3).join('.');
  const recentHints = others.slice(-3).map((s) => hintOf(s.combo)).filter((h) => h !== '-');
  const fresh = (c: (typeof tries)[number]) => newCombo(c) && c.seen.opener !== last?.opener;
  const pick = tries.find((c) => c.whole && fresh(c) && !recentHints.includes(hintOf(c.seen.combo))) ?? tries.find((c) => c.whole && fresh(c)) ?? tries.find(fresh) ?? tries.find(newCombo) ?? tries[0];
  return { line: pick.line, seen: pick.seen, fresh: true };
}

export function nudge(n: Nudge, seen: NudgeSeen[] = []): string {
  return pickNudge(n, seen).line;
}
