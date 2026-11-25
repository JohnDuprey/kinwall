import { z } from '@hono/zod-openapi';
import { TravelDateSchema } from './travel-schemas.ts';
export const AwayPersonSchema = z
  .object({
    memberId: z.string(),
    startDate: TravelDateSchema,
    endDate: TravelDateSchema,
    leaveDayAway: z.boolean().default(true),
    returnDayAway: z.boolean().default(true),
  })
  .strict();
export const AwayHandoffInputSchema = z
  .object({
    choreId: z.string(),
    fromMemberId: z.string(),
    toMemberId: z.string(),
    startDate: TravelDateSchema,
    endDate: TravelDateSchema,
  })
  .strict();
export const AwayInputSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().trim().min(1).max(200),
    tripId: z.string().nullable().default(null),
    people: z.array(AwayPersonSchema).min(1).max(100),
    keepDue: z
      .array(z.object({ choreId: z.string(), memberId: z.string() }))
      .max(500)
      .default([]),
    handoffs: z.array(AwayHandoffInputSchema).max(500).default([]),
    revision: z.number().int().min(1).optional(),
    token: z.string().max(200).optional(),
  })
  .strict();
export const AwayPeriodSchema = AwayInputSchema.omit({
  token: true,
  id: true,
  revision: true,
})
  .extend({
    id: z.string(),
    revision: z.number().int(),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    tripTitle: z.string().nullable(),
    timezone: z.string(),
    people: z.array(
      AwayPersonSchema.extend({
        effectiveFrom: TravelDateSchema.nullable(),
        effectiveTo: TravelDateSchema.nullable(),
      }),
    ),
    handoffs: z.array(
      AwayHandoffInputSchema.extend({
        id: z.string(),
        choreTitle: z.string(),
        choreEmoji: z.string().nullable(),
      }),
    ),
  })
  .openapi('AwayPeriod');
export const AwayReviewLineSchema = z.object({
  memberId: z.string(),
  choreId: z.string(),
  title: z.string(),
  emoji: z.string().nullable(),
  dates: z.array(TravelDateSchema),
  toMemberId: z.string().optional(),
  schoolwork: z.boolean().optional(),
});
export const AwayReviewSchema = z.object({
  paused: z.array(AwayReviewLineSchema),
  keepDue: z.array(AwayReviewLineSchema),
  handoffs: z.array(AwayReviewLineSchema),
  conflicts: z.array(
    z.object({
      kind: z.string(),
      text: z.string(),
      blocking: z.boolean(),
      memberId: z.string().optional(),
      choreId: z.string().optional(),
    }),
  ),
  continues: z.array(z.object({ kind: z.string(), text: z.string() })),
  token: z.string(),
});
export type AwayInput = z.infer<typeof AwayInputSchema>;
