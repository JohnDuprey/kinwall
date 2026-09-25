# Kinwall web

The React + Vite single-page app: calendar, chores, lists and settings UI served by the
Kinwall server (and by Cloudflare Workers as static assets).

```bash
npm run dev            # dev server on :5173, proxies /api to a running server on :8080
VITE_MOCK=1 npm run dev  # same, but with in-memory fake data — no server needed (see src/mock.ts)
npm run build           # type-checks then builds to dist/, served by the server in production
```

See the [root README](../README.md) for the full project, and [SPEC.md](../SPEC.md) for the
API and architecture.
