import { z } from '@hono/zod-openapi';
import { MealDateSchema } from './meal-schemas.ts';

export const PlanningDinnerSchema = z.discriminatedUnion('kind', [
  z.object({ date: MealDateSchema, kind: z.literal('open') }).strict(),
  z.object({ date: MealDateSchema, kind: z.literal('meal'), title: z.string().trim().min(1).max(200), recipeId: z.string().min(1).max(100).optional(), replaceMealId: z.string().min(1).max(100).optional().describe('Explicitly swap this planned dinner in place; must match the reviewed date and canSwap.') }).strict(),
]);
export const PlanningPrepSchema = z.object({
  id: z.string().uuid(), eventId: z.string().min(1).max(200), occurrenceStart: z.string().datetime({ offset: true }).nullable(),
  title: z.string().trim().min(1).max(200), dueDate: MealDateSchema, listId: z.string().min(1).max(200),
}).strict();
export const PlanningDraftSchema = z.object({ dinners: z.array(PlanningDinnerSchema).max(7), prep: z.array(PlanningPrepSchema).max(30) }).strict()
  .refine(d => new Set(d.dinners.map(m => m.date)).size === d.dinners.length, 'Choose each dinner date only once')
  .refine(d => new Set(d.prep.map(p => p.id)).size === d.prep.length, 'Preparation ids must be unique');
export const PlanningAppliedSchema = z.object({
  dinners: z.record(z.string(), z.object({ id: z.string(), choice: z.string() })),
  prep: z.record(z.string(), z.object({ id: z.string(), choice: z.string() })),
});
export const PlanningSaveSchema = z.object({ revision: z.number().int().min(0), draft: PlanningDraftSchema }).strict();
export const PlanningApplySchema = PlanningSaveSchema.extend({ sourceVersion: z.number().int().min(0), requestId: z.string().uuid() }).strict();
export const PlanningParamsSchema = z.object({ weekStart: MealDateSchema });
export const PlanningQuerySchema = z.object({ weekStart: MealDateSchema.optional() });
export const WeeklyPlanningSchema = z.object({
  weekStart: MealDateSchema, dates: z.array(MealDateSchema), timezone: z.string(), sourceVersion: z.number().int(), revision: z.number().int(),
  draft: PlanningDraftSchema, applied: PlanningAppliedSchema,
  features: z.object({ meals: z.boolean(), lists: z.boolean(), upkeep: z.boolean() }),
  events: z.array(z.object({ id: z.string(), title: z.string(), start: z.string(), end: z.string(), allDay: z.boolean(), memberIds: z.array(z.string()), occurrenceStart: z.string().nullable() })),
  meals: z.array(z.object({ id: z.string(), date: z.string(), slot: z.string(), title: z.string(), canSwap: z.boolean() })),
  tasks: z.array(z.object({ id: z.string(), title: z.string(), dueDate: z.string().nullable(), eventId: z.string().nullable(), listId: z.string(), done: z.boolean() })),
  jobs: z.array(z.object({ id: z.string(), title: z.string(), date: z.string() })),
  lists: z.array(z.object({ id: z.string(), name: z.string() })),
  pantry: z.array(z.object({ id: z.string(), title: z.string(), useBy: z.string() })),
  recipes: z.array(z.object({ id: z.string(), name: z.string(), totalMinutes: z.number().nullable() })),
  suggestions: z.array(z.object({ id: z.string(), name: z.string(), totalMinutes: z.number().nullable(), uses: z.array(z.object({ title: z.string(), useBy: z.string().nullable() })) })),
}).openapi('WeeklyPlanning');
export const PlanningExportSchema = z.object({ weekStart: MealDateSchema, revision: z.number().int().min(0), draft: PlanningDraftSchema, applied: PlanningAppliedSchema });
export type PlanningDraft = z.infer<typeof PlanningDraftSchema>;
export type PlanningApplied = z.infer<typeof PlanningAppliedSchema>;
export type WeeklyPlanning = z.infer<typeof WeeklyPlanningSchema>;
