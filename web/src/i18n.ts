// The app's display language. The approach and the German translation come from sudo-Foras666
// (github.com/sudo-Foras666/kinwall, feature request #31).
//
// English text is the key: t('Settings') shows the current language's entry from
// src/locales/<lang>.json, else the English, so a screen never shows a blank or a key.
// - Placeholders are {name}: t('Hi {name}', { name }). Keep whole sentences in one t(); never glue
//   translated pieces together.
// - A word that reads differently in one place gets a context: tc('now-next', 'Next') looks up
//   "now-next|Next" first.
// - Counts: tn(n, '{n} day', '{n} days'). A language with more plural forms adds entries keyed
//   "<other>#few", "<other>#many" and so on (the Intl.PluralRules names).
// - English text kept in a constant (a tab label, say) is marked with msg('Board') so the check
//   script collects it, and shown with tm(label) at render (t() itself only takes literal text).
// - Never call t() at module level: it would freeze in English before the language loads.
//
// No packages: the server's tests import web helpers that call t(). English ships in the code;
// other languages load on demand (setLang), so a wall in English never downloads German.
// scripts/i18n-check.mjs keeps en.json in step with the t() calls and checks every translation.
export type Lang = 'en' | 'de'
/** Each choice in its own language: what someone looks for when they can't read the rest. */
export const LANGUAGES: { key: Lang; label: string }[] = [
  { key: 'en', label: 'English' },
  { key: 'de', label: 'Deutsch' },
]
type Dict = Record<string, string>
const LOADERS: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Dict }>> = {
  de: () => import('./locales/de.json'),
}
export const isLang = (v: unknown): v is Lang => LANGUAGES.some(l => l.key === v)
export const languageName = (l: Lang) => LANGUAGES.find(x => x.key === l)!.label

/** Which language to show (first that's set wins):
 * 1. the member's own language, on a device that belongs to them (their phone, a kid's tablet)
 * 2. this device's pick (Settings → Only on this device), for walls and shared screens
 * 3. the family's language (Settings → Household)
 * 4. English
 * A shared wall stays in the family's (or its own) language when someone is picked: only
 * activities follow the player's language (playerLang). */
export function pickLang(p: { member?: string | null; device?: string | null; family?: string | null }): Lang {
  for (const l of [p.member, p.device, p.family]) if (isLang(l)) return l
  return 'en'
}
/** An activity's language: the player's own, else what the screen shows. */
export const playerLang = (member: string | null | undefined, shown: Lang): Lang => isLang(member) ? member : shown

let current: Lang = 'en'
let dict: Dict | null = null
let plurals = new Intl.PluralRules('en')
let generation = 0
export const lang = (): Lang => current

/** Loads `next`'s words, then switches everything rendered from now on to it. If another setLang
 * started meanwhile, the later one wins. */
export async function setLang(next: Lang, load = (l: Exclude<Lang, 'en'>) => LOADERS[l]().then(m => m.default)): Promise<void> {
  const mine = ++generation
  const words = next === 'en' ? null : await load(next)
  if (mine !== generation) return
  current = next
  dict = words
  plurals = new Intl.PluralRules(next)
  if (typeof document !== 'undefined') document.documentElement.lang = next
}

// The last language shown here, so the first paint (before the family loads) is already in it.
const LAST_KEY = 'kinwall.lastLang'
export function rememberLang(l: Lang) {
  try { if (localStorage.getItem(LAST_KEY) !== l) localStorage.setItem(LAST_KEY, l) } catch { /* storage blocked */ }
}
export function startLang(): Lang {
  try { const l = localStorage.getItem(LAST_KEY); return isLang(l) ? l : 'en' } catch { return 'en' }
}

/** For Intl formatters: the browser's own locale when it's this language (so en-GB and de-AT keep
 * their regional formats), else the language itself. */
export function intlLocale(own = typeof navigator === 'undefined' ? undefined : navigator.language, of: Lang = current): string {
  return own && own.toLowerCase().split('-')[0] === of ? own : of
}

let currency = 'USD'
/** The family's currency for prices (settings.currency, an ISO 4217 code; USD until a parent picks one). */
export const setCurrency = (code: string | null | undefined) => { currency = code || 'USD' }
/** A price in the family's currency and language: "$12.99", "12,99 €"; whole amounts without cents ("$12"). */
export const money = (cents: number): string =>
  new Intl.NumberFormat(intlLocale(), { style: 'currency', currency, ...(cents % 100 ? {} : { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }).format(cents / 100)

type Vars = Record<string, string | number>
const fill = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : text

/** Marks English kept in a constant (a tab's label) so the check script collects it. Show it with
 * tm(label) at render. */
export const msg = (text: string): string => text

/** `text` (English) in the current language, with its {placeholders} filled in. */
export const t = (text: string, vars?: Vars): string => fill(dict?.[text] ?? text, vars)

/** t() for text that isn't written right here: a label marked with msg() where it's defined. */
export const tm = (marked: string, vars?: Vars): string => t(marked, vars)

/** Like t(), for a word that reads differently in one place ("context|text" in the dictionary). */
export const tc = (context: string, text: string, vars?: Vars): string =>
  fill(dict?.[`${context}|${text}`] ?? dict?.[text] ?? text, vars)

/** A count: `one` or `other` by the language's plural rules, with {n} formatted for it. */
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  const all = { n: n.toLocaleString(intlLocale()), ...vars }
  const form = plurals.select(n)
  const extra = dict?.[`${other}#${form}`]
  return extra ? fill(extra, all) : t(form === 'one' ? one : other, all)
}

// Dates in the current language (Intl, not date-fns patterns, so the word order is the language's own).
export const DAY: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' } // Wed, Oct 8 / Mi., 8. Okt.
export const LONG_DAY: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' } // Wednesday, October 8
export const MONTH_DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' } // Oct 8
/** `d` in the current language. A calendar day built from its date key (new Date(y, m, d)) needs no
 * timeZone; a moment (a timestamp) takes the household's, so every screen shows the family's day. */
export const formatDate = (d: Date, opts: Intl.DateTimeFormatOptions, timeZone?: string) =>
  new Intl.DateTimeFormat(intlLocale(), timeZone ? { ...opts, timeZone } : opts).format(d)
