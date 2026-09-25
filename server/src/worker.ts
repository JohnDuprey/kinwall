import type { Env } from './env.ts';
import { createKinwall, type Kinwall } from './entry.ts';
import { MIGRATIONS } from './worker-migrations.ts';

// One per isolate, so migrations are checked once per isolate (lazily, on the first request/cron)
// and retried on the next call if they fail. Bindings don't change within an isolate.
let kinwall: Kinwall | undefined;
const get = (env: Env) => (kinwall ??= createKinwall(env, { migrations: MIGRATIONS }));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return get(env).fetch(request, ctx);
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Cron runs every 5 min (wrangler.toml); syncDue self-throttles per calendar against
    // syncIntervalMinutes, so the more frequent tick only adds a cheap "anything due?" query, not
    // more actual syncing. Notifications run on every tick - they need the finer cadence.
    ctx.waitUntil(get(env).scheduled(undefined, ctx));
  },
};
