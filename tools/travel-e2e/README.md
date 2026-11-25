# Trips and away days browser checks

Run from the feature worktree with Docker available:

```sh
bash tools/travel-e2e/run.sh both
```

`codex` or `claude` runs one original half; `next` runs the home-care, destination-day and advisory-check extension. `both` runs all three suites. `RESULTS_DIR=/absolute/path` chooses the output folder
(default `/tmp/kinwall-travel-e2e-<time>`).

The script builds the repo's production `Dockerfile` and a Node 24 / Playwright Chromium runner
(`tools/travel-e2e/Dockerfile`). Each half gets its own disposable app container with its data on
a tmpfs, seeded with the demo family (Alex, Sam, Maya and Leo) by `scripts/seed-demo.mjs`. No
host data directory or real family is mounted. The test-only key is `kw_docker_e2e_only`.
Both browsers run inside Docker and share their app's network namespace, so the page is served
from `localhost` (a secure origin, so the service worker and IndexedDB behave as in production).

The Codex half (`codex.mjs`) covers trip lifecycle, ordered stops, comparing places to stay,
participant voting, booking, family homes, link metadata and pictures, transportation modes and
endpoint time zones, activities, meal/outing links, all five list types (create/link/unlink), calendar publishing and date review,
privacy, deletion and responsive views. The Claude half (`claude.mjs`) covers away setup,
boundary days, overlaps, kept-due chores, handoffs and conflicts, approval/credit/undo, return,
trip-linked away days, feature switches and the household screens away days affect.
The extension (`next.mjs`) exercises manual private care, checklist/status edits, stale writes,
kid/wall/everyday-adult privacy, browser storage, destination-local Today/Tonight, advisory links,
care deletion and responsive care/check screens. It uses its own freshly seeded app instance.

Each half writes `results.json`, screenshots and Playwright trace ZIPs, plus app, seed and server
logs. Network 4xx responses are recorded rather than failing the run, because some cases
deliberately check validation, permissions or missing records; review them against those cases.
`apiCalls` records the Node-side API checks with the status each expected. A failed check, a page
exception, a server 5xx, or a console error other than a 400/403/404/409 resource load fails it.

The link-metadata browser check reads the live <https://www.python.org/> page for its Open Graph
title and picture, so it needs internet access and changes if that page does. Hotel and rental
JSON-LD reading is covered by deterministic server tests (`server/test/travel.test.ts`) instead.
Real listing sites aren't used and often block reads.

Views: phone (390×844), tablet landscape and portrait, wall (1366×1024) and phone landscape, in
light and dark, plus a short landscape view (844×230) standing in for an on-screen keyboard.
These are emulated viewports, not physical devices or keyboards; those still need checking by
hand. No bookings, payments, external calendar accounts or real listing providers are used.
Calendar publishing is checked against a local Kinwall calendar.

Containers and their tmpfs data are removed at the end. `KEEP_CONTAINERS=1` keeps the demo
instances for inspection; `docker port <container> 8080` shows each one's local port.
