// Two-way sync of a Kinwall to-do list with a Todoist project, a Google Tasks list or a Microsoft
// To Do list.
//
// What syncs: title, done, due date, notes, priority (not Google), and steps (Todoist and Google
// subtasks, To Do checklist items: title, done and order). What stays in Kinwall: who it's for, the
// linked event, the discussion. Each item's and step's outside id and the fields as both sides last
// agreed are kept in task_link_items, so a re-sync never duplicates and each side's changes show up
// as differences from that (map.ts mergeFields has the rule).
// - Created on one side: created on the other. A done item that never synced stays on its side.
// - Deleted on one side: deleted on the other (a delete beats an edit made since). An item moved to
//   another Kinwall list counts as deleted from this one.
// - The first sync of a link pairs items (and their steps) with exactly the same title, then copies the rest.
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
import { APP_NAME, byPosition, googleTasksApp, microsoftTodoApp, RateLimited, todoistApp, TokenRefused, type RemoteStep, type RemoteTask, type StepFields, type TaskApp, type TaskAppKind } from './apps.ts';
import { changed, mergeFields, type Priority, type TaskFields } from './map.ts';

export type TaskAccountRow = { id: string; kind: TaskAppKind; name: string; config: string; created_at: string };
export type TaskLinkRow = {
  list_id: string;
  account_id: string | null;
  app: TaskAppKind;
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

type StepRow = { id: string; item_id: string; title: string; done: number; sort: number };
type MapRow = { item_id: string; remote_id: string; base: string; parent_id: string | null; checked_at: string | null };
/** A step's fields as both sides last agreed, and its place among its item's steps. */
type StepBase = StepFields & { rank: number };
/** How many tasks done on both sides are looked up per sync (Todoist lists only open ones, so a
 * task deleted while done is found this way, a few at a time). */
const DONE_CHECKS = 5;

async function syncOnce(env: Env, listId: string, execCtx?: WaitCtx): Promise<SyncResult> {
  const db = env.DB;
  const link = await db.prepare('SELECT * FROM task_links WHERE list_id = ?').bind(listId).first<TaskLinkRow>();
  if (!link) return { ok: false, error: stored('error', 'This list is not synced') };
  // Imported without its account: waits for the family to connect that app again (nothing to record).
  if (!link.account_id) return { ok: false, error: stored('error', 'Connect {app} again to sync this list.', { app: APP_NAME[link.app] }) };
  const account = await db.prepare('SELECT * FROM task_accounts WHERE id = ?').bind(link.account_id).first<TaskAccountRow>();
  if (!account) return { ok: false, error: stored('error', 'This list is not synced') };
  const startedAt = new Date();
  if (link.retry_after && new Date(link.retry_after) > startedAt) return { ok: false, error: link.last_error ?? stored('error', 'Waiting to sync') };

  const stmts: KinwallStatement[] = [];
  let pulled = 0, pushed = 0;
  const nowIso = startedAt.toISOString();
  const label = APP_NAME[account.kind];
  const remoteList = link.remote_id;
  /** Forgets an item's (or step's) pairing, and an item's steps' too. */
  const forget = (id: string) => stmts.push(db.prepare('DELETE FROM task_link_items WHERE list_id = ?1 AND (item_id = ?2 OR parent_id = ?2)').bind(listId, id));
  const keep = (itemId: string, remoteId: string, base: TaskFields | StepBase, parentId: string | null = null) =>
    stmts.push(db.prepare('INSERT INTO task_link_items (list_id, item_id, remote_id, base, parent_id) VALUES (?,?,?,?,?) ON CONFLICT(list_id, item_id) DO UPDATE SET remote_id = excluded.remote_id, base = excluded.base, parent_id = excluded.parent_id').bind(listId, itemId, remoteId, JSON.stringify(base), parentId));
  const deleteItem = (id: string) => { stmts.push(db.prepare("DELETE FROM notes WHERE target_type = 'list_item' AND target_id = ?").bind(id), db.prepare('DELETE FROM list_items WHERE id = ?').bind(id)); pulled++; };
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
      // Like ticking it in Kinwall: every step follows, keeping "done = all steps done" (the steps'
      // own pairings catch up on the next sync).
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
    const [itemsRes, stepsRes, mapsRes, sortRes] = await db.batch<any>([
      db.prepare('SELECT id, title, notes, due_date, done, priority, updated_at, sort FROM list_items WHERE list_id = ?').bind(listId),
      db.prepare('SELECT s.id, s.item_id, s.title, s.done, s.sort FROM list_item_steps s JOIN list_items i ON i.id = s.item_id WHERE i.list_id = ? ORDER BY s.sort, s.created_at').bind(listId),
      db.prepare('SELECT item_id, remote_id, base, parent_id, checked_at FROM task_link_items WHERE list_id = ?').bind(listId),
      db.prepare('SELECT coalesce(max(sort), -1) AS m FROM list_items WHERE list_id = ?').bind(listId),
    ]);
    const items = new Map((itemsRes.results as ItemRow[]).map((r) => [r.id, r]));
    const stepsOf = new Map<string, StepRow[]>();
    for (const st of stepsRes.results as StepRow[]) stepsOf.set(st.item_id, [...(stepsOf.get(st.item_id) ?? []), st]);
    const allMaps = mapsRes.results as MapRow[];
    const stepMaps = new Map<string, MapRow[]>();
    for (const m of allMaps) if (m.parent_id) stepMaps.set(m.parent_id, [...(stepMaps.get(m.parent_id) ?? []), m]);
    const remote = await app.tasks(remoteList);
    const byRemote = new Map(remote.map((t) => [t.id, t]));
    const usedRemote = new Set<string>();
    // Paired tasks done on both sides that the app didn't list (Todoist): a few are looked up.
    const doneChecks: { m: MapRow; gone: () => void }[] = [];

    /** Steps ↔ the task's subtasks or checklist items, like items: each field against what both
     * sides last agreed; changed on both sides, Kinwall's wins (steps keep no edit time). Order:
     * Kinwall's on the first sync and whenever Kinwall's changed; the app's when only the app's
     * changed (or it only added steps); To Do's checklist order isn't readable or settable. */
    const syncSteps = async (item: ItemRow, rem: RemoteTask) => {
      const local = stepsOf.get(item.id) ?? [];
      const localById = new Map(local.map((st) => [st.id, st]));
      const remoteSteps = rem.steps ?? [];
      const remById = new Map(remoteSteps.map((r) => [r.id, r]));
      const maps = stepMaps.get(item.id) ?? [];
      type Pair = { step: StepRow; remote: RemoteStep; baseRank: number | null; created?: boolean; imported?: boolean };
      const pairs: Pair[] = [];
      const usedLocal = new Set<string>(), usedRem = new Set<string>();
      const drop = (st: StepRow) => { local.splice(local.indexOf(st), 1); stmts.push(db.prepare('DELETE FROM list_item_steps WHERE id = ?').bind(st.id)); pulled++; };
      const merge = (st: StepRow, r: RemoteStep, base: StepFields | null) => {
        const l: StepFields = { title: st.title, done: !!st.done }, rr: StepFields = { title: r.title, done: r.done };
        const m = { ...l };
        for (const k of ['title', 'done'] as const) if (l[k] !== rr[k] && base && l[k] === base[k]) (m as Record<string, unknown>)[k] = rr[k];
        const push = Object.fromEntries((['title', 'done'] as const).filter((k) => m[k] !== rr[k]).map((k) => [k, m[k]]));
        const pullSt = (['title', 'done'] as const).filter((k) => m[k] !== l[k]);
        if (pullSt.length) {
          stmts.push(db.prepare('UPDATE list_item_steps SET title = ?, done = ?, done_at = ?, done_by = NULL, done_by_label = ? WHERE id = ?').bind(m.title, m.done ? 1 : 0, m.done ? nowIso : null, m.done ? label : null, st.id));
          st.title = m.title; st.done = m.done ? 1 : 0;
          pulled++;
        }
        return push as Partial<StepFields>;
      };
      for (const m of maps) {
        const base = JSON.parse(m.base) as StepBase;
        const st = localById.get(m.item_id) ?? null;
        usedLocal.add(m.item_id); usedRem.add(m.remote_id);
        let r = remById.get(m.remote_id) ?? null;
        if (!r && app.task) {
          if (st?.done && base.done) { doneChecks.push({ m, gone: () => { drop(st); forget(m.item_id); } }); continue; }
          const t = await app.task(m.remote_id);
          r = t && { id: t.id, title: t.fields.title, done: t.fields.done, position: t.position ?? null };
        }
        if (!st && !r) { forget(m.item_id); continue; }
        if (!st) { await app.removeStep(remoteList, rem.id, m.remote_id); pushed++; forget(m.item_id); continue; }
        if (!r) { drop(st); forget(m.item_id); continue; }
        const push = merge(st, r, base);
        if (Object.keys(push).length) { await app.updateStep(remoteList, rem.id, r.id, push); Object.assign(r, push); pushed++; }
        pairs.push({ step: st, remote: r, baseRank: base.rank });
      }
      // Never paired: same title, else copied across (done ones too: they're part of the item).
      const spare = new Map<string, RemoteStep[]>();
      for (const r of remoteSteps) if (!usedRem.has(r.id)) spare.set(r.title, [...(spare.get(r.title) ?? []), r]);
      for (const st of [...local].sort((a, b) => a.sort - b.sort)) {
        if (usedLocal.has(st.id)) continue;
        const twin = spare.get(st.title)?.shift();
        if (twin) {
          const push = merge(st, twin, null);
          if (Object.keys(push).length) { await app.updateStep(remoteList, rem.id, twin.id, push); Object.assign(twin, push); pushed++; }
          pairs.push({ step: st, remote: twin, baseRank: null });
          continue;
        }
        const before = pairs.filter((p) => p.step.sort < st.sort).sort((a, b) => b.step.sort - a.step.sort)[0];
        const made = await app.createStep(remoteList, rem.id, { title: st.title, done: !!st.done }, before?.remote.id ?? null);
        pushed++;
        pairs.push({ step: st, remote: made, baseRank: null, created: true });
      }
      let nextSort = Math.max(-1, ...local.map((st) => st.sort)) + 1;
      for (const r of [...spare.values()].flat()) {
        const st: StepRow = { id: crypto.randomUUID(), item_id: item.id, title: r.title, done: r.done ? 1 : 0, sort: nextSort++ };
        stmts.push(db.prepare('INSERT INTO list_item_steps (id, item_id, title, done, done_at, sort, created_at, added_by_label, done_by_label) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(st.id, item.id, st.title, st.done, st.done ? nowIso : null, st.sort, nowIso, label, st.done ? label : null));
        local.push(st);
        pulled++;
        pairs.push({ step: st, remote: r, baseRank: null, imported: true });
      }
      stepsOf.set(item.id, local);
      // Order.
      const ids = (ps: Pair[]) => ps.map((p) => p.step.id).join();
      const localSeq = [...pairs].sort((a, b) => a.step.sort - b.step.sort);
      const remoteSeq = [...pairs].sort((a, b) => byPosition(a.remote, b.remote));
      const based = (seq: Pair[]) => seq.filter((p) => p.baseRank !== null);
      const baseSeq = ids(based(pairs).sort((a, b) => a.baseRank! - b.baseRank!));
      const localMoved = ids(based(localSeq)) !== baseSeq, remoteMoved = app.stepOrder && ids(based(remoteSeq)) !== baseSeq;
      const remoteWins = app.stepOrder && maps.length > 0 && ((remoteMoved && !localMoved) || (!localMoved && !remoteMoved && pairs.some((p) => p.imported) && !pairs.some((p) => p.created)));
      const final = remoteWins ? remoteSeq : localSeq;
      if (ids(final) !== ids(localSeq)) {
        const slots = localSeq.map((p) => p.step.sort);
        final.forEach((p, i) => {
          if (p.step.sort === slots[i]) return;
          p.step.sort = slots[i];
          stmts.push(db.prepare('UPDATE list_item_steps SET sort = ? WHERE id = ?').bind(slots[i], p.step.id));
        });
        pulled++;
      }
      if (app.stepOrder && ids(final) !== ids(remoteSeq)) { await app.orderSteps(remoteList, rem.id, final.map((p) => p.remote.id)); pushed++; }
      final.forEach((p, i) => keep(p.step.id, p.remote.id, { title: p.step.title, done: !!p.step.done, rank: i }, item.id));
      // An item with steps is done exactly when every step is (Kinwall's rule): steps that changed
      // in the app can finish or reopen it, which then goes back to the app like a Kinwall change.
      if (local.length && local.every((st) => st.done) !== !!item.done) {
        const done = local.every((st) => st.done);
        pull(item, { done });
        item.done = done ? 1 : 0;
        item.updated_at = nowIso;
      }
    };

    /** A new task in the app for a Kinwall item, with its steps in order. */
    const createRemote = async (item: ItemRow, f: TaskFields) => {
      const made = await app.create(remoteList, f);
      pushed++;
      keep(item.id, made.id, f);
      let prev: string | null = null;
      for (const [i, st] of (stepsOf.get(item.id) ?? []).entries()) {
        const s = await app.createStep(remoteList, made.id, { title: st.title, done: !!st.done }, prev);
        prev = s.id;
        keep(st.id, s.id, { title: st.title, done: !!st.done, rank: i }, item.id);
      }
    };

    // Items synced before.
    for (const m of allMaps) {
      if (m.parent_id) continue;
      const base = JSON.parse(m.base) as TaskFields;
      const item = items.get(m.item_id);
      items.delete(m.item_id);
      usedRemote.add(m.remote_id);
      let rem: RemoteTask | null = byRemote.get(m.remote_id) ?? null;
      if (!rem && app.task) {
        // Todoist lists open tasks only: one missing was finished or deleted there. Done on both
        // sides already: looked up a few at a time (deleted while done → deleted here too).
        if (item?.done && base.done) { doneChecks.push({ m, gone: () => { deleteItem(item.id); forget(item.id); } }); continue; }
        rem = await app.task(m.remote_id);
      }
      if (!item && !rem) { forget(m.item_id); continue; }
      if (!item) { await app.remove(remoteList, m.remote_id); pushed++; forget(m.item_id); continue; }
      if (!rem) { deleteItem(item.id); forget(item.id); continue; }
      if (rem.steps) await syncSteps(item, rem);
      const local = fieldsOf(item, app);
      const merged = mergeFields(base, local, rem.fields, localIsNewer(item.updated_at, rem.updatedAt), keys);
      const push = changed(rem.fields, merged, keys);
      if (Object.keys(push).length) { await app.update(remoteList, rem.id, push); pushed++; }
      pull(item, changed(local, merged, keys));
      if (JSON.stringify(merged) !== JSON.stringify(base)) keep(item.id, rem.id, merged);
    }

    // Never synced: pair by exact title (the first sync of a link), else copy the open ones across.
    const unpaired = new Map<string, RemoteTask[]>();
    for (const t of remote) if (!usedRemote.has(t.id)) unpaired.set(t.fields.title, [...(unpaired.get(t.fields.title) ?? []), t]);
    for (const item of [...items.values()].sort((a, b) => a.sort - b.sort)) {
      const twin = unpaired.get(item.title)?.shift();
      if (twin) {
        if (twin.steps) await syncSteps(item, twin);
        const local = fieldsOf(item, app);
        const merged = mergeFields(null, local, twin.fields, localIsNewer(item.updated_at, twin.updatedAt), keys);
        const push = changed(twin.fields, merged, keys);
        if (Object.keys(push).length) { await app.update(remoteList, twin.id, push); pushed++; }
        pull(item, changed(local, merged, keys));
        keep(item.id, twin.id, merged);
      } else if (!item.done) {
        await createRemote(item, fieldsOf(item, app));
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
      for (const [i, r] of (t.steps ?? []).entries()) {
        const sid = crypto.randomUUID();
        stmts.push(db.prepare('INSERT INTO list_item_steps (id, item_id, title, done, done_at, sort, created_at, added_by_label, done_by_label) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(sid, id, r.title, r.done ? 1 : 0, r.done ? nowIso : null, i, nowIso, label, r.done ? label : null));
        keep(sid, r.id, { title: r.title, done: r.done, rank: i }, id);
      }
    }

    // The done-on-both-sides tasks least recently looked up: gone from the app → gone here too.
    for (const { m, gone } of doneChecks.sort((a, b) => (a.m.checked_at ?? '').localeCompare(b.m.checked_at ?? '')).slice(0, DONE_CHECKS)) {
      if (await app.task!(m.remote_id)) stmts.push(db.prepare('UPDATE task_link_items SET checked_at = ? WHERE list_id = ? AND item_id = ?').bind(nowIso, listId, m.item_id));
      else gone();
    }

    await db.batch([
      ...stmts,
      // items_rev after this sync's own writes (the triggers bumped it): a later change moves it again.
      db.prepare('UPDATE task_links SET synced_rev = (SELECT items_rev FROM lists WHERE id = ?1), last_synced_at = ?2, last_error = NULL, last_error_code = NULL, sync_failures = 0, retry_after = NULL, reconnect_notified_at = NULL WHERE list_id = ?1').bind(listId, new Date().toISOString()),
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

/** To-do lists change by hand, often from the app on a phone, so they're checked more often than
 * calendars: a list is due again two minutes after its last sync. On Node a one-minute loop runs
 * this (node.ts); on Workers it rides the calendar cron. Kinwall's own changes still go out
 * within seconds (queueTaskSync), and opening a list on a grown-up's device pulls it right away. */
export const TASK_SYNC_MINUTES = 2;
export const taskSyncCutoff = (now = Date.now()) => new Date(now - TASK_SYNC_MINUTES * 60_000).toISOString();

/** The scheduled part (sync.ts syncDue): links not synced for the sync interval, or changed in
 * Kinwall since their last sync, not waiting out a 429. Stalest first, until `deadline`. */
export async function syncDueTaskLinks(env: Env, cutoff: string, deadline: number, execCtx?: WaitCtx): Promise<void> {
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(
    `SELECT t.list_id FROM task_links t JOIN lists l ON l.id = t.list_id
     WHERE t.account_id IS NOT NULL AND (t.retry_after IS NULL OR t.retry_after <= ?1) AND (t.last_synced_at IS NULL OR t.last_synced_at < ?2 OR t.synced_rev IS NOT l.items_rev)
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
