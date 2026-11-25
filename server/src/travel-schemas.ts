import { stored } from './i18n.ts';
import { z } from '@hono/zod-openapi';
import { isPublicHttpsUrl } from './outbound.ts';
import { zonedTimeToUtc } from './recurrence.ts';
export const TravelDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v,
    'Choose a real date.',
  );
export const TravelTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const TravelZoneSchema = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'Choose an IANA time zone.');
const text = z.string().trim().max(4000).nullable().default(null);
const short = z.string().trim().max(200).nullable().default(null);
const date = TravelDateSchema.nullable().default(null);
const time = TravelTimeSchema.nullable().default(null);
const zone = TravelZoneSchema.nullable().default(null);
export const PublicTravelUrlSchema = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return !u.username && !u.password && isPublicHttpsUrl(v);
    } catch {
      return false;
    }
  }, 'Use a public HTTPS link.');
const url = PublicTravelUrlSchema.nullable().default(null);
export const TripMarkSchema = z.object({
  memberId: z.string(),
  kind: z.enum(['interested', 'really']),
});
export const TripInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    emoji: short,
    description: text,
    location: short,
    startDate: date,
    endDate: date,
    dateNote: short,
    viewTimeZone: zone,
    status: z.enum(['idea', 'planning', 'ready']).default('idea'),
    memberIds: z.array(z.string()).max(100).default([]),
    detailsAudience: z.enum(['grownups', 'everyone']).default('grownups'),
    detailsOnWall: z.boolean().default(false),
    packingListIds: z.array(z.string()).max(100).default([]).describe("Linked active list IDs of any kind (legacy field name; includes packing, groceries, shopping and to-do lists)."),
    archivedAt: short,
    canceledAt: short,
  })
  .strict();
// Zod 4 applies a default inside optional fields. Sparse patches must remove creation defaults.
export function sparseShape<T extends z.ZodRawShape>(shape: T) {
  return Object.fromEntries(
    Object.entries(shape).map(([k, v]) => [
      k,
      (
        (v instanceof z.ZodDefault ? v.removeDefault() : v) as z.ZodType
      ).optional(),
    ]),
  ) as { [K in keyof T]: z.ZodOptional<z.ZodType<z.output<T[K]>>> };
}
export const TripPatchSchema = z
  .object(sparseShape(TripInputSchema.shape))
  .extend({ revision: z.number().int().min(1) })
  .strict();
export const StopInputSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    town: short,
    timezone: zone,
    arriveDate: date,
    leaveDate: date,
    notes: text,
    sort: z.number().int().default(0),
  })
  .strict();
export const StayGroupInputSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    stopId: short,
    checkIn: date,
    checkOut: date,
    sort: z.number().int().default(0),
  })
  .strict();
export const StayDetailsSchema = z
  .object({
    address: text,
    contact: text,
    arrival: text,
    confirmation: short,
    manageUrl: url,
    codes: text,
  })
  .strict();
export const LegDetailsSchema = z
  .object({
    confirmation: short,
    manageUrl: url,
    notes: text,
  })
  .strict();
export const StayPriceSchema = z.object({
  amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  basis: z.enum(['night', 'stay', 'week', 'person']).nullable().default(null),
  fees: z.enum(['included', 'extra', 'unknown']).default('unknown'),
  observedOn: date,
  context: text,
});
export const StayInputSchema = z
  .object({
    groupId: z.string(),
    name: z.string().trim().min(1).max(200),
    kind: z
      .enum(['hotel', 'rental', 'family', 'camping', 'other'])
      .default('other'),
    town: short,
    sourceUrl: url,
    siteName: short,
    imageUrl: url,
    cost: z
      .enum(['unknown', 'free', 'contribution', 'price'])
      .default('unknown'),
    price: StayPriceSchema.nullable().default(null),
    sleeps: z.number().int().min(1).max(1000).nullable().default(null),
    notes: text,
    booking: z
      .enum(['none', 'booked', 'confirmed_family', 'canceled'])
      .default('none'),
    fetchedAt: short,
    details: StayDetailsSchema.nullable().optional(),
  })
  .strict();
export const LegInputSchema = z
  .object({
    mode: z
      .enum(['flight', 'drive', 'train', 'bus', 'ferry', 'rental', 'other'])
      .default('other'),
    title: short,
    from: short,
    to: short,
    departDate: date,
    departTime: time,
    departTz: zone,
    arriveDate: date,
    arriveTime: time,
    arriveTz: zone,
    carrier: short,
    number: short,
    memberIds: z.array(z.string()).max(100).default([]),
    notes: text,
    booking: z.enum(['none', 'booked', 'canceled']).default('none'),
    sort: z.number().int().default(0),
    details: LegDetailsSchema.nullable().optional(),
  })
  .strict();
export const ItemInputSchema = z
  .object({
    kind: z.enum(['activity', 'outing', 'meal', 'event']),
    title: short,
    label: short,
    refId: short,
    date,
    time,
    tz: zone,
    place: short,
    url,
    notes: text,
    sort: z.number().int().default(0),
  })
  .strict();
export const StopSchema = StopInputSchema.extend({ id: z.string() });
export const StaySchema = StayInputSchema.omit({ details: true }).extend({
  id: z.string(),
  addedBy: short,
  bookedBy: short,
  details: StayDetailsSchema.nullable(),
  hasDetails: z.boolean(),
});
export const LegSchema = LegInputSchema.omit({ details: true }).extend({
  id: z.string(),
  details: LegDetailsSchema.nullable(),
  hasDetails: z.boolean(),
});
export const ItemSchema = ItemInputSchema.extend({
  id: z.string(),
  suggestedBy: short,
  marks: z.array(TripMarkSchema),
  missing: z.boolean(),
});
export const StayGroupSchema = StayGroupInputSchema.extend({
  id: z.string(),
  pollId: short,
  poll: z
    .object({
      id: z.string(),
      status: z.enum(['open', 'closed']),
      round: z.number().optional(),
      options: z.array(
        z.object({ id: z.string(), stayId: z.string().nullable() }),
      ),
      votes: z.array(z.object({ memberId: z.string(), optionId: z.string() })),
      voterIds: z.array(z.string()),
    })
    .nullable(),
  chosenOptionId: short,
  chosenBy: short,
  chosenAt: short,
  options: z.array(StaySchema),
});
export const CalendarLinkSchema = z.object({
  eventId: z.string().nullable(),
  calendarId: z.string(),
  state: z.enum(['added', 'failed', 'pending']),
  error: z.string().nullable(),
});
export const TripSummarySchema = TripInputSchema.extend({
  travelDay: z.object({ today: TravelDateSchema, timeZone: TravelZoneSchema, source: z.enum(['override','stop','leg','home']), stopId: z.string().nullable() }).optional(),
  id: z.string(),
  revision: z.number().int(),
  createdBy: short,
  createdAt: z.string(),
  updatedAt: z.string(),
  marks: z.array(TripMarkSchema),
  counts: z.object({
    stops: z.number(),
    stayGroups: z.number(),
    staysChosen: z.number(),
    staysBooked: z.number(),
    legs: z.number(),
    legsBooked: z.number(),
    openVotes: z.number(),
    planned: z.number(),
    ideas: z.number(),
  }),
}).openapi('TripSummary');
export const CareInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['pet','home','plants','other']).default('other'),
  helperName: short, helperContact: text,
  fromDate: date, toDate: date,
  status: z.enum(['needed','asked','confirmed','canceled']).default('needed'),
  tasks: z.array(z.object({id:z.string().min(1).max(100),text:z.string().trim().min(1).max(1000),done:z.boolean()}).strict()).max(100).default([]),
  instructions: text, entry: text, emergency: text,
  sort: z.number().int().min(-100000).max(100000).default(0),
}).strict();
export const CareSchema = CareInputSchema.extend({id:z.string().min(1).max(200),updatedAt:z.string().datetime()});
export function validCareDates(care: z.infer<typeof CareInputSchema>): boolean {
  return (!care.fromDate && !care.toDate || !!care.fromDate && !!care.toDate && care.fromDate<=care.toDate && Date.parse(care.toDate)-Date.parse(care.fromDate)<=3660*86400000) && new Set(care.tasks.map(t=>t.id)).size===care.tasks.length;
}
export const TripSchema = TripSummarySchema.extend({
  care: z.array(CareSchema).max(100).default([]),
  canSeeCare: z.boolean().default(false),
  canEditCare: z.boolean().default(false),
  careUnavailable: z.boolean().default(false),
  checks: z.array(z.object({code:z.enum(['uncovered_nights','overlapping_stays','outside_trip','travel_overlap','travel_backwards']),part:z.enum(['stays','travel','stops','plan']),from:TravelDateSchema.nullable(),to:TravelDateSchema.nullable(),ids:z.array(z.string()),count:z.number().int().optional()})).default([]),
  stops: z.array(StopSchema),
  stayGroups: z.array(StayGroupSchema),
  legs: z.array(LegSchema),
  items: z.array(ItemSchema),
  calendar: z.object({
    span: CalendarLinkSchema.nullable(),
    items: z.array(
      z.object({
        kind: z.enum(['leg', 'stay', 'item']),
        id: z.string(),
        link: CalendarLinkSchema,
      }),
    ),
  }),
  awayPeriodIds: z.array(z.string()),
  canSeeDetails: z.boolean(),
  can: z.object({
    edit: z.boolean(),
    addStays: z.boolean(),
    choose: z.boolean(),
    suggest: z.boolean(),
    vote: z.boolean(),
  }),
}).openapi('Trip');
export type Trip = z.infer<typeof TripSchema>;
export function endpointInstant(
  date: string | null,
  time: string | null,
  zone: string | null,
): Date | null {
  if (!date || !time || !zone) return null;
  const [y, mo, d] = date.split('-').map(Number),
    [h, mi] = time.split(':').map(Number);
  const out = zonedTimeToUtc({ y, mo: mo - 1, d, h, mi, s: 0 }, zone);
  // Nonexistent local times (spring-forward) must not silently move the clock.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(out);
  const p = Object.fromEntries(parts.map((v) => [v.type, v.value]));
  if (
    `${p.year}-${p.month}-${p.day}` !== date ||
    `${p.hour}:${p.minute}` !== time
  )
    throw new Error(stored('error', 'This local time does not exist in that time zone.'));
  return out;
}
