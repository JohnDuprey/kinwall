# Translations

Kinwall is available in English and German (Deutsch). German covers every screen of the web app.
Some text still comes from the server in English (newscast lines, insights, battery reasons, error
messages), and the phone apps follow the phone's language.

The German translation is by [sudo-Foras666](https://github.com/sudo-Foras666). Thank you!

How a family picks a language is in [Settings → General](../settings/general.md#language).

## How keys work

The English text is the key. In the code:

```tsx
t('Notifications')                                 // a plain string
t('Remove: {title}', { title: item.title })        // a placeholder
tn(count, '{n} item left', '{n} items left')       // a count: both English forms
tc('now-next', 'Next')                             // the same word, read differently in one place
```

Each language is one flat JSON file in `web/src/locales/`: the English as the key, the translation as
the value.

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

`web/src/locales/en.json` lists every key the code uses. It's generated, so don't edit it by hand.

## Adding or improving a language

1. Copy `web/src/locales/en.json` to `web/src/locales/<code>.json` (for example `fr.json`), or open
   the existing file to improve it.
2. Translate the values. Leave out anything you're unsure of: it shows in English.
3. For a new language, add it to `LANGUAGES` and `LOADERS` in `web/src/i18n.ts`, and to `LANGUAGES`
   in `server/src/schemas.ts`.
4. Run the checks (`scripts/check.sh`, or just `node scripts/i18n-check.mjs` in `web/`).
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

It also reports how much of each language is done.
