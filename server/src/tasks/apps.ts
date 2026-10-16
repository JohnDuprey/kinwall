// The two outside to-do apps a Kinwall list can sync with (tasks/sync.ts), over plain fetch:
// - Todoist's API v1 (https://developer.todoist.com/api/v1/), which replaced its REST v2 and
//   Sync v9 APIs; a parent's personal API token, sent as a Bearer token.
// - Google Tasks API v1 (https://developers.google.com/workspace/tasks), with Kinwall's Google
//   sign-in and the tasks scope only (routes/tasks.ts asks for it on its own consent).
// - Microsoft To Do through Microsoft Graph v1.0 (https://learn.microsoft.com/graph/todo-concept-overview),
//   with Kinwall's Microsoft sign-in and the Tasks.ReadWrite permission only, the same way.
import { ensureToken } from '../providers/google.ts';
import { ensureToken as ensureMsToken } from '../providers/microsoft.ts';
import { notesText } from '../providers/notes.ts';
import { msg, stored } from '../i18n.ts';
import type { ProviderEnv } from '../providers/types.ts';
import { cleanNotes, fromGoogleDue, fromMsDue, fromMsImportance, fromTodoistDue, fromTodoistPriority, msImportance, todoistPriority, toGoogleDue, type TaskFields } from './map.ts';

export type TaskAppKind = 'todoist' | 'google' | 'microsoft';
// Names, not words: the same in every language (msg() only marks them for the check).
export const APP_NAME: Record<TaskAppKind, string> = { todoist: 'Todoist', google: msg('Google Tasks'), microsoft: msg('Microsoft To Do') };
export type RemoteList = { remoteId: string; name: string };
export type RemoteTask = { id: string; fields: TaskFields; updatedAt: string | null };

/** The other app asked Kinwall to slow down (HTTP 429): sync.ts waits `retryAfter` seconds. */
export class RateLimited extends Error {
  readonly retryAfter: number;
  constructor(retryAfter: number) {
    super(`rate limited, retry after ${retryAfter}s`);
    this.retryAfter = retryAfter;
    this.name = 'RateLimited';
  }
}

/** The other app turned the sign-in or token down for good (a reset Todoist token, a removed
 * Google access): only connecting it again fixes it. sync.ts records last_error_code 'revoked'. */
export class TokenRefused extends Error {
  readonly app: TaskAppKind;
  constructor(app: TaskAppKind) {
    super(`${app} refused the token`);
    this.app = app;
    this.name = 'TokenRefused';
  }
}

export interface TaskApp {
  readonly kind: TaskAppKind;
  /** The fields it keeps: Google Tasks has no priority. */
  readonly keys: readonly (keyof TaskFields)[];
  /** Kinwall's fields as this app can hold them (To Do has no urgent: it's high there). Merging
   * compares these, so a level the app can't hold isn't mistaken for a change. */
  fit?(f: TaskFields): TaskFields;
  lists(): Promise<RemoteList[]>;
  createList(name: string): Promise<RemoteList>;
  /** Top-level tasks only (subtasks stay in the other app). Todoist answers open ones only; Google all. */
  tasks(listId: string): Promise<RemoteTask[]>;
  /** One task that tasks() left out: done, or gone (null). Only Todoist needs it. */
  task?(id: string): Promise<RemoteTask | null>;
  create(listId: string, f: TaskFields): Promise<RemoteTask>;
  update(listId: string, id: string, patch: Partial<TaskFields>): Promise<void>;
  remove(listId: string, id: string): Promise<void>;
}

function retryAfter(res: Response, body: unknown): number {
  const header = Number(res.headers.get('retry-after'));
  const fromBody = Number((body as { retry_after?: unknown } | null)?.retry_after);
  return Math.max(1, Math.round(header || fromBody || 60));
}

/** A failed call, in words the family sees on the list (stored English, translated when read).
 * The app's own reason code helps someone setting up their own server (a Tasks API not enabled). */
const appFailed = (app: string, status: number, reason = '') =>
  reason
    ? stored('error', '{app} had a problem (HTTP {status}, {reason}). Kinwall tries again on the next sync.', { app, status, reason: reason.slice(0, 40) })
    : stored('error', '{app} had a problem (HTTP {status}). Kinwall tries again on the next sync.', { app, status });

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

// --- Todoist ---------------------------------------------------------------------------------

export const TODOIST_API = 'https://api.todoist.com/api/v1';

async function todoistFetch(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${TODOIST_API}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: 'Bearer ' + token, ...(init.body ? { 'content-type': 'application/json' } : {}) },
  });
  if (res.status === 204) return null;
  const body = await readJson(res);
  if (res.status === 401 || res.status === 403) throw new TokenRefused('todoist');
  if (res.status === 429) throw new RateLimited(retryAfter(res, body));
  if (res.status === 404 && (!init.method || init.method === 'DELETE')) return undefined; // gone already
  if (!res.ok) throw new Error(appFailed(APP_NAME.todoist, res.status));
  return body;
}

async function todoistPages(token: string, path: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ limit: '200' });
    if (cursor) q.set('cursor', cursor);
    const page: { results?: any[]; next_cursor?: string | null } = (await todoistFetch(token, `${path}${path.includes('?') ? '&' : '?'}${q}`)) ?? {};
    out.push(...(page.results ?? []));
    cursor = page.next_cursor ?? null;
  } while (cursor);
  return out;
}

/** Who a Todoist token belongs to: checks it works before it's saved. */
export async function todoistUser(token: string): Promise<{ name: string }> {
  const user = (await todoistFetch(token, '/user')) as { email?: string; full_name?: string } | undefined;
  return { name: user?.email || user?.full_name || 'Todoist' };
}

function todoistTask(t: any, tz: string): RemoteTask {
  return {
    id: String(t.id),
    fields: { title: String(t.content ?? '').trim(), notes: cleanNotes(t.description), due: fromTodoistDue(t.due, tz), done: !!t.checked, priority: fromTodoistPriority(t.priority) },
    updatedAt: t.updated_at ?? t.added_at ?? null,
  };
}

function todoistBody(f: Partial<TaskFields>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (f.title !== undefined) body.content = f.title;
  if (f.notes !== undefined) body.description = f.notes ?? '';
  if (f.priority !== undefined && f.priority !== null) body.priority = todoistPriority(f.priority);
  // A day only: a Todoist time on the same day stays, since an unchanged due isn't sent.
  if (f.due !== undefined) Object.assign(body, f.due ? { due_date: f.due } : { due_string: 'no date' });
  return body;
}

export function todoistApp(token: string, tz: string): TaskApp {
  const call = (path: string, init?: RequestInit) => todoistFetch(token, path, init);
  return {
    kind: 'todoist',
    keys: ['title', 'notes', 'due', 'done', 'priority'],
    async lists() {
      const projects = await todoistPages(token, '/projects');
      return projects.filter((p) => !p.is_archived && !p.is_deleted).map((p) => ({ remoteId: String(p.id), name: String(p.name) }));
    },
    async createList(name) {
      const p = await call('/projects', { method: 'POST', body: JSON.stringify({ name }) });
      return { remoteId: String(p.id), name: String(p.name ?? name) };
    },
    async tasks(listId) {
      const all = await todoistPages(token, `/tasks?project_id=${encodeURIComponent(listId)}`);
      return all.filter((t) => !t.parent_id && !t.is_deleted).map((t) => todoistTask(t, tz));
    },
    async task(id) {
      const t = await call(`/tasks/${encodeURIComponent(id)}`);
      return !t || t.is_deleted ? null : todoistTask(t, tz);
    },
    async create(listId, f) {
      const t = await call('/tasks', { method: 'POST', body: JSON.stringify({ ...todoistBody(f), project_id: listId }) });
      if (f.done) await call(`/tasks/${encodeURIComponent(t.id)}/close`, { method: 'POST' });
      const made = todoistTask(t, tz);
      return { ...made, fields: { ...made.fields, done: f.done } };
    },
    async update(_listId, id, patch) {
      const body = todoistBody(patch);
      if (Object.keys(body).length) await call(`/tasks/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(body) });
      if (patch.done !== undefined) await call(`/tasks/${encodeURIComponent(id)}/${patch.done ? 'close' : 'reopen'}`, { method: 'POST' });
    },
    async remove(_listId, id) {
      await call(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}

// --- Google Tasks ----------------------------------------------------------------------------

export const GOOGLE_TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
// Who signed in comes from openid email, as for Calendar.
export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks openid email';

type OAuthCtx = { env: ProviderEnv; account: { id: string; config: any }; saveAccountConfig: (config: any) => Promise<void> };

async function googleFetch(ctx: OAuthCtx, path: string, init: RequestInit = {}): Promise<any> {
  const token = await ensureToken(ctx);
  const res = await fetch(`${GOOGLE_TASKS_API}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: 'Bearer ' + token, 'content-type': 'application/json' },
  });
  if (res.status === 204) return null;
  const body = await readJson(res);
  if (res.status === 401) throw new TokenRefused('google'); // a fresh token turned away: access was withdrawn
  const reason = String((body as any)?.error?.errors?.[0]?.reason ?? (body as any)?.error?.status ?? '');
  if (res.status === 429 || (res.status === 403 && /rateLimit/i.test(reason))) throw new RateLimited(retryAfter(res, body));
  if (res.status === 404 && init.method === 'DELETE') return null; // gone already
  if (!res.ok) throw new Error(appFailed(APP_NAME.google, res.status, reason));
  return body;
}

async function googlePages(ctx: OAuthCtx, path: string, params: Record<string, string> = {}): Promise<any[]> {
  const out: any[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ ...params, maxResults: '100' });
    if (pageToken) q.set('pageToken', pageToken);
    const page = (await googleFetch(ctx, `${path}?${q}`)) ?? {};
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

function googleTask(t: any): RemoteTask {
  return {
    id: String(t.id),
    fields: { title: String(t.title ?? '').trim(), notes: cleanNotes(t.notes), due: fromGoogleDue(t.due), done: t.status === 'completed', priority: null },
    updatedAt: t.updated ?? null,
  };
}

function googleBody(f: Partial<TaskFields>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (f.title !== undefined) body.title = f.title;
  if (f.notes !== undefined) body.notes = f.notes;
  if (f.due !== undefined) body.due = toGoogleDue(f.due);
  if (f.done !== undefined) Object.assign(body, f.done ? { status: 'completed' } : { status: 'needsAction', completed: null });
  return body;
}

export function googleTasksApp(ctx: OAuthCtx): TaskApp {
  const call = (path: string, init?: RequestInit) => googleFetch(ctx, path, init);
  const list = (id: string) => `/lists/${encodeURIComponent(id)}/tasks`;
  return {
    kind: 'google',
    keys: ['title', 'notes', 'due', 'done'],
    async lists() {
      return (await googlePages(ctx, '/users/@me/lists')).map((l) => ({ remoteId: String(l.id), name: String(l.title) }));
    },
    async createList(name) {
      const l = await call('/users/@me/lists', { method: 'POST', body: JSON.stringify({ title: name }) });
      return { remoteId: String(l.id), name: String(l.title ?? name) };
    },
    async tasks(listId) {
      // Deleted ones aren't asked for: a task missing here is gone.
      const all = await googlePages(ctx, list(listId), { showCompleted: 'true', showHidden: 'true' });
      return all.filter((t) => !t.parent && !t.deleted).map(googleTask);
    },
    async create(listId, f) {
      return googleTask(await call(list(listId), { method: 'POST', body: JSON.stringify(googleBody(f)) }));
    },
    async update(listId, id, patch) {
      const body = googleBody(patch);
      if (Object.keys(body).length) await call(`${list(listId)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
    },
    async remove(listId, id) {
      await call(`${list(listId)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}

// --- Microsoft To Do -------------------------------------------------------------------------

export const GRAPH_API = 'https://graph.microsoft.com/v1.0';
export const MS_TASKS_SCOPE = 'offline_access Tasks.ReadWrite User.Read openid email';

async function graphFetch(ctx: OAuthCtx, path: string, init: RequestInit = {}): Promise<any> {
  const token = await ensureMsToken(ctx, MS_TASKS_SCOPE);
  const res = await fetch(path.startsWith('http') ? path : `${GRAPH_API}${path}`, {
    ...init,
    // Notes as text; no outlook.timezone: a due date stays the day it is in its own zone.
    headers: { ...init.headers, authorization: 'Bearer ' + token, 'content-type': 'application/json', prefer: 'outlook.body-content-type="text"' },
  });
  if (res.status === 204) return null;
  const body = await readJson(res);
  if (res.status === 401) throw new TokenRefused('microsoft');
  if (res.status === 429 || res.status === 503 && res.headers.has('retry-after')) throw new RateLimited(retryAfter(res, body));
  if (res.status === 404 && init.method === 'DELETE') return null; // gone already
  const code = String((body as any)?.error?.code ?? '');
  if (!res.ok) throw new Error(appFailed(APP_NAME.microsoft, res.status, code));
  return body;
}

async function graphPages(ctx: OAuthCtx, path: string): Promise<any[]> {
  const out: any[] = [];
  let next: string | undefined = path;
  while (next) {
    const page: { value?: any[]; '@odata.nextLink'?: string } = (await graphFetch(ctx, next)) ?? {};
    out.push(...(page.value ?? []));
    next = page['@odata.nextLink'];
  }
  return out;
}

function msTask(t: any): RemoteTask {
  const notes = t.body?.contentType === 'html' ? notesText(t.body?.content) ?? null : cleanNotes(t.body?.content);
  return {
    id: String(t.id),
    fields: { title: String(t.title ?? '').trim(), notes: cleanNotes(notes), due: fromMsDue(t.dueDateTime), done: t.status === 'completed', priority: fromMsImportance(t.importance) },
    updatedAt: t.lastModifiedDateTime ?? null,
  };
}

function msBody(f: Partial<TaskFields>, tz: string): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (f.title !== undefined) body.title = f.title;
  if (f.notes !== undefined) body.body = { content: f.notes ?? '', contentType: 'text' };
  if (f.priority !== undefined && f.priority !== null) body.importance = msImportance(f.priority);
  // A due day is midnight in the family's zone, which To Do shows as that day.
  if (f.due !== undefined) body.dueDateTime = f.due ? { dateTime: `${f.due}T00:00:00`, timeZone: tz } : null;
  if (f.done !== undefined) body.status = f.done ? 'completed' : 'notStarted';
  return body;
}

export function microsoftTodoApp(ctx: OAuthCtx, tz: string): TaskApp {
  const call = (path: string, init?: RequestInit) => graphFetch(ctx, path, init);
  const list = (id: string) => `/me/todo/lists/${encodeURIComponent(id)}/tasks`;
  return {
    kind: 'microsoft',
    keys: ['title', 'notes', 'due', 'done', 'priority'],
    fit: (f) => (f.priority === 'urgent' ? { ...f, priority: 'high' } : f),
    async lists() {
      return (await graphPages(ctx, '/me/todo/lists')).map((l) => ({ remoteId: String(l.id), name: String(l.displayName) }));
    },
    async createList(name) {
      const l = await call('/me/todo/lists', { method: 'POST', body: JSON.stringify({ displayName: name }) });
      return { remoteId: String(l.id), name: String(l.displayName ?? name) };
    },
    // Every task, done ones too (checklist items are To Do's steps: they stay there). A task missing
    // here is gone. Polled like the others: a delta query would save little on a family's list.
    async tasks(listId) {
      return (await graphPages(ctx, list(listId))).map(msTask);
    },
    async create(listId, f) {
      return msTask(await call(list(listId), { method: 'POST', body: JSON.stringify(msBody(f, tz)) }));
    },
    async update(listId, id, patch) {
      const body = msBody(patch, tz);
      if (Object.keys(body).length) await call(`${list(listId)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
    },
    async remove(listId, id) {
      await call(`${list(listId)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
