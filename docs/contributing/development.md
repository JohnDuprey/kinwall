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

## Workflows

| Workflow | Runs on | Does |
|---|---|---|
| `ci.yml` | push, PR | Server typecheck and tests, web build. |
| `docker.yml` | push to `main`, `v*` tags | Multi-arch image to `ghcr.io/<owner>/kinwall`. |
| `cloudflare.yml` | `v*` tags, manual | Workers deploy (when `CLOUDFLARE_DEPLOY=true`). |
| `demo.yml` | `v*` tags, manual | Demo build to Cloudflare Pages (when `DEMO_PAGES_PROJECT` is set). |
