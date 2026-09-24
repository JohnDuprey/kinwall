import { createApp } from './app.ts';
import type { Env } from './env.ts';
import { syncDue } from './sync.ts';
import { runMigrations } from './migrate.ts';
import { MIGRATIONS } from './worker-migrations.ts';

const app = createApp();

// Once per isolate; a failure is retried on the next request instead of being cached.
let migrated: Promise<void> | undefined;
function ready(env: Env): Promise<void> {
  migrated ??= runMigrations(env.DB, MIGRATIONS).catch((err) => {
    migrated = undefined;
    throw err;
  });
  return migrated;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await ready(env);
    return app.fetch(request, env, ctx);
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(ready(env).then(() => syncDue(env, ctx)));
  },
};
