# Working on Kinwall

Rules for anyone changing this repo, people and AI coding agents alike. Setup, checks and code
conventions are in [docs/contributing/development.md](docs/contributing/development.md); read it
first. This file adds how work gets done.

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
  `recipes`, `notes`, `trackers`, `settings`, `mcp`, `sync`, `auth`, `server`, `web`, `docs`, `ha`.
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
- Choices use a `<select>` (not radio groups); destructive or rare actions (archive, delete) go in a
  "More…" select, never next to the primary button.
- Copy: US English, short and plain, sentence case. Say what happens ("Saved: Tacos"), not how.
- Kids use this: no dark patterns, nothing scary, parent-only actions stay behind parent access.

## Content

- Examples, fixtures, screenshots and the demo use the demo family only: "Our Family" with Alex,
  Sam, Maya and Leo. Never real names, addresses or photos.
- Don't name competing family-calendar products anywhere public. Services Kinwall imports from or
  syncs with (Google, HelloFresh, stores) are fine to name.
- Never commit secrets, API keys or tokens; tests use obvious fakes.

## Deploying

`main` must stay green. The hosted service deploys from `kinwall-cloud`'s deploy workflow, which
takes the latest commit whose CI passed; self-hosted releases come from `v*` tags.
