// MCP (Model Context Protocol) endpoint: POST/GET/DELETE /mcp, stateless Streamable HTTP.
//
// Library: @modelcontextprotocol/sdk's WebStandardStreamableHTTPServerTransport - it's built on
// Request/Response/ReadableStream (no node:* imports), so the same code runs on Workers and Node.
// Confirmed Workers-compatible via `wrangler deploy --dry-run` (see README).
//
// Every tool is a thin wrapper around the existing REST routes, called in-process via
// `app.request()` with the caller's own Authorization header forwarded unchanged - so auth,
// scope enforcement (display vs admin), bus events/webhooks and rev bumps all happen exactly as
// they would for a real HTTP request. No route logic is duplicated here.
import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { hostTimezone } from './env.ts';
import { effectivePublicUrl } from './providers/config.ts';
import { CalendarSchema, CategorySchema, ChoreDaySchema, ChoreSchema, EventInstanceSchema, LeaderboardEntrySchema, ListDetailSchema, ListItemSchema, ListSchema, MemberSchema, NoteSchema, NotificationSchema, PointsSchema, SettingsSchema, SnapshotSchema } from './schemas.ts';
import type { Env } from './env.ts';
import { VERSION } from './version.ts';
import { resolveKey } from './auth.ts';

type App = OpenAPIHono<{ Bindings: Env }>;

async function call(app: App, env: Env, auth: string, method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { Authorization: auth, 'X-Kinwall-Source': 'mcp' } };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await app.request(path, init, env);
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json };
}

// REST errors (4xx/5xx) become MCP tool results with isError: true and the route's `{error}`
// text - never a thrown McpError, so the client always gets a readable message.
function errorResult(json: unknown, fallback: string): CallToolResult {
  const message = json && typeof json === 'object' && 'error' in json ? String((json as { error: unknown }).error) : fallback;
  return { content: [{ type: 'text', text: message }], isError: true };
}

function okResult(summary: string, structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: summary }, { type: 'text', text: '```json\n' + JSON.stringify(structuredContent, null, 2) + '\n```' }],
    structuredContent,
  };
}

class MemberResolutionError extends Error {}

// Members may be referenced by name (case-insensitive) instead of id, per SPEC - this makes
// the tools usable from a chat window without the caller ever seeing a member id.
async function resolveMember(app: App, env: Env, auth: string, ref: string): Promise<string> {
  const { status, json } = await call(app, env, auth, 'GET', '/api/members');
  if (status >= 400) throw new MemberResolutionError('failed to list members');
  const members = json as { id: string; name: string }[];
  const byId = members.find((m) => m.id === ref);
  if (byId) return byId.id;
  const exact = members.filter((m) => m.name.toLowerCase() === ref.toLowerCase());
  if (exact.length === 1) return exact[0].id;
  const partial = members.filter((m) => m.name.toLowerCase().includes(ref.toLowerCase()));
  if (partial.length === 1) return partial[0].id;
  if (partial.length > 1) throw new MemberResolutionError(`"${ref}" matches multiple members: ${partial.map((m) => m.name).join(', ')}`);
  throw new MemberResolutionError(`no member found matching "${ref}"`);
}

async function resolveMemberIds(app: App, env: Env, auth: string, refs: string[] | undefined): Promise<string[]> {
  if (!refs || refs.length === 0) return [];
  const out: string[] = [];
  for (const ref of refs) out.push(await resolveMember(app, env, auth, ref));
  return out;
}

// Lists may be referenced by name (case-insensitive) instead of id, same convention as members.
async function resolveList(app: App, env: Env, auth: string, ref: string): Promise<{ id: string; name: string }> {
  const { status, json } = await call(app, env, auth, 'GET', '/api/lists?archived=true');
  if (status >= 400) throw new MemberResolutionError('failed to list lists');
  const lists = json as { id: string; name: string }[];
  const byId = lists.find((l) => l.id === ref);
  if (byId) return byId;
  const exact = lists.filter((l) => l.name.toLowerCase() === ref.toLowerCase());
  if (exact.length === 1) return exact[0];
  const partial = lists.filter((l) => l.name.toLowerCase().includes(ref.toLowerCase()));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new MemberResolutionError(`"${ref}" matches multiple lists: ${partial.map((l) => l.name).join(', ')}`);
  throw new MemberResolutionError(`no list found matching "${ref}"`);
}

// Categories may be referenced by name (case-insensitive) instead of id, same convention as
// members/lists.
async function resolveCategory(app: App, env: Env, auth: string, ref: string): Promise<{ id: string; name: string }> {
  const { status, json } = await call(app, env, auth, 'GET', '/api/categories');
  if (status >= 400) throw new MemberResolutionError('failed to list categories');
  const categories = json as { id: string; name: string }[];
  const byId = categories.find((cat) => cat.id === ref);
  if (byId) return byId;
  const exact = categories.filter((cat) => cat.name.toLowerCase() === ref.toLowerCase());
  if (exact.length === 1) return exact[0];
  const partial = categories.filter((cat) => cat.name.toLowerCase().includes(ref.toLowerCase()));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new MemberResolutionError(`"${ref}" matches multiple categories: ${partial.map((cat) => cat.name).join(', ')}`);
  throw new MemberResolutionError(`no category found matching "${ref}"`);
}

// "Today" for defaults means the household's day, not UTC's - in the evening west of UTC those differ.
async function todayInHousehold(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>();
  const tz = row?.value || hostTimezone();
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// Lists given as JSON text ("[15]") are parsed rather than rejected: clients holding a stale tool list,
// and some model-driven clients generally, send arrays that way.
function jsonList<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : v;
    } catch {
      return v;
    }
  }, schema);
}

// Permission groups. readOnly: only reads. destructive: removes something. openWorld: reaches
// outside Kinwall (writes to Google/Outlook, or pushes to phones). idempotent: repeating the same
// call changes nothing more.
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const SET = { ...WRITE, idempotentHint: true };
const OK = { ok: z.boolean() };
const EVENT_ID_DOC = 'Link this task to a calendar event; use list_events to find ids.';
const PRIORITY_DOC = 'low | normal | high | urgent. Open urgent items sort first, then high (important, starred), normal, low.';
const BIRTHDAY_DOC = 'YYYY-MM-DD, or --MM-DD when the year is unknown (age is then not shown).';
const NOTE_TARGET_DOC = 'event:<eventId> (from list_events) or list_item:<itemId> (from get_list).';
const SORT_BY_DOC = 'Item order: manual (priority first, overdue first, then hand-set order), added (newest first), due (soonest first, undated last), priority (priority, then soonest due), alpha (A-Z).';
const TOOL_OUTPUT: Record<string, z.ZodRawShape> = {
  get_household: { settings: SettingsSchema, members: z.array(MemberSchema), calendars: z.array(CalendarSchema) },
  list_events: { events: z.array(EventInstanceSchema) },
  get_event: { event: EventInstanceSchema },
  create_event: { event: EventInstanceSchema },
  update_event: { event: EventInstanceSchema },
  set_event_category: { event: EventInstanceSchema },
  delete_event: OK,
  list_chores: { date: z.string(), chores: z.array(ChoreDaySchema) },
  create_chore: { chore: ChoreSchema },
  update_chore: { chore: ChoreSchema },
  complete_chore: OK,
  uncomplete_chore: OK,
  get_leaderboard: { period: z.string(), leaderboard: z.array(LeaderboardEntrySchema) },
  get_points: { member: z.string(), ...PointsSchema.shape },
  add_member: { member: MemberSchema },
  update_member: { member: MemberSchema },
  list_lists: { lists: z.array(ListSchema) },
  create_list: { list: ListSchema },
  update_list: { list: ListSchema },
  get_list: ListDetailSchema.shape,
  add_list_items: { items: z.array(ListItemSchema) },
  update_list_item: { item: ListItemSchema },
  set_list_item_done: { item: ListItemSchema },
  set_step_done: { item: ListItemSchema },
  get_event_items: { items: z.array(ListItemSchema.extend({ listName: z.string() })) },
  list_categories: { categories: z.array(CategorySchema) },
  update_category: { category: CategorySchema },
  send_notification: { result: z.object({ ok: z.boolean(), sent: z.number() }) },
  list_notifications: { notifications: z.array(NotificationSchema) },
  list_notes: { notes: z.array(NoteSchema) },
  add_note: { note: NoteSchema },
  update_note: { note: NoteSchema },
  get_snapshot: SnapshotSchema.shape,
};

const TOOL_HINTS: Record<string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }> = {
  get_household: READ, list_events: READ, get_event: READ, list_chores: READ, get_leaderboard: READ, get_points: READ, list_lists: READ, get_list: READ, list_categories: READ, get_event_items: READ, list_notifications: READ, list_notes: READ, get_snapshot: READ,
  create_event: { ...WRITE, openWorldHint: true }, update_event: { ...SET, openWorldHint: true }, set_event_category: SET,
  create_chore: WRITE, update_chore: SET, complete_chore: SET, uncomplete_chore: SET, add_member: WRITE, update_member: SET,
  create_list: WRITE, update_list: SET, add_list_items: WRITE, update_list_item: SET, set_list_item_done: SET, set_step_done: SET, update_category: SET, add_note: WRITE, update_note: SET,
  send_notification: { ...WRITE, openWorldHint: true },
  delete_event: { ...WRITE, destructiveHint: true, idempotentHint: true, openWorldHint: true },
};

function registerTools(server: McpServer, app: App, env: Env, auth: string) {
  // Every tool gets its MCP annotations from TOOL_HINTS, so clients (e.g. Claude's connector
  // settings) can group them into read-only / write / delete for permissions.
  const tool: typeof server.registerTool = (name, config, cb) => {
    const hints = TOOL_HINTS[name];
    if (!hints) throw new Error(`MCP tool ${name} has no entry in TOOL_HINTS`);
    // Output schemas (shapes the REST routes already declare) tell the model what comes back; the
    // SDK validates successful results against them, and tests exercise every tool.
    return server.registerTool(name, { ...config, outputSchema: TOOL_OUTPUT[name], annotations: { title: config.title, ...hints } }, cb);
  };

  tool(
    'get_household',
    {
      title: 'Get household',
      description:
        'Household settings (family name, timezone, week start), members, and a summary of calendars. Always check the ' +
        'returned timezone before interpreting or producing dates/times for this household.',
      inputSchema: {},
    },
    async () => {
      const [settingsRes, membersRes, calendarsRes] = await Promise.all([
        call(app, env, auth, 'GET', '/api/settings'),
        call(app, env, auth, 'GET', '/api/members'),
        call(app, env, auth, 'GET', '/api/calendars'),
      ]);
      for (const [res, what] of [[settingsRes, 'settings'], [membersRes, 'members'], [calendarsRes, 'calendars']] as const) {
        if (res.status >= 400) return errorResult(res.json, `failed to load ${what}`);
      }
      const settings = settingsRes.json as { familyName: string; timezone: string | null };
      return okResult(
        `${settings.familyName}, timezone ${settings.timezone ?? '(not set - server default applies)'}, ` +
          `${(membersRes.json as unknown[]).length} member(s), ${(calendarsRes.json as unknown[]).length} calendar(s).`,
        { settings: settingsRes.json, members: membersRes.json, calendars: calendarsRes.json },
      );
    },
  );

  tool(
    'list_events',
    {
      title: 'List events',
      description: 'List calendar events (merged across all calendars) overlapping a date range. Defaults to today through +7 days.',
      inputSchema: {
        from: z.string().optional().describe('ISO date/datetime, inclusive. Default: today.'),
        to: z.string().optional().describe('ISO date/datetime, exclusive. Default: 7 days after `from`.'),
        member: z.string().optional().describe('Member name (case-insensitive) or id to filter by.'),
        calendarId: z.string().optional(),
      },
    },
    async ({ from, to, member, calendarId }) => {
      const fromDate = from ?? await todayInHousehold(env);
      const toDate = to ?? new Date(Date.parse(`${fromDate}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
      let memberId: string | undefined;
      try {
        if (member) memberId = await resolveMember(app, env, auth, member);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const query = new URLSearchParams({ from: fromDate, to: toDate });
      if (memberId) query.set('memberId', memberId);
      if (calendarId) query.set('calendarId', calendarId);
      const res = await call(app, env, auth, 'GET', `/api/events?${query}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to list events');
      const events = res.json as unknown[];
      return okResult(`${events.length} event(s) from ${fromDate} to ${toDate}.`, { events });
    },
  );

  tool(
    'get_event',
    {
      title: 'Get event',
      description: 'Get a single event by id (the series row itself for a recurring local event).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const res = await call(app, env, auth, 'GET', `/api/events/${encodeURIComponent(id)}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to get event');
      const event = res.json as { title: string };
      return okResult(`"${event.title}".`, { event: res.json as Record<string, unknown> });
    },
  );

  tool(
    'get_event_items',
    {
      title: 'Get event tasks',
      description: 'List items (tasks) linked to a calendar event, across all lists, open first. Each carries listId and listName.',
      inputSchema: { id: z.string().describe('Event id (from list_events).') },
    },
    async ({ id }) => {
      const res = await call(app, env, auth, 'GET', `/api/events/${encodeURIComponent(id)}/items`);
      if (res.status >= 400) return errorResult(res.json, 'failed to get event items');
      const items = res.json as { done: boolean }[];
      return okResult(`${items.filter((i) => !i.done).length} open of ${items.length} linked item(s).`, { items });
    },
  );

  tool(
    'create_event',
    {
      title: 'Create event',
      description: 'Create a calendar event. Writes through to the provider for remote (Google/Microsoft/CalDAV) calendars.',
      inputSchema: {
        calendarId: z.string().describe('Target calendar id (see get_household for writable calendars).'),
        title: z.string(),
        start: z.string().describe('ISO datetime (UTC), or YYYY-MM-DD for an all-day event.'),
        end: z.string().describe('ISO datetime (UTC), exclusive, or YYYY-MM-DD for an all-day event.'),
        allDay: z.boolean().default(false),
        location: z.string().optional(),
        description: z.string().optional(),
        members: jsonList(z.array(z.string())).optional().describe('Member names or ids to attach to this event.'),
        rrule: z.string().nullable().optional().describe('Recurrence rule, e.g. FREQ=WEEKLY;BYDAY=TU. Local calendars only.'),
        reminders: jsonList(z.array(z.number().int().min(0)).nullable()).optional().describe('Reminder minutes before start, e.g. [30] or [10, 1440]. [] = no reminders, null = default. Written to Google/Outlook for synced events.'),
        travelMinutes: z.number().int().min(0).max(600).nullable().optional().describe('Travel time in minutes: the event gets a leave-by time (start minus this). Kinwall-only, never sent to Google/Outlook. null clears it.'),
        remindBeforeLeave: z.boolean().optional().describe('When true (and travelMinutes is set), reminders count back from the leave-by time instead of the start.'),
      },
    },
    async ({ members, ...input }) => {
      let memberIds: string[] = [];
      try {
        memberIds = await resolveMemberIds(app, env, auth, members);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const res = await call(app, env, auth, 'POST', '/api/events', { ...input, memberIds });
      if (res.status >= 400) return errorResult(res.json, 'failed to create event');
      const event = res.json as { title: string; start: string };
      return okResult(`Created "${event.title}" starting ${event.start}.`, { event: res.json as Record<string, unknown> });
    },
  );

  tool(
    'update_event',
    {
      title: 'Update event',
      description: 'Update an event (whole series for recurring local events). Only provided fields change.',
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        allDay: z.boolean().optional(),
        location: z.string().optional(),
        description: z.string().optional(),
        members: jsonList(z.array(z.string())).optional().describe('Member names or ids; replaces the current list.'),
        rrule: z.string().nullable().optional(),
        reminders: jsonList(z.array(z.number().int().min(0)).nullable()).optional().describe('Reminder minutes before start, e.g. [30] or [10, 1440]. [] = no reminders, null = default. Written to Google/Outlook for synced events.'),
        travelMinutes: z.number().int().min(0).max(600).nullable().optional().describe('Travel time in minutes: the event gets a leave-by time (start minus this). Kinwall-only, never sent to Google/Outlook. null clears it.'),
        remindBeforeLeave: z.boolean().optional().describe('When true (and travelMinutes is set), reminders count back from the leave-by time instead of the start.'),
        scope: z
          .enum(['occurrence', 'series'])
          .optional()
          .describe('For a member-only update on a recurring synced event: tag just this occurrence, or every occurrence in the series. Default: occurrence.'),
      },
    },
    async ({ id, members, ...input }) => {
      let memberIds: string[] | undefined;
      try {
        if (members) memberIds = await resolveMemberIds(app, env, auth, members);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const res = await call(app, env, auth, 'PATCH', `/api/events/${encodeURIComponent(id)}`, { ...input, memberIds });
      if (res.status >= 400) return errorResult(res.json, 'failed to update event');
      const event = res.json as { title: string };
      return okResult(`Updated "${event.title}".`, { event: res.json as Record<string, unknown> });
    },
  );

  tool(
    'delete_event',
    {
      title: 'Delete event',
      description: 'Delete an event (whole series for recurring local events).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const res = await call(app, env, auth, 'DELETE', `/api/events/${encodeURIComponent(id)}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to delete event');
      return okResult('Event deleted.', { ok: true });
    },
  );

  tool(
    'list_chores',
    {
      title: 'List chores for a day',
      description: 'List chores due on a date (household timezone), with each chore\'s completion state. Defaults to today.',
      inputSchema: { date: z.string().optional().describe('YYYY-MM-DD, household timezone. Default: today.') },
    },
    async ({ date }) => {
      const day = date ?? await todayInHousehold(env);
      const res = await call(app, env, auth, 'GET', `/api/chores/day?date=${encodeURIComponent(day)}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to list chores');
      const chores = res.json as { completed: boolean }[];
      const done = chores.filter((c) => c.completed).length;
      return okResult(`${day}: ${done}/${chores.length} chore(s) complete.`, { date: day, chores });
    },
  );

  tool(
    'create_chore',
    {
      title: 'Create chore',
      description: 'Create a recurring or one-off chore.',
      inputSchema: {
        title: z.string(),
        emoji: z.string().optional(),
        member: z.string().optional().describe('Assign to a member by name or id; omit for "anyone".'),
        points: z.number().optional(),
        rrule: z.string().optional().describe('Recurrence, e.g. FREQ=DAILY or FREQ=WEEKLY;BYDAY=MO,WE,FR. Omit for a one-off chore.'),
        dueDate: z.string().optional().describe('YYYY-MM-DD. Required if rrule is omitted (one-off); anchors the recurrence otherwise.'),
        dueTime: z.string().optional(),
        list: z.string().optional().describe('Checklist: a list (name or id) that must be fully ticked before the chore can be completed. A reusable list resets on completion.'),
      },
    },
    async ({ member, list, ...input }) => {
      let memberId: string | undefined;
      let listId: string | undefined;
      try {
        if (member) memberId = await resolveMember(app, env, auth, member);
        if (list) listId = (await resolveList(app, env, auth, list)).id;
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'lookup failed');
      }
      const res = await call(app, env, auth, 'POST', '/api/chores', { ...input, memberId, listId });
      if (res.status >= 400) return errorResult(res.json, 'failed to create chore');
      const chore = res.json as { title: string };
      return okResult(`Created chore "${chore.title}".`, { chore: res.json as Record<string, unknown> });
    },
  );

  tool(
    'update_chore',
    {
      title: 'Update chore',
      description:
        'Change a chore: title, emoji, assignee, points, recurrence, due date/time, or active state. Only provided fields change; pass member: null to unassign (anyone). ' +
        'rrule uses standard RRULE syntax, e.g. FREQ=DAILY or FREQ=WEEKLY;BYDAY=MO,WE,FR, optionally ending with ;UNTIL=YYYYMMDD to stop the recurrence on a date; pass rrule: null to make it one-off (requires dueDate).',
      inputSchema: {
        choreId: z.string(),
        title: z.string().optional(),
        emoji: z.string().optional(),
        member: z.string().nullable().optional().describe('Assign to a member by name or id; null for "anyone".'),
        points: z.number().optional(),
        rrule: z.string().nullable().optional().describe('Recurrence, e.g. FREQ=DAILY or FREQ=WEEKLY;BYDAY=MO,WE,FR, optionally with ;UNTIL=YYYYMMDD. null to clear (one-off).'),
        dueDate: z.string().nullable().optional().describe('YYYY-MM-DD.'),
        dueTime: z.string().nullable().optional(),
        active: z.boolean().optional(),
        list: z.string().nullable().optional().describe('Checklist list (name or id); null to unlink.'),
      },
    },
    async ({ choreId, member, list, ...input }) => {
      let memberId: string | null | undefined;
      let listId: string | null | undefined;
      try {
        if (member !== undefined) memberId = member === null ? null : await resolveMember(app, env, auth, member);
        if (list !== undefined) listId = list === null ? null : (await resolveList(app, env, auth, list)).id;
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'lookup failed');
      }
      const body = { ...input, ...(memberId !== undefined ? { memberId } : {}), ...(listId !== undefined ? { listId } : {}) };
      const res = await call(app, env, auth, 'PATCH', `/api/chores/${encodeURIComponent(choreId)}`, body);
      if (res.status >= 400) return errorResult(res.json, 'failed to update chore');
      const chore = res.json as { title: string };
      return okResult(`Updated chore "${chore.title}".`, { chore: res.json as Record<string, unknown> });
    },
  );

  tool(
    'complete_chore',
    {
      title: 'Complete chore',
      description: 'Mark a chore complete for a date. Defaults to today.',
      inputSchema: {
        choreId: z.string(),
        date: z.string().optional().describe('YYYY-MM-DD. Default: today.'),
        member: z.string().optional().describe('Who completed it, by name or id; defaults to the chore\'s assigned member.'),
      },
    },
    async ({ choreId, date, member }) => {
      let memberId: string | undefined;
      try {
        if (member) memberId = await resolveMember(app, env, auth, member);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const day = date ?? await todayInHousehold(env);
      const res = await call(app, env, auth, 'POST', `/api/chores/${encodeURIComponent(choreId)}/complete`, { date: day, memberId });
      if (res.status >= 400) return errorResult(res.json, 'failed to complete chore');
      return okResult(`Marked chore complete for ${day}.`, { ok: true });
    },
  );

  tool(
    'uncomplete_chore',
    {
      title: 'Uncomplete chore',
      description: 'Undo a chore completion for a date. Defaults to today.',
      inputSchema: { choreId: z.string(), date: z.string().optional().describe('YYYY-MM-DD. Default: today.') },
    },
    async ({ choreId, date }) => {
      const day = date ?? await todayInHousehold(env);
      const res = await call(app, env, auth, 'DELETE', `/api/chores/${encodeURIComponent(choreId)}/complete?date=${encodeURIComponent(day)}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to uncomplete chore');
      return okResult(`Undid completion for ${day}.`, { ok: true });
    },
  );

  tool(
    'get_leaderboard',
    {
      title: 'Get chore leaderboard',
      description: 'Chore leaderboard: points, completions and streaks by member for a period. Default: week.',
      inputSchema: { period: z.enum(['today', 'week', 'month']).optional() },
    },
    async ({ period }) => {
      const res = await call(app, env, auth, 'GET', `/api/leaderboard?period=${period ?? 'week'}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to load leaderboard');
      const entries = res.json as { name: string; points: number }[];
      const summary = entries.map((e) => `${e.name}: ${e.points}pt`).join(', ') || 'no members';
      return okResult(`Leaderboard (${period ?? 'week'}): ${summary}.`, { period: period ?? 'week', leaderboard: entries });
    },
  );

  tool(
    'get_points',
    {
      title: "Get a member's points",
      description: "A member's chore points: balance left to spend on sticker packs, all-time earned and spent, and recent ledger entries (purchases). Read-only - buying happens on the wall.",
      inputSchema: { member: z.string().describe('Member name or id.') },
    },
    async ({ member }) => {
      let memberId: string;
      try {
        memberId = await resolveMember(app, env, auth, member);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const res = await call(app, env, auth, 'GET', `/api/members/${encodeURIComponent(memberId)}/points`);
      if (res.status >= 400) return errorResult(res.json, 'failed to load points');
      const points = res.json as { balance: number; earnedTotal: number; spentTotal: number };
      return okResult(`${member}: ${points.balance} points to spend (${points.earnedTotal} earned, ${points.spentTotal} spent).`, { member: memberId, ...(res.json as Record<string, unknown>) });
    },
  );

  tool(
    'get_snapshot',
    {
      title: 'Get a member\'s snapshot',
      description:
        "One family member's day (range=day) or next 7 days (range=week): greeting, weather (if a location is set), their events plus " +
        "everyone's, their chores, their list items that are due or high/urgent, family birthdays, and (day) tomorrow at a glance. " +
        'Good for "what does Maya have today?" or "what\'s my week look like?".',
      inputSchema: {
        member: z.string().describe('Member name or id.'),
        range: z.enum(['day', 'week']).optional().describe('day (default) or week.'),
      },
    },
    async ({ member, range }) => {
      let id: string;
      try {
        id = await resolveMember(app, env, auth, member);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const res = await call(app, env, auth, 'GET', `/api/snapshot?member=${encodeURIComponent(id)}&range=${range ?? 'day'}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to load snapshot');
      const snap = res.json as { greeting: string; events: unknown[]; chores: unknown[]; items: unknown[]; birthdays: unknown[] };
      const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
      return okResult(`${snap.greeting}: ${n(snap.events.length, 'event')}, ${n(snap.chores.length, 'chore')}, ${n(snap.items.length, 'list item')}, ${n(snap.birthdays.length, 'birthday')}.`, res.json as Record<string, unknown>);
    },
  );

  tool(
    'add_member',
    {
      title: 'Add family member',
      description: 'Add a new family member.',
      inputSchema: {
        name: z.string(),
        color: z.string().describe('Hex color, e.g. #ff6b6b - drives their calendar/chore color.'),
        avatar: z.string().optional().describe('Emoji or initial.'),
        birthday: z.string().optional().describe(BIRTHDAY_DOC),
      },
    },
    async (input) => {
      const res = await call(app, env, auth, 'POST', '/api/members', input);
      if (res.status >= 400) return errorResult(res.json, 'failed to add member');
      const member = res.json as { name: string };
      return okResult(`Added member "${member.name}".`, { member: res.json as Record<string, unknown> });
    },
  );

  tool(
    'update_member',
    {
      title: 'Update family member',
      description: 'Change a family member\'s name, color, avatar, or birthday. Only provided fields change.',
      inputSchema: {
        member: z.string().describe('Member name or id.'),
        name: z.string().optional(),
        color: z.string().optional().describe('Hex color, e.g. #ff6b6b.'),
        avatar: z.string().nullable().optional().describe('Emoji or initial.'),
        birthday: z.string().nullable().optional().describe(`${BIRTHDAY_DOC} null clears it.`),
      },
    },
    async ({ member, ...input }) => {
      let id: string;
      try {
        id = await resolveMember(app, env, auth, member);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const res = await call(app, env, auth, 'PATCH', `/api/members/${encodeURIComponent(id)}`, input);
      if (res.status >= 400) return errorResult(res.json, 'failed to update member');
      const updated = res.json as { name: string };
      return okResult(`Updated member "${updated.name}".`, { member: res.json as Record<string, unknown> });
    },
  );

  tool(
    'list_lists',
    {
      title: 'List lists',
      description: 'List all lists (shopping/todo/reusable) with item and open counts.',
      inputSchema: { archived: z.boolean().optional().describe('Include archived lists. Default: false.') },
    },
    async ({ archived }) => {
      const res = await call(app, env, auth, 'GET', `/api/lists${archived ? '?archived=true' : ''}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to list lists');
      const lists = res.json as { name: string; itemCount: number; openCount: number }[];
      const summary = lists.map((l) => `${l.name} (${l.openCount}/${l.itemCount} open)`).join(', ') || 'no lists';
      return okResult(`${lists.length} list(s): ${summary}.`, { lists: res.json as Record<string, unknown>[] });
    },
  );

  tool(
    'create_list',
    {
      title: 'Create list',
      description: 'Create a list. Kinds: shopping (grouped by store/category), todo (items can have an assignee and due date), reusable (packing lists, routines - can be reset).',
      inputSchema: {
        name: z.string().describe('List name, e.g. "Groceries".'),
        kind: z.enum(['shopping', 'todo', 'reusable']).optional().describe('Default: todo.'),
        emoji: z.string().optional().describe('A single emoji shown with the list.'),
        members: jsonList(z.array(z.string())).optional().describe('Owner member names or ids. Default: the whole family.'),
      },
    },
    async ({ name, kind, emoji, members }) => {
      let memberIds: string[];
      try {
        memberIds = await resolveMemberIds(app, env, auth, members);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const res = await call(app, env, auth, 'POST', '/api/lists', { name, kind: kind ?? 'todo', emoji, memberIds });
      if (res.status >= 400) return errorResult(res.json, 'failed to create list');
      const list = res.json as { name: string; kind: string };
      return okResult(`Created ${list.kind} list "${list.name}".`, { list: res.json as Record<string, unknown> });
    },
  );

  tool(
    'get_list',
    {
      title: 'Get list',
      description: 'Get a list by id or name (case-insensitive), including its items (in the list sortBy order, each with its ordered steps), group ordering, and store/category suggestions.',
      inputSchema: { list: z.string().describe('List id or name.') },
    },
    async ({ list }) => {
      let id: string;
      try {
        id = (await resolveList(app, env, auth, list)).id;
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'list lookup failed');
      }
      const res = await call(app, env, auth, 'GET', `/api/lists/${encodeURIComponent(id)}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to get list');
      const detail = res.json as { list: { name: string }; items: unknown[] };
      return okResult(`"${detail.list.name}": ${detail.items.length} item(s).`, detail as Record<string, unknown>);
    },
  );

  tool(
    'add_list_items',
    {
      title: 'Add list items',
      description: 'Add one or more items to a list. Provide plain titles, or objects for more detail (notes, quantity, store, category, member, dueDate, eventId, priority, steps).',
      inputSchema: {
        listId: z.string().optional().describe('List id (use this or listName).'),
        listName: z.string().optional().describe('List name, case-insensitive (use this or listId).'),
        items: jsonList(z.array(
          z.union([
            z.string().describe('Plain item title.'),
            z.object({
              title: z.string(),
              notes: z.string().optional(),
              quantity: z.string().optional().describe('Free text, e.g. "2" or "1 lb".'),
              store: z.string().optional(),
              category: z.string().optional(),
              member: z.string().optional().describe('Member name or id to assign this item to.'),
              dueDate: z.string().optional().describe('YYYY-MM-DD.'),
              eventId: z.string().optional().describe(EVENT_ID_DOC),
              priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe(PRIORITY_DOC),
              steps: jsonList(z.array(z.string())).optional().describe('Ordered sub-steps, e.g. ["Pick up toys", "Fluff cushions"]. The item completes when every step is done.'),
            }),
          ]),
        )),
      },
    },
    async ({ listId, listName, items }) => {
      let resolvedListId: string;
      try {
        if (listId) {
          resolvedListId = listId;
        } else if (listName) {
          resolvedListId = (await resolveList(app, env, auth, listName)).id;
        } else {
          return errorResult(null, 'listId or listName is required');
        }
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'list lookup failed');
      }
      const body: Record<string, unknown>[] = [];
      for (const item of items) {
        if (typeof item === 'string') {
          body.push({ title: item });
          continue;
        }
        const { member, ...rest } = item;
        let memberId: string | undefined;
        try {
          if (member) memberId = await resolveMember(app, env, auth, member);
        } catch (err) {
          return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
        }
        body.push({ ...rest, memberId });
      }
      const res = await call(app, env, auth, 'POST', `/api/lists/${encodeURIComponent(resolvedListId)}/items`, body);
      if (res.status >= 400) return errorResult(res.json, 'failed to add list items');
      const added = res.json as unknown[];
      return okResult(`Added ${added.length} item(s).`, { items: res.json as Record<string, unknown>[] });
    },
  );

  tool(
    'list_categories',
    {
      title: 'List event categories',
      description: 'List event categories (name, emoji, color, keywords), ordered by sort. A category\'s color overrides the assigned member\'s color on the calendar.',
      inputSchema: {},
    },
    async () => {
      const res = await call(app, env, auth, 'GET', '/api/categories');
      if (res.status >= 400) return errorResult(res.json, 'failed to list categories');
      const categories = res.json as { name: string }[];
      const summary = categories.map((cat) => cat.name).join(', ') || 'no categories';
      return okResult(`${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}: ${summary}.`, { categories: res.json as Record<string, unknown>[] });
    },
  );

  tool(
    'update_category',
    {
      title: 'Update event category',
      description: 'Change an event category: name, emoji, color, or keywords (used to auto-match events by title). Only provided fields change.',
      inputSchema: {
        category: z.string().describe('Category name or id.'),
        name: z.string().optional(),
        emoji: z.string().nullable().optional(),
        color: z.string().optional().describe('Hex color, e.g. #3366ff.'),
        keywords: jsonList(z.array(z.string())).optional(),
      },
    },
    async ({ category, ...input }) => {
      let id: string;
      try {
        id = (await resolveCategory(app, env, auth, category)).id;
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'category lookup failed');
      }
      const res = await call(app, env, auth, 'PATCH', `/api/categories/${encodeURIComponent(id)}`, input);
      if (res.status >= 400) return errorResult(res.json, 'failed to update category');
      const updated = res.json as { name: string };
      return okResult(`Updated category "${updated.name}".`, { category: res.json as Record<string, unknown> });
    },
  );

  tool(
    'set_event_category',
    {
      title: 'Set event category',
      description: 'Set or clear an event\'s category override. Clearing (omit category) falls back to a keyword match or the calendar\'s default category.',
      inputSchema: {
        id: z.string(),
        category: z.string().optional().describe('Category name or id. Omit to clear the override.'),
        scope: z
          .enum(['occurrence', 'series'])
          .optional()
          .describe('For a recurring synced event: apply to just this occurrence, or every occurrence in the series. Default: occurrence.'),
      },
    },
    async ({ id, category, scope }) => {
      let categoryId: string | null = null;
      if (category) {
        try {
          categoryId = (await resolveCategory(app, env, auth, category)).id;
        } catch (err) {
          return errorResult(null, err instanceof Error ? err.message : 'category lookup failed');
        }
      }
      const res = await call(app, env, auth, 'PATCH', `/api/events/${encodeURIComponent(id)}`, { categoryId, scope });
      if (res.status >= 400) return errorResult(res.json, 'failed to set event category');
      const event = res.json as { title: string };
      return okResult(categoryId ? `Set "${event.title}"'s category.` : `Cleared "${event.title}"'s category override.`, { event: res.json as Record<string, unknown> });
    },
  );

  tool(
    'send_notification',
    {
      title: 'Send push notification',
      description: 'Send a custom push notification now to devices following the given members (or all devices if none given). Admin only.',
      inputSchema: {
        title: z.string(),
        body: z.string(),
        members: jsonList(z.array(z.string())).optional().describe('Member names or ids to target; omit to notify every device.'),
      },
    },
    async ({ title, body, members }) => {
      let memberIds: string[] = [];
      try {
        memberIds = await resolveMemberIds(app, env, auth, members);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const res = await call(app, env, auth, 'POST', '/api/notify', { title, body, memberIds: memberIds.length ? memberIds : undefined });
      if (res.status >= 400) return errorResult(res.json, 'failed to send notification');
      const result = res.json as { sent: number };
      return okResult(`Sent to ${result.sent} device(s).`, { result });
    },
  );

  tool(
    'list_notifications',
    {
      title: 'List notifications',
      description: 'Recent notifications Kinwall sent (event reminders, daily summaries, chore nudges, list updates, messages), newest first - the same feed as the bell in the app.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('Default 20.'),
        before: z.string().optional().describe('ISO time: only notifications older than this.'),
      },
    },
    async ({ limit, before }) => {
      const qs = new URLSearchParams({ limit: String(limit ?? 20), ...(before ? { before } : {}) });
      const res = await call(app, env, auth, 'GET', `/api/notifications?${qs}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to list notifications');
      const rows = res.json as { at: string; title: string }[];
      const summary = rows.slice(0, 5).map((n) => `${n.title} (${n.at})`).join('; ') || 'none';
      return okResult(`${rows.length} notification(s): ${summary}.`, { notifications: res.json as Record<string, unknown>[] });
    },
  );

  tool(
    'set_list_item_done',
    {
      title: 'Set list item done',
      description: 'Mark a list item done or not done. Marking it done ticks all its steps; not done unticks them.',
      inputSchema: { listId: z.string(), itemId: z.string(), done: z.boolean() },
    },
    async ({ listId, itemId, done }) => {
      const res = await call(app, env, auth, 'PATCH', `/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, { done });
      if (res.status >= 400) return errorResult(res.json, 'failed to update item');
      return okResult(done ? 'Marked item done.' : 'Marked item not done.', { item: res.json as Record<string, unknown> });
    },
  );

  tool(
    'set_step_done',
    {
      title: 'Set step done',
      description: 'Tick or untick one step of a list item (step ids come from get_list). Ticking the last open step completes the item; unticking a step of a done item re-opens it.',
      inputSchema: { list: z.string().describe('List id or name.'), itemId: z.string(), stepId: z.string(), done: z.boolean() },
    },
    async ({ list, itemId, stepId, done }) => {
      let listId: string;
      try {
        listId = (await resolveList(app, env, auth, list)).id;
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'list lookup failed');
      }
      const res = await call(app, env, auth, 'PATCH', `/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}/steps/${encodeURIComponent(stepId)}`, { done });
      if (res.status >= 400) return errorResult(res.json, 'failed to update step');
      const item = res.json as { title: string; done: boolean; stepsDone: number; stepsTotal: number };
      const progress = `${item.stepsDone} of ${item.stepsTotal} steps done`;
      return okResult(`"${item.title}": ${progress}${item.done ? ' - item complete.' : '.'}`, { item: res.json as Record<string, unknown> });
    },
  );

  tool(
    'update_list',
    {
      title: 'Update list',
      description: 'Change a list: rename it, switch its kind (todo / shopping / reusable), emoji, owners, item sort order, or archive it. Only provided fields change.',
      inputSchema: {
        list: z.string().describe('List id or name.'),
        name: z.string().optional(),
        kind: z.enum(['shopping', 'todo', 'reusable']).optional(),
        emoji: z.string().optional(),
        members: jsonList(z.array(z.string())).optional().describe('Owner member names or ids; [] = the whole family.'),
        sortBy: z.enum(['manual', 'added', 'due', 'priority', 'alpha']).optional().describe(SORT_BY_DOC),
        archived: z.boolean().optional(),
      },
    },
    async ({ list, members, ...input }) => {
      let listId: string;
      let memberIds: string[] | undefined;
      try {
        listId = (await resolveList(app, env, auth, list)).id;
        if (members) memberIds = await resolveMemberIds(app, env, auth, members);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'lookup failed');
      }
      const res = await call(app, env, auth, 'PATCH', `/api/lists/${encodeURIComponent(listId)}`, { ...input, ...(memberIds ? { memberIds } : {}) });
      if (res.status >= 400) return errorResult(res.json, 'failed to update list');
      const updated = res.json as { name: string; kind: string };
      return okResult(`Updated ${updated.kind} list "${updated.name}".`, { list: res.json as Record<string, unknown> });
    },
  );

  tool(
    'update_list_item',
    {
      title: 'Update list item',
      description: 'Edit a list item: title, notes, quantity, store, category, assignee, due date, linked event, priority. Only provided fields change; pass member: null to unassign.',
      inputSchema: {
        list: z.string().describe('List id or name.'),
        itemId: z.string(),
        title: z.string().optional(),
        notes: z.string().nullable().optional(),
        quantity: z.string().nullable().optional(),
        store: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        member: z.string().nullable().optional().describe('Member name or id to assign; null to unassign.'),
        dueDate: z.string().nullable().optional().describe('YYYY-MM-DD, or null to clear.'),
        eventId: z.string().nullable().optional().describe(`${EVENT_ID_DOC} null to unlink.`),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe(PRIORITY_DOC),
      },
    },
    async ({ list, itemId, member, ...input }) => {
      let listId: string;
      let memberId: string | null | undefined;
      try {
        listId = (await resolveList(app, env, auth, list)).id;
        if (member !== undefined) memberId = member === null ? null : await resolveMember(app, env, auth, member);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'lookup failed');
      }
      const body = { ...input, ...(memberId !== undefined ? { memberId } : {}) };
      const res = await call(app, env, auth, 'PATCH', `/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, body);
      if (res.status >= 400) return errorResult(res.json, 'failed to update item');
      return okResult(`Updated "${(res.json as { title: string }).title}".`, { item: res.json as Record<string, unknown> });
    },
  );

  tool(
    'list_notes',
    {
      title: 'List notes',
      description: 'The notes thread on an event or list item (family members\' messages, oldest first; memberId null = "Someone"). list_events and get_list show a noteCount.',
      inputSchema: { target: z.string().describe(NOTE_TARGET_DOC) },
    },
    async ({ target }) => {
      const res = await call(app, env, auth, 'GET', `/api/notes?target=${encodeURIComponent(target)}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to list notes');
      const notes = res.json as unknown[];
      return okResult(`${notes.length} note(s).`, { notes: res.json as Record<string, unknown>[] });
    },
  );

  tool(
    'add_note',
    {
      title: 'Add note',
      description: 'Add a note to the thread on an event or list item, posted as a member (or "Someone" if omitted). Separate thoughts go in separate notes.',
      inputSchema: {
        target: z.string().describe(NOTE_TARGET_DOC),
        body: z.string().describe('The note, up to 2000 characters.'),
        member: z.string().optional().describe('Who is posting: member name or id.'),
      },
    },
    async ({ target, body, member }) => {
      let memberId: string | undefined;
      try {
        if (member) memberId = await resolveMember(app, env, auth, member);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const res = await call(app, env, auth, 'POST', '/api/notes', { target, body, memberId });
      if (res.status >= 400) return errorResult(res.json, 'failed to add note');
      return okResult('Note added.', { note: res.json as Record<string, unknown> });
    },
  );

  tool(
    'update_note',
    {
      title: 'Update note',
      description: "Replace a note's text (note ids come from list_notes).",
      inputSchema: { noteId: z.string(), body: z.string().describe('The new text, up to 2000 characters.') },
    },
    async ({ noteId, body }) => {
      const res = await call(app, env, auth, 'PATCH', `/api/notes/${encodeURIComponent(noteId)}`, { body });
      if (res.status >= 400) return errorResult(res.json, 'failed to update note');
      return okResult('Note updated.', { note: res.json as Record<string, unknown> });
    },
  );
}

// Mounted as `app.all('/mcp', ...)` in app.ts, passing the app itself so tools can call back
// into it. Auth: same bearer keys as REST, checked once up front (401 + WWW-Authenticate if
// missing/invalid) via the same resolveKey() requireAuth uses - scope enforcement itself still
// happens per-tool-call via the forwarded Authorization header hitting the real REST route.
export async function handleMcp(c: Context<{ Bindings: Env }>, app: App): Promise<Response> {
  const resolved = await resolveKey(c);
  const auth = c.req.header('Authorization') ?? '';
  if (!resolved || !auth) {
    // resource_metadata is how an OAuth-capable client (e.g. a Claude connector) discovers where to
    // sign in (MCP authorization spec / RFC 9728). Header-based API keys keep working as before.
    const base = ((await effectivePublicUrl(c.env, c.env.DB)).value || new URL(c.req.url).origin).replace(/\/$/, '');
    return c.body(JSON.stringify({ error: 'unauthorized' }), 401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
    });
  }

  // Icon + website let clients show Kinwall's own icon instead of a letter placeholder.
  const origin = new URL(c.req.url).origin;
  const server = new McpServer({
    name: 'kinwall',
    title: 'Kinwall',
    version: VERSION,
    websiteUrl: origin,
    icons: [
      { src: `${origin}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] },
      { src: `${origin}/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] },
      { src: `${origin}/icon.svg`, mimeType: 'image/svg+xml', sizes: ['any'] },
    ],
  });
  registerTools(server, app, c.env, auth);
  // enableJsonResponse: plain JSON responses (no SSE stream) - simplest thing that works for a
  // stateless, request/response tool server; a client is free to ask for SSE and still gets it
  // for server-initiated messages mid-request, this only affects the final response framing.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
}
