// Workers-compatible. The one way to host the server: worker.ts, node.ts and embedders (e.g. a
// Durable Object per household) all go through createKinwall. See SPEC.md "Embedding the server".
import { createApp } from './app.ts';
import type { Env, WaitCtx } from './env.ts';
import { syncDue } from './sync.ts';
import { runNotifications, sealMedicationNotes } from './notify.ts';
import { runMigrations, type Migration } from './migrate.ts';
import { sealHealthEntries } from './routes/trackers.ts';
import { shelveReadingEntries } from './shelve.ts';
import { lookUpSome } from './book-details.ts';

const errorName = (err: unknown) => (err instanceof Error ? err.name : 'error'); // never the message: it can carry data

export type { KinwallDb, KinwallStatement } from './db.ts';
export type { Env, WaitCtx } from './env.ts';
export { runMigrations, type Migration } from './migrate.ts';
export { isClaimed } from './routes/setup.ts';
export { finishPasskeyLogin, hasAnyPasskey as hasPasskey } from './routes/passkeys.ts';
export { recordHostEvent } from './host-events.ts';
export { recordSecurityEvent } from './routes/security-events.ts';

export type KinwallOptions = {
  /** Applied lazily before the first fetch/scheduled (e.g. MIGRATIONS from worker-migrations.ts).
   * Omit when the host migrates the DB itself before serving (node.ts does, from the fs). */
  migrations?: Migration[];
};

export function createKinwall(env: Env, opts: KinwallOptions = {}) {
  const app = createApp();

  // Once per instance; a failure is retried on the next call instead of being cached.
  let migrated: Promise<void> | undefined;
  function migrate(): Promise<void> {
    if (!opts.migrations) return Promise.resolve();
    migrated ??= runMigrations(env.DB, opts.migrations).catch((err) => {
      migrated = undefined;
      throw err;
    });
    return migrated;
  }
  // Then, once per instance (process, isolate or Durable Object), seal health entries and medicine
  // notes still in plaintext (routes/trackers.ts, notify.ts). A failure is logged and retried on the next call, never
  // served as an error: those entries still read fine, and writes are sealed regardless.
  let sealed: Promise<void> | undefined;
  async function ready(): Promise<void> {
    await migrate();
    sealed ??= Promise.all([sealHealthEntries(env), sealMedicationNotes(env)]).then(
      () => undefined,
      (err) => {
        sealed = undefined;
        console.error('sealing health entries failed', err instanceof Error ? err.name : 'error');
      },
    );
    await sealed;
    // And once: reading entries from before every book was in the library join it (shelve.ts). Like
    // sealing, a failure is logged and retried on the next call, never served as an error.
    shelved ??= shelveReadingEntries(env).then(() => undefined, (err) => { shelved = undefined; console.error('shelving reading entries failed', errorName(err)); });
    await shelved;
  }
  let shelved: Promise<void> | undefined;

  return {
    /** The Hono app, for hosts that add their own routes/middleware (node.ts adds static files). */
    app,
    /** API only (/api/*, /mcp, /oauth/*, /.well-known/*, /plugins/*, /r/*, /docs, /openapi.json); anything else 404s.
     * Without ctx, background work (webhooks, sync-after-write) runs fire-and-forget. */
    async fetch(request: Request, ctx?: ExecutionContext): Promise<Response> {
      await ready();
      return app.fetch(request, env, ctx);
    },
    /** One cron tick: sync calendars that are due (self-throttled) + send due notifications + look up a few library books' details. Each
     * runs to the end whatever the other does, and a failure is logged rather than thrown: the next
     * tick retries, and a host's alarm (a Durable Object per family) isn't failed and re-run for it. */
    async scheduled(now?: Date, ctx?: WaitCtx): Promise<void> {
      await ready();
      // And a few library books' details from Open Library (book-details.ts), gently.
      const results = await Promise.allSettled([syncDue(env, ctx), runNotifications(env, now ?? new Date(), ctx), lookUpSome(env)]);
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`${['calendar sync', 'notifications', 'book details'][i]} tick failed:`, errorName(r.reason));
      });
    },
  };
}

export type Kinwall = ReturnType<typeof createKinwall>;
