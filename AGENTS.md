# Working on Kinwall

Rules for anyone changing this repo, people and AI coding agents alike. Setup, checks and code
conventions are in [docs/contributing/development.md](docs/contributing/development.md); read it
first. This file adds how work gets done.

## How to work here

- `scripts/new-feature.sh <name>` makes a worktree `../kinwall-<name>` on a fresh branch from
  `main`, with its own `npm ci` (never symlink `node_modules` between worktrees).
- `scripts/check.sh` runs every check below; run it before pushing. A test run that prints no
  summary line means the tests didn't load, and the script treats that as a failure.
- Land finished work on `main` (rebase onto `origin/main`, re-run the checks, push), then
  `scripts/finish-feature.sh <name>` removes the worktree and branch once everything is on `main`
  (`--all` cleans up every landed one).
- One feature per branch, in files that don't overlap with other work in progress.

## Finding your way around

Optional: `graphify-out/` is a local, gitignored knowledge graph of the code and docs, built by
the [graphify](https://github.com/safishamsi/graphify) CLI from code structure only (no LLM,
nothing leaves the machine). Before reading many files to answer "where is X", "what calls Y" or
"how does Z flow", ask the graph, then open only the files it points to:

```bash
graphify explain "runNotifications()"            # a symbol's file, line, callers and callees
graphify query "where are medication reminders sent" --budget 800   # broader, noisier search
graphify path "batteryFor()" "battery()"         # how two symbols connect
```

`scripts/graph.sh` builds it (about 15 seconds) and refreshes it after changes;
`scripts/new-feature.sh` copies the current one into a new worktree. Without graphify installed,
search the code as usual.

## Test first

- Write the failing test before the change: a bug gets a test that reproduces it, a feature gets
  tests for its behavior. Then make it pass, then tidy up.
- Server: `server/test/*.test.ts` (node:test against `app.request()`). Web: `web/test/*.test.ts`
  for logic (parsers, date math, formatting). UI changes are checked by eye in the demo build
  (`VITE_MOCK=1 npm run dev`) at phone (390×844), tablet (1024×768) and wall (1366×1024+) sizes,
  in light and dark.
- A change is done when all of these pass:
  ```bash
  cd server && npm run typecheck && npm test
  cd web && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build && npm run build:demo
  ```
  `tsc -p .` in `web/` checks nothing; use `tsconfig.app.json` (or the build).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, imperative,
lowercase, no period, under ~72 characters. The body says why when that isn't obvious.

- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `style`, `chore`, `ci`, `build`.
- Scopes are areas of the app: `board`, `calendar`, `chores`, `rewards`, `lists`, `meals`,
  `recipes`, `notes`, `snapshot`, `journal`, `insights`, `trackers`, `medications`, `contacts`, `settings`, `mcp`, `sync`, `auth`, `server`, `web`, `docs`, `ha`.
- Breaking changes (API, MCP tools, export format, settings) get `!` and a `BREAKING CHANGE:` footer.
- One logical change per commit. Tests and docs go in the same commit as the change.
- CI checks every new commit (`.github/check-commits.sh`), and a failing check blocks the hosted
  deploy. Check a message locally with `echo "feat(x): y" | .github/check-commits.sh`. Merge
  commits are skipped; merge branches whose commits don't follow the format with `--squash`.

Examples: `feat(meals): open a planned meal's recipe on tap`, `fix(board): keep the photo from
collapsing when the meals card is full`.

## Docs

User-facing changes update `docs/` in the same change: the feature's page under `docs/using/`,
`docs/settings/` for new settings, `docs/integrations/rest-api.md` and `mcp.md` for API or MCP
changes, `docs/self-hosting/` for config. New routes are documented by their zod-openapi schema.

## Design

- Plain CSS custom properties in `web/src/styles.css`; use the existing tokens (`--card`, `--bg-alt`,
  `--text`, `--text-dim`, `--accent…`, `--radius…`, `--shadow`) and existing classes (`.btn`,
  `.field`, `.settings-select`, `.board-card`, `Sheet`) before adding new ones. No UI kits.
- Every screen works on a phone, a tablet, a wall display and in phone landscape, in light and dark.
- Touch first: targets at least 44px, nothing that needs hover or a precise click.
- Pointer and hover: everything clickable is a real `<button>` or `<a>` (or `role="button"` with
  Enter/Space), shows a pointer and has a hover state. Both come from the shared "Pointer and hover"
  rules at the end of `styles.css`: add a new control's class to their lists, and keep hover inside
  `@media (hover: hover) and (pointer: fine)`.
- Scrollbars: hidden only on touch screens (`pointer: coarse`); mouse users always see them. Don't
  hide a scrollbar anywhere else.
- Short choices use a `<select>` (not radio groups). A long list, picking several, or choices that
  need a preview (color schemes, typefaces, timezones, categories, members) use a row that opens a
  sheet (`PickField`, `SchemePicker`), never `<select multiple>`.
- A card summing up settings shows them as read-only `.chip-static` chips, one per setting with an
  icon and a plain name; values inherited from the family are marked 🏠. No run-on sentences.
- Color is never the only signal: pair it with a word, shape, emoji, avatar or pattern. Check new
  colors with the color-vision helpers in `web/src/colorVision.ts`.
- Buttons in headers and rows size to their content (`flex: none`); `.btn` stretches by default.
- Destructive or rare actions (archive, delete) go in a "More…" select or at the bottom of a sheet,
  never next to the primary button.
- Copy: US English, short and plain, sentence case. Say what happens ("Saved: Tacos"), not how.
- Kids use this: no dark patterns, nothing scary, parent-only actions stay behind parent access.

## Content

- Examples, fixtures, screenshots and the demo use the demo family only: "Our Family" with Alex,
  Sam, Maya and Leo. Never real names, addresses or photos.
- Don't name competing family-calendar products anywhere public. Services Kinwall imports from or
  syncs with (Google, HelloFresh, stores) are fine to name.
- Never commit secrets, API keys or tokens; tests use obvious fakes.

## Health data

- Health data is always encrypted at rest, on hosted and self-hosted, with no setting to turn it
  off. That includes the Health tracker (checkups, vaccines, measurements, notes) and anything
  medical added later (medications and their log). Use the family's encryption key, the same one
  that protects connected-account tokens, so logs, backups and database access see only ciphertext.
- Never log health request or response bodies, and cover that with a test.
- Health data stays out of webhooks, MCP/AI connectors, snapshots, profiles, share links and push
  notification text unless the family explicitly turns each one on.
- Store only what the feature needs: no diagnoses or conditions unless a feature truly requires them.

## Deploying

`main` must stay green. The hosted service deploys from `kinwall-cloud`'s deploy workflow, which
takes the latest commit whose CI passed; self-hosted releases come from `v*` tags.
