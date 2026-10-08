// "Your data": GET /api/export (everything the family entered, minus credentials), POST /api/import
// (merges an export back in) and GET /api/host-events (see host-events.ts). All admin-only -
// display keys are denied by default in auth.ts.
import { createRoute, z } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { createRouter } from '../router.ts';
import { emit, type BusEventType } from '../bus.ts';
import type { KinwallDb, KinwallStatement } from '../db.ts';
import type { Env } from '../env.ts';
import { RecipeSchema, MealSchema, RestaurantSchema } from '../meal-schemas.ts';
import { readRestaurants } from './restaurants.ts';
import { parseFilter } from '../calendar-filter.ts';
import { readRecipes, readMeals, normalizeIngredient } from '../meals.ts';
import { CATALOGS, itemKey, looksLikeGroceries, type Catalog } from '../item-memory.ts';
import { readSettings, settingsWrites } from './settings.ts';
import { toApi as categoryToApi } from './categories.ts';
import { toApi as choreToApi, type ChoreRow } from './chores.ts';
import { LibraryChoreSchema, type LibraryRow } from './chore-library.ts';
import { toLibraryApi, type LibraryRow as LibraryBookRow } from './library.ts';
import { toApi as listToApi, toItemApi, toGroupApi, groupSteps, type ListRow, type ListItemRow, type ListItemStepRow, type ListGroupRow } from './lists.ts';
import { toApi as webhookToApi, type WebhookRow } from './webhooks.ts';
import { toNoteApi, type NoteRow } from './notes.ts';
import { healthBlock, openRow, sealHealthEntries, sealRow, sealedTitle, SEALED_TITLE, toTrackerApi, type TrackerRow } from './trackers.ts';
import { toEntryApi, toPlacementApi, type PointEntryRow, type PlacementRow } from './stickers.ts';
import { toRewardApi, toRedemptionApi, type RewardRow, type RedemptionRow } from './rewards.ts';
import { parseMemberIds } from '../calendar-members.ts';
import { RECONNECT_MESSAGE } from '../sync.ts';
import { decryptConfig, encryptConfig } from '../crypto.ts';
import { isSafeFeedUrl } from '../outbound.ts';
import type { CategoryRow } from '../calendar-categories.ts';
import { grownUpChangeStmts, isAdultBirthday, kidRefusal, noteGrownUpChange, parseTempCheck, parseTransitions } from './members.ts';
import { journalOwner, privateNow, type PrivacyRow } from '../journal-privacy.ts';
import { isConnectedApp } from '../auth.ts';
import { DrainedSchema, FollowupSchema, openDrained, openTempCheck, readCustom, sealCustom, sealTempCheck, type TempCheckRow } from './temp-check.ts';
import { openEntry, sealEntry, type JournalRow } from './journal.ts';
import { DoseTimesSchema, LateWindowSchema, loadLogs, loadMedications, sealLog, sealMedication, type DoseLog } from './medications.ts';
import { fromRow as contactFromRow, type ContactRow } from './contacts.ts';
import { PollSchema, readPolls } from './polls.ts';
import {
  CalendarSchema,
  CalendarFilterSchema,
  CategorySchema,
  ContactCategorySchema,
  ContactSchema,
  ChoreSchema,
  ListGroupSchema,
  ListItemSchema,
  ListItemStepSchema,
  ActorSchema,
  ListSchema,
  ErrorSchema,
  BirthdaySchema,
  MemberSchema,
  TempCheckSettingsSchema,
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
  LibraryBookSchema,
} from '../schemas.ts';

export const dataRoutes = createRouter();

const EXPORT_VERSION = 1;

const ExportSchema = z
  .object({
    version: z.number(),
    exportedAt: z.string(),
    settings: SettingsSchema,
    members: z.array(MemberSchema.omit({ picture: true, pointsToday: true, pointsWeek: true, balance: true, rewardGoal: true, todayGoal: true, tempCheck: true, privateJournal: true }).extend({ tempCheck: TempCheckSettingsSchema.optional(), tempCheckFeelings: z.array(z.string()).default([]),  birthday: BirthdaySchema.nullable().default(null), grownUp: z.boolean().optional(), needsApproval: z.boolean().default(false), transitionReminders: TransitionRemindersSchema.optional(), rewardGoalId: z.string().nullable().default(null) })),
    categories: z.array(CategorySchema),
    contactCategories: z.array(ContactCategorySchema),
    contacts: z.array(ContactSchema),
    // Every calendar, but no config/credentials/account: synced ones are imported as placeholders
    // that keep their settings and are reconnected, and their events re-fetched.
    // ICS feeds also carry their url (the export is the family's own, admin-only file), so they come
    // back connected on import; provider accounts never do - those hold tokens and are reconnected.
    calendars: z.array(CalendarSchema.pick({ id: true, kind: true, name: true, color: true, remoteId: true, memberIds: true, categoryId: true, enabled: true }).extend({ url: z.string().url().optional(), displayEdit: z.boolean().optional(), filter: CalendarFilterSchema.optional() })),
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
        busy: z.boolean().default(true),
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
    // Events hidden one by one or by series (0069), keyed like the overrides above.
    hiddenEvents: z.array(z.object({ calendarId: z.string(), scope: z.enum(['occurrence', 'series']), key: z.string(), title: z.string(), start: z.string(), allDay: z.boolean() })),
    // listId: exports before 0027 lack it; pluginId/pluginMinutes before 0033.
    // needsApproval/approveTimedPlay before 0037.
    chores: z.array(ChoreSchema.extend({ libraryId: z.string().nullable().default(null), listId: z.string().nullable().optional(), pluginId: z.string().nullable().optional(), pluginMinutes: z.number().nullable().optional(), needsApproval: z.boolean().nullable().default(null), approveTimedPlay: z.boolean().default(false), archived: z.boolean().default(false) })), // archived: deleted after it was done, kept for its history
    // The chore library (0082): saved chores to hand out. Older exports predate it.
    choreLibrary: z.array(LibraryChoreSchema.pick({ id: true, title: true, emoji: true, points: true, listId: true, memberId: true, everyN: true, everyUnit: true, needsApproval: true, notes: true, createdAt: true })),
    // pointsAwarded: older exports predate it - null imports as the chore's full points.
    choreCompletions: z.array(z.object({ id: z.string(), choreId: z.string(), date: z.string(), memberId: z.string().nullable(), completedAt: z.string(), pointsAwarded: z.number().nullable().default(null), status: z.enum(['approved', 'pending']).default('approved') })),
    lists: z.array(
      ListSchema.extend({
        sortBy: ListSchema.shape.sortBy.default('manual'), // older exports predate it
        keepChecked: z.boolean().optional(), // older exports: the kind's default (0040)
        catalog: z.enum(CATALOGS).nullable().optional(), // older exports predate list types (0076): see catalogsFor
        isDefault: z.boolean().default(false), // older exports predate default lists (0088)
        overdueCount: z.number().optional(), // computed, and older exports predate it
        itemsRev: z.number().optional(), // computed, and older exports predate it
        lastDoneAt: z.string().nullable().default(null), // older exports predate who-did-what (0078)
        lastDoneBy: ActorSchema.nullable().default(null),
        items: z.array(
          // Older exports predate event links, priority, steps and aisles.
          ListItemSchema.omit({ meals: true }).extend({
            aisle: z.string().nullable().default(null),
            forMemberIds: z.array(z.string()).default([]), // older exports predate it (0108)
            eventId: z.string().nullable().default(null),
            priority: ListItemSchema.shape.priority.default('normal'),
            steps: z.array(ListItemStepSchema.extend({ addedBy: ActorSchema.nullable().default(null), checkedBy: ActorSchema.nullable().default(null) })).default([]),
            addedBy: ActorSchema.nullable().default(null),
            checkedBy: ActorSchema.nullable().default(null),
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
    // Daily check-ins (0053), one per member per day; the points they earned are in pointEntries.
    checkIns: z.array(z.object({ memberId: z.string(), date: z.string(), points: z.number(), at: z.string() })),
    // Temp check answers (0054), one per member per day. sleep/feelings are opened here (sealed again on import);
    // null for a connected app without aiHealthAccess. A private day's goal-check notes (0063) are left out
    // (the outcome stays); importing never replaces a private day's notes.
    tempChecks: z.array(z.object({ memberId: z.string(), date: z.string(), sleep: z.string().nullable(), feelings: z.array(z.string()).nullable(), goal: z.string().nullable(), goalSkipped: z.boolean(), followup: FollowupSchema.nullable().default(null), drained: DrainedSchema.nullable().default(null), private: z.boolean().default(false), createdAt: z.string(), updatedAt: z.string() })),
    // Journal entries (0055): opened here, sealed again on import; none for a connected app without aiHealthAccess.
    // A private entry's text (0063) is never exported (null; the mood and day stay), for anyone; importing
    // never overwrites a private entry, and brings a missing one back without its words.
    journalEntries: z.array(z.object({ id: z.string(), memberId: z.string(), date: z.string(), text: z.string().nullable(), mood: z.string().nullable(), private: z.boolean().default(false), createdAt: z.string(), updatedAt: z.string() })),
    // Medications (0056) and each dose marked or snoozed: opened here (the family's own backup), sealed again on
    // import; none for a connected app without aiHealthAccess.
    medications: z.array(z.object({ id: z.string(), memberId: z.string(), name: z.string().min(1), dose: z.string(), times: DoseTimesSchema, days: z.array(z.number().int().min(0).max(6)).min(1), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), totalDoses: z.number().int().min(1).max(1000).nullable().default(null), lateWindow: LateWindowSchema.default('3h'), createdAt: z.string(), updatedAt: z.string() })),
    medicationLog: z.array(z.object({ medicationId: z.string(), date: z.string(), time: z.string(), status: z.enum(['taken', 'skipped']).nullable(), at: z.string().nullable(), by: z.string().nullable(), snoozedUntil: z.string().nullable(), startedAt: z.string().nullable().default(null) })),
    scrapbook: z.array(StickerPlacementSchema),
    // Rewards (0039) and their redemptions; the points they took are in pointEntries.
    rewards: z.array(RewardSchema.omit({ used: true })),
    rewardRedemptions: z.array(RedemptionSchema),
    trackers: z.array(TrackerEntrySchema), // reading log, memories, health visits (0031)
    recipes: z.array(RecipeSchema),
    meals: z.array(MealSchema),
    // The restaurant binder (0100), each with its menu.
    restaurants: z.array(RestaurantSchema),
    // Family polls (0102), each with its choices and who voted for what.
    polls: z.array(PollSchema),
    mealShoppingSources: z.array(z.object({ listId: z.string(), sourceRef: z.string(), itemId: z.string(), fingerprint: z.string() })),
    // Where the household keeps things (0040): the store/category/aisle last used per item name
    // (nameKey is the matching key, store '' = none), and stores' aisle walking orders.
    // catalog (0076): which list type's catalog; older exports predate it (see catalogsFor).
    itemMemory: z.array(z.object({ catalog: z.enum(CATALOGS).optional(), nameKey: z.string(), store: z.string(), category: z.string().nullable(), aisle: z.string().nullable(), updatedAt: z.string() })),
    storeAisles: z.array(z.object({ store: z.string(), aisles: z.array(z.string()) })),
    // Names to autocomplete on shopping lists (0041): the spelling last used and how often.
    itemNames: z.array(z.object({ catalog: z.enum(CATALOGS).optional(), nameKey: z.string(), title: z.string(), uses: z.number(), lastUsed: z.string() })),
    // The family's library (migration 0089); readers come from the trackers' bookId.
    libraryBooks: z.array(LibraryBookSchema.omit({ readers: true })),
    // A scanned product's name, per catalog (migration 0085).
    itemBarcodes: z.array(z.object({ catalog: z.enum(CATALOGS), barcode: z.string().regex(/^\d{8,14}$/), title: z.string().min(1), updatedAt: z.string() })),
    // Grocery catalog categories (0070): the family's own groupings per item name, in order.
    itemTags: z.array(z.object({ catalog: z.enum(CATALOGS).optional(), nameKey: z.string(), tag: z.string() })),
    passkeys: z.array(z.object({ name: z.string(), createdAt: z.string() })),
    webhooks: z.array(WebhookSchema),
  })
  .openapi('Export');

type MemberRow = { id: string; name: string; color: string; avatar: string | null; birthday: string | null; sort: number; grown_up: number; needs_approval: number; transitions: string | null; reward_goal: string | null; temp_check: string | null; temp_check_feelings: string | null };
type CalendarRow = { id: string; kind: z.infer<typeof CalendarSchema>['kind']; remote_id: string | null; name: string; color: string | null; member_ids: string; category_id: string | null; enabled: number; display_edit: number; filter: string | null };
type EventRow = {
  id: string; calendar_id: string; title: string; start: string; end: string; all_day: number; location: string | null;
  description: string | null; rrule: string | null; member_ids: string; category_id: string | null; reminders: string | null;
  travel_minutes: number | null; remind_before_leave: number; sync_source: string | null; external_id: string | null; busy: number;
};
type CompletionRow = { id: string; chore_id: string; date: string; member_id: string | null; completed_at: string; points_awarded: number | null; status: 'approved' | 'pending' };
type ContactCategoryRow = { id: string; name: string; color: string | null; sort: number; created_at: string; updated_at: string };

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
    summary: 'Download everything the family entered as JSON (no credentials, secrets or synced events; no health entries for a connected app without aiHealthAccess)',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: ExportSchema } } } },
  }),
  async (c) => {
    const db = c.env.DB;
    const healthHidden = !!(await healthBlock(c));
    // Column lists are explicit (never SELECT *) so a secret column can't leak in by accident.
    const [members, categories, contactCategories, contacts, calendars, events, memberOverrides, categoryOverrides, travelOverrides, seriesMemberOverrides, seriesCategoryOverrides, chores, completions, lists, items, steps, groups, notes, pointEntries, stickerPacks, checkIns, tempChecks, journal, scrapbook, rewards, redemptions, trackers, passkeys, webhooks, hiddenEvents] = (await db.batch<unknown>([
      db.prepare('SELECT id, name, color, avatar, birthday, sort, grown_up, needs_approval, transitions, reward_goal, temp_check, temp_check_feelings FROM members ORDER BY sort, created_at'),
      db.prepare('SELECT id, name, emoji, color, keywords, sort, created_at FROM categories ORDER BY sort, created_at'),
      db.prepare('SELECT id, name, color, sort, created_at, updated_at FROM contact_categories ORDER BY sort, name COLLATE NOCASE, id'),
      db.prepare('SELECT id, kind, name, organization, title, given_name, family_name, nickname, relationship, favorite, emergency, phones, emails, addresses, websites, dates, notes, category_ids, tags, member_ids, service_hours, service_area, always_open, wall_visible, emergency_visible, phone_visible_on_wall, address_visible_on_wall, visibility, selected_member_ids, source_metadata, private_fields, created_at, updated_at FROM contacts ORDER BY name COLLATE NOCASE, id'),
      db.prepare('SELECT id, kind, remote_id, name, color, member_ids, category_id, enabled, display_edit, filter, config FROM calendars ORDER BY name'),
      db.prepare(
        `SELECT e.id, e.calendar_id, e.title, e.start, e.end, e.all_day, e.location, e.description, e.rrule, e.member_ids, e.category_id, e.reminders, e.travel_minutes, e.remind_before_leave, e.sync_source, e.external_id, e.busy
         FROM events e JOIN calendars c ON c.id = e.calendar_id WHERE c.kind = 'local' ORDER BY e.start`,
      ),
      db.prepare('SELECT calendar_id, external_id, member_ids FROM event_member_overrides ORDER BY calendar_id, external_id'),
      db.prepare('SELECT calendar_id, external_id, category_id FROM event_category_overrides ORDER BY calendar_id, external_id'),
      db.prepare('SELECT calendar_id, external_id, travel_minutes, remind_before_leave FROM event_travel_overrides ORDER BY calendar_id, external_id'),
      db.prepare('SELECT calendar_id, series_id, member_ids FROM event_series_member_overrides ORDER BY calendar_id, series_id'),
      db.prepare('SELECT calendar_id, series_id, category_id FROM event_series_category_overrides ORDER BY calendar_id, series_id'),
      db.prepare('SELECT id, title, emoji, member_id, points, rrule, due_date, due_time, active, sort, created_at, list_id, plugin_id, plugin_minutes, needs_approval, approve_timed_play, archived, library_id FROM chores ORDER BY sort, created_at'),
      db.prepare('SELECT id, chore_id, date, member_id, completed_at, points_awarded, status FROM chore_completions ORDER BY date'),
      db.prepare('SELECT id, name, emoji, color, kind, member_ids, group_by, sort_by, keep_checked, catalog, is_default, sort, archived, created_at, last_done_at, last_done_by, last_done_by_label FROM lists ORDER BY sort, created_at'),
      db.prepare(
        'SELECT id, list_id, title, notes, quantity, store, category, aisle, member_id, for_member_ids, due_date, event_id, priority, done, done_at, done_by, done_by_label, added_by, added_by_label, sort, created_at, updated_at FROM list_items ORDER BY sort, created_at',
      ),
      db.prepare('SELECT id, item_id, title, done, done_at, sort, created_at, added_by, added_by_label, done_by, done_by_label FROM list_item_steps ORDER BY sort, created_at'),
      db.prepare('SELECT list_id, kind, name, sort FROM list_groups ORDER BY sort'),
      db.prepare(
        `SELECT n.id, n.target_type, n.target_id, n.member_id, n.body, n.created_at, n.updated_at FROM notes n
         WHERE (n.target_type = 'list_item' AND n.target_id IN (SELECT id FROM list_items))
            OR (n.target_type = 'event' AND n.target_id IN (SELECT e.id FROM events e JOIN calendars c ON c.id = e.calendar_id WHERE c.kind = 'local'))
         ORDER BY n.target_type, n.target_id, n.created_at, n.id`,
      ),
      db.prepare('SELECT id, member_id, amount, reason, ref, at, note FROM point_entries ORDER BY at, id'),
      db.prepare('SELECT member_id, pack_id, unlocked_at FROM member_sticker_packs ORDER BY member_id, pack_id'),
      db.prepare('SELECT member_id, date, points, at FROM check_ins ORDER BY date, member_id'),
      db.prepare('SELECT member_id, date, sleep, feelings, goal, goal_skipped, followup, drained, private, created_at, updated_at FROM temp_checks ORDER BY date, member_id'),
      db.prepare('SELECT id, member_id, date, text, mood, private, created_at, updated_at FROM journal_entries ORDER BY date, created_at, id'),
      db.prepare('SELECT id, member_id, sticker, x, y, scale, rotation, z, placed_at FROM scrapbook_stickers ORDER BY member_id, z, placed_at, id'),
      db.prepare('SELECT id, title, emoji, cost, member_ids, needs_approval, limit_period, limit_count, active, sort, created_at FROM rewards ORDER BY sort, created_at'),
      db.prepare('SELECT id, reward_id, member_id, title, emoji, cost, status, note, date, requested_at, decided_at, given_at FROM reward_redemptions ORDER BY requested_at, id'),
      db.prepare('SELECT t.*, p.family AS photo_family FROM tracker_entries t LEFT JOIN photos p ON p.id = t.photo_id ORDER BY t.date, t.created_at'),
      db.prepare('SELECT name, created_at FROM passkeys ORDER BY created_at'),
      db.prepare('SELECT id, url, events, enabled, created_at FROM webhooks ORDER BY created_at'),
      db.prepare('SELECT calendar_id, scope, key, title, start, all_day FROM event_hidden ORDER BY calendar_id, start, key'),
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
        settings: (({ googlePhotos: _, ...settings }) => settings)(await readSettings(db)), // a connection, not a setting
        members: await Promise.all((members as MemberRow[]).map(async ({ id, name, color, avatar, birthday, sort, grown_up, needs_approval, transitions, reward_goal, temp_check, temp_check_feelings }) => ({
          id, name, color, avatar, birthday, sort, grownUp: !!grown_up, needsApproval: !!needs_approval, transitionReminders: parseTransitions(transitions), rewardGoalId: reward_goal,
          tempCheck: parseTempCheck(temp_check), tempCheckFeelings: healthHidden ? [] : await readCustom(c.env, id, temp_check_feelings),
        }))),
        categories: (categories as CategoryRow[]).map(categoryToApi),
        contactCategories: (contactCategories as ContactCategoryRow[]).map((r) => ({ id: r.id, name: r.name, color: r.color, sort: r.sort, createdAt: r.created_at, updatedAt: r.updated_at })),
        contacts: (contacts as ContactRow[]).map(contactFromRow),
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
          filter: parseFilter(r.filter),
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
          busy: r.busy !== 0,
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
        hiddenEvents: (hiddenEvents as { calendar_id: string; scope: 'occurrence' | 'series'; key: string; title: string; start: string; all_day: number }[]).map((r) => ({
          calendarId: r.calendar_id, scope: r.scope, key: r.key, title: r.title, start: r.start, allDay: !!r.all_day,
        })),
        chores: (chores as ChoreRow[]).map((r) => ({ ...choreToApi(r), archived: !!r.archived })),
        choreLibrary: (await db.prepare('SELECT id, title, emoji, points, list_id, member_id, every_n, every_unit, needs_approval, notes, created_at FROM chore_library ORDER BY created_at, id').all<LibraryRow>()).results.map((r) => ({
          id: r.id, title: r.title, emoji: r.emoji, points: r.points, listId: r.list_id, memberId: r.member_id, everyN: r.every_n, everyUnit: r.every_unit, needsApproval: r.needs_approval == null ? null : !!r.needs_approval, notes: r.notes, createdAt: r.created_at,
        })),
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
        checkIns: (checkIns as { member_id: string; date: string; points: number; at: string }[]).map((r) => ({ memberId: r.member_id, date: r.date, points: r.points, at: r.at })),
        tempChecks: await Promise.all((tempChecks as TempCheckRow[]).map(async (r) => {
          const opened = async () => { const { followupHidden: _, ...t } = await openTempCheck(c.env, r, false); return { ...t, drained: await openDrained(c.env, r) }; };
          const v = healthHidden ? { sleep: null, feelings: null, goal: r.goal, goalSkipped: !!r.goal_skipped, followup: null, drained: null } : await opened();
          return { memberId: r.member_id, date: r.date, ...v, private: !!r.private, createdAt: r.created_at, updatedAt: r.updated_at };
        })),
        journalEntries: healthHidden ? [] : await Promise.all((journal as JournalRow[]).map((r) => openEntry(c.env, r, false))), // never a private entry's words
        ...(healthHidden ? { medications: [], medicationLog: [] } : await exportMedications(c.env)),
        scrapbook: (scrapbook as PlacementRow[]).map(toPlacementApi),
        rewards: (rewards as RewardRow[]).map(toRewardApi),
        rewardRedemptions: (redemptions as RedemptionRow[]).map(toRedemptionApi),
        // opened: the export is the family's own backup; a connected app without aiHealthAccess gets no health
        trackers: (await Promise.all((trackers as TrackerRow[]).filter((r) => r.kind !== 'health' || !healthHidden).map((r) => openRow(c.env, r)))).map(toTrackerApi),
        recipes: await readRecipes(db, { archived: true }),
        meals: await readMeals(db, '0000-01-01', '9999-12-31'),
        restaurants: await readRestaurants(db, { archived: true }),
        polls: await readPolls(db),
        mealShoppingSources: (await db.prepare('SELECT list_id, source_ref, item_id, fingerprint FROM meal_shopping_sources ORDER BY list_id, source_ref').all<{ list_id: string; source_ref: string; item_id: string; fingerprint: string }>()).results.map((r) => ({ listId: r.list_id, sourceRef: r.source_ref, itemId: r.item_id, fingerprint: r.fingerprint })),
        itemMemory: (await db.prepare('SELECT catalog, name_key, store, category, aisle, updated_at FROM item_memory ORDER BY catalog, name_key, store').all<{ catalog: Catalog; name_key: string; store: string; category: string | null; aisle: string | null; updated_at: string }>()).results
          .map((r) => ({ catalog: r.catalog, nameKey: r.name_key, store: r.store, category: r.category, aisle: r.aisle, updatedAt: r.updated_at })),
        itemNames: (await db.prepare('SELECT catalog, name_key, title, uses, last_used FROM item_names ORDER BY catalog, name_key').all<{ catalog: Catalog; name_key: string; title: string; uses: number; last_used: string }>()).results
          .map((r) => ({ catalog: r.catalog, nameKey: r.name_key, title: r.title, uses: r.uses, lastUsed: r.last_used })),
        libraryBooks: (await db.prepare('SELECT * FROM library_books ORDER BY title COLLATE NOCASE, created_at').all<LibraryBookRow>()).results.map((r) => { const { readers: _, ...b } = toLibraryApi(r); return b; }),
        itemBarcodes: (await db.prepare('SELECT catalog, barcode, title, updated_at FROM item_barcodes ORDER BY catalog, barcode').all<{ catalog: Catalog; barcode: string; title: string; updated_at: string }>()).results
          .map((r) => ({ catalog: r.catalog, barcode: r.barcode, title: r.title, updatedAt: r.updated_at })),
        itemTags: (await db.prepare('SELECT catalog, name_key, tag FROM item_tags ORDER BY catalog, name_key, sort').all<{ catalog: Catalog; name_key: string; tag: string }>()).results
          .map((r) => ({ catalog: r.catalog, nameKey: r.name_key, tag: r.tag })),
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
  contactCategories: ExportSchema.shape.contactCategories.default([]),
  contacts: ExportSchema.shape.contacts.default([]),
  eventMemberOverrides: ExportSchema.shape.eventMemberOverrides.default([]),
  eventCategoryOverrides: ExportSchema.shape.eventCategoryOverrides.default([]),
  eventTravelOverrides: ExportSchema.shape.eventTravelOverrides.default([]),
  eventSeriesMemberOverrides: ExportSchema.shape.eventSeriesMemberOverrides.default([]),
  eventSeriesCategoryOverrides: ExportSchema.shape.eventSeriesCategoryOverrides.default([]),
  hiddenEvents: ExportSchema.shape.hiddenEvents.default([]),
  notes: ExportSchema.shape.notes.default([]),
  pointEntries: ExportSchema.shape.pointEntries.default([]),
  stickerPacks: ExportSchema.shape.stickerPacks.default([]),
  checkIns: ExportSchema.shape.checkIns.default([]),
  tempChecks: ExportSchema.shape.tempChecks.default([]),
  journalEntries: ExportSchema.shape.journalEntries.default([]),
  medications: ExportSchema.shape.medications.default([]),
  medicationLog: ExportSchema.shape.medicationLog.default([]),
  scrapbook: ExportSchema.shape.scrapbook.default([]),
  rewards: ExportSchema.shape.rewards.default([]),
  choreLibrary: ExportSchema.shape.choreLibrary.default([]),
  rewardRedemptions: ExportSchema.shape.rewardRedemptions.default([]),
  trackers: ExportSchema.shape.trackers.default([]),
  recipes: ExportSchema.shape.recipes.default([]),
  meals: ExportSchema.shape.meals.default([]),
  restaurants: ExportSchema.shape.restaurants.default([]),
  polls: ExportSchema.shape.polls.default([]),
  mealShoppingSources: ExportSchema.shape.mealShoppingSources.default([]),
  itemMemory: ExportSchema.shape.itemMemory.default([]),
  storeAisles: ExportSchema.shape.storeAisles.default([]),
  itemNames: ExportSchema.shape.itemNames.default([]),
  itemBarcodes: ExportSchema.shape.itemBarcodes.default([]),
  libraryBooks: ExportSchema.shape.libraryBooks.default([]),
  itemTags: ExportSchema.shape.itemTags.default([]),
}).openapi('Import');

const ImportResultSchema = z
  .object({
    imported: z.object({
      members: z.number(),
      categories: z.number(),
      contactCategories: z.number(),
      contacts: z.number(),
      calendars: z.number(),
      events: z.number(),
      eventMemberOverrides: z.number(),
      eventCategoryOverrides: z.number(),
      eventTravelOverrides: z.number(),
      eventSeriesMemberOverrides: z.number(),
      eventSeriesCategoryOverrides: z.number(),
      hiddenEvents: z.number(),
      chores: z.number(),
      choreCompletions: z.number(),
      choreLibrary: z.number(),
      lists: z.number(),
      listItems: z.number(),
      listItemSteps: z.number(),
      notes: z.number(),
      pointEntries: z.number(),
      stickerPacks: z.number(),
      checkIns: z.number(),
      tempChecks: z.number(),
      journalEntries: z.number(),
      medications: z.number(),
      medicationLog: z.number(),
      scrapbook: z.number(),
      rewards: z.number(),
      rewardRedemptions: z.number(),
      trackers: z.number(),
      recipes: z.number(),
      meals: z.number(),
      restaurants: z.number(),
      polls: z.number(),
      mealShoppingSources: z.number(),
      itemMemory: z.number(),
      storeAisles: z.number(),
      itemNames: z.number(),
      itemBarcodes: z.number(),
      libraryBooks: z.number(),
      itemTags: z.number(),
    }),
    // Synced calendars waiting to be reconnected (imported placeholders, from this or an earlier import).
    needsReconnect: z.array(z.object({ id: z.string(), kind: z.string(), name: z.string() })),
    // grownUp: members the file marks as kids who stay grown-ups (PATCH /api/members/{id} would refuse it).
    skipped: z.object({ passkeys: z.number(), webhooks: z.number(), grownUp: z.array(z.object({ id: z.string(), name: z.string() })) }),
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

type ImportBody = z.infer<typeof ImportSchema>;
/** Each list's type and each remembered row's catalog. A file from before list types (0076: no
 * catalog anywhere) gets the migration's rules: a shopping list is Groceries when named like
 * groceries, when meals were added to it, or when it's the file's only shopping list; a remembered
 * name goes to the grocery catalog unless it's only on Shopping lists, and to the shopping catalog
 * too when it's on one. */
export function catalogsFor(body: Pick<ImportBody, 'lists' | 'mealShoppingSources' | 'itemMemory' | 'itemNames' | 'itemTags'>) {
  const legacy = !body.lists.some((l) => l.catalog) && ![...body.itemMemory, ...body.itemNames, ...body.itemTags].some((r) => r.catalog);
  const shopping = body.lists.filter((l) => l.kind === 'shopping');
  const meals = new Set(body.mealShoppingSources.map((s) => s.listId));
  const list = (l: ImportBody['lists'][number]): Catalog | null =>
    l.kind !== 'shopping' ? null : !legacy ? (l.catalog ?? 'groceries') : looksLikeGroceries(l.name) || meals.has(l.id) || shopping.length === 1 ? 'groceries' : 'shopping';
  const onType = (cat: Catalog) => new Set(shopping.filter((l) => list(l) === cat).flatMap((l) => l.items.map((i) => itemKey(i.title))));
  const onGroceries = onType('groceries'), onShopping = onType('shopping');
  const rows = <T extends { catalog?: Catalog; nameKey: string }>(rs: T[]): (T & { catalog: Catalog })[] =>
    legacy
      ? rs.flatMap((r) => [
          ...(onShopping.has(r.nameKey) && !onGroceries.has(r.nameKey) ? [] : [{ ...r, catalog: 'groceries' as const }]),
          ...(onShopping.has(r.nameKey) ? [{ ...r, catalog: 'shopping' as const }] : []),
        ])
      : rs.map((r) => ({ ...r, catalog: r.catalog ?? 'groceries' }));
  return { list, rows };
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
    const hiddenEvents = body.hiddenEvents.filter((h) => calendarIds.has(h.calendarId));
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
    const checkIns = body.checkIns.filter((ci) => fileMembers.has(ci.memberId));
    const scrapbook = body.scrapbook.filter((st) => fileMembers.has(st.memberId));
    const redemptions = body.rewardRedemptions.filter((r) => fileMembers.has(r.memberId));
    // A member's entries only with that member (they're personal); the family's and removed members' always.
    // A connected app without aiHealthAccess neither adds health entries nor overwrites one by id, nor turns the switch on.
    const healthHidden = !!(await healthBlock(c));
    const healthIds = healthHidden ? new Set((await db.prepare("SELECT id FROM tracker_entries WHERE kind = 'health'").all<{ id: string }>()).results.map((r) => r.id)) : new Set<string>();
    const trackers = body.trackers.filter((t) => (t.memberId === null || fileMembers.has(t.memberId)) && !(healthHidden && (t.kind === 'health' || healthIds.has(t.id))));
    if (trackers.some((t) => sealedTitle(t.title))) return c.json({ error: `trackers: ${SEALED_TITLE.error}` }, 400);
    if (healthHidden) for (const k of ['aiHealthAccess', 'medications', 'medicationNamesOnWalls'] as const) delete settings.data[k];
    // Temp checks likewise (sleep and feelings are health): none from a connected app without aiHealthAccess.
    const tempChecks = healthHidden ? [] : body.tempChecks.filter((t) => fileMembers.has(t.memberId));
    // Who is here already. A journal that's private now takes entries only from its owner's device,
    // as POST /api/members/{id}/journal does: an import can't add to it or change what's in it.
    const here = new Map((await db.prepare('SELECT id, name, grown_up, journal_private, journal_private_allowed FROM members').all<PrivacyRow & { id: string }>()).results.map((m) => [m.id, m]));
    const mine = await journalOwner(c);
    const closed = new Set([...here.values()].filter((m) => privateNow(m) && m.id !== mine).map((m) => m.id));
    const journalEntries = healthHidden ? [] : body.journalEntries.filter((e) => fileMembers.has(e.memberId) && !closed.has(e.memberId));
    const medications = healthHidden ? [] : body.medications.filter((m) => fileMembers.has(m.memberId));
    const medIds = new Set(medications.map((m) => m.id));
    const medicationLog = body.medicationLog.filter((d) => medIds.has(d.medicationId));
    const mealSources = body.mealShoppingSources.filter((s) => items.some((i) => i.id === s.itemId && i.listId === s.listId));
    const catalogs = catalogsFor(body);
    const steps = items.flatMap((i) => i.steps.map((st) => ({ ...st, itemId: i.id, doneAt: st.done ? (i.doneAt ?? new Date().toISOString()) : null, createdAt: i.createdAt })));

    // Members and chores have no createdAt in the export; stamp new rows 1 ms apart in file order so
    // their created_at tie-break keeps the exported order.
    const now = Date.now();
    const stamp = (i: number) => new Date(now + i).toISOString();
    const keepCreated = { keep: ['created_at'] };
    // Files from before grown-ups: 18+ by a birthday with a year counts as one (as migration 0051).
    const today = new Date().toISOString().slice(0, 10);
    // Who is a grown-up changes who reads a journal: a connected app's import leaves it as it is for
    // members already here, and anyone else's change is logged and noted (routes/members.ts).
    // Marking a grown-up as a kid follows PATCH's rule (kidRefusal): when refused they stay a grown-up
    // and the rest of the file still comes in (skipped.grownUp).
    const app = await isConnectedApp(c);
    const asFiled = (m: (typeof body.members)[number]) => m.grownUp ?? isAdultBirthday(m.birthday, today);
    const keptGrownUp: { id: string; name: string }[] = [];
    for (const m of body.members) {
      const was = here.get(m.id);
      if (!app && was?.grown_up && !asFiled(m) && (await kidRefusal(c, was))) keptGrownUp.push({ id: m.id, name: was.name });
    }
    const kept = new Set(keptGrownUp.map((m) => m.id));
    const grownUp = (m: (typeof body.members)[number]) => ((app || kept.has(m.id)) && here.has(m.id) ? !!here.get(m.id)!.grown_up : asFiled(m));
    const flips = body.members.filter((m) => here.has(m.id) && grownUp(m) !== !!here.get(m.id)!.grown_up);
    const privateAs = new Map(body.members.map((m) => [m.id, grownUp(m) ? 2 : 1])); // journal-privacy.ts privateLevel
    // Health entries are sealed again before anything is written (no key: the import fails, nothing stored).
    // Private journal days and entries already here are never overwritten (the file can't have their words).
    const [privateDays, privateEntries] = (await db.batch<unknown>([
      db.prepare('SELECT member_id, date, followup, private FROM temp_checks WHERE private != 0'),
      db.prepare('SELECT id FROM journal_entries WHERE private != 0 OR member_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...closed])),
    ])).map((r) => r.results);
    const keptNotes = new Map((privateDays as { member_id: string; date: string; followup: string | null; private: number }[]).map((r) => [`${r.member_id}:${r.date}`, r]));
    const keptEntries = new Set((privateEntries as { id: string }[]).map((r) => r.id));
    const sealedTempChecks = await Promise.all(tempChecks.map(async (t) => {
      const kept = keptNotes.get(`${t.memberId}:${t.date}`);
      const sealed = await sealTempCheck(c.env, t.memberId, t.date, t);
      return { member_id: t.memberId, date: t.date, ...sealed, followup: kept ? kept.followup : sealed.followup, private: kept ? kept.private : t.private ? privateAs.get(t.memberId)! : 0, goal: t.goal, goal_skipped: t.goalSkipped ? 1 : 0, created_at: t.createdAt, updated_at: t.updatedAt };
    }));
    const sealedJournal = await Promise.all(journalEntries.filter((e) => !keptEntries.has(e.id)).map((e) =>
      sealEntry(c.env, { id: e.id, member_id: e.memberId, date: e.date, text: e.text ?? '', mood: e.mood, private: e.private || e.text === null ? privateAs.get(e.memberId)! : 0, created_at: e.createdAt, updated_at: e.updatedAt })));
    const logDays = new Map<string, { medicationId: string; date: string; log: DoseLog }>();
    for (const d of medicationLog) {
      const day = logDays.get(`${d.medicationId}:${d.date}`) ?? logDays.set(`${d.medicationId}:${d.date}`, { medicationId: d.medicationId, date: d.date, log: {} }).get(`${d.medicationId}:${d.date}`)!;
      day.log[d.time] = { ...(d.startedAt ? { startedAt: d.startedAt } : {}), ...(d.status ? { status: d.status, ...(d.at ? { at: d.at } : {}), ...(d.by ? { by: d.by } : {}) } : d.snoozedUntil ? { snoozedUntil: d.snoozedUntil } : {}) };
    }
    const sealedMeds = await Promise.all(medications.map(async (m) => ({ id: m.id, member_id: m.memberId, data: await sealMedication(c.env, m), created_at: m.createdAt, updated_at: m.updatedAt })));
    const sealedLog = await Promise.all([...logDays.values()].map(async (d) => ({ medication_id: d.medicationId, date: d.date, log: await sealLog(c.env, d.medicationId, d.date, d.log), updated_at: d.date })));
    const memberFeelings = new Map(healthHidden ? [] : await Promise.all(body.members.map(async (m) => [m.id, await sealCustom(c.env, m.id, m.tempCheckFeelings)] as const)));
    const sealedTrackers = await Promise.all(trackers.map((t) => sealRow(c.env, { id: t.id, kind: t.kind, member_id: t.memberId, former_member: t.formerMember, date: t.date, title: t.title, photo_id: t.photoId, photo_own: t.photoOwned ? 1 : 0, data: JSON.stringify(t.data), created_at: t.createdAt, updated_at: t.updatedAt })));
    const writes = [
      ...settingsWrites(db, settings.data),
      ...upserts(db, 'members', 'id', body.members.map((m, i) => ({ id: m.id, name: m.name, color: m.color, avatar: m.avatar, birthday: m.birthday, sort: m.sort, grown_up: grownUp(m) ? 1 : 0, needs_approval: m.needsApproval && !grownUp(m) ? 1 : 0, transitions: m.transitionReminders ? JSON.stringify(m.transitionReminders) : null, reward_goal: m.rewardGoalId, temp_check: m.tempCheck ? JSON.stringify(m.tempCheck) : null, ...(healthHidden ? {} : { temp_check_feelings: memberFeelings.get(m.id) }), created_at: stamp(i) })), keepCreated),
      ...(await Promise.all(flips.map((m) => grownUpChangeStmts(c, m.id, grownUp(m), m.name)))).flat(),
      ...upserts(
        db,
        'categories',
        'id',
        body.categories.map((cat) => ({ id: cat.id, name: cat.name, emoji: cat.emoji, color: cat.color, keywords: JSON.stringify(cat.keywords), sort: cat.sort, created_at: cat.createdAt })),
        keepCreated,
      ),
      ...upserts(db, 'contact_categories', 'id', body.contactCategories.map((cat) => ({ id: cat.id, name: cat.name, color: cat.color, sort: cat.sort, created_at: cat.createdAt, updated_at: cat.updatedAt })), keepCreated),
      ...upserts(db, 'contacts', 'id', body.contacts.map((contact) => ({
        id: contact.id, kind: contact.kind, name: contact.name, organization: contact.organization ?? null,
        relationship: contact.relationship ?? null, title: contact.title ?? null, given_name: contact.givenName ?? null, family_name: contact.familyName ?? null, nickname: contact.nickname ?? null, favorite: contact.favorite ? 1 : 0, emergency: contact.emergency ? 1 : 0,
        phones: JSON.stringify(contact.phones), emails: JSON.stringify(contact.emails),
        addresses: JSON.stringify(contact.addresses), websites: JSON.stringify(contact.websites), dates: JSON.stringify(contact.dates),
        notes: contact.notes ?? null, category_ids: JSON.stringify(contact.categoryIds), tags: JSON.stringify(contact.tags), member_ids: JSON.stringify(contact.memberIds), service_hours: contact.serviceHours ?? null, service_area: contact.serviceArea ?? null, always_open: contact.alwaysOpen ? 1 : 0, wall_visible: contact.wallVisible ? 1 : 0, emergency_visible: contact.emergencyVisible ? 1 : 0, phone_visible_on_wall: contact.phoneVisibleOnWall ? 1 : 0, address_visible_on_wall: contact.addressVisibleOnWall ? 1 : 0, visibility: contact.visibility, selected_member_ids: JSON.stringify(contact.selectedMemberIds), source_metadata: contact.sourceMetadata ? JSON.stringify(contact.sourceMetadata) : null,
        private_fields: JSON.stringify(contact.privateFields), created_at: contact.createdAt, updated_at: contact.updatedAt,
      })), keepCreated),
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
            filter: cal.filter ? JSON.stringify(cal.filter) : null,
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
        'event_hidden',
        'calendar_id, scope, key',
        hiddenEvents.map((h) => ({ id: crypto.randomUUID(), calendar_id: h.calendarId, scope: h.scope, key: h.key, title: h.title, start: h.start, all_day: h.allDay ? 1 : 0, created_at: new Date(now).toISOString() })),
        { keep: ['id', 'created_at'] },
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
          busy: e.busy ? 1 : 0,
          sync_source: e.syncSource,
          external_id: e.syncSource ? e.externalId : null,
          updated_at: new Date(now).toISOString(),
        })),
      ),
      // Before chores, which point at it (library_id).
      ...upserts(
        db,
        'chore_library',
        'id',
        body.choreLibrary.map((l) => ({
          id: l.id, title: l.title, emoji: l.emoji, points: l.points, member_id: l.memberId, every_n: l.everyN, every_unit: l.everyUnit,
          needs_approval: l.needsApproval == null ? null : l.needsApproval ? 1 : 0, notes: l.notes, created_at: l.createdAt,
          list_id: l.listId && body.lists.some((x) => x.id === l.listId) ? l.listId : null, // as chores: only a list in this file
        })),
        { ...keepCreated, expr: { member_id: memberRef('member_id') } },
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
          archived: ch.archived ? 1 : 0,
          library_id: ch.libraryId,
        })),
        { ...keepCreated, expr: { member_id: memberRef('member_id'), library_id: "(SELECT id FROM chore_library WHERE id = j.value->>'library_id')" } },
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
          catalog: catalogs.list(l),
          is_default: l.isDefault && l.kind === 'shopping' ? 1 : 0,
          sort: l.sort,
          archived: l.archived ? 1 : 0,
          created_at: l.createdAt,
          last_done_at: l.lastDoneAt,
          last_done_by: l.lastDoneBy?.memberId ?? null,
          last_done_by_label: l.lastDoneBy?.label ?? null,
        })),
        { ...keepCreated, expr: { last_done_by: memberRef('last_done_by') } },
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
          for_member_ids: JSON.stringify(i.forMemberIds),
          due_date: i.dueDate,
          event_id: i.eventId,
          priority: i.priority,
          done: i.done ? 1 : 0,
          done_at: i.doneAt,
          done_by: i.checkedBy ? i.checkedBy.memberId ?? null : i.doneBy,
          done_by_label: i.checkedBy?.label ?? null,
          added_by: i.addedBy?.memberId ?? null,
          added_by_label: i.addedBy?.label ?? null,
          sort: i.sort,
          created_at: i.createdAt,
          updated_at: i.updatedAt,
        })),
        { ...keepCreated, expr: { member_id: memberRef('member_id'), done_by: memberRef('done_by'), added_by: memberRef('added_by') } },
      ),
      // Steps export without timestamps: a ticked one takes its item's doneAt, all take its createdAt.
      ...upserts(
        db,
        'list_item_steps',
        'id',
        steps.map((st) => ({
          id: st.id, item_id: st.itemId, title: st.title, done: st.done ? 1 : 0, done_at: st.doneAt, sort: st.sort, created_at: st.createdAt,
          added_by: st.addedBy?.memberId ?? null, added_by_label: st.addedBy?.label ?? null, done_by: st.checkedBy?.memberId ?? null, done_by_label: st.checkedBy?.label ?? null,
        })),
        { ...keepCreated, expr: { added_by: memberRef('added_by'), done_by: memberRef('done_by') } },
      ),
      ...upserts(db, 'list_groups', 'list_id, kind, name', groups.map((g) => ({ list_id: g.listId, kind: g.kind, name: g.name, sort: g.sort }))),
      ...upserts(
        db,
        'notes',
        'id',
        notes.map((n) => ({ id: n.id, target_type: n.targetType, target_id: n.targetId, member_id: n.memberId, body: n.body, created_at: n.createdAt, updated_at: n.updatedAt })),
        { keep: ['created_at', 'target_type', 'target_id'], expr: { member_id: memberRef('member_id') } },
      ),
      ...upserts(db, 'point_entries', 'id', pointEntries.map((e) => ({ id: e.id, member_id: e.memberId, amount: e.amount, reason: e.reason, ref: e.ref, at: e.at, note: e.note ?? null })), { keep: ['member_id'] }),
      ...upserts(db, 'member_sticker_packs', 'member_id, pack_id', stickerPacks.map((p) => ({ member_id: p.memberId, pack_id: p.packId, unlocked_at: p.unlockedAt }))),
      ...upserts(db, 'temp_checks', 'member_id, date', sealedTempChecks, keepCreated),
      ...upserts(db, 'journal_entries', 'id', sealedJournal, { keep: ['member_id', 'created_at'] }),
      ...upserts(db, 'medications', 'id', sealedMeds, { keep: ['member_id', 'created_at'] }),
      ...upserts(db, 'medication_log', 'medication_id, date', sealedLog),
      ...upserts(db, 'check_ins', 'member_id, date', checkIns.map((ci) => ({ member_id: ci.memberId, date: ci.date, points: ci.points, at: ci.at }))),
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
        sealedTrackers,
        // Photos travel in their own zip: a photo not on this instance is dropped, not an FK error.
        { keep: ['created_at', 'kind'], expr: { photo_id: "(SELECT id FROM photos WHERE id = j.value->>'photo_id')" } },
      ),
      ...upserts(db, 'recipes', 'id', body.recipes.map((r) => ({ id: r.id, name: r.name, description: r.description, instructions: r.instructions, steps: r.steps ? JSON.stringify(r.steps) : null, preparation_notes: r.preparationNotes, source_url: r.sourceUrl, default_servings: r.defaultServings, prep_minutes: r.prepMinutes ?? null, total_minutes: r.totalMinutes ?? null, archived: r.archived ? 1 : 0, source: r.source ?? null, external_id: r.externalId ?? null, image_url: r.imageUrl ?? null, kind: r.kind, makes: r.makes, created_at: r.createdAt, updated_at: r.updatedAt })), keepCreated),
      // Replace each imported recipe's ingredient set, including intentionally empty sets.
      db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(body.recipes.map((r) => r.id))),
      ...upserts(db, 'recipe_ingredients', 'id', body.recipes.flatMap((r) => r.ingredients.map((i) => ({ id: i.id, recipe_id: r.id, name: i.name, normalized_name: normalizeIngredient(i.name), quantity: i.quantity, unit: i.unit, preparation: i.preparation, qualifier: i.qualifier, category: i.category, sort: i.sort, basic_id: i.basicId ?? null }))),
        { expr: { basic_id: "(SELECT id FROM recipes WHERE id = j.value->>'basic_id' AND kind = 'basic')" } }),
      // Ratings by a member not on this instance are dropped, not an FK error.
      db.prepare("INSERT INTO recipe_ratings (recipe_id, member_id, stars) SELECT j.value->>'recipe_id', j.value->>'member_id', j.value->>'stars' FROM json_each(?) j WHERE j.value->>'member_id' IN (SELECT id FROM members) ON CONFLICT(recipe_id, member_id) DO UPDATE SET stars = excluded.stars")
        .bind(JSON.stringify(body.recipes.flatMap((r) => Object.entries(r.rating?.byMember ?? {}).map(([member_id, stars]) => ({ recipe_id: r.id, member_id, stars }))))),
      ...upserts(db, 'restaurants', 'id', body.restaurants.map((r) => ({ id: r.id, name: r.name, cuisine: r.cuisine, phone: r.phone, address: r.address, website: r.website, order_url: r.orderUrl, menu_url: r.menuUrl, notes: r.notes, archived: r.archived ? 1 : 0, created_at: r.createdAt, updated_at: r.updatedAt })), keepCreated),
      // Each imported restaurant's menu is replaced by the file's, like a recipe's ingredients.
      db.prepare('DELETE FROM restaurant_menu_items WHERE restaurant_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(body.restaurants.map((r) => r.id))),
      ...upserts(db, 'restaurant_menu_items', 'id', body.restaurants.flatMap((r) => r.menu.map((i) => ({ id: i.id, restaurant_id: r.id, section: i.section, name: i.name, description: i.description, price_cents: i.priceCents, favorite: i.favorite ? 1 : 0, sort: i.sort })))),
      ...upserts(db, 'meals', 'id', body.meals.map((m) => ({ id: m.id, date: m.date, slot: m.slot, title: m.title, meal_kind: m.mealKind, recipe_id: m.recipeId, recipe_snapshot: m.recipeSnapshot ? JSON.stringify(m.recipeSnapshot) : null, servings: m.servings, assignee_member_id: m.assigneeMemberId, eater_ids: JSON.stringify(m.eaterIds ?? []), notes: m.notes, planned_time: m.plannedTime, calendar_event_id: m.calendarEventId, calendar_event_start: m.calendarEventId ? m.calendarEventStart ?? null : null, status: m.status, source_url: m.sourceUrl, restaurant_id: m.restaurantId, order_type: m.orderType, created_at: m.createdAt, updated_at: m.updatedAt })), { ...keepCreated, expr: { recipe_id: "(SELECT id FROM recipes WHERE id = j.value->>'recipe_id')", restaurant_id: "(SELECT id FROM restaurants WHERE id = j.value->>'restaurant_id')", assignee_member_id: memberRef('assignee_member_id') } }),
      // Each imported meal's orders are the file's; orders by a member not on this instance are dropped.
      db.prepare('DELETE FROM meal_orders WHERE meal_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(body.meals.map((m) => m.id))),
      db.prepare("INSERT INTO meal_orders (meal_id, member_id, items, note, updated_at) SELECT j.value->>'meal_id', j.value->>'member_id', j.value->>'items', j.value->>'note', j.value->>'updated_at' FROM json_each(?) j WHERE j.value->>'member_id' IN (SELECT id FROM members) ON CONFLICT(meal_id, member_id) DO NOTHING")
        // ponytail: one JSON param for every order (a family's takeout fits easily); chunk like upserts() if it ever nears D1's 2 MB.
        .bind(JSON.stringify(body.meals.flatMap((m) => m.orders.map((o) => ({ meal_id: m.id, member_id: o.memberId, items: JSON.stringify(o.items), note: o.note, updated_at: o.updatedAt }))))),
      // A poll's choices in the file replace its choices here; votes by members or for choices not here are dropped.
      ...upserts(db, 'polls', 'id', body.polls.map((p) => ({ id: p.id, question: p.question, date: p.date, slot: p.slot, status: p.status, winner_option_id: p.winnerOptionId, meal_id: p.mealId, created_by: p.createdBy, created_at: p.createdAt, closed_at: p.closedAt })), { ...keepCreated, expr: { meal_id: "(SELECT id FROM meals WHERE id = j.value->>'meal_id')", created_by: memberRef('created_by') } }),
      db.prepare('DELETE FROM poll_options WHERE poll_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(body.polls.map((p) => p.id))),
      ...upserts(db, 'poll_options', 'id', body.polls.flatMap((p) => p.options.map((o) => ({ id: o.id, poll_id: p.id, label: o.label, recipe_id: o.recipeId, restaurant_id: o.restaurantId ?? null, sort: o.sort }))), { expr: { recipe_id: "(SELECT id FROM recipes WHERE id = j.value->>'recipe_id')", restaurant_id: "(SELECT id FROM restaurants WHERE id = j.value->>'restaurant_id')" } }),
      db.prepare("INSERT INTO poll_votes (poll_id, member_id, option_id, updated_at) SELECT j.value->>'poll_id', j.value->>'member_id', j.value->>'option_id', ? FROM json_each(?) j WHERE j.value->>'member_id' IN (SELECT id FROM members) AND j.value->>'option_id' IN (SELECT id FROM poll_options) ON CONFLICT(poll_id, member_id) DO UPDATE SET option_id = excluded.option_id")
        .bind(new Date().toISOString(), JSON.stringify(body.polls.flatMap((p) => p.options.flatMap((o) => o.votes.map((member_id) => ({ poll_id: p.id, member_id, option_id: o.id })))))),
      ...upserts(db, 'meal_shopping_sources', 'list_id, source_ref', mealSources.map((s) => ({ list_id: s.listId, source_ref: s.sourceRef, item_id: s.itemId, fingerprint: s.fingerprint }))),
      // Newer knowledge wins: a remembered place only replaces one that is older.
      ...upserts(db, 'item_memory', 'catalog, name_key, store', catalogs.rows(body.itemMemory).map((m) => ({ catalog: m.catalog, name_key: m.nameKey, store: m.store, category: m.category, aisle: m.aisle, updated_at: m.updatedAt })), { where: 'excluded.updated_at > item_memory.updated_at' }),
      // A store's aisle order in the file replaces this instance's order for that store.
      db.prepare('DELETE FROM store_aisles WHERE store IN (SELECT value FROM json_each(?))').bind(JSON.stringify(body.storeAisles.map((a) => a.store))),
      ...upserts(db, 'store_aisles', 'store, aisle', body.storeAisles.flatMap((a) => [...new Set(a.aisles)].map((aisle, sort) => ({ store: a.store, aisle, sort })))),
      ...upserts(db, 'library_books', 'id', body.libraryBooks.map((b) => ({ id: b.id, format: b.format ?? 'book', title: b.title, author: b.author, isbn: b.isbn, pages: b.pages, cover_url: b.coverUrl, year: b.year, series: b.series, series_number: b.seriesNumber, lexile: b.lexile, description: b.description, genres: b.genres.length ? JSON.stringify(b.genres) : null, location: b.location ?? null, lent_to: b.lentTo ?? null, lent_on: b.lentOn ?? null, shelf: b.shelf ?? null, added_by: b.addedBy?.memberId ?? null, added_by_label: b.addedBy?.label ?? null, created_at: b.createdAt, updated_at: b.updatedAt })), { keep: ['created_at'], expr: { added_by: "(SELECT id FROM members WHERE id = j.value->>'added_by')" } }),
      ...upserts(db, 'item_barcodes', 'catalog, barcode', body.itemBarcodes.map((b) => ({ catalog: b.catalog, barcode: b.barcode, title: b.title, updated_at: b.updatedAt })), { where: 'excluded.updated_at > item_barcodes.updated_at' }),
      ...upserts(db, 'item_names', 'catalog, name_key', catalogs.rows(body.itemNames).map((n) => ({ catalog: n.catalog, name_key: n.nameKey, title: n.title, uses: n.uses, last_used: n.lastUsed })), { where: 'excluded.last_used > item_names.last_used' }),
      // An item's categories in the file are added to the ones it has here, in the file's order after them.
      ...upserts(db, 'item_tags', 'catalog, name_key, tag', catalogs.rows(body.itemTags).map((t, n) => ({ catalog: t.catalog, name_key: t.nameKey, tag: t.tag, sort: 1000 + n }))),
    ];
    if (writes.length) await db.batch(writes);
    for (const m of flips) await noteGrownUpChange(c, m.id, m.name, grownUp(m));
    // An entry already here as health keeps its kind (kind is kept on conflict), so sweep up anything the file brought in as another kind.
    if (trackers.length) await sealHealthEntries(c.env);

    const changed: [BusEventType, number][] = [
      ['settings.changed', Object.keys(settings.data).length],
      ['member.changed', body.members.length],
      ['category.changed', body.categories.length],
      ['contact.changed', body.contacts.length],
      ['contact.category.changed', body.contactCategories.length],
      ['calendar.changed', calendars.length],
      ['events.changed', events.length + memberOverrides.length + categoryOverrides.length + travelOverrides.length + seriesMemberOverrides.length + seriesCategoryOverrides.length + hiddenEvents.length],
      ['chore.changed', body.chores.length + completions.length],
      ['chore.library.changed', body.choreLibrary.length],
      ['list.changed', body.lists.length + notes.length + body.itemMemory.length + body.storeAisles.length + body.itemTags.length],
      ['sticker.changed', pointEntries.length + stickerPacks.length + checkIns.length + scrapbook.length],
      ['reward.changed', body.rewards.length + redemptions.length],
      ['tracker.changed', trackers.length],
      ['tempcheck.changed', tempChecks.length],
      ['journal.changed', journalEntries.length],
      ['recipe.changed', body.recipes.length],
      ['meal.changed', body.meals.length],
      ['restaurant.changed', body.restaurants.length],
      ['poll.changed', body.polls.length],
    ];
    for (const [type, n] of changed) if (n > 0) emit(c, type, { imported: n });

    return c.json(
      {
        imported: {
          members: body.members.length,
          categories: body.categories.length,
          contactCategories: body.contactCategories.length,
          contacts: body.contacts.length,
          calendars: calendars.length,
          events: events.length,
          eventMemberOverrides: memberOverrides.length,
          eventCategoryOverrides: categoryOverrides.length,
          eventTravelOverrides: travelOverrides.length,
          eventSeriesMemberOverrides: seriesMemberOverrides.length,
          eventSeriesCategoryOverrides: seriesCategoryOverrides.length,
          hiddenEvents: hiddenEvents.length,
          chores: body.chores.length,
          choreCompletions: completions.length,
          choreLibrary: body.choreLibrary.length,
          lists: body.lists.length,
          listItems: items.length,
          listItemSteps: steps.length,
          notes: notes.length,
          pointEntries: pointEntries.length,
          stickerPacks: stickerPacks.length,
          checkIns: checkIns.length,
          tempChecks: tempChecks.length,
          journalEntries: journalEntries.length,
          medications: medications.length,
          medicationLog: medicationLog.length,
          scrapbook: scrapbook.length,
          rewards: body.rewards.length,
          rewardRedemptions: redemptions.length,
          trackers: trackers.length,
          recipes: body.recipes.length,
          meals: body.meals.length,
          restaurants: body.restaurants.length,
          polls: body.polls.length,
          mealShoppingSources: mealSources.length,
          itemMemory: body.itemMemory.length,
          storeAisles: body.storeAisles.length,
          itemNames: body.itemNames.length,
          itemBarcodes: body.itemBarcodes.length,
          libraryBooks: body.libraryBooks.length,
          itemTags: body.itemTags.length,
        },
        needsReconnect: (await db.prepare("SELECT id, kind, name FROM calendars WHERE kind != 'local' AND config = '' ORDER BY name").all<{ id: string; kind: string; name: string }>()).results,
        skipped: {
          passkeys: body.passkeys.length,
          webhooks: body.webhooks.length,
          grownUp: keptGrownUp,
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

/** Medicines and every dose marked or snoozed, opened: the family's own backup. */
async function exportMedications(env: Env) {
  const medications = await loadMedications(env);
  const logs = await loadLogs(env, medications.map((m) => m.id), '0000-00-00', '9999-99-99');
  const medicationLog = [...logs].flatMap(([k, log]) => {
    const [medicationId, date] = [k.slice(0, k.lastIndexOf(':')), k.slice(k.lastIndexOf(':') + 1)];
    return Object.entries(log).map(([time, e]) => ({ medicationId, date, time, status: e.status ?? null, at: e.at ?? null, by: e.by ?? null, snoozedUntil: e.snoozedUntil ?? null, startedAt: e.startedAt ?? null }));
  }).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.medicationId.localeCompare(b.medicationId));
  return { medications, medicationLog };
}
