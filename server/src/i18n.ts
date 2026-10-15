// The text the server writes for people, in their language: the same model as the web app
// (web/src/i18n.ts). English is the key: t('Not enough points') gives that language's entry from
// src/locales/<lang>.json, else the English, so nothing ever shows a blank or a key. The approach and
// the first German come from sudo-Foras666's fork (github.com/sudo-Foras666/kinwall, #31).
//
//   const { t, tc, tn } = words(lang)   in the function that writes the text (scripts/i18n-check.mjs
//                                        collects the English from these calls; pass `lang` down, not t)
//   msg('…') / tm(lang, label)          English kept in a constant, shown later
//
// Whose language:
// - A request's answer (errors, insights, the battery, the newscast, the refill card): the language
//   the screen shows, which the web app sends as Accept-Language; without one, the family's
//   (settings.language). MCP asks for English: its words are read by an assistant, not shown.
// - A push: the language of the device's owner (members.language), else the family's (loadSubs).
// - Text stored once for everyone (the in-app feed, security activity): the family's.
// Never translated: what the family typed, API values, logs, OpenAPI and MCP text, webhook payloads.
import type { Context } from 'hono';
import type { KinwallDb } from './db.ts';
import de from './locales/de.json' with { type: 'json' };

export type Lang = 'en' | 'de';
export const LANGS: readonly Lang[] = ['en', 'de'];
export const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);
const DICTS: Record<Lang, Record<string, string> | null> = { en: null, de };
/** For Intl formatters (dates, lists, numbers). */
export const LOCALES: Record<Lang, string> = { en: 'en-US', de: 'de-DE' };

type Vars = Record<string, string | number>;
const fill = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : text;
const plurals = new Map<Lang, Intl.PluralRules>();

/** Marks English kept in a constant so the check collects it; show it with tm(lang, text). */
export const msg = (text: string): string => text;
/** A msg() label in `lang`. */
export const tm = (lang: Lang, marked: string, vars?: Vars): string => fill(DICTS[lang]?.[marked] ?? marked, vars);

/** The translators for one language. */
export function words(lang: Lang) {
  const dict = DICTS[lang];
  const locale = LOCALES[lang];
  let rules = plurals.get(lang);
  if (!rules) plurals.set(lang, (rules = new Intl.PluralRules(locale)));
  const t = (text: string, vars?: Vars): string => fill(dict?.[text] ?? text, vars);
  /** Like t(), for a word that reads differently in one place ("context|text" in the dictionary). */
  const tc = (context: string, text: string, vars?: Vars): string => fill(dict?.[`${context}|${text}`] ?? dict?.[text] ?? text, vars);
  /** A count: `one` or `other` by the language's plural rules, with {n} formatted for it. */
  const tn = (n: number, one: string, other: string, vars?: Vars): string => {
    const all = { n: n.toLocaleString(locale), ...vars };
    const form = rules.select(n);
    const extra = dict?.[`${other}#${form}`];
    return extra ? fill(extra, all) : t(form === 'one' ? one : other, all);
  };
  /** "A, B, and C" / "A, B und C". */
  const list = (parts: string[]): string => new Intl.ListFormat(locale, { type: 'conjunction' }).format(parts);
  return { lang, locale, t, tc, tn, list };
}

/** The family's language (settings.language), English until a parent picks one. */
export async function familyLang(db: KinwallDb): Promise<Lang> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'language'").first<{ value: string }>();
  return isLang(row?.value) ? row.value : 'en';
}

/** The first language in an Accept-Language header that Kinwall comes in (by q), or null. */
export function headerLang(header: string | undefined | null): Lang | null {
  if (!header) return null;
  const ranked = header.split(',').map((part, i) => {
    const [tag, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return { base: tag.trim().toLowerCase().split('-')[0], q: q ? Number(q.slice(2)) || 0 : 1, i };
  }).filter((l) => l.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked.map((l) => l.base).find(isLang) ?? null;
}

/** The language a request's answer is written in: its Accept-Language, else the family's. */
export async function requestLang(c: Context<{ Bindings: { DB: KinwallDb } }>): Promise<Lang> {
  return headerLang(c.req.header('Accept-Language')) ?? familyLang(c.env.DB);
}

/** English text stored (or answered) now and translated when it's read: a security activity line,
 * an error kept in a constant. The check collects it as "context|text", like tc(). */
export const stored = (context: string, text: string, vars?: Vars): string => fill(text, vars);

/** Text stored in English (stored(), or an error a route wrote, maybe with values in it: `Only
 * ${name} can …`) in `lang`: its "context|…" entry, else the first of that context's templates it
 * fits ("error|Only {name} can …", values put back), else as it is. Only that context's keys are
 * templates, so a sentence from elsewhere can't be mistaken for one. app.ts runs every { error }
 * through it on the way out (context 'error'; the check collects `error:` in the code), so routes
 * keep writing English. */
export function translateStored(lang: Lang, context: string, text: string): string {
  const dict = DICTS[lang];
  if (!dict) return text;
  const key = `${context}|${text}`;
  if (Object.hasOwn(dict, key)) return dict[key];
  for (const t of templatesFor(lang, context)) {
    const m = t.re.exec(text);
    if (m) return fill(t.text, Object.fromEntries(t.names.map((n, i) => [n, m[i + 1]])));
  }
  return text;
}
export const translateError = (lang: Lang, message: string) => translateStored(lang, 'error', message);

type Template = { re: RegExp; names: string[]; text: string; literal: number };
const templates = new Map<string, Template[]>();
function templatesFor(lang: Lang, context: string): Template[] {
  const id = `${lang}:${context}`;
  let list = templates.get(id);
  if (list) return list;
  const prefix = `${context}|`;
  list = Object.entries(DICTS[lang] ?? {}).filter(([k]) => k.startsWith(prefix) && /\{\w+\}/.test(k)).map(([k, text]) => {
    const names: string[] = [];
    const source = k.slice(prefix.length).split(/(\{\w+\})/).map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      if (!name) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(name);
      return '(.+?)';
    }).join('');
    return { re: new RegExp(`^${source}$`, 's'), names, text, literal: k.length - names.join('').length };
  }).sort((a, b) => b.literal - a.literal); // the most specific first: "… {name} (a kid's device)" before "… {name}"
  templates.set(id, list);
  return list;
}

/** The translators for the language a request's answer is written in (requestLang). */
export const wordsFor = async (c: Context<{ Bindings: { DB: KinwallDb } }>) => words(await requestLang(c));

/** Builds text once per language, for a message going to several devices: perLang((lang) => …). */
export function perLang<T>(build: (lang: Lang) => T): (lang: Lang) => T {
  const made = new Map<Lang, T>();
  return (lang) => {
    if (!made.has(lang)) made.set(lang, build(lang));
    return made.get(lang)!;
  };
}
