// MCP (Model Context Protocol) endpoint: POST/DELETE /mcp, stateless Streamable HTTP (GET answers 405: no SSE stream).
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
import { BoardSchema, CalendarSchema, CategorySchema, ContactCategoryInputSchema, ContactCategorySchema, ContactInputSchema, ContactPatchSchema, ContactSchema, ChoreDaySchema, ChoreSchema, EventInstanceSchema, LeaderboardEntrySchema, ListDetailSchema, ListItemSchema, ListSchema, MemberSchema, NoteSchema, StoreAislesSchema, TrackerEntrySchema, TRACKER_KINDS, NotificationSchema, PointsSchema, SettingsSchema, SnapshotSchema, CustomSchemeSchema, MAX_CUSTOM_SCHEMES, TransitionRemindersSchema, RewardSchema, RewardInputSchema, RedemptionSchema, RewardLimitSchema, MemberStatsSchema, StatsPeriodSchema } from './schemas.ts';
import type { Env } from './env.ts';
import { RecipeSchema, RecipeInputSchema, RecipeKindSchema, RecipeImportSchema, RecipeImportResultSchema, RecipePreviewResultSchema, RecipeUrlImportSchema, MealSchema, MealInputSchema, MealPatchSchema, ProjectionSchema, ProjectionApplySchema, ProjectionQuerySchema, MealRangeSchema } from './meal-schemas.ts';
import { VERSION } from './version.ts';
import { resolveKey } from './auth.ts';
import { NightScreenSchema } from './routes/night-screen.ts';

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

// An activity (installed plugin) by id or name, case-insensitive.
async function resolvePlugin(app: App, env: Env, auth: string, ref: string): Promise<string> {
  const { status, json } = await call(app, env, auth, 'GET', '/api/plugins');
  if (status >= 400) throw new MemberResolutionError('failed to list activities');
  const found = (json as { id: string; name: string }[]).find((p) => p.id === ref || p.name.toLowerCase() === ref.toLowerCase());
  if (!found) throw new MemberResolutionError(`no installed activity matching "${ref}"`);
  return found.id;
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

// Delete tools take an id or the exact name (any case), never a partial match: "tacos" must not
// delete "Fish tacos".
async function resolveExact(app: App, env: Env, auth: string, path: string, ref: string, what: string, pick = (json: unknown) => json): Promise<{ id: string; name: string }> {
  const { status, json } = await call(app, env, auth, 'GET', path);
  if (status >= 400) throw new MemberResolutionError(`failed to look up the ${what}`);
  const rows = (pick(json) as { id: string; name?: string; title?: string }[]).map((r) => ({ id: r.id, name: r.name ?? r.title ?? '' }));
  const hits = rows.filter((r) => r.id === ref || r.name.toLowerCase() === ref.trim().toLowerCase());
  if (hits.length === 1) return hits[0];
  throw new MemberResolutionError(hits.length ? `"${ref}" matches ${hits.length} ${what}s; use the id` : `no ${what} with id or exact name "${ref}"`);
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

// Booleans given as text ("true"/"false") are read as booleans, for the same clients. Applied to
// every argument that takes a boolean but not the string "true", so string arguments are untouched.
function lenientBooleans(shape: z.ZodRawShape): z.ZodRawShape {
  const asBool = (v: unknown) => (v === 'true' ? true : v === 'false' ? false : v);
  return Object.fromEntries(Object.entries(shape).map(([k, s]) => [k, z.safeParse(s, true).success && !z.safeParse(s, 'true').success ? z.preprocess(asBool, s) : s]));
}

// Permission groups. readOnly: only reads. destructive: removes something. openWorld: reaches
// outside Kinwall (writes to Google/Outlook, or pushes to phones). idempotent: repeating the same
// call changes nothing more.
const PaletteOut = z.object({ bg: z.string(), card: z.string(), text: z.string(), accent: z.string() });

// Built-in color schemes as people see them in Settings (web/src/skins.ts). The ids are what the
// settings store; note 'meadow' is shown as Peach and 'field' as Meadow.
const BUILTIN_SCHEMES: { id: string; name: string; emoji: string }[] = [
  { id: 'meadow', name: 'Peach', emoji: '🍑' }, { id: 'field', name: 'Meadow', emoji: '🌿' }, { id: 'ocean', name: 'Ocean', emoji: '🌊' },
  { id: 'lavender', name: 'Lavender', emoji: '💜' }, { id: 'midnight', name: 'Midnight', emoji: '🌌' }, { id: 'spring', name: 'Spring', emoji: '🌸' },
  { id: 'summer', name: 'Summer', emoji: '☀️' }, { id: 'autumn', name: 'Autumn', emoji: '🍂' }, { id: 'winter', name: 'Winter', emoji: '❄️' },
  { id: 'harvest', name: 'Harvest', emoji: '🎃' }, { id: 'festive', name: 'Festive', emoji: '🎄' },
  { id: 'slate', name: 'Slate', emoji: '🩶' }, { id: 'ink', name: 'Ink', emoji: '🖋️' }, { id: 'sage', name: 'Sage', emoji: '🪴' },
  { id: 'graphite', name: 'Graphite', emoji: '✏️' }, { id: 'berry', name: 'Berry', emoji: '🫐' },
];

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const SET = { ...WRITE, idempotentHint: true };
const DELETE = { ...WRITE, destructiveHint: true, idempotentHint: true };
const OK = { ok: z.boolean() };
const EVENT_ID_DOC = 'Link this task to a calendar event; use list_events to find ids.';
const PRIORITY_DOC = 'low | normal | high | urgent. Open urgent items sort first, then high (important, starred), normal, low.';
const BIRTHDAY_DOC = 'YYYY-MM-DD, or --MM-DD when the year is unknown (age is then not shown).';
const NOTE_TARGET_DOC = 'event:<eventId> (from list_events) or list_item:<itemId> (from get_list).';
const SORT_BY_DOC = 'Item order: manual (priority first, overdue first, then hand-set order), added (newest first), due (soonest first, undated last), priority (priority, then soonest due), alpha (A-Z), aisle (shopping lists: by store, then the store\'s aisle order - custom when set, else natural - no aisle last, then A-Z; the default for new shopping lists).';
const AISLE_DOC = 'Where in the store, e.g. "Aisle 4", "Produce" or "Back wall" (per store).';
const CATEGORY_DOC = 'On a shopping list this is the department (e.g. "Produce"): with no aisle known at a store, the item shows in that store\'s aisle of the same name.';
const REMEMBER_DOC = 'On a shopping list, an omitted store/category/aisle is filled from what the family used last time for that item name.';
const TOOL_OUTPUT: Record<string, z.ZodRawShape> = {
  list_recipes: { recipes: z.array(RecipeSchema) }, get_recipe: { recipe: RecipeSchema }, create_recipe: { recipe: RecipeSchema }, update_recipe: { recipe: RecipeSchema }, rate_recipe: { recipe: RecipeSchema }, import_recipe: RecipeImportResultSchema.shape, import_recipe_from_url: RecipePreviewResultSchema.shape,
  list_meals: { meals: z.array(MealSchema) }, create_meal: { meal: MealSchema }, update_meal: { meal: MealSchema },
  get_meal_projection: ProjectionSchema.shape, apply_meal_projection: { added: z.number(), itemIds: z.array(z.string()), projection: ProjectionSchema },
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
  list_pending_approvals: { approvals: z.array(z.object({ choreId: z.string(), title: z.string(), emoji: z.string().nullable(), date: z.string(), memberId: z.string().nullable(), completedAt: z.string(), points: z.number() })) },
  approve_chore: { ok: z.boolean(), points: z.number() },
  reject_chore: OK,
  list_rewards: { rewards: z.array(RewardSchema) },
  create_reward: { reward: RewardSchema },
  update_reward: { reward: RewardSchema },
  redeem_reward: { redemption: RedemptionSchema, balance: z.number() },
  list_reward_requests: { requests: z.array(RedemptionSchema) },
  approve_reward: { redemption: RedemptionSchema },
  decline_reward: { redemption: RedemptionSchema },
  mark_reward_given: { redemption: RedemptionSchema },
  get_leaderboard: { period: z.string(), leaderboard: z.array(LeaderboardEntrySchema) },
  get_points: { member: z.string(), ...PointsSchema.shape },
  get_member_profile: { member: z.string(), stats: MemberStatsSchema },
  add_member: { member: MemberSchema },
  update_member: { member: MemberSchema },
  list_lists: { lists: z.array(ListSchema) },
  create_list: { list: ListSchema },
  update_list: { list: ListSchema },
  get_list: ListDetailSchema.shape,
  add_list_items: { items: z.array(ListItemSchema) },
  update_list_item: { item: ListItemSchema },
  set_store_aisle_order: { order: StoreAislesSchema },
  set_list_item_done: { item: ListItemSchema },
  set_step_done: { item: ListItemSchema },
  get_event_items: { items: z.array(ListItemSchema.extend({ listName: z.string() })) },
  list_categories: { categories: z.array(CategorySchema) },
  update_category: { category: CategorySchema },
  list_contacts: { contacts: z.array(ContactSchema) },
  get_contact: { contact: ContactSchema },
  create_contact: { contact: ContactSchema },
  update_contact: { contact: ContactSchema },
  list_contact_categories: { categories: z.array(ContactCategorySchema) },
  create_contact_category: { category: ContactCategorySchema },
  update_contact_category: { category: ContactCategorySchema },
  send_notification: { result: z.object({ ok: z.boolean(), sent: z.number() }) },
  set_night_screen: NightScreenSchema.shape,
  list_notifications: { notifications: z.array(NotificationSchema) },
  list_notes: { notes: z.array(NoteSchema) },
  add_note: { note: NoteSchema },
  update_note: { note: NoteSchema },
  list_tracker_entries: { entries: z.array(TrackerEntrySchema) },
  add_tracker_entry: { entry: TrackerEntrySchema },
  update_tracker_entry: { entry: TrackerEntrySchema },
  get_snapshot: SnapshotSchema.shape,
  get_board: { board: BoardSchema },
  list_color_schemes: {
    current: z.string(),
    schemes: z.array(z.object({ id: z.string(), name: z.string(), emoji: z.string(), kind: z.enum(['built-in', 'seasonal', 'custom']), light: PaletteOut.optional(), dark: PaletteOut.optional() })),
  },
  set_color_scheme: { settings: SettingsSchema },
  save_color_scheme: { scheme: CustomSchemeSchema, settings: SettingsSchema },
  delete_color_scheme: { settings: SettingsSchema },
  delete_list: OK, delete_list_item: OK, delete_list_step: { item: ListItemSchema }, delete_note: OK, delete_chore: OK,
  preview_contact_import: { entries: z.array(z.object({ contact: ContactInputSchema, duplicateIds: z.array(z.string()) })) },
  import_contacts: { created: z.number(), merged: z.number(), skipped: z.number(), ids: z.array(z.string()) },
  merge_contacts: { contact: ContactSchema },
  delete_tracker_entry: OK, delete_meal: OK, delete_recipe: OK, delete_reward: OK, delete_contact: OK, delete_contact_category: OK,
};

const TOOL_HINTS: Record<string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }> = {
  list_recipes: READ, get_recipe: READ, create_recipe: WRITE, update_recipe: SET, rate_recipe: SET, import_recipe: SET, import_recipe_from_url: { ...SET, openWorldHint: true }, list_meals: READ, create_meal: WRITE, update_meal: SET, get_meal_projection: READ, apply_meal_projection: SET,
  get_household: READ, list_events: READ, get_event: READ, list_chores: READ, get_leaderboard: READ, get_points: READ, get_member_profile: READ, list_lists: READ, get_list: READ, list_categories: READ, get_event_items: READ, list_notifications: READ, list_notes: READ, get_snapshot: READ, get_board: READ, list_tracker_entries: READ, add_tracker_entry: WRITE, update_tracker_entry: SET, list_color_schemes: READ, set_color_scheme: SET, save_color_scheme: WRITE,
  list_contacts: READ, get_contact: READ, list_contact_categories: READ, preview_contact_import: READ,
  delete_color_scheme: { ...WRITE, destructiveHint: true, idempotentHint: true },
  create_event: { ...WRITE, openWorldHint: true }, update_event: { ...SET, openWorldHint: true }, set_event_category: SET,
  create_chore: WRITE, update_chore: SET, complete_chore: SET, uncomplete_chore: SET, list_pending_approvals: READ, approve_chore: SET, reject_chore: SET,
  list_rewards: READ, create_reward: WRITE, update_reward: SET, redeem_reward: WRITE, list_reward_requests: READ, approve_reward: SET, decline_reward: SET, mark_reward_given: SET,
  add_member: WRITE, update_member: SET,
  create_list: WRITE, update_list: SET, add_list_items: WRITE, update_list_item: SET, set_store_aisle_order: SET, set_list_item_done: SET, set_step_done: SET, update_category: SET, add_note: WRITE, update_note: SET,
  create_contact: WRITE, update_contact: SET, create_contact_category: WRITE, update_contact_category: SET,
  send_notification: { ...WRITE, openWorldHint: true },
  set_night_screen: SET,
  delete_event: { ...WRITE, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  delete_list: DELETE, delete_list_item: DELETE, delete_list_step: DELETE, delete_note: DELETE, delete_chore: DELETE,
  delete_tracker_entry: DELETE, delete_meal: DELETE, delete_recipe: DELETE, delete_reward: DELETE, delete_contact: DELETE, delete_contact_category: DELETE, import_contacts: WRITE, merge_contacts: WRITE,
};

function registerTools(server: McpServer, app: App, env: Env, auth: string) {
  // Every tool gets its MCP annotations from TOOL_HINTS, so clients (e.g. Claude's connector
  // settings) can group them into read-only / write / delete for permissions.
  const tool: typeof server.registerTool = (name, config, cb) => {
    const hints = TOOL_HINTS[name];
    if (!hints) throw new Error(`MCP tool ${name} has no entry in TOOL_HINTS`);
    // Output schemas (shapes the REST routes already declare) tell the model what comes back; the
    // SDK validates successful results against them, and tests exercise every tool.
    const inputSchema = config.inputSchema && lenientBooleans(config.inputSchema as z.ZodRawShape);
    return server.registerTool(name, { ...config, inputSchema, outputSchema: TOOL_OUTPUT[name], annotations: { title: config.title, ...hints } } as typeof config, cb);
  };

  tool('list_recipes', { title: 'Find recipes', description: 'Search the recipe library; archived=true includes archived recipes. kind: basic lists only basics (seasoning blends, sauces, doughs used inside other recipes), meal only meals.', inputSchema: { search: z.string().optional(), category: z.string().optional(), archived: z.boolean().optional(), kind: RecipeKindSchema.optional() } }, async ({ search, category, archived, kind }) => {
    const query = new URLSearchParams();
    if (search) query.set('search', search); if (category) query.set('category', category); if (archived) query.set('archived', 'true'); if (kind) query.set('kind', kind);
    const result = await call(app, env, auth, 'GET', `/api/recipes?${query}`);
    return result.status >= 400 ? errorResult(result.json, 'failed to find recipes') : okResult('Recipes', { recipes: result.json });
  });
  tool('get_recipe', { title: 'Get recipe', description: 'Read a recipe and its ingredients.', inputSchema: { id: z.string() } }, async ({ id }) => {
    const result = await call(app, env, auth, 'GET', `/api/recipes/${encodeURIComponent(id)}`);
    return result.status >= 400 ? errorResult(result.json, 'recipe not found') : okResult('Recipe', { recipe: result.json });
  });
  tool('create_recipe', { title: 'Create recipe', description: 'Admin: create a manual recipe. Its sourceUrl is only stored; to read a recipe off a web page use import_recipe_from_url.', inputSchema: { ...RecipeInputSchema.shape, ingredients: jsonList(RecipeInputSchema.shape.ingredients), steps: jsonList(RecipeInputSchema.shape.steps) } }, async (input) => {
    const result = await call(app, env, auth, 'POST', '/api/recipes', input);
    return result.status >= 400 ? errorResult(result.json, 'failed to create recipe') : okResult('Recipe created', { recipe: result.json });
  });
  tool('import_recipe', { title: 'Import recipe', description: 'Admin: import a recipe from another app (e.g. a meal kit), keyed by source + externalId so importing again updates it. Ingredient lines like "1.5 tablespoon Sour Cream" are parsed; pantry: false marks one that ships in the kit (left off grocery lists by default). steps are text (several lines become bullets) or { text, bullets, imageUrl, title, timers: [{ name, minutes }] }; instructions keeps them as numbered text. plan also plans it on that date/slot unless the slot already has a meal (planned: false, with reason); a meal it planned before for that slot within the week is reused. plan.calendarId (a Kinwall calendar id, any writable one) also puts the planned meal on that calendar unless it already has an event; plan.eventStart "cooking" starts it when cooking starts. Only a calendar named here is written to.', inputSchema: { ...RecipeImportSchema.shape, ingredients: jsonList(RecipeImportSchema.shape.ingredients), steps: jsonList(RecipeImportSchema.shape.steps) } }, async (input) => {
    const result = await call(app, env, auth, 'POST', '/api/recipes/import', input);
    return result.status >= 400 ? errorResult(result.json, 'failed to import recipe') : okResult((result.json as { planned?: boolean }).planned ? 'Recipe imported and planned' : 'Recipe imported', result.json as Record<string, unknown>);
  });
  tool('import_recipe_from_url', { title: 'Import recipe from a link', description: 'Admin: read a recipe from a web page (its schema.org Recipe data: name, photo, servings, times, ingredients, steps). Without save it only previews; save: true also saves it, keyed by the page address so importing the same page again updates that recipe. A page without recipe data fails: then ask for the recipe text and use create_recipe.', inputSchema: RecipeUrlImportSchema.shape }, async (input) => {
    const result = await call(app, env, auth, 'POST', '/api/recipes/import-url', input);
    return result.status >= 400 ? errorResult(result.json, 'failed to read the recipe page') : okResult(input.save ? 'Recipe imported' : 'Recipe preview (not saved)', result.json as Record<string, unknown>);
  });
  tool('update_recipe', { title: 'Edit recipe', description: 'Admin: edit a recipe; archived=true archives it, false restores it. Supplying ingredients replaces the ingredient list. steps (structured, instructions follows them) or instructions alone (clears steps). Existing planned meals keep their snapshots.', inputSchema: { id: z.string(), ...RecipeInputSchema.partial().shape, ingredients: jsonList(RecipeInputSchema.shape.ingredients), steps: jsonList(RecipeInputSchema.shape.steps) } }, async ({ id, ...input }) => {
    const result = await call(app, env, auth, 'PATCH', `/api/recipes/${encodeURIComponent(id)}`, input);
    return result.status >= 400 ? errorResult(result.json, 'failed to edit recipe') : okResult('Recipe updated', { recipe: result.json });
  });
  tool('rate_recipe', { title: 'Rate recipe', description: "Set a family member's 1-5 star rating of a recipe (0 or null clears it). Recipes carry rating: { average, count, byMember }.", inputSchema: { recipeId: z.string(), memberId: z.string().describe('Member name (case-insensitive) or id.'), stars: z.number().int().min(0).max(5).nullable().describe('1-5; 0 or null clears the rating.') } }, async ({ recipeId, memberId, stars }) => {
    let member: string;
    try { member = await resolveMember(app, env, auth, memberId); } catch (err) { return errorResult(null, err instanceof Error ? err.message : 'member lookup failed'); }
    const result = await call(app, env, auth, 'PUT', `/api/recipes/${encodeURIComponent(recipeId)}/rating`, { memberId: member, stars });
    return result.status >= 400 ? errorResult(result.json, 'failed to rate recipe') : okResult(stars ? `Rated ${stars} star${stars === 1 ? '' : 's'}` : 'Rating cleared', { recipe: result.json });
  });
  tool('list_meals', { title: 'Get meal plan', description: 'Read dated meals in an inclusive range. Start from on the household week start (weekStart from get_household: 0 Sunday, 1 Monday); omit to for that seven-day week.', inputSchema: { from: MealRangeSchema.shape.from, to: MealRangeSchema.shape.to.optional().describe('Inclusive end date; defaults to six days after from.') } }, async ({ from, to }) => {
    const end = to ?? new Date(Date.parse(`${from}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
    const result = await call(app, env, auth, 'GET', `/api/meals?${new URLSearchParams({ from, to: end })}`);
    return result.status >= 400 ? errorResult(result.json, 'failed to read meals') : okResult('Meal plan', { meals: result.json });
  });
  tool('create_meal', { title: 'Plan meal', description: 'Admin: plan a recipe, freeform meal, or dining out on a date. Does not create calendar events.', inputSchema: { ...MealInputSchema.shape, member: z.string().nullable().optional().describe('Who is cooking: assignee name (case-insensitive) or id; null leaves unassigned. eaterIds is who is eating. Overrides assigneeMemberId when provided.') } }, async ({ member, ...input }) => {
    try {
      if (member !== undefined) input.assigneeMemberId = member === null ? null : await resolveMember(app, env, auth, member);
    } catch (err) {
      return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
    }
    const result = await call(app, env, auth, 'POST', '/api/meals', input);
    return result.status >= 400 ? errorResult(result.json, 'failed to plan meal') : okResult('Meal planned', { meal: result.json });
  });
  tool('update_meal', { title: 'Update meal', description: 'Admin: edit/assign a meal; refreshRecipe explicitly replaces its ingredient snapshot. Assigned devices may update notes/status only. A calendar event Kinwall created for the meal follows its date, slot, time, title, notes and people (eaters and cook), on whichever calendar it is on; a linked event of your own is never changed.', inputSchema: { id: z.string(), ...MealPatchSchema.shape, member: z.string().nullable().optional().describe('Who is cooking: assignee name (case-insensitive) or id; null clears assignment. eaterIds is who is eating. Overrides assigneeMemberId when provided.') } }, async ({ id, member, ...input }) => {
    try {
      if (member !== undefined) input.assigneeMemberId = member === null ? null : await resolveMember(app, env, auth, member);
    } catch (err) {
      return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
    }
    const result = await call(app, env, auth, 'PATCH', `/api/meals/${encodeURIComponent(id)}`, input);
    return result.status >= 400 ? errorResult(result.json, 'failed to update meal') : okResult('Meal updated', { meal: result.json });
  });
  tool('get_meal_projection', { title: 'Preview meal groceries', description: 'Admin: review scaled ingredients, per-meal/day sources, existing list matches, applied and changed amounts before applying. Ambiguous amounts need review. Select a shopping list to include matches and prior applications; no list returns an unscoped preview.', inputSchema: { ...ProjectionQuerySchema.shape, listName: z.string().optional().describe('Shopping list name, case-insensitive; use this or listId. listId takes precedence.') } }, async ({ from, to, listId, listName }) => {
    try {
      if (!listId && listName) listId = (await resolveList(app, env, auth, listName)).id;
    } catch (err) {
      return errorResult(null, err instanceof Error ? err.message : 'list lookup failed');
    }
    const query = new URLSearchParams({ from, to }); if (listId !== undefined) query.set('listId', listId);
    const result = await call(app, env, auth, 'GET', `/api/meals/projection?${query}`);
    return result.status >= 400 ? errorResult(result.json, 'failed to project groceries') : okResult('Shopping projection', result.json as Record<string, unknown>);
  });
  tool('apply_meal_projection', { title: 'Apply meal groceries', description: 'Admin: after the user reviews get_meal_projection and chooses a shopping list, add unclaimed ingredients. Repeated or overlapping applications to the same list do not duplicate groceries. Existing items are never rewritten, including changed amounts already applied. Items with a basicId are made from a basic (a seasoning blend, sauce or dough): ask once per basic whether it is made already, then pass basics: { [basicId]: "made" } to skip it or "ingredients" to add the basic\'s own ingredients instead (as written, once).', inputSchema: {
    ...ProjectionApplySchema.shape,
    listId: ProjectionApplySchema.shape.listId.optional().describe('Target shopping list id; use this or listName. Takes precedence over listName.'),
    listName: z.string().optional().describe('Target shopping list name, case-insensitive; use this or listId.'),
    omitKeys: jsonList(ProjectionApplySchema.shape.omitKeys).describe('Exact item keys from get_meal_projection to omit (for example, pantry ingredients).'),
    includeNotes: ProjectionApplySchema.shape.includeNotes.describe('Include meal/date/recipe source notes on added shopping items. Default: false.'),
    includeKitItems: ProjectionApplySchema.shape.includeKitItems.describe('Also add imported meal-kit ingredients that ship in the box (qualifier "in the kit"). Default: false.'),
  } }, async ({ listId, listName, ...input }) => {
    try {
      if (!listId && listName) listId = (await resolveList(app, env, auth, listName)).id;
    } catch (err) {
      return errorResult(null, err instanceof Error ? err.message : 'list lookup failed');
    }
    if (!listId) return errorResult(null, 'listId or listName is required');
    const result = await call(app, env, auth, 'POST', '/api/meals/projection/apply', { ...input, listId });
    return result.status >= 400 ? errorResult(result.json, 'failed to apply groceries') : okResult('Shopping projection applied', result.json as Record<string, unknown>);
  });

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
        activity: z.string().optional().describe('Activity: an installed activity plugin (name or id). Playing it in Kinwall for `minutes` in a day completes the chore, e.g. "5 min of Sight words".'),
        minutes: z.number().int().min(1).max(60).optional().describe('Minutes of play the activity needs, 1-60. Default 5.'),
        needsApproval: z.boolean().nullable().optional().describe("Ticks from wall screens and kids' devices wait for a parent's OK: true/false overrides the person's default, null follows it."),
        approveTimedPlay: z.boolean().optional().describe("Activity chores: also wait for a parent's OK when timed play completes it (default: auto-approve)."),
      },
    },
    async ({ member, list, activity, minutes, ...input }) => {
      let memberId: string | undefined;
      let listId: string | undefined;
      let pluginId: string | undefined;
      try {
        if (member) memberId = await resolveMember(app, env, auth, member);
        if (list) listId = (await resolveList(app, env, auth, list)).id;
        if (activity) pluginId = await resolvePlugin(app, env, auth, activity);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'lookup failed');
      }
      const res = await call(app, env, auth, 'POST', '/api/chores', { ...input, memberId, listId, pluginId, pluginMinutes: minutes });
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
        "Change a chore: title, emoji, assignee, points, recurrence, due date/time, checklist, linked activity, whether it needs a parent's OK, or active state. Only provided fields change; pass member: null to unassign (anyone). " +
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
        activity: z.string().nullable().optional().describe('Activity plugin (name or id) whose play completes the chore; null to unlink.'),
        minutes: z.number().int().min(1).max(60).optional().describe('Minutes of play the activity needs, 1-60.'),
        needsApproval: z.boolean().nullable().optional().describe("Ticks from wall screens and kids' devices wait for a parent's OK: true/false overrides the person's default, null follows it."),
        approveTimedPlay: z.boolean().optional().describe("Activity chores: also wait for a parent's OK when timed play completes it (default: auto-approve)."),
      },
    },
    async ({ choreId, member, list, activity, minutes, ...input }) => {
      let memberId: string | null | undefined;
      let listId: string | null | undefined;
      let pluginId: string | null | undefined;
      try {
        if (member !== undefined) memberId = member === null ? null : await resolveMember(app, env, auth, member);
        if (list !== undefined) listId = list === null ? null : (await resolveList(app, env, auth, list)).id;
        if (activity !== undefined) pluginId = activity === null ? null : await resolvePlugin(app, env, auth, activity);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'lookup failed');
      }
      const body = { ...input, ...(memberId !== undefined ? { memberId } : {}), ...(listId !== undefined ? { listId } : {}), ...(pluginId !== undefined ? { pluginId } : {}), ...(minutes !== undefined ? { pluginMinutes: minutes } : {}) };
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
      if ((res.json as { pending?: boolean }).pending) return okResult(`Ticked for ${day}; it's waiting for a parent's OK.`, { ok: true });
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
    'list_pending_approvals',
    {
      title: 'List chores to approve',
      description: "Chores ticked on a wall screen or kid's device that are waiting for a parent's OK (no points until approved), oldest first. Admin only.",
      inputSchema: {},
    },
    async () => {
      const res = await call(app, env, auth, 'GET', '/api/chores/pending');
      if (res.status >= 400) return errorResult(res.json, 'failed to list approvals');
      const approvals = res.json as { title: string; date: string }[];
      return okResult(approvals.length ? `${approvals.length} to approve: ${approvals.map((a) => `${a.title} (${a.date})`).join(', ')}.` : 'Nothing waiting for approval.', { approvals: res.json as Record<string, unknown>[] });
    },
  );

  tool(
    'approve_chore',
    {
      title: 'Approve chore',
      description: "Approve a chore waiting for a parent's OK: awards its points (late credit judged by when it was ticked). Defaults to today. Admin only.",
      inputSchema: { choreId: z.string(), date: z.string().optional().describe('YYYY-MM-DD. Default: today.') },
    },
    async ({ choreId, date }) => {
      const day = date ?? await todayInHousehold(env);
      const res = await call(app, env, auth, 'POST', `/api/chores/${encodeURIComponent(choreId)}/approve`, { date: day });
      if (res.status >= 400) return errorResult(res.json, 'failed to approve chore');
      const { points } = res.json as { points: number };
      return okResult(`Approved (${points} point${points === 1 ? '' : 's'}).`, { ok: true, points });
    },
  );

  tool(
    'reject_chore',
    {
      title: 'Not yet (reject chore)',
      description: "Say \"Not yet\" to a chore waiting for a parent's OK: removes the tick and shows the optional note on the kid's chore until they tick it again; their devices get a notification. Defaults to today. Admin only.",
      inputSchema: { choreId: z.string(), date: z.string().optional().describe('YYYY-MM-DD. Default: today.'), note: z.string().max(200).optional().describe('e.g. "Please make the bed properly".') },
    },
    async ({ choreId, date, note }) => {
      const day = date ?? await todayInHousehold(env);
      const res = await call(app, env, auth, 'POST', `/api/chores/${encodeURIComponent(choreId)}/reject`, { date: day, note });
      if (res.status >= 400) return errorResult(res.json, 'failed to reject chore');
      return okResult('Sent back with "Not yet".', { ok: true });
    },
  );

  // ---- Rewards: thin wrappers over routes/rewards.ts. Members by name or id, like chores.
  const rewardsFor = async (member: string | undefined) => {
    const memberIds = member ? [await resolveMember(app, env, auth, member)] : [];
    return memberIds;
  };
  const who = async (ids: string[] | undefined) => (ids ? resolveMemberIds(app, env, auth, ids) : undefined);
  const redemptionLine = (r: { title: string; emoji: string | null; cost: number; status: string }) => `${r.emoji ? `${r.emoji} ` : ''}${r.title} (${r.cost} pts, ${r.status})`;

  tool(
    'list_rewards',
    {
      title: 'List rewards',
      description: 'Rewards members can spend chore points on. With member, only the ones for them; archived=true includes archived ones.',
      inputSchema: { member: z.string().optional().describe('Member name or id.'), archived: z.boolean().optional() },
    },
    async ({ member, archived }) => {
      let memberIds: string[];
      try {
        memberIds = await rewardsFor(member);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const q = new URLSearchParams();
      if (memberIds[0]) q.set('memberId', memberIds[0]);
      if (archived) q.set('archived', 'true');
      const res = await call(app, env, auth, 'GET', `/api/rewards?${q}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to list rewards');
      const rewards = res.json as { title: string; emoji: string | null; cost: number }[];
      return okResult(rewards.length ? rewards.map((r) => `${r.emoji ? `${r.emoji} ` : ''}${r.title} (${r.cost} pts)`).join(', ') : 'No rewards yet.', { rewards });
    },
  );

  const rewardFields = {
    members: jsonList(z.array(z.string())).optional().describe('Who can redeem it, by name or id; empty or omitted = everyone.'),
    needsApproval: z.boolean().optional().describe("Redeeming waits for a parent's OK (default true). A parent's own redeem is approved at once."),
    limit: RewardLimitSchema.optional().describe('Up to count (1-20) per member per day or week, e.g. { count: 3, period: "day" }; null = no limit (default).'),
  };

  tool(
    'create_reward',
    {
      title: 'Create reward',
      description: 'Admin: add a reward members can spend chore points on, e.g. "🍿 Movie night" for 100 points.',
      inputSchema: { title: RewardInputSchema.shape.title, emoji: z.string().optional(), cost: RewardInputSchema.shape.cost.describe('Points it costs (1 or more).'), ...rewardFields },
    },
    async ({ members, ...input }) => {
      let memberIds: string[] | undefined;
      try {
        memberIds = await who(members);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const res = await call(app, env, auth, 'POST', '/api/rewards', { ...input, ...(memberIds ? { memberIds } : {}) });
      if (res.status >= 400) return errorResult(res.json, 'failed to create reward');
      const reward = res.json as { title: string; cost: number };
      return okResult(`Added reward "${reward.title}" (${reward.cost} pts).`, { reward: res.json as Record<string, unknown> });
    },
  );

  tool(
    'update_reward',
    {
      title: 'Edit reward',
      description: 'Admin: change a reward (use list_rewards for ids); active=false archives it, true brings it back. Only provided fields change.',
      inputSchema: { rewardId: z.string(), title: RewardInputSchema.shape.title.optional(), emoji: z.string().nullable().optional(), cost: RewardInputSchema.shape.cost.optional(), active: z.boolean().optional(), ...rewardFields },
    },
    async ({ rewardId, members, ...input }) => {
      let memberIds: string[] | undefined;
      try {
        memberIds = await who(members);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const res = await call(app, env, auth, 'PATCH', `/api/rewards/${encodeURIComponent(rewardId)}`, { ...input, ...(memberIds ? { memberIds } : {}) });
      if (res.status >= 400) return errorResult(res.json, 'failed to update reward');
      return okResult(`Updated reward "${(res.json as { title: string }).title}".`, { reward: res.json as Record<string, unknown> });
    },
  );

  tool(
    'redeem_reward',
    {
      title: 'Redeem reward',
      description: "Spend a member's points on a reward. The points come off at once; it waits for a parent's OK if the reward needs one (a parent's own key approves at once). Refused when short of points or over the reward's daily/weekly limit.",
      inputSchema: { rewardId: z.string(), member: z.string().describe('Member name or id.') },
    },
    async ({ rewardId, member }) => {
      let memberId: string;
      try {
        memberId = await resolveMember(app, env, auth, member);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const res = await call(app, env, auth, 'POST', `/api/rewards/${encodeURIComponent(rewardId)}/redeem`, { memberId });
      if (res.status === 402) {
        const { balance, cost } = res.json as { balance: number; cost: number };
        return errorResult(null, `Not enough points: ${cost - balance} more needed (has ${balance}, costs ${cost}).`);
      }
      if (res.status >= 400) return errorResult(res.json, 'failed to redeem reward');
      const { redemption, balance } = res.json as { redemption: { status: string; title: string }; balance: number };
      return okResult(`${redemption.title}: ${redemption.status === 'pending' ? "waiting for a parent's OK" : 'approved'}. ${balance} points left.`, res.json as Record<string, unknown>);
    },
  );

  tool(
    'list_reward_requests',
    {
      title: 'List reward requests',
      description: "Redeemed rewards. Default: the ones a parent still has to act on (pending = waiting for OK, approved = not given yet), oldest first. status filters (comma-separated: pending, approved, declined, given); member narrows to one person.",
      inputSchema: { status: z.string().optional(), member: z.string().optional().describe('Member name or id.') },
    },
    async ({ status, member }) => {
      let memberIds: string[];
      try {
        memberIds = await rewardsFor(member);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const q = new URLSearchParams({ status: status ?? 'pending,approved' });
      if (memberIds[0]) q.set('memberId', memberIds[0]);
      const res = await call(app, env, auth, 'GET', `/api/rewards/redemptions?${q}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to list reward requests');
      const requests = res.json as { title: string; emoji: string | null; cost: number; status: string }[];
      return okResult(requests.length ? requests.map(redemptionLine).join(', ') : 'No reward requests.', { requests });
    },
  );

  const decide = (name: string, title: string, description: string, action: string, done: (r: { title: string }) => string, extra: z.ZodRawShape = {}) =>
    tool(name, { title, description, inputSchema: { redemptionId: z.string().describe('From list_reward_requests.'), ...extra } }, async ({ redemptionId, ...body }) => {
      const res = await call(app, env, auth, 'POST', `/api/rewards/redemptions/${encodeURIComponent(String(redemptionId))}/${action}`, action === 'decline' ? body : undefined);
      if (res.status >= 400) return errorResult(res.json, `failed to ${action} reward`);
      return okResult(done(res.json as { title: string }), { redemption: res.json as Record<string, unknown> });
    });
  decide('approve_reward', 'Approve reward', "Admin: approve a redeemed reward waiting for a parent's OK.", 'approve', (r) => `Approved ${r.title}.`);
  decide(
    'decline_reward',
    'Not this time (decline reward)',
    "Admin: decline a redeemed reward waiting for OK, or cancel an approved one not given yet. The points go back and the member's devices are told, with the optional note.",
    'decline',
    (r) => `Declined ${r.title}; the points are back.`,
    { note: z.string().max(200).optional().describe('e.g. "Let\'s do it at the weekend".') },
  );
  decide('mark_reward_given', 'Mark reward given', 'Admin: mark an approved reward as given (delivered).', 'given', (r) => `Marked ${r.title} as given.`);

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
    'get_member_profile',
    {
      title: "Get a member's profile",
      description: "A member's profile stats for a period (household days): chores done and points earned (chores plus daily check-ins, with the same stretch before), daily check-ins, points spent, streak and best streak, books, sticker book, activity time, milestone badges and birthday countdown. Read-only.",
      inputSchema: { member: z.string().describe('Member name or id.'), period: StatsPeriodSchema.optional().describe('today, week (default), month, year or all.') },
    },
    async ({ member, period }) => {
      let memberId: string;
      try {
        memberId = await resolveMember(app, env, auth, member);
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'member lookup failed');
      }
      const res = await call(app, env, auth, 'GET', `/api/members/${encodeURIComponent(memberId)}/stats?period=${period ?? 'week'}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to load profile');
      const s = res.json as { choresDone: number; pointsEarned: number; streak: { current: number; best: number } };
      return okResult(`${member}: ${s.choresDone} chore(s) done, ${s.pointsEarned} points earned (${period ?? 'week'}); streak ${s.streak.current}, best ${s.streak.best}.`, { member: memberId, stats: res.json as Record<string, unknown> });
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
    'get_board',
    {
      title: 'Get the household board',
      description:
        "The household bulletin board: everyone's events plus untagged ones, open list items due soon (or overdue) or high/urgent, " +
        "today's chores per member, and birthdays, for today through the next `days` days. Good for \"what's coming up for the family?\".",
      inputSchema: { days: z.number().int().min(1).max(14).optional().describe('How many days ahead, starting today (default 7).') },
    },
    async ({ days }) => {
      const res = await call(app, env, auth, 'GET', `/api/board${days ? `?days=${days}` : ''}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to load board');
      const board = res.json as { events: unknown[]; items: unknown[]; chores: unknown[]; birthdays: unknown[] };
      const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
      return okResult(`Board: ${n(board.events.length, 'event')}, ${n(board.items.length, 'list item')}, ${n(board.chores.length, 'chore line')}, ${n(board.birthdays.length, 'birthday')}.`, { board: res.json });
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
        grownUp: z.boolean().optional().describe("A parent or other adult: their chores never wait for a parent's OK. Default false."),
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
      description: "Change a family member's name, color, avatar, birthday, whether they're a grown-up, whether their chores need a parent's OK, or transition reminders (admin). Only provided fields change.",
      inputSchema: {
        member: z.string().describe('Member name or id.'),
        name: z.string().optional(),
        color: z.string().optional().describe('Hex color, e.g. #ff6b6b.'),
        avatar: z.string().nullable().optional().describe('Emoji or initial.'),
        birthday: z.string().nullable().optional().describe(`${BIRTHDAY_DOC} null clears it.`),
        grownUp: z.boolean().optional().describe("A parent or other adult: their chores never wait for a parent's OK (turns needsApproval off)."),
        needsApproval: z.boolean().optional().describe("Their chores need a parent's OK by default (a chore's own setting wins). Ignored for a grown-up."),
        transitionReminders: TransitionRemindersSchema.optional().describe(
          'Admin: pushes to this person\'s own devices before their events. { on, minutes: [10, 5] (1-120, up to 8), repeat: { every: 5, within: 30 } or null, leaveBy: true (count to the leave-by time when there is travel time) }. Replaces the whole setting.',
        ),
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
      description: 'Create a list. Kinds: shopping (grouped by aisle or store; an item\'s category is its department), todo (items can have an assignee and due date), reusable (packing lists, routines - can be reset).',
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
      description: 'Get a list by id or name (case-insensitive), including its items (in the list sortBy order, each with its ordered steps and, on a shopping list, the aisle it was kept in at each store), group ordering, store/category/aisle suggestions and stores\' aisle orders. With store, also `trip`: the list as shopped at that store - items in aisle order with their aisle there, then those with no aisle known there, then those planned for other stores. An item with no aisle known there whose category (department) names one of the store\'s aisles, any case, shows in that aisle (not saved).',
      inputSchema: { list: z.string().describe('List id or name.'), store: z.string().optional().describe('Shopping at this store: adds the trip view.') },
    },
    async ({ list, store }) => {
      let id: string;
      try {
        id = (await resolveList(app, env, auth, list)).id;
      } catch (err) {
        return errorResult(null, err instanceof Error ? err.message : 'list lookup failed');
      }
      const res = await call(app, env, auth, 'GET', `/api/lists/${encodeURIComponent(id)}${store ? `?store=${encodeURIComponent(store)}` : ''}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to get list');
      const detail = res.json as { list: { name: string }; items: unknown[]; trip?: { items: { title: string; aisle: string | null; section: string; done: boolean }[] } };
      const trip = detail.trip?.items.map((i) => `${i.done ? '[x] ' : ''}${i.title}${i.section === 'aisle' ? ` (${i.aisle})` : i.section === 'unknown' ? ' (aisle unknown)' : ' (other store)'}`).join(', ');
      return okResult(`"${detail.list.name}": ${detail.items.length} item(s).${trip ? ` At ${store}: ${trip}.` : ''}`, detail as Record<string, unknown>);
    },
  );

  tool(
    'add_list_items',
    {
      title: 'Add list items',
      description: `Add one or more items to a list. Provide plain titles, or objects for more detail (notes, quantity, store, category, aisle, member, dueDate, eventId, priority, steps). ${REMEMBER_DOC}`,
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
              category: z.string().optional().describe(CATEGORY_DOC),
              aisle: z.string().optional().describe(AISLE_DOC),
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

  tool('list_contacts', {
    title: 'Find household contacts',
    description: 'List or search people, services and places in the household directory (search matches names, relationships, organizations and tags). Results follow the key: an admin key sees every contact; a device key sees only what its visibility allows. Use get_contact for one record.',
    inputSchema: { search: z.string().optional(), kind: ContactInputSchema.shape.kind.optional(), category: z.string().uuid().optional() },
  }, async ({ search, kind, category }) => {
    const query = new URLSearchParams();
    if (search) query.set('search', search);
    if (kind) query.set('kind', kind);
    if (category) query.set('category', category);
    const res = await call(app, env, auth, 'GET', `/api/contacts?${query}`);
    return res.status >= 400 ? errorResult(res.json, 'failed to list contacts') : okResult('Household contacts', { contacts: res.json as Record<string, unknown>[] });
  });
  tool('get_contact', { title: 'Get household contact', description: 'Read a contact by id or an exact display name when it resolves to one record. Display keys cannot read private contacts and see redacted private fields on household contacts.', inputSchema: { id: z.string().uuid().optional(), name: z.string().optional() } }, async ({ id, name }) => {
    let resolved = id;
    if (!resolved && name) {
      const matches = await call(app, env, auth, 'GET', `/api/contacts?search=${encodeURIComponent(name)}`);
      const exact = (matches.json as { id: string; name: string }[]).filter(c => c.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (exact.length !== 1) return errorResult(null, exact.length ? 'contact name is ambiguous' : 'contact not found');
      resolved = exact[0].id;
    }
    if (!resolved) return errorResult(null, 'id or exact name is required');
    const res = await call(app, env, auth, 'GET', `/api/contacts/${encodeURIComponent(resolved)}`);
    return res.status >= 400 ? errorResult(res.json, 'contact not found') : okResult('Contact', { contact: res.json as Record<string, unknown> });
  });
  tool('create_contact', { title: 'Create household contact', description: 'Admin: add a person or organization. visibility private hides the whole record from display keys; privateFields hides selected fields on household contacts.', inputSchema: ContactInputSchema.shape }, async (input) => {
    const res = await call(app, env, auth, 'POST', '/api/contacts', input);
    return res.status >= 400 ? errorResult(res.json, 'failed to create contact') : okResult('Contact created', { contact: res.json as Record<string, unknown> });
  });
  tool('update_contact', { title: 'Update household contact', description: 'Admin: change only the provided fields of a contact. Use id from list_contacts.', inputSchema: { id: z.string().uuid(), ...ContactPatchSchema.shape } }, async ({ id, ...input }) => {
    const res = await call(app, env, auth, 'PATCH', `/api/contacts/${encodeURIComponent(id)}`, input);
    return res.status >= 400 ? errorResult(res.json, 'failed to update contact') : okResult('Contact updated', { contact: res.json as Record<string, unknown> });
  });
  tool('list_contact_categories', { title: 'List contact categories', description: 'List the household directory\'s built-in and custom categories, separate from calendar event categories.', inputSchema: {} }, async () => {
    const res = await call(app, env, auth, 'GET', '/api/contact-categories');
    return res.status >= 400 ? errorResult(res.json, 'failed to list contact categories') : okResult('Contact categories', { categories: res.json as Record<string, unknown>[] });
  });
  tool('create_contact_category', { title: 'Create contact category', description: 'Admin: create a custom directory category.', inputSchema: ContactCategoryInputSchema.shape }, async (input) => {
    const res = await call(app, env, auth, 'POST', '/api/contact-categories', input);
    return res.status >= 400 ? errorResult(res.json, 'failed to create contact category') : okResult('Contact category created', { category: res.json as Record<string, unknown> });
  });
  tool('update_contact_category', { title: 'Update contact category', description: 'Admin: change a custom directory category.', inputSchema: { id: z.string().uuid(), ...ContactCategoryInputSchema.partial().shape } }, async ({ id, ...input }) => {
    const res = await call(app, env, auth, 'PATCH', `/api/contact-categories/${encodeURIComponent(id)}`, input);
    return res.status >= 400 ? errorResult(res.json, 'failed to update contact category') : okResult('Contact category updated', { category: res.json as Record<string, unknown> });
  });
  tool('delete_contact', { title: 'Delete household contact', description: 'Admin: permanently delete a contact. This cannot be undone.', inputSchema: { id: z.string().uuid() } }, async ({ id }) => {
    const res = await call(app, env, auth, 'DELETE', `/api/contacts/${encodeURIComponent(id)}`);
    return res.status >= 400 ? errorResult(res.json, 'failed to delete contact') : okResult('Contact deleted', { ok: true });
  });
  tool('delete_contact_category', { title: 'Delete contact category', description: 'Admin: permanently delete a custom directory category and remove it from contacts. Contacts remain.', inputSchema: { id: z.string().uuid() } }, async ({ id }) => {
    const res = await call(app, env, auth, 'DELETE', `/api/contact-categories/${encodeURIComponent(id)}`);
    return res.status >= 400 ? errorResult(res.json, 'failed to delete contact category') : okResult('Contact category deleted', { ok: true });
  });
  tool('preview_contact_import', { title: 'Preview contact import', description: 'Admin: preview normalized contact drafts and possible duplicates without saving them. Takes drafts, not vCard text; the Kinwall app sends vCard files to the server itself.', inputSchema: { contacts: z.array(ContactInputSchema).max(1000) } }, async ({ contacts }) => {
    const res = await call(app, env, auth, 'POST', '/api/contacts/import/preview', { contacts });
    return res.status >= 400 ? errorResult(res.json, 'failed to preview contact import') : okResult('Contact import preview', res.json as Record<string, unknown>);
  });
  tool('import_contacts', { title: 'Import contacts', description: 'Admin: import approved normalized contact drafts. Merge requires an explicit target ID for every draft and confirmMerge.', inputSchema: { contacts: z.array(ContactInputSchema).max(1000), strategy: z.enum(['skip', 'merge', 'create']).optional(), mergeTargets: z.array(z.string().uuid()).optional(), confirmMerge: z.boolean().optional() } }, async ({ contacts, strategy, mergeTargets, confirmMerge }) => {
    const res = await call(app, env, auth, 'POST', '/api/contacts/import', { contacts, strategy: strategy ?? 'skip', mergeTargets, confirmMerge });
    return res.status >= 400 ? errorResult(res.json, 'failed to import contacts') : okResult('Contacts imported', res.json as Record<string, unknown>);
  });
  tool('merge_contacts', { title: 'Merge household contacts', description: 'Admin: explicitly merge sourceId into targetId, preserving unique methods and metadata.', inputSchema: { targetId: z.string().uuid(), sourceId: z.string().uuid() } }, async ({ targetId, sourceId }) => {
    const res = await call(app, env, auth, 'POST', '/api/contacts/merge', { targetId, sourceId, confirm: true });
    return res.status >= 400 ? errorResult(res.json, 'failed to merge contacts') : okResult('Contacts merged', { contact: res.json as Record<string, unknown> });
  });

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
    'set_night_screen',
    {
      title: 'Start or end the Night screen',
      description:
        "Start (on: true) or end (on: false) the Night screen on the family's wall screens, e.g. when nobody's home. Omit displays for every wall screen. " +
        'Each wall uses its own Night screen settings and a tap still wakes it. "On" runs out after hours (default 12). Full access only.',
      inputSchema: {
        on: z.boolean(),
        displays: jsonList(z.array(z.string())).optional().describe('Paired display names or ids; omit for every wall screen.'),
        hours: z.number().positive().max(168).optional().describe('How long "on" lasts. Default 12.'),
      },
    },
    async ({ on, displays, hours }) => {
      let ids: string[] | undefined;
      if (displays?.length) {
        try {
          ids = [];
          for (const d of displays) ids.push((await resolveExact(app, env, auth, '/api/displays/night-screen', d, 'display', (j) => (j as { displays: { id: string; name: string }[] }).displays)).id);
        } catch (err) {
          return errorResult(null, err instanceof Error ? err.message : 'display lookup failed');
        }
      }
      const res = await call(app, env, auth, 'POST', '/api/displays/night-screen', { on, displays: ids, hours });
      if (res.status >= 400) return errorResult(res.json, 'failed to set the Night screen');
      const state = res.json as { displays: { id: string; name: string }[] };
      const names = ids ? state.displays.filter((d) => ids.includes(d.id)).map((d) => d.name).join(', ') : 'every wall screen';
      return okResult(`Night screen ${on ? 'on' : 'off'} for ${names}.`, state as unknown as Record<string, unknown>);
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
      description: 'Change a list: rename it, switch its kind (todo / shopping / reusable), emoji, owners, item sort order, grouping, whether checked items stay in place, or archive it. Only provided fields change.',
      inputSchema: {
        list: z.string().describe('List id or name.'),
        name: z.string().optional(),
        kind: z.enum(['shopping', 'todo', 'reusable']).optional(),
        emoji: z.string().optional(),
        members: jsonList(z.array(z.string())).optional().describe('Owner member names or ids; [] = the whole family.'),
        sortBy: z.enum(['manual', 'added', 'due', 'priority', 'alpha', 'aisle']).optional().describe(SORT_BY_DOC),
        groupBy: z.enum(['store', 'category', 'aisle', 'none']).optional().describe('Group items under store, category or aisle headings, or none. Shopping lists group by aisle, store or none (category reads as aisle there); category is for to-do and reusable lists.'),
        keepChecked: z.boolean().optional().describe('Checked items stay in place, crossed off, until Checkout (or Reset). Default on for shopping and reusable lists, off for to-do lists.'),
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
      description: 'Edit a list item: title, notes, quantity, store, category, aisle, assignee, due date, linked event, priority. Only provided fields change; pass member: null to unassign. A shopping item\'s store/category/aisle is remembered for next time.',
      inputSchema: {
        list: z.string().describe('List id or name.'),
        itemId: z.string(),
        title: z.string().optional(),
        notes: z.string().nullable().optional(),
        quantity: z.string().nullable().optional(),
        store: z.string().nullable().optional(),
        category: z.string().nullable().optional().describe(CATEGORY_DOC),
        aisle: z.string().nullable().optional().describe(`${AISLE_DOC} null to clear.`),
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
    'set_store_aisle_order',
    {
      title: 'Set store aisle order',
      description: 'Set the order you walk a store\'s aisles in, e.g. ["Produce", "Bakery", "Deli", "Aisle 4", "Frozen", "Aisle 5", "Dairy"]. Shopping lists sorted or grouped by aisle follow it; aisles not in it come after, in natural order. Every aisle in it is offered when picking an aisle for that store. An empty list clears it. get_list returns it as aisleOrder.',
      inputSchema: {
        store: z.string().nullable().describe('Store name (as on the items), or null for items with no store.'),
        aisles: jsonList(z.array(z.string())).describe('Aisle names in walking order.'),
      },
    },
    async ({ store, aisles }) => {
      const res = await call(app, env, auth, 'PUT', '/api/lists/aisles', { store, aisles });
      if (res.status >= 400) return errorResult(res.json, 'failed to set aisle order');
      const order = res.json as { aisles: string[] };
      return okResult(order.aisles.length ? `Set ${store ?? 'no-store'} aisle order: ${order.aisles.join(', ')}.` : `Cleared ${store ?? 'no-store'} aisle order.`, { order: res.json as Record<string, unknown> });
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
  // ---- Trackers: reading log, memories, health visits. Health is refused to display-scoped callers,
  // and to every MCP call until the family turns on aiHealthAccess, by the REST route (healthBlock),
  // so these tools need no check of their own.
  const HEALTH_DOC = 'Health entries are hidden, and can\'t be added or changed here, unless a parent turned on "Let connected apps see health entries" (Settings → Connected apps).';
  const TRACKER_DATA_DOC =
    'The kind\'s fields. reading: {format: book|audiobook (default book), author, status: want|reading|finished, pagesRead, totalPages (books), ' +
    'narrator, minutesListened, totalMinutes (audiobooks, whole minutes: 4h 30m = 270), finishedOn (YYYY-MM-DD), rating 1-5, notes}. ' +
    'memory: {text, mood (one emoji)}. health: {type: checkup|dentist|specialist|vaccine|sick|other, time (HH:MM), provider, notes, ' +
    'height {value, unit: in|cm}, weight {value, unit: lb|kg}, temperature {value, unit: F|C}, followUp (YYYY-MM-DD)}.';
  const trackerMember = async (member: string | undefined) => (member ? await resolveMember(app, env, auth, member) : undefined);

  tool(
    'list_tracker_entries',
    {
      title: 'List tracker entries',
      description: `The family's trackers, newest first: reading (books and audiobooks, progress, ratings), memory (daily journal) and health (doctor/dentist visits; admin keys only). memberId null = the whole family. ${HEALTH_DOC}`,
      inputSchema: {
        kind: z.enum(TRACKER_KINDS).optional(),
        member: z.string().optional().describe('Member name or id.'),
        from: z.string().optional().describe('YYYY-MM-DD, inclusive.'),
        to: z.string().optional().describe('YYYY-MM-DD, inclusive.'),
        q: z.string().optional().describe('Search titles and fields.'),
      },
    },
    async ({ kind, member, from, to, q }) => {
      let memberId: string | undefined;
      try { memberId = await trackerMember(member); } catch (err) { return errorResult(null, err instanceof Error ? err.message : 'member lookup failed'); }
      const query = new URLSearchParams(Object.entries({ kind, memberId, from, to, q }).filter((e): e is [string, string] => !!e[1]));
      const res = await call(app, env, auth, 'GET', `/api/trackers?${query}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to list tracker entries');
      const entries = res.json as unknown[];
      return okResult(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`, { entries: res.json as Record<string, unknown>[] });
    },
  );

  tool(
    'add_tracker_entry',
    {
      title: 'Add tracker entry',
      description: `Log a book, a memory or a health visit. title: the book (required for reading), a memory's headline, or a visit's reason. ${HEALTH_DOC}`,
      inputSchema: {
        kind: z.enum(TRACKER_KINDS),
        member: z.string().optional().describe('Whose entry: member name or id. Omit for the whole family.'),
        date: z.string().optional().describe('YYYY-MM-DD: a book\'s start, a memory\'s day, a visit\'s day. Default: today.'),
        title: z.string().optional(),
        data: z.record(z.string(), z.unknown()).optional().describe(TRACKER_DATA_DOC),
      },
    },
    async ({ kind, member, date, title, data }) => {
      let memberId: string | undefined;
      try { memberId = await trackerMember(member); } catch (err) { return errorResult(null, err instanceof Error ? err.message : 'member lookup failed'); }
      const res = await call(app, env, auth, 'POST', '/api/trackers', { kind, memberId, date, title, data: data ?? {} });
      if (res.status >= 400) return errorResult(res.json, 'failed to add tracker entry');
      return okResult('Entry added.', { entry: res.json as Record<string, unknown> });
    },
  );

  tool(
    'update_tracker_entry',
    {
      title: 'Update tracker entry',
      description: `Edit an entry (ids from list_tracker_entries), e.g. log pages read or rate a book. data is merged over the entry's fields; null clears one. ${HEALTH_DOC}`,
      inputSchema: {
        entryId: z.string(),
        member: z.string().nullable().optional().describe('Member name or id; null = the whole family.'),
        date: z.string().optional(),
        title: z.string().optional(),
        data: z.record(z.string(), z.unknown()).optional().describe(TRACKER_DATA_DOC),
      },
    },
    async ({ entryId, member, date, title, data }) => {
      let memberId: string | null | undefined = member === null ? null : undefined;
      try { if (member) memberId = await trackerMember(member); } catch (err) { return errorResult(null, err instanceof Error ? err.message : 'member lookup failed'); }
      const res = await call(app, env, auth, 'PATCH', `/api/trackers/${encodeURIComponent(entryId)}`, { memberId, date, title, data });
      if (res.status >= 400) return errorResult(res.json, 'failed to update tracker entry');
      return okResult('Entry updated.', { entry: res.json as Record<string, unknown> });
    },
  );

  // ---- Color schemes: the household's scheme and the family's own saved schemes. A device can
  // override the scheme in the app, but that's stored on the device, so it isn't reachable here.
  type Custom = z.infer<typeof CustomSchemeSchema>;
  const loadSchemes = async () => {
    const res = await call(app, env, auth, 'GET', '/api/settings');
    if (res.status >= 400) return { ok: false as const, error: errorResult(res.json, 'failed to load settings') };
    const settings = res.json as { colorScheme: string; customSchemes: Custom[] };
    return { ok: true as const, settings, customs: settings.customSchemes ?? [] };
  };
  const findScheme = (ref: string, customs: Custom[]): { id: string; name: string } | null => {
    const r = ref.trim().toLowerCase();
    if (r === 'seasonal') return { id: 'seasonal', name: 'Seasonal' };
    // Names first: "Meadow" is the green scheme, even though Peach's id is 'meadow'.
    const all = [...BUILTIN_SCHEMES, ...customs];
    return all.find((x) => x.name.toLowerCase() === r) ?? all.find((x) => x.id.toLowerCase() === r) ?? null;
  };
  const schemeNames = (customs: Custom[]) => ['Seasonal', ...BUILTIN_SCHEMES.map((b) => b.name), ...customs.map((c) => c.name)].join(', ');
  const PaletteIn = z.object({
    bg: z.string().describe('Background, #RRGGBB.'),
    card: z.string().describe('Cards, #RRGGBB.'),
    text: z.string().describe('Text, #RRGGBB.'),
    accent: z.string().describe('Accent for buttons and highlights, #RRGGBB. Buttons deepen it as needed for readable labels.'),
  });

  tool(
    'list_color_schemes',
    {
      title: 'List color schemes',
      description:
        "The household's color scheme and every scheme it can use: Seasonal, the built-in schemes (by the name people see, " +
        'e.g. Peach is the default and Meadow is the green one), and the family\'s own saved schemes with their light and dark palettes.',
      inputSchema: {},
    },
    async () => {
      const got = await loadSchemes();
      if (!got.ok) return got.error;
      const { settings, customs } = got;
      const schemes = [
        { id: 'seasonal', name: 'Seasonal', emoji: '🗓️', kind: 'seasonal' as const },
        ...BUILTIN_SCHEMES.map((b) => ({ ...b, kind: 'built-in' as const })),
        ...customs.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, kind: 'custom' as const, light: c.light, dark: c.dark })),
      ];
      const current = findScheme(settings.colorScheme, customs)?.name ?? settings.colorScheme;
      return okResult(`The household uses ${current}. ${schemes.length} schemes available (${customs.length} of the family's own).`, { current: settings.colorScheme, schemes });
    },
  );

  tool(
    'set_color_scheme',
    {
      title: 'Set color scheme',
      description: "Set the household's color scheme, for every device that follows the family setting. Use a name from list_color_schemes (or Seasonal).",
      inputSchema: { scheme: z.string().describe('Scheme name or id, e.g. "Peach", "Meadow", "Seasonal", or one of the family\'s own.') },
    },
    async ({ scheme }) => {
      const got = await loadSchemes();
      if (!got.ok) return got.error;
      const found = findScheme(scheme, got.customs);
      if (!found) return errorResult(null, `No color scheme called "${scheme}". Choose one of: ${schemeNames(got.customs)}.`);
      const res = await call(app, env, auth, 'PATCH', '/api/settings', { colorScheme: found.id });
      if (res.status >= 400) return errorResult(res.json, 'failed to set the color scheme');
      return okResult(`The household now uses ${found.name}.`, { settings: res.json as Record<string, unknown> });
    },
  );

  tool(
    'save_color_scheme',
    {
      title: 'Save a color scheme',
      description:
        "Create one of the family's own color schemes, or replace one (pass `replace`). Give four colors for light mode and four for dark mode. " +
        'Text must reach 4.5:1 contrast on the background and on cards in both modes (dim text is derived and checked too); a failing scheme ' +
        `is refused with the ratios that fell short. A family can keep up to ${MAX_CUSTOM_SCHEMES}. Set use: true to make it the household's scheme.`,
      inputSchema: {
        name: z.string().describe('Up to 30 characters.'),
        emoji: z.string().optional().describe('One emoji shown on its chip.'),
        light: PaletteIn,
        dark: PaletteIn,
        replace: z.string().optional().describe("Name or id of one of the family's own schemes to overwrite."),
        use: z.boolean().optional().describe("Also make it the household's scheme. Default false."),
      },
    },
    async ({ name, emoji, light, dark, replace, use }) => {
      const got = await loadSchemes();
      if (!got.ok) return got.error;
      const { customs } = got;
      let id: string;
      if (replace) {
        const target = customs.find((c) => c.id === replace || c.name.toLowerCase() === replace.trim().toLowerCase());
        if (!target) return errorResult(null, `The family has no scheme called "${replace}" to replace.`);
        id = target.id;
      } else {
        if (customs.length >= MAX_CUSTOM_SCHEMES) return errorResult(null, `The family already has ${MAX_CUSTOM_SCHEMES} schemes. Delete one or pass replace.`);
        if (findScheme(name, customs)) return errorResult(null, `A scheme called "${name}" already exists. Pick another name, or pass replace to overwrite one of the family's own.`);
        id = `custom-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
      }
      const scheme = { id, name: name.trim(), emoji: emoji ?? '🎨', light, dark };
      const list = replace ? customs.map((c) => (c.id === id ? scheme : c)) : [...customs, scheme];
      const res = await call(app, env, auth, 'PATCH', '/api/settings', { customSchemes: list, ...(use ? { colorScheme: id } : {}) });
      if (res.status >= 400) return errorResult(res.json, 'failed to save the color scheme');
      const saved = (res.json as { customSchemes: Custom[] }).customSchemes.find((c) => c.id === id)!;
      return okResult(`Saved ${saved.name}${use ? ' and made it the household\'s scheme' : ''}.`, { scheme: saved, settings: res.json as Record<string, unknown> });
    },
  );

  tool(
    'delete_color_scheme',
    {
      title: 'Delete a color scheme',
      description: "Delete one of the family's own color schemes. Screens using it go back to Peach, the default.",
      inputSchema: { scheme: z.string().describe("Name or id of one of the family's own schemes.") },
    },
    async ({ scheme }) => {
      const got = await loadSchemes();
      if (!got.ok) return got.error;
      const { settings, customs } = got;
      const target = customs.find((c) => c.id === scheme || c.name.toLowerCase() === scheme.trim().toLowerCase());
      if (!target) return errorResult(null, `The family has no scheme called "${scheme}". Built-in schemes can't be deleted.`);
      const res = await call(app, env, auth, 'PATCH', '/api/settings', {
        customSchemes: customs.filter((c) => c.id !== target.id),
        ...(settings.colorScheme === target.id ? { colorScheme: 'meadow' } : {}),
      });
      if (res.status >= 400) return errorResult(res.json, 'failed to delete the color scheme');
      return okResult(`Deleted ${target.name}.`, { settings: res.json as Record<string, unknown> });
    },
  );

  // Deletes: irreversible, so each says so and names what goes with it. Scope is the REST route's
  // (lists, items, steps and notes are allowed to display keys; the rest need full access).
  // Members, calendars, keys, webhooks and photos are deliberately not deletable over MCP.
  const lookupError = (err: unknown) => errorResult(null, err instanceof Error ? err.message : 'lookup failed');
  const remove = async (path: string, fallback: string, summary: string) => {
    const res = await call(app, env, auth, 'DELETE', path);
    return res.status >= 400 ? errorResult(res.json, fallback) : okResult(summary, { ok: true });
  };
  const NO_UNDO = 'Permanent: it cannot be undone.';

  tool(
    'delete_list',
    {
      title: 'Delete list',
      description: `Delete a whole list with all its items, their steps and notes, and its groups. ${NO_UNDO} To keep it out of the way instead, use update_list archived: true. Takes the list id or its exact name.`,
      inputSchema: { list: z.string().describe('List id or exact name (any case).') },
    },
    async ({ list }) => {
      let target: { id: string; name: string };
      try {
        target = await resolveExact(app, env, auth, '/api/lists?archived=true', list, 'list');
      } catch (err) {
        return lookupError(err);
      }
      return remove(`/api/lists/${encodeURIComponent(target.id)}`, 'failed to delete list', `Deleted list "${target.name}".`);
    },
  );

  tool(
    'delete_list_item',
    {
      title: 'Delete list item',
      description: `Delete an item from a list, with its steps and notes (item ids come from get_list). ${NO_UNDO} To just tick it off, use set_list_item_done.`,
      inputSchema: { list: z.string().describe('List id or name.'), itemId: z.string() },
    },
    async ({ list, itemId }) => {
      let target: { id: string; name: string };
      try {
        target = await resolveList(app, env, auth, list);
      } catch (err) {
        return lookupError(err);
      }
      return remove(`/api/lists/${encodeURIComponent(target.id)}/items/${encodeURIComponent(itemId)}`, 'failed to delete item', `Deleted the item from "${target.name}".`);
    },
  );

  tool(
    'delete_list_step',
    {
      title: 'Delete step',
      description: `Delete one step of a list item (step ids come from get_list). ${NO_UNDO} If every remaining step is done, the item becomes done.`,
      inputSchema: { list: z.string().describe('List id or name.'), itemId: z.string(), stepId: z.string() },
    },
    async ({ list, itemId, stepId }) => {
      let listId: string;
      try {
        listId = (await resolveList(app, env, auth, list)).id;
      } catch (err) {
        return lookupError(err);
      }
      const res = await call(app, env, auth, 'DELETE', `/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}/steps/${encodeURIComponent(stepId)}`);
      if (res.status >= 400) return errorResult(res.json, 'failed to delete step');
      const item = res.json as { title: string; stepsDone: number; stepsTotal: number };
      return okResult(`Deleted the step. "${item.title}": ${item.stepsDone} of ${item.stepsTotal} steps done.`, { item: res.json as Record<string, unknown> });
    },
  );

  tool(
    'delete_note',
    {
      title: 'Delete note',
      description: `Delete one note from an event's or list item's thread (note ids come from list_notes). ${NO_UNDO}`,
      inputSchema: { noteId: z.string() },
    },
    async ({ noteId }) => remove(`/api/notes/${encodeURIComponent(noteId)}`, 'failed to delete note', 'Deleted the note.'),
  );

  tool(
    'delete_chore',
    {
      title: 'Delete chore',
      description: `Full access: delete a chore. One that was ever done is archived: it leaves every list for good, but its completion history and the points members earned from it stay. ${NO_UNDO} To pause a chore and bring it back later, use update_chore active: false instead.`,
      inputSchema: { choreId: z.string() },
    },
    async ({ choreId }) => remove(`/api/chores/${encodeURIComponent(choreId)}`, 'failed to delete chore', 'Deleted the chore.'),
  );

  tool(
    'delete_tracker_entry',
    {
      title: 'Delete tracker entry',
      description: `Full access: delete a book, memory or health entry (ids come from list_tracker_entries). A memory's own photo goes with it, unless it's also a family photo. ${HEALTH_DOC} ${NO_UNDO}`,
      inputSchema: { entryId: z.string() },
    },
    async ({ entryId }) => remove(`/api/trackers/${encodeURIComponent(entryId)}`, 'failed to delete entry', 'Deleted the entry.'),
  );

  tool(
    'delete_meal',
    {
      title: 'Delete meal',
      description: `Full access: remove a planned meal (ids come from list_meals), with the calendar event Kinwall created for it and that event's notes. A linked event of your own and groceries already added to a list stay. ${NO_UNDO}`,
      inputSchema: { mealId: z.string() },
    },
    async ({ mealId }) => remove(`/api/meals/${encodeURIComponent(mealId)}`, 'failed to delete meal', 'Deleted the meal.'),
  );

  tool(
    'delete_recipe',
    {
      title: 'Delete recipe',
      description: `Full access: delete a recipe and its ingredients. Meals already planned from it keep their own copy. ${NO_UNDO} To hide it instead, use update_recipe archived: true. Takes the recipe id or its exact name.`,
      inputSchema: { recipe: z.string().describe('Recipe id or exact name (any case).') },
    },
    async ({ recipe }) => {
      let target: { id: string; name: string };
      try {
        target = await resolveExact(app, env, auth, '/api/recipes?archived=true', recipe, 'recipe');
      } catch (err) {
        return lookupError(err);
      }
      return remove(`/api/recipes/${encodeURIComponent(target.id)}`, 'failed to delete recipe', `Deleted recipe "${target.name}".`);
    },
  );

  tool(
    'delete_reward',
    {
      title: 'Delete reward',
      description: `Full access: delete a reward. Past requests for it stay in history, and anyone saving for it no longer has a goal. ${NO_UNDO} To retire it instead, use update_reward active: false. Takes the reward id or its exact title.`,
      inputSchema: { reward: z.string().describe('Reward id or exact title (any case).') },
    },
    async ({ reward }) => {
      let target: { id: string; name: string };
      try {
        target = await resolveExact(app, env, auth, '/api/rewards?archived=true', reward, 'reward');
      } catch (err) {
        return lookupError(err);
      }
      return remove(`/api/rewards/${encodeURIComponent(target.id)}`, 'failed to delete reward', `Deleted reward "${target.name}".`);
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
  // No standalone SSE stream: a stateless server never sends on it, and a client holding one open
  // keeps a hosted family's Durable Object awake (billed) around the clock. The spec's answer for
  // "no stream here" is 405, which clients handle by just POSTing.
  if (c.req.method === 'GET') return c.body(null, 405, { Allow: 'POST, DELETE' });

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
