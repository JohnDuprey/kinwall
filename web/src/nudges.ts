// Nudges: the headline of a transition reminder push and of the app's leave-by / start-prep Live
// Activity. The same words every time get tuned out, so the line varies, kindly (kids read these,
// so nothing that shames), and escalates as time runs out. Every line says what (the event or
// meal) and when (minutes, a time, or "now"), and stays short enough for a lock screen.
//
// Deterministic: the pick comes from a seed (person, event, day), the stage and the warning's
// ordinal, so a restart never reshuffles and consecutive warnings never repeat a line.
//
// Two copies, kept identical (a test checks): server/src/nudges.ts (pushes) and web/src/nudges.ts
// (the Live Activity payload). The Docker and web builds each see only their own folder.

export type NudgeKind = 'leave' | 'prep' | 'start';
export type NudgeStage = 'early' | 'mid' | 'soon' | 'now';

// {t} the event or meal, {m} minutes left ("15 min"), {at} the leave-by / prep-by / start time,
// {n} the person's first name (lines with it are only used when there is one), {e} an emoji.
export const POOLS: Record<NudgeKind, Record<NudgeStage, string[]>> = {
  leave: {
    early: ['{t} in {m}: find your shoes {e}', '{m} until you leave for {t} {e}', 'Heads up: leave for {t} at {at} {e}', 'Ready for {t}? Leave at {at} {e}', '{n}, leave for {t} at {at} {e}'],
    mid: ['{m} to leave for {t}. Shoes on? {e}', 'Leave in {m} for {t}. Bag ready? {e}', 'Leave at {at} for {t} {e}', 'Shoes on? Leave at {at} for {t} {e}', '{n}, {m} until {t}. Bag packed? {e}'],
    soon: ['{m} to go until {t}! {e}', 'Nearly there: leave for {t} in {m} {e}', 'Shoes, bag, go: {t} in {m} {e}', 'Almost go time: {t} at {at} {e}', 'Shoes on: {t} at {at} {e}', '{n}, leave for {t} in {m} {e}'],
    now: ['Leave now for {t}! {e}', 'Out the door now for {t}! {e}', 'Time to go now: {t} {e}', '{n}, leave now for {t} {e}'],
  },
  prep: {
    early: ['{t}: start prep by {at} {e}', 'Chef time for {t} in {m} {e}', 'Coming up: start {t} at {at} {e}', '{n}, {t} prep starts at {at} {e}'],
    mid: ['Chef time in {m}! {t} {e}', 'Prep {t} in {m}. Apron on? {e}', 'Prep for {t} starts at {at} {e}', 'Apron time at {at}: {t} {e}', '{n}, start {t} in {m} {e}'],
    soon: ['{m} to prep time: {t} {e}', 'Almost chef time! {t} in {m} {e}', 'Wash your hands: {t} prep in {m} {e}', 'Almost chef time: {t} at {at} {e}', 'Hands washed? {t} prep at {at} {e}', '{n}, {t} prep in {m} {e}'],
    now: ['Start prep now for {t}! {e}', 'Chef time: start {t} now {e}', 'Aprons on, {t} starts now {e}', '{n}, start {t} now {e}'],
  },
  start: {
    early: ['{t} in {m} {e}', 'Coming up at {at}: {t} {e}', 'Later today at {at}: {t} {e}', '{n}, {t} starts at {at} {e}'],
    mid: ['{m} until {t}. Time to wrap up {e}', '{t} in {m}: finish up {e}', 'Wrapping up? {t} starts at {at} {e}', 'Finish up soon: {t} at {at} {e}', '{n}, {t} in {m} {e}'],
    soon: ['{t} in {m}! {e}', 'Almost time: {t} in {m} {e}', 'Nearly there: {t} at {at} {e}', 'Get ready: {t} starts at {at} {e}', '{n}, {t} starts in {m} {e}'],
    now: ['{t} starts now {e}', 'Time for {t} now! {e}', 'Here we go: {t} starts now {e}', '{n}, {t} is starting now {e}'],
  },
};

export const EMOJI: Record<NudgeKind, string[]> = {
  leave: ['🚗', '👟', '🎒', '⏰', '🙌', '🚙'],
  prep: ['🍳', '🥄', '🧑‍🍳', '🥕', '🍅', '⏲️'],
  start: ['⏰', '✨', '🌟', '👋', '🎈'],
};

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

export type Nudge = {
  kind: NudgeKind;
  title: string;
  /** Minutes left to the leave-by / prep-by / start time; 0 or less is "now". */
  minutes: number;
  /** That time, formatted ("5:15 PM"). */
  at: string;
  /** Person, event and day ("m1:e7:2030-03-04"): the same seed gives the same lines. */
  seed: string;
  /** Which warning this is (0, 1, 2 …): consecutive ones get different lines. */
  ordinal?: number;
  /** The person's first name, used in some lines. */
  name?: string | null;
  calm?: boolean;
  /** A Live Activity's headline: it stays up while its own countdown ticks, so no "15 min" in it
   * (only lines with the time); it changes by stage. */
  live?: boolean;
};

export function nudge(n: Nudge): string {
  if (n.calm) return calmNudge(n.kind, n.title, n.minutes, n.live ? n.at : undefined);
  const stage = nudgeStage(n.minutes);
  const pool = POOLS[n.kind][stage].filter((line) => (n.name || !line.includes('{n}')) && !(n.live && line.includes('{m}')));
  const base = hash(`${n.seed}:${n.kind}:${stage}`) + (n.ordinal ?? 0);
  const emoji = EMOJI[n.kind][base % EMOJI[n.kind].length];
  return pool[base % pool.length]
    .replace('{t}', n.title)
    .replace('{m}', `${n.minutes} min`)
    .replace('{at}', n.at)
    .replace('{n}', n.name ?? '')
    .replace('{e}', emoji);
}
