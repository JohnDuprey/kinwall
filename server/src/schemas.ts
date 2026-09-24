// Shared zod-openapi schemas, reused across route files.
import { z } from '@hono/zod-openapi';

export const ErrorSchema = z.object({ error: z.string() }).openapi('Error');

export const MemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    avatar: z.string().nullable(),
    sort: z.number(),
    pointsToday: z.number(),
    pointsWeek: z.number(),
  })
  .openapi('Member');

export const MemberInputSchema = z
  .object({
    name: z.string().min(1),
    color: z.string().min(1),
    avatar: z.string().nullable().optional(),
    sort: z.number().optional(),
  })
  .openapi('MemberInput');

export const SettingsSchema = z
  .object({
    familyName: z.string(),
    timezone: z.string().nullable(),
    weekStart: z.union([z.literal(0), z.literal(1)]),
    theme: z.string(),
  })
  .openapi('Settings');

export const AccountSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['google', 'microsoft', 'caldav']),
    name: z.string(),
    createdAt: z.string(),
  })
  .openapi('Account');

export const CalendarSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['local', 'ics', 'google', 'microsoft', 'caldav']),
    accountId: z.string().nullable(),
    remoteId: z.string().nullable(),
    name: z.string(),
    color: z.string().nullable(),
    memberId: z.string().nullable(),
    writable: z.boolean(),
    enabled: z.boolean(),
    lastSyncedAt: z.string().nullable(),
    lastError: z.string().nullable(),
  })
  .openapi('Calendar');

export const CalendarInputSchema = z
  .object({
    kind: z.enum(['local', 'ics', 'google', 'microsoft', 'caldav']),
    name: z.string().min(1),
    color: z.string().nullable().optional(),
    memberId: z.string().nullable().optional(),
    accountId: z.string().nullable().optional(),
    remoteId: z.string().nullable().optional(),
    url: z.string().url().optional(),
  })
  .openapi('CalendarInput');

export const EventInstanceSchema = z
  .object({
    id: z.string(),
    calendarId: z.string(),
    title: z.string(),
    start: z.string(),
    end: z.string(),
    allDay: z.boolean(),
    location: z.string().nullable(),
    description: z.string().nullable(),
    memberIds: z.array(z.string()),
    color: z.string(),
    rrule: z.string().nullable(),
    occurrenceStart: z.string().nullable(),
    readOnly: z.boolean(),
  })
  .openapi('EventInstance');

export const EventInputSchema = z
  .object({
    calendarId: z.string(),
    title: z.string().min(1),
    start: z.string(),
    end: z.string(),
    allDay: z.boolean(),
    location: z.string().optional(),
    description: z.string().optional(),
    memberIds: z.array(z.string()).optional(),
    rrule: z.string().nullable().optional(),
  })
  .openapi('EventInput');

export const ChoreSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    emoji: z.string().nullable(),
    memberId: z.string().nullable(),
    points: z.number(),
    rrule: z.string().nullable(),
    dueDate: z.string().nullable(),
    dueTime: z.string().nullable(),
    active: z.boolean(),
    sort: z.number(),
  })
  .openapi('Chore');

export const ChoreInputSchema = z
  .object({
    title: z.string().min(1),
    emoji: z.string().nullable().optional(),
    memberId: z.string().nullable().optional(),
    points: z.number().optional(),
    rrule: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    dueTime: z.string().nullable().optional(),
    active: z.boolean().optional(),
    sort: z.number().optional(),
  })
  .openapi('ChoreInput');

export const ChoreDaySchema = ChoreSchema.extend({
  completed: z.boolean(),
  completedAt: z.string().nullable(),
  completedBy: z.string().nullable(),
}).openapi('ChoreDay');

export const LeaderboardEntrySchema = z
  .object({
    memberId: z.string(),
    name: z.string(),
    color: z.string(),
    avatar: z.string().nullable(),
    points: z.number(),
    completed: z.number(),
    streak: z.number(),
    rank: z.number(),
  })
  .openapi('LeaderboardEntry');

export const ApiKeySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    scope: z.enum(['admin', 'display']),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
  })
  .openapi('ApiKey');

export const ApiKeyCreatedSchema = z
  .object({ id: z.string(), name: z.string(), scope: z.enum(['admin', 'display']), key: z.string() })
  .openapi('ApiKeyCreated');

export const MeSchema = z.object({ scope: z.enum(['admin', 'display']), keyName: z.string() }).openapi('Me');

export const WebhookSchema = z
  .object({ id: z.string(), url: z.string(), events: z.array(z.string()), enabled: z.boolean(), createdAt: z.string() })
  .openapi('Webhook');

export const WebhookInputSchema = z
  .object({ url: z.string().url(), events: z.array(z.string()), secret: z.string().optional(), enabled: z.boolean().optional() })
  .openapi('WebhookInput');
