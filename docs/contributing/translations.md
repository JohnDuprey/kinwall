# Translations

Kinwall is available in English and German (Deutsch). German covers every screen of the web app and
the text the server writes for people: push notifications, the newscast, insights, the battery,
error messages and more (see [What's translated](#whats-translated)). The phone apps' own screens
follow the phone's language and are still English.

The German translation is by [sudo-Foras666](https://github.com/sudo-Foras666), from their
[German fork](https://github.com/sudo-Foras666/kinwall): the web app's and the server's German, and
the way Kinwall handles translations. Thank you!

How a family picks a language is in [Settings → General](../settings/general.md#language).

## Which language shows where

* **The family's language** (Settings → General → Household) is the default for everyone: every
  screen, the wall, the notifications in the bell, and the server's text.
* **A member's own language** (Settings → Language, or a parent sets it) is for their own phone or
  tablet, and for the pushes that go to it. A shared wall stays in the family's language; when
  someone taps their face, only the activities they play switch to theirs.
* **A device** can also pick a language just for itself.

## How keys work

The English text is the key. In the code:

```tsx
t('Notifications')                                 // a plain string
t('Remove: {title}', { title: item.title })        // a placeholder
tn(count, '{n} item left', '{n} items left')       // a count: both English forms
tc('now-next', 'Next')                             // the same word, read differently in one place
```

Each language is one flat JSON file in `web/src/locales/` (the web app) and `server/src/locales/`
(text the server writes): the English as the key, the translation as the value.

```json
{
  "Notifications": "Benachrichtigungen",
  "Remove: {title}": "Entfernen: {title}",
  "{n} item left": "{n} Artikel übrig",
  "{n} items left": "{n} Artikel übrig",
  "now-next|Next": "Danach"
}
```

* **Missing entries show in English**, never blank. A partial file is fine.
* **Keep every `{placeholder}`** exactly as it is; move it wherever your language needs it. The check
  fails if a translation has different placeholders than the English.
* **Context keys** look like `context|English`. Translate only the part after the `|`.
* **Plurals.** English has two forms, one entry each. A language with more forms adds entries for its
  extra forms on the plural key, named the way `Intl.PluralRules` names them: `"{n} items left#few"`,
  `"{n} items left#many"`.
* **When the English changes**, its old entry no longer matches anything, and the check asks you to
  remove it. Translate the new English instead (the old translation is a good start).

`web/src/locales/en.json` and `server/src/locales/en.json` list every key the code uses. They're
generated, so don't edit them by hand. Server keys that start with `error|` are error messages, and
`security|` ones are Security activity lines.

## Adding or improving a language

1. Copy `web/src/locales/en.json` to `web/src/locales/<code>.json` (for example `fr.json`), and
   `server/src/locales/en.json` to `server/src/locales/<code>.json`, or open the existing files to
   improve them.
2. Translate the values. Leave out anything you're unsure of: it shows in English.
3. For a new language, add it to `LANGUAGES` and `LOADERS` in `web/src/i18n.ts`, to `LANGUAGES` in
   `server/src/schemas.ts`, and to `LANGS`, `DICTS` and `LOCALES` in `server/src/i18n.ts`.
4. Run the checks (`scripts/check.sh`, or just `node scripts/i18n-check.mjs` and
   `node scripts/i18n-check.mjs --server` in `web/`).
5. Try it in the demo build: `cd web && VITE_MOCK=1 npm run dev`, then open
   `http://localhost:5173/?lang=de` (your code instead of `de`). Look at a phone, a tablet and a
   wall-sized window: longer words are where layouts break.
6. Open a pull request titled `feat(web): add <language>` or `feat(web): improve the <language>
   translation`.

### Tone

* Informal and friendly: Kinwall talks to a family, kids included (German uses "du").
* Short and plain. Name things the way a family would, not the way the code does.
* Follow your language's own conventions for capitalization, quotes and punctuation.

### Glossary

Keep these the same everywhere. The German column is what Kinwall uses.

| English | German |
|---|---|
| Board | Board |
| Chores | Aufgaben |
| Lists | Listen |
| Rewards | Belohnungen |
| Points (pts) | Punkte (Pkt.) |
| To approve / Approve | Zur Freigabe / Freigeben |
| Meals | Essen |
| Journal | Tagebuch |
| Activities | Aktivitäten |
| Settings | Einstellungen |
| Household | Haushalt |
| Wall screen | Wandbildschirm |
| A grown-up / parent | Ein Erwachsener / Elternteil |
| Shopping mode | Einkaufen |
| Clear checked | Abgehakte entfernen |

## For developers

* **Wrap everything people read** in `t()`: labels, hints, toasts, errors, `aria-label`s. Not API
  values, enum names, log lines, or MCP and OpenAPI text, which stay English.
* **Whole sentences.** Never build a sentence from translated pieces
  (`` `${t('Took')} ${n} ${t('items')}` ``); use one `t()` or `tn()` with placeholders, so each
  language can order the words its own way.
* **Text kept in a constant** (a tab's label, a select's options) is marked with `msg('Board')` where
  it's defined and shown with `tm(label)` at render.
* **No `t()` at module level.** It would run before the language loads and stay English.
* **Dates and numbers** go through `Intl` in the current language: `formatDate(date, DAY)` from
  `i18n.ts` (a moment takes the household's time zone), `intlLocale()` for other formatters. Not
  date-fns patterns like `'MMM d'`, which are English word order.

`node scripts/i18n-check.mjs` (in `web/`, run by `scripts/check.sh` and CI) checks:

1. `en.json` matches the code. After changing text, run `node scripts/i18n-check.mjs --write`.
2. Every key is literal text (or a `? :` between literals), and no `t()` runs at module level.
3. Every translation's keys are in `en.json`, with the same placeholders.
4. **No new hard-coded copy.** `web/i18n-baseline.json` counts the English strings outside `t()` in
   each file, and a file's count may not go up; a new file starts at 0. Converting a screen lowers it
   (`--write` only ever lowers it). The count is a heuristic: when it flags something that isn't copy
   (a CSS value, say), say why in the pull request and a maintainer runs `--reset-baseline`.

It also reports how much of each language is done. `--server` checks the server's text the same way,
with `server/src/locales/en.json` and its own `server/i18n-baseline.json`.

### The server's text

`server/src/i18n.ts` works like the web app's, except that a server answers many people at once, so
the language is passed in:

```ts
const { t, tn, list } = words(lang)               // in the function that writes the text
const { t } = await wordsFor(c)                   // in a route: the language of the request
t('Leave by {time}', { time })
tn(n, '{n} chore left', '{n} chores left')
```

* **Whose language.** A request's answer (an error, insights, the newscast) is in the language the
  screen shows: the web app sends it as `Accept-Language`; a request without one gets the family's.
  A push goes out in the language of the device's owner, else the family's. Text stored once for
  everyone (the in-app notifications) is in the family's language. MCP asks for English: an assistant
  reads it.
* **Errors need nothing.** Routes keep writing `c.json({ error: '…' }, 400)` in English; the check
  collects every `error:` as an `error|…` key (a `${value}` in it becomes a `{placeholder}`) and the
  server translates each `{ error }` on its way out. An error kept in a constant is marked
  `stored('error', '…')`.
* **Stored now, translated when read.** `stored('security', 'Passkey “{name}” added', { name })`
  saves English and `translateStored(lang, 'security', text)` reads it in a language, so lines saved
  before a translation existed are translated too.
* **Never translated:** what the family typed (chore, event and meal names), API values and enums,
  logs, OpenAPI and MCP text, webhook payloads and the export.

## What's translated

* **The web app:** every screen.
* **The server:** push notifications and the in-app notifications, transition and leave-by
  reminders, the newscast, insights and the battery, the refill card, Security activity, outing
  ideas, the weather, profile badges, the Snapshot greeting, error messages, and recipe import (it
  also recognizes German recipe headings: Zutaten, Zubereitung).
* **Not yet:** the phone apps' own screens (widgets, Live Activity buttons, Siri and the share sheet)
  follow the phone's language and are English; Home Assistant, activity plugins and calendar and
  recipe parsers are English; content like coloring page names, tidbits and the check-in feelings
  shows in English. The public share pages (a shared recipe or list) and the MCP tools' text are
  English.
* **Saved as written:** text Kinwall fills in for you and then saves is in the language of the
  screen or the family at the time, and stays that way: suggested rewards and praise chips, starter
  chores, the family's default name, "Eating out" for a meal with no name, notes on shopping items
  added from meals, and the in-app notifications. The community calendar's default skip words
  ("meeting, committee, board, hearing") are English data; change them for your feeds.
* Text your family typed always shows as typed.
