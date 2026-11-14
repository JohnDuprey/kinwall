# Development setup

You need **Node 24**. The server is TypeScript that Node runs directly, with no build step.

```bash
cd server && npm ci && npm run dev          # API on :8080 (Node, SQLite in ./data), restarts on change
cd web && npm ci && npm run dev             # UI on :5173, proxies /api; reachable from an iPad on your LAN
VITE_MOCK=1 npm run dev                     # UI with in-memory fake data, no server needed
cd server && npm run dev:worker             # same API on the Workers runtime with local D1
                                            # (put ENCRYPTION_KEY in a .dev.vars file at the repo root)
```

Open the UI, enter the setup code from the server log, and you're in. For a populated instance, run `scripts/seed-demo.mjs`. See [Demo build](../self-hosting/demo-build.md).

## Checks

```bash
cd server && npm test && npm run typecheck   # node:test against app.request() with the SQLite adapter
cd web && npm run build && npm run lint      # tsc -b + vite build; oxlint
```

CI (`.github/workflows/ci.yml`) runs the server typecheck and tests, plus the web build, on every push and pull request.

When the web app imports a pure module from `server/src`, include that module in the Dockerfile's
web build stage too. Run `docker build -t kinwall:local .` to check the isolated build context;
the local web build can otherwise pass with files that are missing from the image.

## Conventions

* Server code must run on **both** Workers and Node. Shared code uses only `fetch`, Web Crypto and `Intl`. No `fs`, `node:crypto` or `process` outside `node.ts` / `d1-sqlite.ts`.
* Imports include the `.ts` extension, and types use `import type`. No enums, namespaces or constructor parameter properties (Node's type stripping doesn't support them).
* Every route declares a zod-openapi schema with `tags` and `summary`, which is how `/docs` stays complete.
* New tables and columns go in a new `server/migrations/NNNN_name.sql`, which also has to be registered in `server/src/worker-migrations.ts` for the Worker bundle.
* No UI kit and no state library in `web/`: plain CSS custom properties, React and [`date-fns`](https://date-fns.org).
* Clickable things are real buttons or links with a pointer and a hover state, from the shared "Pointer and hover" rules at the end of `web/src/styles.css`. See AGENTS.md → Design for the rest.

### Sign-in URL and language boundaries

Calendar and to-do sign-ins validate the server's consent URL with `web/src/providerConsent.ts`
before navigating. Google URLs must use `https://accounts.google.com`; Microsoft URLs must use
`https://login.microsoftonline.com`. Embedded credentials and other origins are refused. Keep
both sign-in entry points on this shared check when adding providers.

`setLang()` also validates its language at runtime, falling back to English before loading words
for an unsupported value. Its loader map has no inherited property names.

## Workflows

| Workflow | Runs on | Does |
|---|---|---|
| `ci.yml` | push, PR | Server typecheck and tests, web build, commit message check. |
| `release-please.yml` | push to `main` | Keeps the release PR up to date; on a release, calls the three tag workflows below. |
| `docker.yml` | push to `main`, `v*` tags, a release | Multi-arch image to `ghcr.io/<owner>/kinwall`. |
| `cloudflare.yml` | `v*` tags, a release, manual | Workers deploy (when `CLOUDFLARE_DEPLOY=true`). |
| `demo.yml` | `v*` tags, a release, manual | Demo build to Cloudflare Pages (when `DEMO_PAGES_PROJECT` is set). |
| `discord.yml` | a release, manual | Posts the release's highlights from What's new to Discord (when the `DISCORD_RELEASE_WEBHOOK` secret is set). |

## Releases

Releases are for self-hosters and for [What's new](../whats-new.md); the hosted service deploys from `main` on its own.

* [release-please](https://github.com/googleapis/release-please) (`release-please-config.json`, `.release-please-manifest.json`) reads the Conventional Commits on `main` since the last release and keeps one pull request open, **chore: release x.y.z**, with the next version and a new `CHANGELOG.md` section: `feat` goes under New, `fix` under Fixed, `perf` under Faster, and breaking changes on top. `docs`, `chore`, `ci`, `test`, `refactor`, `build` and `style` don't appear and don't make a release on their own.
* The version follows the commits: a breaking change bumps the major version, a `feat` the minor, a `fix` or `perf` the patch. It's bumped in `server/package.json`, `web/package.json`, both lockfiles and the bug report form.
* What's new (`docs/whats-new.md`) needs a `## X.Y.Z` section, ideally with `### Highlights`, before the release PR is merged: once the image is built, `discord.yml` posts that section's intro and Highlights to the Kinwall Discord with a link to the full notes. Preview it with `node scripts/release-discord.mjs vX.Y.Z --dry-run`; for a release made another way, run the Discord workflow by hand with the tag.
* Before merging, reword the generated notes for families if they need it: edit the release PR's `CHANGELOG.md` right before merging (release-please rewrites the PR on the next push to `main`), or edit the GitHub Release afterward.
* Merging the release PR (squash) tags `vX.Y.Z` and creates the GitHub Release. A tag pushed by the workflow's token starts no other workflows, so `release-please.yml` calls `docker.yml` (the image, tagged `X.Y.Z`, `X.Y` and `latest`), `cloudflare.yml` and `demo.yml` itself, on the release commit.
* A `v*` tag you push yourself runs those three workflows directly, as before.
* The repository needs **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** turned on. Pull requests opened by the workflow don't run CI; the checks run once it's merged to `main`.

### Derived point totals and medicine counts

`member_point_totals` is derived from chore completions and point entries. Migration
0137 builds the initial totals without changing source history; SQLite triggers maintain
inserts, edits, transfers, deletes and imports in the same transaction. Do not import or
export this derived table. Recent daily goals use a partial date index.

Medicine taken counts are cached only in process memory, per database and encrypted
medicine row. `medications.log_revision` changes through triggers whenever its logs
change, including imports, so a subsequent read opens the updated history. A restart
or cache eviction rebuilds the count from encrypted logs; no health totals are stored
in plaintext. Each process retains at most 128 cached counts per database.

### Recipe reads

Single-recipe reads use direct equality filters for the recipe, ingredients, ratings and
favorites, so opening one recipe does not scan the library. Query-plan regression tests
cover these reads.

### Home routine polling

Home checks each visible child's routine initially and after app changes. Its 15-second
poll checks enabled routines only and pauses while the page is hidden. Returning to the
page checks all visible children again; overlapping requests for a child are skipped.

### Calendar window details

Calendar reads fetch event rows with the household metadata in the first database batch,
then expand repeats and check overlap before reading related details in a second batch.
Notes, linked tasks, meals, overrides and hidden status use the matching event keys,
passed as JSON so each related query uses one parameter even for large calendars.
Composite indexes seek individual override and hidden keys; `idx_meals_event` finds
linked meals without reading meal history. Empty windows skip the details batch.

Reminder reads reuse their candidate event rows for hidden/filter resolution and limit
their own travel settings and meal links to those candidates. Query-plan and read-cost
tests cover historical rows, recurring events and windows with over 100 events.

### Deferred screens and offline files

Secondary screens load through React lazy imports. Keep small shared controls and setup
resume state outside the screen modules: importing a named export can otherwise bring
the whole screen into startup again. `screen-loading.test.ts` checks the eager dependency
graph. Navigation keeps the header and navigation visible while a screen loads.

The build embeds its modern and legacy screen-file lists in its HTML. After startup,
the service worker caches the appropriate files without executing them, preserving
unopened screens for offline use. The lists belong to that exact HTML build, so an old
open page does not fetch a newer build's files. PDF and additional language downloads
remain on demand. Shell-cache matching ignores `Vary` because these app files are the
same for every Origin; API requests never enter this cache. Native web views prepare
the deferred modules after startup with imports, since they cannot rely on a service
worker; opening one sooner still loads it immediately.

Measured with the production build and gzip across the entry, App and their static
JavaScript dependencies, startup fell from 533 KB to 378 KB (29%). Background offline
caching still downloads the deferred screens after startup; it does not evaluate them.

### Daily summary reads

Daily summaries load one data snapshot per notification tick, after finding the first
recipient whose copy has not already been sent. Events, calendar membership, chore goal
progress, linked tasks, due items and meals are reused across devices and the household
feed. Recurring event counts are computed once; member filtering and translated text
are still built separately for each recipient.

The snapshot stays inside that tick. A later recipient gets a fresh read on the next
tick, while retries skip already-sent copies before loading summary data. The regression
test covers four devices plus the feed: five meal reads and five goal reads become one
each, and twenty per-event calendar lookups become one shared calendar read.

### Weekly planning writes

Migration 0146 adds empty weekly draft/receipt tables and a one-row source counter; it does
not backfill or change family records. Source-table triggers advance the review counter in
the same transaction as relevant writes, so a source change between validation and the apply
batch cannot slip through. Event reminder-only changes and idle sync bookkeeping do not
advance it. A relevant changed source row adds one small metadata write. The counter is
conservative across weeks: unrelated calendar, meal, list or upkeep changes can require a
new review. Drafts use their own revision for compare-and-swap; a failed guard aborts the
whole Node/D1 batch. Apply receipts make lost-response retries safe.

Planning reuses `buildMeal`/`mealWrite` and `listItemInsert`, then emits ordinary domain changes
after commit. No provider events or timed alerts are created. Source counters and receipts
are not exported; shared drafts and applied item links are. Imports of older exports keep
working, and an import replaces receipts only for weeks explicitly included in that file.
