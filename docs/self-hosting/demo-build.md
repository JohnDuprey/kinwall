# Demo build

A static build of the web app that runs **entirely in the browser** on sample data. There's no server and no database, nothing is saved, and every visitor gets a fresh copy. A slim strip at the top says "Demo — nothing is saved. Reload for a fresh copy." Sign-in is skipped.

## Build it

```bash
cd web
npm ci
npm run build:demo        # VITE_MOCK=1 vite build --outDir dist-demo
```

Serve `web/dist-demo` from any static host. It includes a sample family (Alex, Sam, Maya and Leo) with about two weeks of events around today, chores and lists.

For local development, `VITE_MOCK=1 npm run dev` gives the same in-memory data with hot reload.

## Publishing on release

`.github/workflows/demo.yml` builds the demo and deploys it to a **Cloudflare Pages** project on `v*` tags (or when run manually). It needs:

* repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the same ones as the Workers deploy),
* repository variable `DEMO_PAGES_PROJECT`, the Pages project name. Set its custom domain in the Cloudflare dashboard.

The workflow skips itself when `DEMO_PAGES_PROJECT` is empty.

## Seeding a real instance instead

To try a *real* server with sample data, `scripts/seed-demo.mjs` fills a fresh instance (one with no members yet) with a fictional family (Alex, Sam, Maya, Leo), a month of events, categories, chores with history, and lists:

```bash
KINWALL_URL=http://localhost:8080 KINWALL_KEY=<admin key> node scripts/seed-demo.mjs
```
