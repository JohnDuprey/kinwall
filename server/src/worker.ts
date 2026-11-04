import { msg } from './i18n.ts';
import type { Env } from './env.ts';
import { createKinwall, type Kinwall } from './entry.ts';
import { MIGRATIONS } from './worker-migrations.ts';

// One per isolate, so migrations are checked once per isolate (lazily, on the first request/cron)
// and retried on the next call if they fail. Bindings don't change within an isolate.
export { OpenLibrary } from './openlibrary-worker.ts';

type WorkerEnv = Env & { OPEN_LIBRARY: DurableObjectNamespace };
let kinwall: Kinwall | undefined;
const get = (env: WorkerEnv) => (kinwall ??= createKinwall({ ...env,
  OPEN_LIBRARY_JSON: async path => {
    const object = env.OPEN_LIBRARY.get(env.OPEN_LIBRARY.idFromName('openlibrary'));
    const response = await object.fetch(`https://openlibrary.internal${path}`);
    const value = await response.json() as { error?: string };
    if (!response.ok) throw new Error(value.error ?? msg('Open Library is unavailable'));
    return value;
  },
}, { migrations: MIGRATIONS }));

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    return get(env).fetch(request, ctx);
  },
  async scheduled(_event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    // Cron runs every 5 min (wrangler.toml); syncDue self-throttles per calendar against
    // syncIntervalMinutes, so the more frequent tick only adds a cheap "anything due?" query, not
    // more actual syncing. Notifications run on every tick - they need the finer cadence.
    ctx.waitUntil(get(env).scheduled(undefined, ctx));
  },
};
