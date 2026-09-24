import { createApp } from './app.ts';
import type { Env } from './env.ts';
import { syncDue } from './sync.ts';

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(syncDue(env, ctx));
  },
};
