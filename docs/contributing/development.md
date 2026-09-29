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

## Conventions

* Server code must run on **both** Workers and Node. Shared code uses only `fetch`, Web Crypto and `Intl`. No `fs`, `node:crypto` or `process` outside `node.ts` / `d1-sqlite.ts`.
* Imports include the `.ts` extension, and types use `import type`. No enums, namespaces or constructor parameter properties (Node's type stripping doesn't support them).
* Every route declares a zod-openapi schema with `tags` and `summary`, which is how `/docs` stays complete.
* New tables and columns go in a new `server/migrations/NNNN_name.sql`, which also has to be registered in `server/src/worker-migrations.ts` for the Worker bundle.
* No UI kit and no state library in `web/`: plain CSS custom properties, React and `date-fns`.
* Clickable things are real buttons or links with a pointer and a hover state, from the shared "Pointer and hover" rules at the end of `web/src/styles.css`. See AGENTS.md → Design for the rest.

## Workflows

| Workflow | Runs on | Does |
|---|---|---|
| `ci.yml` | push, PR | Server typecheck and tests, web build, commit message check. |
| `release-please.yml` | push to `main` | Keeps the release PR up to date; on a release, calls the three tag workflows below. |
| `docker.yml` | push to `main`, `v*` tags, a release | Multi-arch image to `ghcr.io/<owner>/kinwall`. |
| `cloudflare.yml` | `v*` tags, a release, manual | Workers deploy (when `CLOUDFLARE_DEPLOY=true`). |
| `demo.yml` | `v*` tags, a release, manual | Demo build to Cloudflare Pages (when `DEMO_PAGES_PROJECT` is set). |

## Releases

Releases are for self-hosters and for [What's new](../whats-new.md); the hosted service deploys from `main` on its own.

* [release-please](https://github.com/googleapis/release-please) (`release-please-config.json`, `.release-please-manifest.json`) reads the Conventional Commits on `main` since the last release and keeps one pull request open, **chore: release x.y.z**, with the next version and a new `CHANGELOG.md` section: `feat` goes under New, `fix` under Fixed, `perf` under Faster, and breaking changes on top. `docs`, `chore`, `ci`, `test`, `refactor`, `build` and `style` don't appear and don't make a release on their own.
* The version follows the commits: a breaking change bumps the major version, a `feat` the minor, a `fix` or `perf` the patch. It's bumped in `server/package.json`, `web/package.json`, both lockfiles and the bug report form.
* Before merging, reword the generated notes for families if they need it: edit the release PR's `CHANGELOG.md` right before merging (release-please rewrites the PR on the next push to `main`), or edit the GitHub Release afterwards.
* Merging the release PR (squash) tags `vX.Y.Z` and creates the GitHub Release. A tag pushed by the workflow's token starts no other workflows, so `release-please.yml` calls `docker.yml` (the image, tagged `X.Y.Z`, `X.Y` and `latest`), `cloudflare.yml` and `demo.yml` itself, on the release commit.
* A `v*` tag you push yourself runs those three workflows directly, as before.
* The repository needs **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** turned on. Pull requests opened by the workflow don't run CI; the checks run once it's merged to `main`.
