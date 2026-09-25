// Workers-compatible. The one way to host the server: worker.ts, node.ts and embedders (e.g. a
// Durable Object per household) all go through createKinwall. See SPEC.md "Embedding the server".
import { createApp } from './app.ts';
import type { Env, WaitCtx } from './env.ts';
import { syncDue } from './sync.ts';
import { runNotifications } from './notify.ts';
import { runMigrations, type Migration } from './migrate.ts';

export type { KinwallDb, KinwallStatement } from './db.ts';
export type { Env, WaitCtx } from './env.ts';
export { runMigrations, type Migration } from './migrate.ts';
export { isClaimed } from './routes/setup.ts';
export { finishPasskeyLogin, hasAnyPasskey as hasPasskey } from './routes/passkeys.ts';
export { recordHostEvent } from './host-events.ts';

export type KinwallOptions = {
  /** Applied lazily before the first fetch/scheduled (e.g. MIGRATIONS from worker-migrations.ts).
   * Omit when the host migrates the DB itself before serving (node.ts does, from the fs). */
  migrations?: Migration[];
};

export function createKinwall(env: Env, opts: KinwallOptions = {}) {
  const app = createApp();

  // Once per instance; a failure is retried on the next call instead of being cached.
  let migrated: Promise<void> | undefined;
  function ready(): Promise<void> {
    if (!opts.migrations) return Promise.resolve();
    migrated ??= runMigrations(env.DB, opts.migrations).catch((err) => {
      migrated = undefined;
      throw err;
    });
    return migrated;
  }

  return {
    /** The Hono app, for hosts that add their own routes/middleware (node.ts adds static files). */
    app,
    /** API only (/api/*, /mcp, /oauth/*, /.well-known/*, /docs, /openapi.json); anything else 404s.
     * Without ctx, background work (webhooks, sync-after-write) runs fire-and-forget. */
    async fetch(request: Request, ctx?: ExecutionContext): Promise<Response> {
      await ready();
      return app.fetch(request, env, ctx);
    },
    /** One cron tick: sync calendars that are due (self-throttled) + send due notifications. */
    async scheduled(now?: Date, ctx?: WaitCtx): Promise<void> {
      await ready();
      await Promise.all([syncDue(env, ctx), runNotifications(env, now ?? new Date(), ctx)]);
    },
  };
}

export type Kinwall = ReturnType<typeof createKinwall>;
