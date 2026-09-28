// "Your data": GET /api/export (everything the family entered, minus credentials), POST /api/import
// (merges an export back in) and GET /api/host-events (see host-events.ts). All admin-only -
// display keys are denied by default in auth.ts.
import { createRoute, z } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { createRouter } from '../router.ts';
import { emit, type BusEventType } from '../bus.ts';
import type { KinwallDb, KinwallStatement } from '../db.ts';
import { RecipeSchema, MealSchema } from '../meal-schemas.ts';
import { readRecipes, readMeals, normalizeIngredient } from '../meals.ts';
import { itemKey } from '../item-memory.ts';
import { readSettings, settingsWrites } from './settings.ts';
import { toApi as categoryToApi } from './categories.ts';
import { toApi as choreToApi, type ChoreRow } from './chores.ts';
import { toApi as listToApi, toItemApi, toGroupApi, groupSteps, type ListRow, type ListItemRow, type ListItemStepRow, type ListGroupRow } from './lists.ts';
import { toApi as webhookToApi, type WebhookRow } from './webhooks.ts';
import { toNoteApi, type NoteRow } from './notes.ts';
import { toTrackerApi, type TrackerRow } from './trackers.ts';
import { toEntryApi, toPlacementApi, type PointEntryRow, type PlacementRow } from './stickers.ts';
import { toRewardApi, toRedemptionApi, type RewardRow, type RedemptionRow } from './rewards.ts';
import { parseMemberIds } from '../calendar-members.ts';
import { RECONNECT_MESSAGE } from '../sync.ts';
import { decryptConfig, encryptConfig } from '../crypto.ts';
import { isSafeFeedUrl } from '../outbound.ts';
import type { CategoryRow } from '../calendar-categories.ts';
import { parseTransitions } from './members.ts';
import {
  CalendarSchema,
  CategorySchema,
  ChoreSchema,
  ListGroupSchema,
  ListItemSchema,
  ListSchema,
  ErrorSchema,
  BirthdaySchema,
  MemberSchema,
  TransitionRemindersSchema,
  TrackerEntrySchema,
  NoteSchema,
  PointEntrySchema,
  StickerPlacementSchema,
  RewardSchema,
  RedemptionSchema,
  SettingsPatchSchema,
  SettingsSchema,
  WebhookSchema,
} from '../schemas.ts';

export const dataRoutes = createRouter();

const EXPORT_VERSION = 1;

const ExportSchema = z
  .object({
    version: z.number(),
    exportedAt: z.string(),
    settings: SettingsSchema,
    members: z.array(MemberSchema.omit({ pointsToday: true, pointsWeek: true, balance: true, rewardGoal: true }).extend({ birthday: BirthdaySchema.nullable().default(null), needsApproval: z.boolean().default(false), transitionReminders: TransitionRemindersSchema.optional(), rewardGoalId: z.string().nullable().default(null) })),
    categories: z.array(CategorySchema),
    // Every calendar, but no config/credentials/account: synced ones are imported as placeholders
    // that keep their settings and are reconnected, and their events re-fetched.
    // ICS feeds also carry their url (the export is the family's own, admin-only file), so they come
    // back connected on import; provider accounts never do - those hold tokens and are reconnected.
    calendars: z.array(CalendarSchema.pick({ id: true, kind: true, name: true, color: true, remoteId: true, memberIds: true, categoryId: true, enabled: true }).extend({ url: z.string().url().optional(), displayEdit: z.boolean().optional() })),
    events: z.array(
      z.object({
        id: z.string(),
        calendarId: z.string(),
        title: z.string(),
        start: z.string(),
        end: z.string(),
        allDay: z.boolean(),
        location: z.string().nullable(),
        description: z.string().nullable(),
        rrule: z.string().nullable(),
        memberIds: z.array(z.string()),
        categoryId: z.string().nullable(),
        reminders: z.array(z.number()).nullable(),
        travelMinutes: z.number().nullable().default(null), // older exports predate travel time
        remindBeforeLeave: z.boolean().default(false),
        // Pushed by an automation (PUT /api/calendars/{id}/events/sync); older exports have neither.
        syncSource: z.string().nullable().default(null),
        externalId: z.string().nullable().default(null),
      }),
    ),
    // Per-event member/category tags on synced events, keyed by the provider's event id (see
    // migrations 0006/0011) so they reapply once the calendar is reconnected and re-synced.
    eventMemberOverrides: z.array(z.object({ calendarId: z.string(), externalId: z.string(), memberIds: z.array(z.string()) })),
    eventCategoryOverrides: z.array(z.object({ calendarId: z.string(), externalId: z.string(), categoryId: z.string() })),
    eventTravelOverrides: z.array(z.object({ calendarId: z.string(), externalId: z.string(), travelMinutes: z.number().nullable(), remindBeforeLeave: z.boolean() })),
    // Series-wide tags on recurring synced events, keyed by the provider's series id (0007/0011).
    eventSeriesMemberOverrides: z.array(z.object({ calendarId: z.string(), seriesId: z.string(), memberIds: z.array(z.string()) })),
    eventSeriesCategoryOverrides: z.array(z.object({ calendarId: z.string(), seriesId: z.string(), categoryId: z.string() })),
    // listId: exports before 0027 lack it; pluginId/pluginMinutes before 0033.
    // needsApproval/approveTimedPlay before 0037.
    chores: z.array(ChoreSchema.extend({ listId: z.string().nullable().optional(), pluginId: z.string().nullable().optional(), pluginMinutes: z.number().nullable().optional(), needsApproval: z.boolean().nullable().default(null), approveTimedPlay: z.boolean().default(false) })),
    // pointsAwarded: older exports predate it - null imports as the chore's full points.
    choreCompletions: z.array(z.object({ id: z.string(), choreId: z.string(), date: z.string(), memberId: z.string().nullable(), completedAt: z.string(), pointsAwarded: z.number().nullable().default(null), status: z.enum(['approved', 'pending']).default('approved') })),
    lists: z.array(
      ListSchema.extend({
        sortBy: ListSchema.shape.sortBy.default('manual'), // older exports predate it
        keepChecked: z.boolean().optional(), // older exports: the kind's default (0040)
        items: z.array(
          // Older exports predate event links, priority, steps and aisles.
          ListItemSchema.omit({ meals: true }).extend({
            aisle: z.string().nullable().default(null),
            eventId: z.string().nullable().default(null),
            priority: ListItemSchema.shape.priority.default('normal'),
            steps: ListItemSchema.shape.steps.default([]),
            stepsDone: z.number().default(0),
            stepsTotal: z.number().default(0),
          }),
        ),
        groups: z.array(ListGroupSchema),
      }),
    ),
    // Notes threads on the local events and list items above (synced events' notes stay put).
    notes: z.array(NoteSchema),
    // Points ledger + sticker book (0025). Balances are derived, so only the ledger travels.
    pointEntries: z.array(PointEntrySchema),
    stickerPacks: z.array(z.object({ memberId: z.string(), packId: z.string(), unlockedAt: z.string() })),
    scrapbook: z.array(StickerPlacementSchema),
    // Rewards (0039) and their redemptions; the points they took are in pointEntries.
    rewards: z.array(RewardSchema.omit({ used: true })),
    rewardRedemptions: z.array(RedemptionSchema),
    trackers: z.array(TrackerEntrySchema), // reading log, memories, health visits (0031)
    recipes: z.array(RecipeSchema),
    meals: z.array(MealSchema),
    mealShoppingSources: z.array(z.object({ listId: z.string(), sourceRef: z.string(), itemId: z.string(), fingerprint: z.string() })),
    // Where the household keeps things (0040): the store/category/aisle last used per item name
    // (nameKey is the matching key, store '' = none), and stores' aisle walking orders.
    itemMemory: z.array(z.object({ nameKey: z.string(), store: z.string(), category: z.string().nullable(), aisle: z.string().nullable(), updatedAt: z.string() })),
    storeAisles: z.array(z.object({ store: z.string(), aisles: z.array(z.string()) })),
    // Names to autocomplete on shopping lists (0041): the spelling last used and how often.
    itemNames: z.array(z.object({ nameKey: z.string(), title: z.string(), uses: z.number(), lastUsed: z.string() })),
    passkeys: z.array(z.object({ name: z.string(), createdAt: z.string() })),
    webhooks: z.array(WebhookSchema),
  })
  .openapi('Export');

type MemberRow = { id: string; name: string; color: string; avatar: string | null; birthday: string | null; sort: number; needs_approval: number; transitions: string | null; reward_goal: string | null };
type CalendarRow = { id: string; kind: z.infer<typeof CalendarSchema>['kind']; remote_id: string | null; name: string; color: string | null; member_ids: string; category_id: string | null; enabled: number; display_edit: number };
type EventRow = {
  id: string; calendar_id: string; title: string; start: string; end: string; all_day: number; location: string | null;
  description: string | null; rrule: string | null; member_ids: string; category_id: string | null; reminders: string | null;
  travel_minutes: number | null; remind_before_leave: number; sync_source: string | null; external_id: string | null;
};
type CompletionRow = { id: string; chore_id: string; date: string; member_id: string | null; completed_at: string; points_awarded: number | null; status: 'approved' | 'pending' };

function parseReminders(json: string | null): number[] | null {
  if (json === null) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : null;
  } catch {
    return null;
  }
}

dataRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/export',
    tags: ['System'],
    summary: 'Download everything the family entered as JSON (no credentials, secrets or synced events)',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: ExportSchema } } } },
  }),
  async (c) => {
    const db = c.env.DB;
    // Column lists are explicit (never SELECT *) so a secret column can't leak in by accident.
    const [members, categories, calendars, events, memberOverrides, categoryOverrides, travelOverrides, seriesMemberOverrides, seriesCategoryOverrides, chores, completions, lists, items, steps, groups, notes, pointEntries, stickerPacks, scrapbook, rewards, redemptions, trackers, passkeys, webhooks] = (await db.batch<unknown>([
      db.prepare('SELECT id, name, color, avatar, birthday, sort, needs_approval, transitions, reward_goal FROM members ORDER BY sort, created_at'),
      db.prepare('SELECT id, name, emoji, color, keywords, sort, created_at FROM categories ORDER BY sort, created_at'),
      db.prepare('SELECT id, kind, remote_id, name, color, member_ids, category_id, enabled, display_edit, config FROM calendars ORDER BY name'),
      db.prepare(
        `SELECT e.id, e.calendar_id, e.title, e.start, e.end, e.all_day, e.location, e.description, e.rrule, e.member_ids, e.category_id, e.reminders, e.travel_minutes, e.remind_before_leave, e.sync_source, e.external_id
         FROM events e JOIN calendars c ON c.id = e.calendar_id WHERE c.kind = 'local' ORDER BY e.start`,
      ),
      db.prepare('SELECT calendar_id, external_id, member_ids FROM event_member_overrides ORDER BY calendar_id, external_id'),
      db.prepare('SELECT calendar_id, external_id, category_id FROM event_category_overrides ORDER BY calendar_id, external_id'),
      db.prepare('SELECT calendar_id, external_id, travel_minutes, remind_before_leave FROM event_travel_overrides ORDER BY calendar_id, external_id'),
      db.prepare('SELECT calendar_id, series_id, member_ids FROM event_series_member_overrides ORDER BY calendar_id, series_id'),
      db.prepare('SELECT calendar_id, series_id, category_id FROM event_series_category_overrides ORDER BY calendar_id, series_id'),
      db.prepare('SELECT id, title, emoji, member_id, points, rrule, due_date, due_time, active, sort, created_at, list_id, plugin_id, plugin_minutes, needs_approval, approve_timed_play FROM chores ORDER BY sort, created_at'),
      db.prepare('SELECT id, chore_id, date, member_id, completed_at, points_awarded, status FROM chore_completions ORDER BY date'),
      db.prepare('SELECT id, name, emoji, color, kind, member_ids, group_by, sort_by, keep_checked, sort, archived, created_at FROM lists ORDER BY sort, created_at'),
      db.prepare(
        'SELECT id, list_id, title, notes, quantity, store, category, aisle, member_id, due_date, event_id, priority, done, done_at, done_by, sort, created_at, updated_at FROM list_items ORDER BY sort, created_at',
      ),
      db.prepare('SELECT id, item_id, title, done, done_at, sort, created_at FROM list_item_steps ORDER BY sort, created_at'),
      db.prepare('SELECT list_id, kind, name, sort FROM list_groups ORDER BY sort'),
      db.prepare(
        `SELECT n.id, n.target_type, n.target_id, n.member_id, n.body, n.created_at, n.updated_at FROM notes n
         WHERE (n.target_type = 'list_item' AND n.target_id IN (SELECT id FROM list_items))
            OR (n.target_type = 'event' AND n.target_id IN (SELECT e.id FROM events e JOIN calendars c ON c.id = e.calendar_id WHERE c.kind = 'local'))
         ORDER BY n.target_type, n.target_id, n.created_at, n.id`,
      ),
      db.prepare('SELECT id, member_id, amount, reason, ref, at FROM point_entries ORDER BY at, id'),
      db.prepare('SELECT member_id, pack_id, unlocked_at FROM member_sticker_packs ORDER BY member_id, pack_id'),
      db.prepare('SELECT id, member_id, sticker, x, y, scale, rotation, z, placed_at FROM scrapbook_stickers ORDER BY member_id, z, placed_at, id'),
      db.prepare('SELECT id, title, emoji, cost, member_ids, needs_approval, limit_period, limit_count, active, sort, created_at FROM rewards ORDER BY sort, created_at'),
      db.prepare('SELECT id, reward_id, member_id, title, emoji, cost, status, note, date, requested_at, decided_at, given_at FROM reward_redemptions ORDER BY requested_at, id'),
      db.prepare('SELECT t.*, p.family AS photo_family FROM tracker_entries t LEFT JOIN photos p ON p.id = t.photo_id ORDER BY t.date, t.created_at'),
      db.prepare('SELECT name, created_at FROM passkeys ORDER BY created_at'),
      db.prepare('SELECT id, url, events, enabled, created_at FROM webhooks ORDER BY created_at'),
    ])).map((r) => r.results);

    const itemRows = items as ListItemRow[];
    const groupRows = groups as ListGroupRow[];
    const stepsByItem = groupSteps(steps as ListItemStepRow[]);
    const date = new Date().toISOString();
    c.header('Content-Disposition', `attachment; filename="kinwall-export-${date.slice(0, 10)}.json"`);
    return c.json(
      {
        version: EXPORT_VERSION,
        exportedAt: date,
        settings: await readSettings(db),
        members: (members as MemberRow[]).map(({ id, name, color, avatar, birthday, sort, needs_approval, transitions, reward_goal }) => ({ id, name, color, avatar, birthday, sort, needsApproval: !!needs_approval, transitionReminders: parseTransitions(transitions), rewardGoalId: reward_goal })),
        categories: (categories as CategoryRow[]).map(categoryToApi),
        calendars: await Promise.all((calendars as (CalendarRow & { config: string })[]).map(async (r) => ({
          id: r.id,
          kind: r.kind,
          name: r.name,
          color: r.color,
          remoteId: r.remote_id,
          memberIds: parseMemberIds(r.member_ids),
          categoryId: r.category_id,
          enabled: !!r.enabled,
          displayEdit: !!r.display_edit,
          ...(r.kind === 'ics' && r.config ? { url: (await decryptConfig(c.env, r.id, r.config).catch(() => ({}))).url as string | undefined } : {}),
        }))),
        events: (events as EventRow[]).map((r) => ({
          id: r.id,
          calendarId: r.calendar_id,
          title: r.title,
          start: r.start,
          end: r.end,
          allDay: !!r.all_day,
          location: r.location,
          description: r.description,
          rrule: r.rrule,
          memberIds: parseMemberIds(r.member_ids),
          categoryId: r.category_id,
          reminders: parseReminders(r.reminders),
          travelMinutes: r.travel_minutes,
          remindBeforeLeave: !!r.remind_before_leave,
          syncSource: r.sync_source,
          externalId: r.external_id,
        })),
        eventMemberOverrides: (memberOverrides as { calendar_id: string; external_id: string; member_ids: string }[]).map((r) => ({
          calendarId: r.calendar_id,
          externalId: r.external_id,
          memberIds: parseMemberIds(r.member_ids),
        })),
        eventCategoryOverrides: (categoryOverrides as { calendar_id: string; external_id: string; category_id: string }[]).map((r) => ({
          calendarId: r.calendar_id,
          externalId: r.external_id,
          categoryId: r.category_id,
        })),
        eventTravelOverrides: (travelOverrides as { calendar_id: string; external_id: string; travel_minutes: number | null; remind_before_leave: number }[]).map((r) => ({
          calendarId: r.calendar_id,
          externalId: r.external_id,
          travelMinutes: r.travel_minutes,
          remindBeforeLeave: !!r.remind_before_leave,
        })),
        eventSeriesMemberOverrides: (seriesMemberOverrides as { calendar_id: string; series_id: string; member_ids: string }[]).map((r) => ({
          calendarId: r.calendar_id,
          seriesId: r.series_id,
          memberIds: parseMemberIds(r.member_ids),
        })),
        eventSeriesCategoryOverrides: (seriesCategoryOverrides as { calendar_id: string; series_id: string; category_id: string }[]).map((r) => ({
          calendarId: r.calendar_id,
          seriesId: r.series_id,
          categoryId: r.category_id,
        })),
        chores: (chores as ChoreRow[]).map(choreToApi),
        choreCompletions: (completions as CompletionRow[]).map((r) => ({ id: r.id, choreId: r.chore_id, date: r.date, memberId: r.member_id, completedAt: r.completed_at, pointsAwarded: r.points_awarded, status: r.status })),
        lists: (lists as ListRow[]).map((l) => {
          const mine = itemRows.filter((i) => i.list_id === l.id);
          return {
            ...listToApi(l, mine.length, mine.filter((i) => !i.done).length),
            items: mine.map((i) => toItemApi(i, stepsByItem.get(i.id))),
            groups: groupRows.filter((g) => g.list_id === l.id).map(toGroupApi),
          };
        }),
        notes: (notes as NoteRow[]).map(toNoteApi),
        pointEntries: (pointEntries as PointEntryRow[]).map(toEntryApi),
        stickerPacks: (stickerPacks as { member_id: string; pack_id: string; unlocked_at: string }[]).map((r) => ({ memberId: r.member_id, packId: r.pack_id, unlockedAt: r.unlocked_at })),
        scrapbook: (scrapbook as PlacementRow[]).map(toPlacementApi),
        rewards: (rewards as RewardRow[]).map(toRewardApi),
        rewardRedemptions: (redemptions as RedemptionRow[]).map(toRedemptionApi),
        trackers: (trackers as TrackerRow[]).map(toTrackerApi),
        recipes: await readRecipes(db, { archived: true }),
        meals: await readMeals(db, '0000-01-01', '9999-12-31'),
        mealShoppingSources: (await db.prepare('SELECT list_id, source_ref, item_id, fingerprint FROM meal_shopping_sources ORDER BY list_id, source_ref').all<{ list_id: string; source_ref: string; item_id: string; fingerprint: string }>()).results.map((r) => ({ listId: r.list_id, sourceRef: r.source_ref, itemId: r.item_id, fingerprint: r.fingerprint })),
        itemMemory: (await db.prepare('SELECT name_key, store, category, aisle, updated_at FROM item_memory ORDER BY name_key, store').all<{ name_key: string; store: string; category: string | null; aisle: string | null; updated_at: string }>()).results
          .map((r) => ({ nameKey: r.name_key, store: r.store, category: r.category, aisle: r.aisle, updatedAt: r.updated_at })),
        itemNames: (await db.prepare('SELECT name_key, title, uses, last_used FROM item_names ORDER BY name_key').all<{ name_key: string; title: string; uses: number; last_used: string }>()).results
          .map((r) => ({ nameKey: r.name_key, title: r.title, uses: r.uses, lastUsed: r.last_used })),
        storeAisles: (await db.prepare('SELECT store, aisle FROM store_aisles ORDER BY store, sort').all<{ store: string; aisle: string }>()).results
          .reduce<{ store: string; aisles: string[] }[]>((out, r) => {
            if (out.at(-1)?.store !== r.store) out.push({ store: r.store, aisles: [] });
            out.at(-1)!.aisles.push(r.aisle);
            return out;
          }, []),
        passkeys: (passkeys as { name: string; created_at: string }[]).map((p) => ({ name: p.name, createdAt: p.created_at })),
        webhooks: (webhooks as WebhookRow[]).map(webhookToApi),
      },
      200,
    );
  },
);

// Import: same shape as the export, version pinned. Settings are checked key by key against the
// PATCH /api/settings schema below (unknown keys from other versions are dropped); passkeys and
// webhooks are only counted. The override sections are additive to version 1, so older files lack them.
const ImportSchema = ExportSchema.extend({
  version: z.literal(EXPORT_VERSION, { message: `unsupported export version (this Kinwall reads version ${EXPORT_VERSION})` }),
  exportedAt: z.string().optional(),
  settings: z.record(z.string(), z.unknown()),
  passkeys: z.array(z.unknown()),
  webhooks: z.array(z.unknown()),
  eventMemberOverrides: ExportSchema.shape.eventMemberOverrides.default([]),
  eventCategoryOverrides: ExportSchema.shape.eventCategoryOverrides.default([]),
  eventTravelOverrides: ExportSchema.shape.eventTravelOverrides.default([]),
  eventSeriesMemberOverrides: ExportSchema.shape.eventSeriesMemberOverrides.default([]),
  eventSeriesCategoryOverrides: ExportSchema.shape.eventSeriesCategoryOverrides.default([]),
  notes: ExportSchema.shape.notes.default([]),
  pointEntries: ExportSchema.shape.pointEntries.default([]),
  stickerPacks: ExportSchema.shape.stickerPacks.default([]),
  scrapbook: ExportSchema.shape.scrapbook.default([]),
  rewards: ExportSchema.shape.rewards.default([]),
  rewardRedemptions: ExportSchema.shape.rewardRedemptions.default([]),
  trackers: ExportSchema.shape.trackers.default([]),
  recipes: ExportSchema.shape.recipes.default([]),
  meals: ExportSchema.shape.meals.default([]),
  mealShoppingSources: ExportSchema.shape.mealShoppingSources.default([]),
  itemMemory: ExportSchema.shape.itemMemory.default([]),
  storeAisles: ExportSchema.shape.storeAisles.default([]),
  itemNames: ExportSchema.shape.itemNames.default([]),
}).openapi('Import');

const ImportResultSchema = z
  .object({
    imported: z.object({
      members: z.number(),
      categories: z.number(),
      calendars: z.number(),
      events: z.number(),
      eventMemberOverrides: z.number(),
      eventCategoryOverrides: z.number(),
      eventTravelOverrides: z.number(),
      eventSeriesMemberOverrides: z.number(),
      eventSeriesCategoryOverrides: z.number(),
      chores: z.number(),
      choreCompletions: z.number(),
      lists: z.number(),
      listItems: z.number(),
      listItemSteps: z.number(),
      notes: z.number(),
      pointEntries: z.number(),
      stickerPacks: z.number(),
      scrapbook: z.number(),
      rewards: z.number(),
      rewardRedemptions: z.number(),
      trackers: z.number(),
      recipes: z.number(),
      meals: z.number(),
      mealShoppingSources: z.number(),
      itemMemory: z.number(),
      storeAisles: z.number(),
      itemNames: z.number(),
    }),
    // Synced calendars waiting to be reconnected (imported placeholders, from this or an earlier import).
    needsReconnect: z.array(z.object({ id: z.string(), kind: z.string(), name: z.string() })),
    skipped: z.object({ passkeys: z.number(), webhooks: z.number() }),
  })
  .openapi('ImportResult');

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
// D1 limits: 2 MB per string/row, 100 KB of SQL and 100 bound params per statement, and every
// statement in a batch counts toward the 50 (Free) / 1000 (Paid) queries per invocation. So rows
// are never one statement each: each chunk of rows is bound as a single JSON param and unpacked
// with json_each - a 10 MB file is ~25 statements, all in one all-or-nothing batch.
const CHUNK_BYTES = 512 * 1024;

type Row = Record<string, string | number | null>;
const memberRef = (col: string) => `(SELECT id FROM members WHERE id = j.value->>'${col}')`; // unknown member -> NULL, not an FK error

// INSERT ... ON CONFLICT DO UPDATE for every row, preserving ids. `keep` columns are set on insert
// only; `expr` overrides how a column is read from the row; `where` guards the update.
function upserts(db: KinwallDb, table: string, conflict: string, rows: Row[], opts: { keep?: string[]; expr?: Record<string, string>; where?: string } = {}): KinwallStatement[] {
  if (rows.length === 0) return [];
  const cols = Object.keys(rows[0]);
  const conflictCols = conflict.split(', ');
  const set = cols.filter((c) => !conflictCols.includes(c) && !opts.keep?.includes(c)).map((c) => `${c} = excluded.${c}`);
  // "WHERE true" keeps SQLite from parsing ON CONFLICT as a join constraint (INSERT ... SELECT upsert quirk).
  const sql =
    `INSERT INTO ${table} (${cols.join(', ')}) SELECT ${cols.map((c) => opts.expr?.[c] ?? `j.value->>'${c}'`).join(', ')} FROM json_each(?) j WHERE true ` +
    `ON CONFLICT(${conflict}) DO UPDATE SET ${set.join(', ')}${opts.where ? ` WHERE ${opts.where}` : ''}`;
  const stmts: KinwallStatement[] = [];
  let chunk: string[] = [];
  let size = 0;
  const flush = () => {
    if (chunk.length) stmts.push(db.prepare(sql).bind(`[${chunk.join(',')}]`));
    chunk = [];
    size = 0;
  };
  for (const row of rows) {
    const json = JSON.stringify(row);
    if (size + json.length > CHUNK_BYTES) flush();
    chunk.push(json);
    size += json.length + 1;
  }
  flush();
  return stmts;
}

dataRoutes.use('/api/import', bodyLimit({ maxSize: MAX_IMPORT_BYTES, onError: (c) => c.json({ error: 'Import file is larger than 10 MB' }, 413) }));

dataRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/import',
    tags: ['System'],
    summary: 'Merge a Kinwall export into this family by id (idempotent). Synced calendars come in disconnected, to be reconnected; passkeys and webhooks are skipped.',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: ImportSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: ImportResultSchema } } },
      400: { description: 'invalid', content: { 'application/json': { schema: ErrorSchema } } },
      413: { description: 'too large', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const db = c.env.DB;

    // Settings go through PATCH /api/settings' schema + writer. Keys this version doesn't know are
    // dropped; a null timezone means "never set" in the export, which PATCH can't express.
    const settingsIn = Object.fromEntries(
      Object.entries(body.settings).filter(([k, v]) => k in SettingsPatchSchema.shape && k !== 'theme' && !(k === 'timezone' && v === null)),
    );
    const settings = SettingsPatchSchema.safeParse(settingsIn);
    if (!settings.success) {
      const issue = settings.error.issues[0];
      return c.json({ error: `settings.${issue.path.join('.')}: ${issue.message}` }, 400);
    }

    // Synced calendars carry no credentials in the export: they come in as placeholders (no account,
    // config '') and their events are re-fetched once reconnected.
    const calendars = body.calendars;
    const calendarIds = new Set(calendars.map((cal) => cal.id));
    const localIds = new Set(calendars.filter((cal) => cal.kind === 'local').map((cal) => cal.id));
    // ICS feeds whose url is in the file (and safe) come back connected under this instance's key.
    const icsConfigs = new Map<string, string>();
    for (const cal of calendars) {
      if (cal.kind === 'ics' && cal.url && isSafeFeedUrl(c.env, cal.url)) icsConfigs.set(cal.id, await encryptConfig(c.env, cal.id, { url: cal.url }));
    }
    const events = body.events.filter((e) => localIds.has(e.calendarId));
    const memberOverrides = body.eventMemberOverrides.filter((o) => calendarIds.has(o.calendarId));
    const categoryOverrides = body.eventCategoryOverrides.filter((o) => calendarIds.has(o.calendarId));
    const travelOverrides = body.eventTravelOverrides.filter((o) => calendarIds.has(o.calendarId));
    const seriesMemberOverrides = body.eventSeriesMemberOverrides.filter((o) => calendarIds.has(o.calendarId));
    const seriesCategoryOverrides = body.eventSeriesCategoryOverrides.filter((o) => calendarIds.has(o.calendarId));
    const choreIds = new Set(body.chores.map((ch) => ch.id));
    const completions = body.choreCompletions.filter((cc) => choreIds.has(cc.choreId));
    const items = body.lists.flatMap((l) => l.items.map((i) => ({ ...i, listId: l.id })));
    const groups = body.lists.flatMap((l) => l.groups.map((g) => ({ ...g, listId: l.id })));
    // Only notes whose target is in the file (a local event or a list item) - never onto something else.
    const targetIds = new Set([...events.map((e) => `event:${e.id}`), ...items.map((i) => `list_item:${i.id}`)]);
    const notes = body.notes.filter((n) => targetIds.has(`${n.targetType}:${n.targetId}`));
    // Ledger/sticker rows need their member (NOT NULL): only those for members in the file.
    const fileMembers = new Set(body.members.map((m) => m.id));
    const pointEntries = body.pointEntries.filter((e) => fileMembers.has(e.memberId));
    const stickerPacks = body.stickerPacks.filter((p) => fileMembers.has(p.memberId));
    const scrapbook = body.scrapbook.filter((st) => fileMembers.has(st.memberId));
    const redemptions = body.rewardRedemptions.filter((r) => fileMembers.has(r.memberId));
    // A member's entries only with that member (they're personal); the family's and removed members' always.
    const trackers = body.trackers.filter((t) => t.memberId === null || fileMembers.has(t.memberId));
    const mealSources = body.mealShoppingSources.filter((s) => items.some((i) => i.id === s.itemId && i.listId === s.listId));
    const steps = items.flatMap((i) => i.steps.map((st) => ({ ...st, itemId: i.id, doneAt: st.done ? (i.doneAt ?? new Date().toISOString()) : null, createdAt: i.createdAt })));

    // Members and chores have no createdAt in the export; stamp new rows 1 ms apart in file order so
    // their created_at tie-break keeps the exported order.
    const now = Date.now();
    const stamp = (i: number) => new Date(now + i).toISOString();
    const keepCreated = { keep: ['created_at'] };
    const writes = [
      ...settingsWrites(db, settings.data),
      ...upserts(db, 'members', 'id', body.members.map((m, i) => ({ id: m.id, name: m.name, color: m.color, avatar: m.avatar, birthday: m.birthday, sort: m.sort, needs_approval: m.needsApproval ? 1 : 0, transitions: m.transitionReminders ? JSON.stringify(m.transitionReminders) : null, reward_goal: m.rewardGoalId, created_at: stamp(i) })), keepCreated),
      ...upserts(
        db,
        'categories',
        'id',
        body.categories.map((cat) => ({ id: cat.id, name: cat.name, emoji: cat.emoji, color: cat.color, keywords: JSON.stringify(cat.keywords), sort: cat.sort, created_at: cat.createdAt })),
        keepCreated,
      ),
      ...upserts(
        db,
        'calendars',
        'id',
        calendars.map((cal) => {
          const local = cal.kind === 'local';
          const feed = icsConfigs.get(cal.id);
          return {
            id: cal.id,
            kind: cal.kind,
            remote_id: local ? null : cal.remoteId,
            name: cal.name,
            color: cal.color,
            member_ids: JSON.stringify(cal.memberIds),
            category_id: cal.categoryId,
            enabled: cal.enabled ? 1 : 0,
            display_edit: cal.displayEdit === false ? 0 : 1, // exports from before the switch: on
            writable: local ? 1 : 0, // placeholders are read-only until sync refreshes it
            account_id: null,
            config: local ? '{}' : feed ?? '',
            last_error: local || feed ? null : RECONNECT_MESSAGE,
          };
        }),
        // An existing row (e.g. re-importing into the same, still-connected instance) only takes the
        // settings; its connection is left alone, and a kind mismatch leaves it untouched.
        { keep: ['kind', 'remote_id', 'writable', 'account_id', 'config', 'last_error'], where: 'calendars.kind = excluded.kind' },
      ),
      ...upserts(
        db,
        'event_member_overrides',
        'calendar_id, external_id',
        memberOverrides.map((o) => ({ calendar_id: o.calendarId, external_id: o.externalId, member_ids: JSON.stringify(o.memberIds), updated_at: new Date(now).toISOString() })),
      ),
      ...upserts(
        db,
        'event_category_overrides',
        'calendar_id, external_id',
        categoryOverrides.map((o) => ({ calendar_id: o.calendarId, external_id: o.externalId, category_id: o.categoryId, updated_at: new Date(now).toISOString() })),
      ),
      ...upserts(
        db,
        'event_travel_overrides',
        'calendar_id, external_id',
        travelOverrides.map((o) => ({ calendar_id: o.calendarId, external_id: o.externalId, travel_minutes: o.travelMinutes, remind_before_leave: o.remindBeforeLeave ? 1 : 0, updated_at: new Date(now).toISOString() })),
      ),
      ...upserts(
        db,
        'event_series_member_overrides',
        'calendar_id, series_id',
        seriesMemberOverrides.map((o) => ({ calendar_id: o.calendarId, series_id: o.seriesId, member_ids: JSON.stringify(o.memberIds), updated_at: new Date(now).toISOString() })),
      ),
      ...upserts(
        db,
        'event_series_category_overrides',
        'calendar_id, series_id',
        seriesCategoryOverrides.map((o) => ({ calendar_id: o.calendarId, series_id: o.seriesId, category_id: o.categoryId, updated_at: new Date(now).toISOString() })),
      ),
      ...upserts(
        db,
        'events',
        'id',
        events.map((e) => ({
          id: e.id,
          calendar_id: e.calendarId,
          title: e.title,
          start: e.start,
          end: e.end,
          all_day: e.allDay ? 1 : 0,
          location: e.location,
          description: e.description,
          rrule: e.rrule,
          member_ids: JSON.stringify(e.memberIds),
          category_id: e.categoryId,
          reminders: e.reminders ? JSON.stringify(e.reminders) : null,
          travel_minutes: e.travelMinutes,
          remind_before_leave: e.remindBeforeLeave ? 1 : 0,
          sync_source: e.syncSource,
          external_id: e.syncSource ? e.externalId : null,
          updated_at: new Date(now).toISOString(),
        })),
      ),
      ...upserts(
        db,
        'chores',
        'id',
        body.chores.map((ch, i) => ({
          id: ch.id,
          title: ch.title,
          emoji: ch.emoji,
          member_id: ch.memberId,
          points: ch.points,
          rrule: ch.rrule,
          due_date: ch.dueDate,
          due_time: ch.dueTime,
          active: ch.active ? 1 : 0,
          sort: ch.sort,
          created_at: stamp(i),
          // Only a list in this file can be the checklist; anything else would dangle.
          list_id: ch.listId && body.lists.some((l) => l.id === ch.listId) ? ch.listId : null,
          // Plugins aren't in the file; a link to one this server lacks just shows as unavailable.
          plugin_id: ch.pluginId ?? null,
          plugin_minutes: ch.pluginId ? ch.pluginMinutes ?? null : null,
          needs_approval: ch.needsApproval == null ? null : ch.needsApproval ? 1 : 0,
          approve_timed_play: ch.approveTimedPlay ? 1 : 0,
        })),
        { ...keepCreated, expr: { member_id: memberRef('member_id') } },
      ),
      // UNIQUE(chore_id, date) is the natural key (as in POST /chores/:id/complete); an existing tick keeps its id.
      ...upserts(
        db,
        'chore_completions',
        'chore_id, date',
        completions.map((cc) => ({ id: cc.id, chore_id: cc.choreId, date: cc.date, member_id: cc.memberId, completed_at: cc.completedAt, points_awarded: cc.pointsAwarded, status: cc.status })),
        {
          keep: ['id'],
          expr: {
            member_id: memberRef('member_id'),
            points_awarded: "COALESCE(j.value->>'points_awarded', (SELECT points FROM chores WHERE id = j.value->>'chore_id'), 0)",
          },
        },
      ),
      ...upserts(
        db,
        'lists',
        'id',
        body.lists.map((l) => ({
          id: l.id,
          name: l.name,
          emoji: l.emoji,
          color: l.color,
          kind: l.kind,
          member_ids: JSON.stringify(l.memberIds),
          group_by: l.groupBy,
          sort_by: l.sortBy,
          keep_checked: (l.keepChecked ?? l.kind !== 'todo') ? 1 : 0,
          sort: l.sort,
          archived: l.archived ? 1 : 0,
          created_at: l.createdAt,
        })),
        keepCreated,
      ),
      ...upserts(
        db,
        'list_items',
        'id',
        items.map((i) => ({
          id: i.id,
          list_id: i.listId,
          title: i.title,
          name_key: itemKey(i.title),
          notes: i.notes,
          quantity: i.quantity,
          store: i.store,
          category: i.category,
          aisle: i.aisle,
          member_id: i.memberId,
          due_date: i.dueDate,
          event_id: i.eventId,
          priority: i.priority,
          done: i.done ? 1 : 0,
          done_at: i.doneAt,
          done_by: i.doneBy,
          sort: i.sort,
          created_at: i.createdAt,
          updated_at: i.updatedAt,
        })),
        { ...keepCreated, expr: { member_id: memberRef('member_id') } },
      ),
      // Steps export without timestamps: a ticked one takes its item's doneAt, all take its createdAt.
      ...upserts(
        db,
        'list_item_steps',
        'id',
        steps.map((st) => ({ id: st.id, item_id: st.itemId, title: st.title, done: st.done ? 1 : 0, done_at: st.doneAt, sort: st.sort, created_at: st.createdAt })),
        keepCreated,
      ),
      ...upserts(db, 'list_groups', 'list_id, kind, name', groups.map((g) => ({ list_id: g.listId, kind: g.kind, name: g.name, sort: g.sort }))),
      ...upserts(
        db,
        'notes',
        'id',
        notes.map((n) => ({ id: n.id, target_type: n.targetType, target_id: n.targetId, member_id: n.memberId, body: n.body, created_at: n.createdAt, updated_at: n.updatedAt })),
        { keep: ['created_at', 'target_type', 'target_id'], expr: { member_id: memberRef('member_id') } },
      ),
      ...upserts(db, 'point_entries', 'id', pointEntries.map((e) => ({ id: e.id, member_id: e.memberId, amount: e.amount, reason: e.reason, ref: e.ref, at: e.at })), { keep: ['member_id'] }),
      ...upserts(db, 'member_sticker_packs', 'member_id, pack_id', stickerPacks.map((p) => ({ member_id: p.memberId, pack_id: p.packId, unlocked_at: p.unlockedAt }))),
      ...upserts(
        db,
        'scrapbook_stickers',
        'id',
        scrapbook.map((st) => ({ id: st.id, member_id: st.memberId, sticker: st.sticker, x: st.x, y: st.y, scale: st.scale, rotation: st.rotation, z: st.z, placed_at: st.placedAt })),
        { keep: ['member_id'] },
      ),
      ...upserts(
        db,
        'rewards',
        'id',
        body.rewards.map((r) => ({ id: r.id, title: r.title, emoji: r.emoji, cost: r.cost, member_ids: JSON.stringify(r.memberIds), needs_approval: r.needsApproval ? 1 : 0, limit_period: r.limit?.period ?? null, limit_count: r.limit?.count ?? null, active: r.active ? 1 : 0, sort: r.sort, created_at: r.createdAt })),
        keepCreated,
      ),
      ...upserts(
        db,
        'reward_redemptions',
        'id',
        redemptions.map((r) => ({ id: r.id, reward_id: r.rewardId, member_id: r.memberId, title: r.title, emoji: r.emoji, cost: r.cost, status: r.status, note: r.note, date: r.date, requested_at: r.requestedAt, decided_at: r.decidedAt, given_at: r.givenAt })),
        { keep: ['member_id'], expr: { reward_id: "(SELECT id FROM rewards WHERE id = j.value->>'reward_id')" } },
      ),
      ...upserts(
        db,
        'tracker_entries',
        'id',
        trackers.map((t) => ({ id: t.id, kind: t.kind, member_id: t.memberId, former_member: t.formerMember, date: t.date, title: t.title, photo_id: t.photoId, photo_own: t.photoOwned ? 1 : 0, data: JSON.stringify(t.data), created_at: t.createdAt, updated_at: t.updatedAt })),
        // Photos travel in their own zip: a photo not on this instance is dropped, not an FK error.
        { keep: ['created_at', 'kind'], expr: { photo_id: "(SELECT id FROM photos WHERE id = j.value->>'photo_id')" } },
      ),
      ...upserts(db, 'recipes', 'id', body.recipes.map((r) => ({ id: r.id, name: r.name, description: r.description, instructions: r.instructions, steps: r.steps ? JSON.stringify(r.steps) : null, preparation_notes: r.preparationNotes, source_url: r.sourceUrl, default_servings: r.defaultServings, prep_minutes: r.prepMinutes ?? null, total_minutes: r.totalMinutes ?? null, archived: r.archived ? 1 : 0, source: r.source ?? null, external_id: r.externalId ?? null, image_url: r.imageUrl ?? null, created_at: r.createdAt, updated_at: r.updatedAt })), keepCreated),
      // Replace each imported recipe's ingredient set, including intentionally empty sets.
      db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(body.recipes.map((r) => r.id))),
      ...upserts(db, 'recipe_ingredients', 'id', body.recipes.flatMap((r) => r.ingredients.map((i) => ({ id: i.id, recipe_id: r.id, name: i.name, normalized_name: normalizeIngredient(i.name), quantity: i.quantity, unit: i.unit, preparation: i.preparation, qualifier: i.qualifier, category: i.category, sort: i.sort })))),
      // Ratings by a member not on this instance are dropped, not an FK error.
      db.prepare("INSERT INTO recipe_ratings (recipe_id, member_id, stars) SELECT j.value->>'recipe_id', j.value->>'member_id', j.value->>'stars' FROM json_each(?) j WHERE j.value->>'member_id' IN (SELECT id FROM members) ON CONFLICT(recipe_id, member_id) DO UPDATE SET stars = excluded.stars")
        .bind(JSON.stringify(body.recipes.flatMap((r) => Object.entries(r.rating?.byMember ?? {}).map(([member_id, stars]) => ({ recipe_id: r.id, member_id, stars }))))),
      ...upserts(db, 'meals', 'id', body.meals.map((m) => ({ id: m.id, date: m.date, slot: m.slot, title: m.title, meal_kind: m.mealKind, recipe_id: m.recipeId, recipe_snapshot: m.recipeSnapshot ? JSON.stringify(m.recipeSnapshot) : null, servings: m.servings, assignee_member_id: m.assigneeMemberId, eater_ids: JSON.stringify(m.eaterIds ?? []), notes: m.notes, planned_time: m.plannedTime, calendar_event_id: m.calendarEventId, calendar_event_start: m.calendarEventId ? m.calendarEventStart ?? null : null, status: m.status, source_url: m.sourceUrl, created_at: m.createdAt, updated_at: m.updatedAt })), { ...keepCreated, expr: { recipe_id: "(SELECT id FROM recipes WHERE id = j.value->>'recipe_id')", assignee_member_id: memberRef('assignee_member_id') } }),
      ...upserts(db, 'meal_shopping_sources', 'list_id, source_ref', mealSources.map((s) => ({ list_id: s.listId, source_ref: s.sourceRef, item_id: s.itemId, fingerprint: s.fingerprint }))),
      // Newer knowledge wins: a remembered place only replaces one that is older.
      ...upserts(db, 'item_memory', 'name_key, store', body.itemMemory.map((m) => ({ name_key: m.nameKey, store: m.store, category: m.category, aisle: m.aisle, updated_at: m.updatedAt })), { where: 'excluded.updated_at > item_memory.updated_at' }),
      // A store's aisle order in the file replaces this instance's order for that store.
      db.prepare('DELETE FROM store_aisles WHERE store IN (SELECT value FROM json_each(?))').bind(JSON.stringify(body.storeAisles.map((a) => a.store))),
      ...upserts(db, 'store_aisles', 'store, aisle', body.storeAisles.flatMap((a) => [...new Set(a.aisles)].map((aisle, sort) => ({ store: a.store, aisle, sort })))),
      ...upserts(db, 'item_names', 'name_key', body.itemNames.map((n) => ({ name_key: n.nameKey, title: n.title, uses: n.uses, last_used: n.lastUsed })), { where: 'excluded.last_used > item_names.last_used' }),
    ];
    if (writes.length) await db.batch(writes);

    const changed: [BusEventType, number][] = [
      ['settings.changed', Object.keys(settings.data).length],
      ['member.changed', body.members.length],
      ['category.changed', body.categories.length],
      ['calendar.changed', calendars.length],
      ['events.changed', events.length + memberOverrides.length + categoryOverrides.length + travelOverrides.length + seriesMemberOverrides.length + seriesCategoryOverrides.length],
      ['chore.changed', body.chores.length + completions.length],
      ['list.changed', body.lists.length + notes.length + body.itemMemory.length + body.storeAisles.length],
      ['sticker.changed', pointEntries.length + stickerPacks.length + scrapbook.length],
      ['reward.changed', body.rewards.length + redemptions.length],
      ['tracker.changed', trackers.length],
      ['recipe.changed', body.recipes.length],
      ['meal.changed', body.meals.length],
    ];
    for (const [type, n] of changed) if (n > 0) emit(c, type, { imported: n });

    return c.json(
      {
        imported: {
          members: body.members.length,
          categories: body.categories.length,
          calendars: calendars.length,
          events: events.length,
          eventMemberOverrides: memberOverrides.length,
          eventCategoryOverrides: categoryOverrides.length,
          eventTravelOverrides: travelOverrides.length,
          eventSeriesMemberOverrides: seriesMemberOverrides.length,
          eventSeriesCategoryOverrides: seriesCategoryOverrides.length,
          chores: body.chores.length,
          choreCompletions: completions.length,
          lists: body.lists.length,
          listItems: items.length,
          listItemSteps: steps.length,
          notes: notes.length,
          pointEntries: pointEntries.length,
          stickerPacks: stickerPacks.length,
          scrapbook: scrapbook.length,
          rewards: body.rewards.length,
          rewardRedemptions: redemptions.length,
          trackers: trackers.length,
          recipes: body.recipes.length,
          meals: body.meals.length,
          mealShoppingSources: mealSources.length,
          itemMemory: body.itemMemory.length,
          storeAisles: body.storeAisles.length,
          itemNames: body.itemNames.length,
        },
        needsReconnect: (await db.prepare("SELECT id, kind, name FROM calendars WHERE kind != 'local' AND config = '' ORDER BY name").all<{ id: string; kind: string; name: string }>()).results,
        skipped: {
          passkeys: body.passkeys.length,
          webhooks: body.webhooks.length,
        },
      },
      200,
    );
  },
);

const HostEventSchema = z.object({ id: z.string(), at: z.string(), action: z.string(), detail: z.string().nullable() }).openapi('HostEvent');

dataRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/host-events',
    tags: ['System'],
    summary: 'Actions taken by whoever hosts this instance, newest first (last 100)',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(HostEventSchema) } } } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT id, at, action, detail FROM host_events ORDER BY at DESC LIMIT 100').all<z.infer<typeof HostEventSchema>>();
    return c.json(results, 200);
  },
);
