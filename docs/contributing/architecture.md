# Architecture

The full design and API contract is in [SPEC.md](../../SPEC.md). In short:

* **One codebase, two runtimes.** A single **Hono** app (`server/src/app.ts`) runs on Cloudflare Workers with D1, or on Node 24 with the built-in `node:sqlite`. On Node, a small adapter (`d1-sqlite.ts`) makes SQLite look like D1.
* **One host seam.** `server/src/entry.ts` exports `createKinwall(env)`, which returns `fetch` and `scheduled`. `worker.ts` and `node.ts` are thin wrappers around it. See [Embedding the server](embedding.md).
* **API-first.** The React UI (`web/`, Vite) is just another API client. `@hono/zod-openapi` builds `/openapi.json` and `/docs` from the route schemas. The MCP server (`mcp.ts`) calls the same routes in-process.
* **Providers.** `server/src/providers/` has one module per calendar kind (ICS via `ical.js`, CalDAV via `tsdav`, Google and Microsoft over plain `fetch`) behind one contract (`types.ts`).
* **Background work.** `sync.ts` (chunked calendar sync) and `notify.ts` (Web Push scheduling) run from the Workers cron or Node intervals. `webpush.ts` implements RFC 8291/8292 with Web Crypto, so it runs on Workers.
* **Change bus.** `bus.ts` `emit()` bumps the revision counter behind `/api/rev` and fires [webhooks](../integrations/webhooks.md).
* **Security.** `auth.ts` holds the key scopes, with a deny-by-default allow-list for display keys. `crypto.ts` does AES-256-GCM at rest, and `outbound.ts` has the SSRF guards.
* **Migrations.** `server/migrations/*.sql` are applied at runtime on both targets and tracked in `_migrations`.

```
server/src/  app.ts entry.ts worker.ts node.ts d1-sqlite.ts auth.ts bus.ts mcp.ts sync.ts notify.ts
             routes/*.ts (one file per resource)   providers/*.ts
server/migrations/NNNN_*.sql
web/src/     App.tsx Calendar.tsx Chores.tsx Lists.tsx Settings.tsx Setup.tsx …
```
