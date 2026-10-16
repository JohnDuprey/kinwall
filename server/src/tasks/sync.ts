// Two-way sync of a Kinwall to-do list with a Todoist project or a Google Tasks list.
//
// What syncs: title, done, due date, notes, and priority (Todoist only). What stays in Kinwall:
// who it's for, the linked event, steps, the discussion. Each item's outside id and the fields as
// both sides last agreed are kept in task_link_items, so a re-sync never duplicates and each side's
// changes show up as differences from that (map.ts mergeFields has the rule).
// - Created on one side: created on the other. A done item that never synced stays on its side.
// - Deleted on one side: deleted on the other (a delete beats an edit made since).
// - The first sync of a link pairs items with exactly the same title, then copies the rest.
// - Subtasks in the other app and steps in Kinwall stay where they are.
//
// When: soon after a change in Kinwall (queueTaskSync, from bus.ts emit, debounced), and with the
// calendar sync on its schedule (syncDueTaskLinks, from sync.ts syncDue). A 429 waits out the
// app's Retry-After (longer each time in a row); a refused token is 'revoked' like a calendar's.
import type { Env, WaitCtx } from '../env.ts';
import type { KinwallStatement } from '../db.ts';
import { waitUntil } from '../env.ts';
import { publish } from '../bus.ts';
import { decryptConfig, encryptConfig } from '../crypto.ts';
import { providerEnv } from '../providers/config.ts';
import { SignInRevoked } from '../providers/types.ts';
import { householdTz } from '../sync.ts';
import { itemKey } from '../item-memory.ts';
import { redact } from '../redact.ts';
import { stored } from '../i18n.ts';
import { APP_NAME, googleTasksApp, microsoftTodoApp, RateLimited, todoistApp, TokenRefused, type RemoteTask, type TaskApp, type TaskAppKind } from './apps.ts';
import { changed, mergeFields, type Priority, type TaskFields } from './map.ts';

export type TaskAccountRow = { id: string; kind: TaskAppKind; name: string; config: string; created_at: string };
export type TaskLinkRow = {
  list_id: string;
  account_id: string;
  remote_id: string;
  remote_name: string;
  synced_rev: number | null;
  last_synced_at: string | null;
  last_error: string | null;
  last_error_code: string | null;
  sync_failures: number;
  retry_after: string | null;
  created_at: string;
};
type ItemRow = { id: string; title: string; notes: string | null; due_date: string | null; done: number; priority: Priority; updated_at: string; sort: number };

export { APP_NAME };

/** The app client for a connected account, with its credential decrypted. */
export async function taskApp(env: Env, account: TaskAccountRow): Promise<TaskApp> {
  const config = await decryptConfig(env, account.id, account.config);
  const tz = await householdTz(env.DB);
  if (account.kind === 'todoist') return todoistApp(String(config?.token ?? ''), tz);
  const ctx = {
    env: await providerEnv(env, env.DB),
    account: { id: account.id, config },
    saveAccountConfig: async (next: unknown) => {
      await env.DB.prepare('UPDATE task_accounts SET config = ? WHERE id = ?').bind(await encryptConfig(env, account.id, next), account.id).run();
    },
  };
  return account.kind === 'google' ? googleTasksApp(ctx) : microsoftTodoApp(ctx, tz);
}

/** An item's synced fields as `app` can hold them. */
function fieldsOf(item: ItemRow, app: TaskApp): TaskFields {
  const f: TaskFields = { title: item.title, notes: item.notes || null, due: item.due_date, done: !!item.done, priority: app.keys.includes('priority') ? item.priority : null };
  return app.fit ? app.fit(f) : f;
}

/** Kinwall's side counts as newer on a tie, or when the app gave no time. */
const localIsNewer = (local: string, remote: string | null) => !remote || new Date(local).getTime() >= new Date(remote).getTime();

export type SyncResult = { ok: true; pulled: number; pushed: number } | { ok: false; error: string };

const running = new Map<string, Promise<SyncResult>>();

/** Syncs one linked list now. Two calls for the same list at once share one run. */
export function syncTaskLink(env: Env, listId: string, execCtx?: WaitCtx): Promise<SyncResult> {
  const now = running.get(listId);
  if (now) return now;
  const run = syncOnce(env, listId, execCtx).finally(() => running.delete(listId));
  running.set(listId, run);
  return run;
}

async function syncOnce(env: Env, listId: string, execCtx?: WaitCtx): Promise<SyncResult> {
  const db = env.DB;
  const link = await db.prepare('SELECT * FROM task_links WHERE list_id = ?').bind(listId).first<TaskLinkRow>();
  if (!link) return { ok: false, error: 'This list is not synced' };
  const account = await db.prepare('SELECT * FROM task_accounts WHERE id = ?').bind(link.account_id).first<TaskAccountRow>();
  if (!account) return { ok: false, error: 'This list is not synced' };
  const startedAt = new Date();
  if (link.retry_after && new Date(link.retry_after) > startedAt) return { ok: false, error: link.last_error ?? stored('error', 'Waiting to sync') };

  const stmts: KinwallStatement[] = [];
  let pulled = 0, pushed = 0;
  const nowIso = startedAt.toISOString();
  const label = APP_NAME[account.kind];
  const del = (itemId: string) => stmts.push(db.prepare('DELETE FROM task_link_items WHERE list_id = ? AND item_id = ?').bind(listId, itemId));
  const keep = (itemId: string, remoteId: string, base: TaskFields) =>
    stmts.push(db.prepare('INSERT INTO task_link_items (list_id, item_id, remote_id, base) VALUES (?,?,?,?) ON CONFLICT(list_id, item_id) DO UPDATE SET remote_id = excluded.remote_id, base = excluded.base').bind(listId, itemId, remoteId, JSON.stringify(base)));
  // Writes only the fields that changed, so an edit made in Kinwall meanwhile to another field stays.
  const pull = (item: ItemRow, patch: Partial<TaskFields>) => {
    const sets: string[] = [], binds: unknown[] = [];
    const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); binds.push(v); };
    if (patch.title !== undefined) { set('title', patch.title); set('name_key', itemKey(patch.title)); }
    if (patch.notes !== undefined) set('notes', patch.notes);
    if (patch.due !== undefined) set('due_date', patch.due);
    if (patch.priority !== undefined && patch.priority !== null) set('priority', patch.priority);
    if (patch.done !== undefined) {
      set('done', patch.done ? 1 : 0); set('done_at', patch.done ? nowIso : null); set('done_by', null); set('done_by_label', patch.done ? label : null);
      // Like ticking it in Kinwall: every step follows, keeping "done = all steps done".
      stmts.push(db.prepare('UPDATE list_item_steps SET done = ?1, done_at = ?2, done_by = NULL, done_by_label = ?3 WHERE item_id = ?4 AND done != ?1').bind(patch.done ? 1 : 0, patch.done ? nowIso : null, patch.done ? label : null, item.id));
    }
    if (!sets.length) return;
    set('updated_at', nowIso);
    stmts.unshift(db.prepare(`UPDATE list_items SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, item.id));
    pulled++;
  };

  try {
    const app = await taskApp(env, account);
    const keys = app.keys;
    const [itemsRes, mapsRes, sortRes] = await db.batch<any>([
      db.prepare('SELECT id, title, notes, due_date, done, priority, updated_at, sort FROM list_items WHERE list_id = ?').bind(listId),
      db.prepare('SELECT item_id, remote_id, base FROM task_link_items WHERE list_id = ?').bind(listId),
      db.prepare('SELECT coalesce(max(sort), -1) AS m FROM list_items WHERE list_id = ?').bind(listId),
    ]);
    const items = new Map((itemsRes.results as ItemRow[]).map((r) => [r.id, r]));
    const maps = mapsRes.results as { item_id: string; remote_id: string; base: string }[];
    const remote = await app.tasks(link.remote_id);
    const byRemote = new Map(remote.map((t) => [t.id, t]));
    const usedRemote = new Set<string>();

    // Items synced before.
    for (const m of maps) {
      const base = JSON.parse(m.base) as TaskFields;
      const item = items.get(m.item_id);
      items.delete(m.item_id);
      usedRemote.add(m.remote_id);
      let rem: RemoteTask | null = byRemote.get(m.remote_id) ?? null;
      if (!rem && app.task) {
        // Todoist lists open tasks only: one missing was finished or deleted there. Done on both
        // sides already: nothing to ask (a task deleted while done stays done in Kinwall).
        if (item?.done && base.done) continue;
        rem = await app.task(m.remote_id);
      }
      if (!item && !rem) { del(m.item_id); continue; }
      if (!item) { await app.remove(link.remote_id, m.remote_id); pushed++; del(m.item_id); continue; }
      if (!rem) {
        stmts.push(db.prepare("DELETE FROM notes WHERE target_type = 'list_item' AND target_id = ?").bind(item.id), db.prepare('DELETE FROM list_items WHERE id = ?').bind(item.id));
        pulled++;
        del(m.item_id);
        continue;
      }
      const local = fieldsOf(item, app);
      const merged = mergeFields(base, local, rem.fields, localIsNewer(item.updated_at, rem.updatedAt), keys);
      const push = changed(rem.fields, merged, keys);
      if (Object.keys(push).length) { await app.update(link.remote_id, rem.id, push); pushed++; }
      pull(item, changed(local, merged, keys));
      if (JSON.stringify(merged) !== JSON.stringify(base)) keep(item.id, rem.id, merged);
    }

    // Never synced: pair by exact title (the first sync of a link), else copy the open ones across.
    const unpaired = new Map<string, RemoteTask[]>();
    for (const t of remote) if (!usedRemote.has(t.id)) unpaired.set(t.fields.title, [...(unpaired.get(t.fields.title) ?? []), t]);
    for (const item of [...items.values()].sort((a, b) => a.sort - b.sort)) {
      const twin = unpaired.get(item.title)?.shift();
      const local = fieldsOf(item, app);
      if (twin) {
        const merged = mergeFields(null, local, twin.fields, localIsNewer(item.updated_at, twin.updatedAt), keys);
        const push = changed(twin.fields, merged, keys);
        if (Object.keys(push).length) { await app.update(link.remote_id, twin.id, push); pushed++; }
        pull(item, changed(local, merged, keys));
        keep(item.id, twin.id, merged);
      } else if (!item.done) {
        const made = await app.create(link.remote_id, local);
        pushed++;
        keep(item.id, made.id, local);
      }
    }
    let sort = ((sortRes.results[0] as { m: number } | undefined)?.m ?? -1) + 1;
    for (const t of [...unpaired.values()].flat()) {
      if (t.fields.done) continue;
      const id = crypto.randomUUID();
      const f = t.fields;
      stmts.push(
        db.prepare("INSERT INTO list_items (id, list_id, title, name_key, notes, due_date, priority, done, added_by_label, for_member_ids, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,0,?,'[]',?,?,?)")
          .bind(id, listId, f.title, itemKey(f.title), f.notes, f.due, f.priority ?? 'normal', label, sort++, nowIso, nowIso),
      );
      pulled++;
      keep(id, t.id, f);
    }

    await db.batch([
      ...stmts,
      // items_rev after this sync's own writes (the triggers bumped it): a later change moves it again.
      db.prepare('UPDATE task_links SET synced_rev = (SELECT items_rev FROM lists WHERE id = ?1), last_synced_at = ?2, last_error = NULL, last_error_code = NULL, sync_failures = 0, retry_after = NULL WHERE list_id = ?1').bind(listId, new Date().toISOString()),
    ]);
    const shownError = link.last_error !== null;
    if (pulled) publish(env, execCtx, 'list.item.changed', { listId, synced: account.kind });
    else if (shownError) publish(env, execCtx, 'list.changed', { id: listId });
    return { ok: true, pulled, pushed };
  } catch (err) {
    // Keep what already happened on both sides (created ids above all), then record the failure.
    if (stmts.length) await Promise.resolve(db.batch(stmts)).catch(() => undefined);
    const failures = link.sync_failures + 1;
    let message: string, code: string | null = null, retry: string | null = null;
    if (err instanceof TokenRefused || err instanceof SignInRevoked) {
      code = 'revoked';
      message = stored('error', '{app} stopped letting Kinwall see this list. Reconnect {account} to start syncing again.', { app: label, account: account.name });
    } else if (err instanceof RateLimited) {
      // The app's own wait, at least a minute and doubling while it keeps refusing (an hour at most).
      const seconds = Math.min(3600, Math.max(err.retryAfter, 60 * 2 ** Math.min(failures - 1, 6)));
      retry = new Date(Date.now() + seconds * 1000).toISOString();
      message = stored('error', '{app} asked Kinwall to slow down. It tries again in a few minutes.', { app: label });
    } else {
      message = redact(err instanceof Error ? err.message : String(err));
    }
    await db.prepare('UPDATE task_links SET last_synced_at = ?, last_error = ?, last_error_code = ?, sync_failures = ?, retry_after = ? WHERE list_id = ?')
      .bind(nowIso, message, code, failures, retry, listId).run();
    if (message !== link.last_error || failures === 2) publish(env, execCtx, 'list.changed', { id: listId }); // screens show the warning
    return { ok: false, error: message };
  }
}

/** How long after a change in Kinwall the list syncs: a burst of edits makes one sync. */
export const taskSyncTiming = { debounceMs: 5000 };
const queued = new Set<string>();

/** After any change to a list (bus.ts emit): a linked list syncs a few seconds later. */
export function queueTaskSync(env: Env, execCtx: WaitCtx | undefined, listId: string): void {
  if (queued.has(listId)) return;
  queued.add(listId);
  waitUntil(execCtx, (async () => {
    try {
      const linked = await env.DB.prepare('SELECT 1 AS x FROM task_links WHERE list_id = ?').bind(listId).first();
      if (!linked) return;
      await new Promise((r) => setTimeout(r, taskSyncTiming.debounceMs));
    } finally {
      queued.delete(listId);
    }
    await syncTaskLink(env, listId, execCtx);
  })());
}

/** Syncs waiting or running (tests wait for none). */
export const taskSyncsPending = () => queued.size + running.size;

/** The scheduled part (sync.ts syncDue): links not synced for the sync interval, or changed in
 * Kinwall since their last sync, not waiting out a 429. Stalest first, until `deadline`. */
export async function syncDueTaskLinks(env: Env, cutoff: string, deadline: number, execCtx?: WaitCtx): Promise<void> {
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(
    `SELECT t.list_id FROM task_links t JOIN lists l ON l.id = t.list_id
     WHERE (t.retry_after IS NULL OR t.retry_after <= ?1) AND (t.last_synced_at IS NULL OR t.last_synced_at < ?2 OR t.synced_rev IS NOT l.items_rev)
     ORDER BY t.last_synced_at IS NOT NULL, t.last_synced_at`,
  ).bind(now, cutoff).all<{ list_id: string }>();
  for (const row of results) {
    if (Date.now() > deadline) break;
    await syncTaskLink(env, row.list_id, execCtx).catch((err) => console.error('task list sync failed:', err instanceof Error ? err.name : 'error'));
  }
}

/** After an account is connected again: its lists sync now, so the warning clears. */
export async function syncAccountLinks(env: Env, accountId: string, execCtx?: WaitCtx): Promise<void> {
  await env.DB.prepare('UPDATE task_links SET retry_after = NULL WHERE account_id = ?').bind(accountId).run();
  const { results } = await env.DB.prepare('SELECT list_id FROM task_links WHERE account_id = ?').bind(accountId).all<{ list_id: string }>();
  for (const row of results) await syncTaskLink(env, row.list_id, execCtx);
}
