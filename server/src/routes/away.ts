import { stored, requestLang, translateStored } from '../i18n.ts';
import { createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import type { Env } from '../env.ts';
import type { KinwallDb } from '../db.ts';
import { createRouter } from '../router.ts';
import {
  AwayInputSchema,
  AwayPeriodSchema,
  AwayReviewSchema,
  type AwayInput,
} from '../away-schemas.ts';
import { ErrorSchema } from '../schemas.ts';
import { actorOf } from '../auth.ts';
import { emit } from '../bus.ts';
import {
  loadAway,
  awayContext,
  type AwayPerson,
  type AwayRule,
} from '../away.ts';
import { dueDates, type ChoreRow } from './chores.ts';
import { household, todayInTz } from './members.ts';
import { shiftGoalDate } from '../chore-goal.ts';
import { derivedMac } from '../crypto.ts';
import { loadSchoolDays,classifyDay } from '../school-days.ts';
import { readFeatures } from './settings.ts';
import { readJobs } from '../upkeep.ts';
export const awayRoutes = createRouter();
type C = Context<{ Bindings: Env }>;
type Period = z.infer<typeof AwayPeriodSchema>;
type Row = {
  id: string;
  trip_id: string | null;
  data: string;
  revision: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
const body = <T extends z.ZodType>(schema: T) => ({
  content: { 'application/json': { schema } },
});
const response = (schema: z.ZodType) => ({
  description: 'Away days',
  ...body(schema),
});
const errors = Object.fromEntries(
  [400, 403, 404, 409].map((n) => [
    n,
    {
      description: 'Invalid, forbidden, missing, or changed review',
      ...body(ErrorSchema),
    },
  ]),
);
const params = z.object({ id: z.string() });
export async function readAwayPeriods(
  db: KinwallDb,
  from?: string,
  to?: string,
): Promise<Period[]> {
  const rows = (
    await db
      .prepare(
        'SELECT a.*,t.data AS trip_data FROM away_periods a LEFT JOIN trips t ON t.id=a.trip_id ORDER BY a.created_at DESC,a.id',
      )
      .all<Row & { trip_data: string | null }>()
  ).results;
  return rows
    .map(
      (r) =>
        ({
          ...JSON.parse(r.data),
          id: r.id,
          tripId: r.trip_id,
          tripTitle: r.trip_data ? JSON.parse(r.trip_data).title : null,
          revision: r.revision,
          createdBy: r.created_by,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }) as Period,
    )
    .filter(
      (p) =>
        !from ||
        p.people.some(
          (v) =>
            v.effectiveFrom &&
            v.effectiveTo &&
            v.effectiveFrom <= (to ?? '9999-12-31') &&
            v.effectiveTo >= from,
        ),
    );
}
// A single SQL snapshot is also rechecked inside the saving transaction. New chores/absence edits
// between preview, validation, and commit therefore invalidate the entire save, on Node and D1.
const SOURCE_SQL = `SELECT json_array(
 (SELECT json_group_array(json_object('id',id,'member',member_id,'rrule',rrule,'date',due_date,'active',active,'eligible',eligible_member_ids,'goal',repeat_goal,'title',title,'school',school_kind,'subject',school_subject_id,'daysOff',school_days_off,'approval',needs_approval)) FROM (SELECT * FROM chores ORDER BY id)),
 (SELECT json_group_array(json_object('id',id,'up',updated_at,'revision',revision)) FROM (SELECT * FROM away_periods ORDER BY id)),
 (SELECT json_group_array(json_object('id',id,'grown',grown_up)) FROM (SELECT * FROM members ORDER BY id)),
 (SELECT json_group_array(json_object('id',member_id,'to',to_school_by,'from',from_school_by)) FROM (SELECT * FROM school_kids ORDER BY member_id)),
 (SELECT json_group_array(json_object('id',id,'revision',revision)) FROM (SELECT * FROM trips ORDER BY id)),
 (SELECT json_group_array(json_object('id',id,'up',updated_at)) FROM (SELECT * FROM upkeep_jobs ORDER BY id)),
 (SELECT json_group_array(json_object('id',id,'date',date,'title',title)) FROM (SELECT * FROM meals ORDER BY id)),
 (SELECT value FROM settings WHERE key='timezone')) AS value`;
async function snapshot(db: KinwallDb) {
  return (await db.prepare(SOURCE_SQL).first<{ value: string }>())!.value;
}
function fail(message: string, status: 400 | 404 | 409 = 400): never {
  throw new HTTPException(status, { message });
}
async function review(c: C, input: AwayInput) {
  const lang = await requestLang(c);
  const db = c.env.DB,
    source = await snapshot(db),
    { tz } = await household(db);
  const members = (
    await db.prepare('SELECT id FROM members').all<{ id: string }>()
  ).results.map((v) => v.id);
  if (new Set(input.people.map((p) => p.memberId)).size !== input.people.length)
    fail(stored('error', 'Choose each person once.'));
  if (
    input.tripId &&
    !(await db
      .prepare('SELECT id FROM trips WHERE id=?')
      .bind(input.tripId)
      .first())
  )
    fail(stored('error', 'Trip not found.'));
  const people = input.people.map((p) => {
    if (!members.includes(p.memberId)) fail(stored('error', 'Choose a person in your family.'));
    if (
      p.endDate < p.startDate ||
      Date.parse(p.endDate) - Date.parse(p.startDate) > 3660 * 86400000
    )
      fail(stored('error', 'Choose an end date after the start, within ten years.'));
    const first = shiftGoalDate(p.startDate, p.leaveDayAway ? 0 : 1),
      last = shiftGoalDate(p.endDate, p.returnDayAway ? 0 : -1);
    return {
      ...p,
      effectiveFrom: first <= last ? first : null,
      effectiveTo: first <= last ? last : null,
    };
  });
  const rows = (
    await db
      .prepare(
        'SELECT * FROM chores WHERE active=1 AND archived=0 AND source_id IS NULL',
      )
      .all<ChoreRow>()
  ).results;
  const chores = new Map(rows.map((r) => [r.id, r]));
  const conflicts: {
    kind: string;
    text: string;
    blocking: boolean;
    memberId?: string;
    choreId?: string;
  }[] = [];
  const extraPeople: AwayPerson[] = people.flatMap((p) =>
    p.effectiveFrom && p.effectiveTo
      ? [
          {
            period_id: input.id ?? 'draft',
            member_id: p.memberId,
            start_date: p.effectiveFrom,
            end_date: p.effectiveTo,
          },
        ]
      : [],
  );
  const from = people.map((p) => p.startDate).sort()[0],
    to = people
      .map((p) => p.endDate)
      .sort()
      .at(-1)!;
  const existing = await loadAway(db, from, to);
  const ctx = awayContext(
    [
      ...existing.people.filter((p) => p.period_id !== input.id),
      ...extraPeople,
    ],
    existing.rules.filter((r) => r.period_id !== input.id),
    members,
  );
  const handoffs: Period['handoffs'] = [];
  const rules: AwayRule[] = [];
  for (const k of input.keepDue) {
    const chore = chores.get(k.choreId),
      person = people.find((p) => p.memberId === k.memberId);
    if (
      !chore ||
      chore.member_id !== k.memberId ||
      !person?.effectiveFrom ||
      !person.effectiveTo
    )
      fail(stored('error', 'Keep due must name an away person’s own chore.'));
    rules.push({
      id: crypto.randomUUID(),
      period_id: input.id ?? '',
      chore_id: k.choreId,
      from_member_id: k.memberId,
      to_member_id: null,
      kind: 'keep',
      start_date: person.effectiveFrom,
      end_date: person.effectiveTo,
    });
  }
  for (const h of input.handoffs) {
    const chore = chores.get(h.choreId),
      person = people.find((p) => p.memberId === h.fromMemberId);
    if(chore?.school_kind||chore?.school_subject_id)fail(stored('error', 'Schoolwork can pause or stay due; it cannot be handed to someone else.'));
    if (
      !chore ||
      chore.member_id !== h.fromMemberId ||
      !person?.effectiveFrom ||
      !person.effectiveTo ||
      !members.includes(h.toMemberId) ||
      h.toMemberId === h.fromMemberId ||
      h.endDate < h.startDate ||
      h.startDate < person.effectiveFrom ||
      h.endDate > person.effectiveTo
    )
      fail(
        stored('error', 'A handoff needs an away person’s chore and an at-home family member within the away days.'),
      );
    if (
      input.keepDue.some(
        (k) => k.choreId === h.choreId && k.memberId === h.fromMemberId,
      )
    )
      fail(stored('error', 'Choose Keep due or a handoff for a chore.'));
    if (ctx.touches(h.toMemberId, h.startDate, h.endDate))
      conflicts.push({
        kind: 'recipient-away',
        text: stored('travel', 'The person receiving this chore is away on those dates.'),
        blocking: true,
        memberId: h.toMemberId,
        choreId: h.choreId,
      });
    if (
      [...ctx.rules, ...rules].some(
        (r) =>
          r.kind === 'handoff' &&
          r.chore_id === h.choreId &&
          r.start_date <= h.endDate &&
          r.end_date >= h.startDate,
      )
    )
      conflicts.push({
        kind: 'overlapping-handoff',
        text: stored('travel', 'This chore already has a handoff on these dates.'),
        blocking: true,
        choreId: h.choreId,
      });
    const id = crypto.randomUUID();
    rules.push({
      id,
      period_id: input.id ?? '',
      chore_id: h.choreId,
      from_member_id: h.fromMemberId,
      to_member_id: h.toMemberId,
      kind: 'handoff',
      start_date: h.startDate,
      end_date: h.endDate,
    });
    handoffs.push({
      ...h,
      id,
      choreTitle: chore.title,
      choreEmoji: chore.emoji,
    });
  }
  // An overlapping absence cannot silently turn off a previously agreed handoff recipient.
  for (const r of ctx.rules.filter((r) => r.kind === 'handoff'))
    if (extraPeople.some(p => p.member_id === r.to_member_id && p.start_date <= r.end_date && p.end_date >= r.start_date))
      conflicts.push({
        kind: 'recipient-away',
        text: stored('travel', 'An existing handoff recipient would be away. Change that handoff first.'),
        blocking: true,
        memberId: r.to_member_id!,
        choreId: r.chore_id,
      });
  const kids = (
    await db
      .prepare('SELECT member_id,to_school_by,from_school_by FROM school_kids')
      .all<{
        member_id: string;
        to_school_by: string | null;
        from_school_by: string | null;
      }>()
  ).results;
  const features=await readFeatures(db);
  const school=features.school&&kids.length?await loadSchoolDays(db,from,to):null;
  for (const kid of kids)
    for (const driver of new Set(
      [kid.to_school_by, kid.from_school_by].filter(
        (v): v is string => !!v && v !== 'bus',
      ),
    ))
      for (let day = from; day <= to; day = shiftGoalDate(day, 1))
        if (school&&school.kids.has(kid.member_id)&&['school','half'].includes(classifyDay(school.kids.get(kid.member_id)!,day,school.settings.rules,school.tz).kind)&&ctx.isAway(driver, day) && !ctx.isAway(kid.member_id, day)) {
          conflicts.push({
            kind: 'driver-away',
            text: stored('travel', 'A school driver is away while a child is home. Arrange another ride for those days. Reminders for the away driver pause; the usual ride settings stay unchanged.'),
            blocking: false,
            memberId: driver,
          });
          break;
        }
  const paused: z.infer<typeof AwayReviewSchema>['paused'] = [],
    kept: typeof paused = [],
    given: typeof paused = [];
  for (const person of people) {
    if (!person.effectiveFrom || !person.effectiveTo) continue;
    for (const chore of rows.filter((r) => r.member_id === person.memberId)) {
      const dates = [
        ...dueDates(chore, person.effectiveFrom, person.effectiveTo, tz),
      ];
      if (!dates.length) continue;
      const base = {
        memberId: person.memberId,
        choreId: chore.id,
        title: chore.title,
        emoji: chore.emoji,
        schoolwork:!!(chore.school_kind||chore.school_subject_id),
        dates,
      };
      const hs = input.handoffs.filter(
        (h) => h.choreId === chore.id && h.fromMemberId === person.memberId,
      );
      if (hs.length) {
        for (const h of hs)
          given.push({
            ...base,
            dates: dates.filter((d) => d >= h.startDate && d <= h.endDate),
            toMemberId: h.toMemberId,
          });
        const rest = dates.filter(
          (d) => !hs.some((h) => d >= h.startDate && d <= h.endDate),
        );
        if (rest.length) paused.push({ ...base, dates: rest });
      } else if (
        input.keepDue.some(
          (k) => k.choreId === chore.id && k.memberId === person.memberId,
        )
      )
        kept.push(base);
      else paused.push(base);
      if (!chore.rrule)
        conflicts.push({
          kind: 'one-off',
          text: stored('travel', 'A one-time chore falls during these away days. Its date stays unchanged.'),
          blocking: false,
          choreId: chore.id,
          memberId: person.memberId,
        });
      if((chore.school_kind||chore.school_subject_id)&&chore.school_days_off)conflicts.push({kind:'schoolwork-still-due',text:stored('travel', 'This schoolwork normally stays due on days off. Choose Pause or Keep due for these away days.'),blocking:false,memberId:person.memberId,choreId:chore.id});
    }
  }
  if(features.meals){const meals=(await db.prepare('SELECT id,title,date,eater_ids AS member_ids FROM meals WHERE date BETWEEN ? AND ?').bind(from,to).all<{id:string;title:string;date:string;member_ids:string}>()).results;
    for(const meal of meals){const ids:string[]=JSON.parse(meal.member_ids??'[]');if(people.some(p=>(!ids.length||ids.includes(p.memberId))&&p.effectiveFrom&&p.effectiveTo&&meal.date>=p.effectiveFrom&&meal.date<=p.effectiveTo))conflicts.push({kind:'meal',text:stored('travel', "Planned meal “{value0}” stays on {value1}. Move or remove it in Meals if needed.", {value0: meal.title, value1: meal.date}),blocking:false});}
  }
  if(features.upkeep)for(const job of await readJobs(db,from,iso=>todayInTz(tz,new Date(iso))))if(job.nextDue&&job.nextDue>=from&&job.nextDue<=to)conflicts.push({kind:'upkeep',text:stored('travel', "Home upkeep “{value0}” stays due on {value1}. Supplies and grown-up notices continue.", {value0: job.title, value1: job.nextDue}),blocking:false});
  const canonical = JSON.stringify({ ...input, token: undefined });
  const token = await derivedMac(
    c.env.ENCRYPTION_KEY ?? c.env.ADMIN_API_KEY ?? 'kinwall-away',
    'away-review',
    canonical + '\n' + source,
  );
  return {
    source,
    people,
    handoffs,
    rules,
    tz,
    review: {
      paused,
      keepDue: kept,
      handoffs: given,
      conflicts: conflicts.map(conflict => ({ ...conflict, text: translateStored(lang, 'travel', conflict.text) })),
      continues: [
        {
          kind: 'medicines',
          text: stored('travel', 'Medicines and health records keep their usual schedules.'),
        },
        {
          kind: 'home',
          text: stored('travel', 'Calendar events, meals, upkeep due dates and supplies stay unchanged.'),
        },
      ].map(line => ({ ...line, text: translateStored(lang, 'travel', line.text) })),
      token,
    },
  };
}
awayRoutes.use('/api/away*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
});
awayRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/away',
    tags: ['Away'],
    summary: 'Family away periods, independent of Trips',
    request: {
      query: z.object({
        from: z.string().optional(),
        to: z.string().optional(),
      }),
    },
    responses: { 200: response(z.array(AwayPeriodSchema)), ...errors },
  }),
  async (c) =>
    c.json(
      await readAwayPeriods(
        c.env.DB,
        c.req.valid('query').from,
        c.req.valid('query').to,
      ),
      200,
    ),
);
awayRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/away/preview',
    tags: ['Away'],
    summary: 'Review paused chores, handoffs and conflicts before saving',
    request: { body: body(AwayInputSchema) },
    responses: { 200: response(AwayReviewSchema), ...errors },
  }),
  async (c) => c.json((await review(c, c.req.valid('json'))).review, 200),
);
awayRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/away/{id}',
    tags: ['Away'],
    summary: 'Read one away period',
    request: { params },
    responses: { 200: response(AwayPeriodSchema), ...errors },
  }),
  async (c) => {
    const p = (await readAwayPeriods(c.env.DB)).find(
      (p) => p.id === c.req.valid('param').id,
    );
    if (!p) fail(stored('error', 'Away period not found.'), 404);
    return c.json(p, 200);
  },
);
for (const method of ['post', 'patch'] as const)
  awayRoutes.openapi(
    createRoute({
      method,
      path: method === 'post' ? '/api/away' : '/api/away/{id}',
      tags: ['Away'],
      summary: 'Save reviewed away days without rewriting schedules',
      request: {
        ...(method === 'patch' ? { params } : {}),
        body: body(AwayInputSchema),
      },
      responses: {
        200: response(AwayPeriodSchema),
        201: response(AwayPeriodSchema),
        ...errors,
      },
    }),
    async (c) => {
      const input = c.req.valid('json'),
        id = method === 'patch' ? c.req.param('id')! : crypto.randomUUID();
      if (method === 'patch' && input.id !== id) input.id = id;
      const result = await review(c, input);
      if (!input.token || input.token !== result.review.token)
        fail(stored('error', 'This review changed. Preview the away days again.'), 409);
      if (result.review.conflicts.some((v) => v.blocking))
        fail(
          stored('error', 'Resolve the handoff or school ride conflicts before saving.'),
          409,
        );
      const old = (await readAwayPeriods(c.env.DB)).find((p) => p.id === id);
      if (method === 'patch' && !old) fail(stored('error', 'Away period not found.'), 404);
      if (old && old.revision !== input.revision)
        fail(stored('error', 'These away days changed. Review them again.'), 409);
      const now = new Date().toISOString(),
        revision = (old?.revision ?? 0) + 1;
      const data = {
        ...input,
        id,
        token: undefined,
        people: result.people,
        handoffs: result.handoffs,
        timezone: result.tz,
        revision,
        createdBy: old?.createdBy ?? (await actorOf(c)).memberId,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
        tripTitle: null,
      };
      try {
        await c.env.DB.batch([
          c.env.DB.prepare(
            `SELECT json(CASE WHEN (${SOURCE_SQL.replace(/^SELECT /, '').replace(/ AS value$/, '')}) = ? THEN 'true' ELSE 'away_review_changed' END)`,
          ).bind(result.source),
          c.env.DB.prepare(
            'INSERT INTO away_periods(id,trip_id,data,revision,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET trip_id=excluded.trip_id,data=excluded.data,revision=excluded.revision,updated_at=excluded.updated_at',
          ).bind(
            id,
            input.tripId,
            JSON.stringify(data),
            revision,
            data.createdBy,
            data.createdAt,
            now,
          ),
          c.env.DB.prepare('DELETE FROM away_people WHERE period_id=?').bind(
            id,
          ),
          c.env.DB.prepare('DELETE FROM away_rules WHERE period_id=?').bind(id),
          ...result.people.flatMap((p) =>
            p.effectiveFrom && p.effectiveTo
              ? [
                  c.env.DB.prepare(
                    'INSERT INTO away_people VALUES(?,?,?,?)',
                  ).bind(id, p.memberId, p.effectiveFrom, p.effectiveTo),
                ]
              : [],
          ),
          ...result.rules.map((r) =>
            c.env.DB.prepare(
              'INSERT INTO away_rules VALUES(?,?,?,?,?,?,?,?)',
            ).bind(
              r.id,
              id,
              r.chore_id,
              r.from_member_id,
              r.to_member_id,
              r.kind,
              r.start_date,
              r.end_date,
            ),
          ),
        ]);
      } catch (e) {
        if (String(e).includes('malformed JSON'))
          fail(stored('error', 'This review changed. Preview the away days again.'), 409);
        throw e;
      }
      emit(c, 'settings.changed', {});
      emit(c, 'chore.changed', {});
      return c.json(
        (await readAwayPeriods(c.env.DB)).find((p) => p.id === id)!,
        method === 'post' ? 201 : 200,
      );
    },
  );
awayRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/away/{id}',
    tags: ['Away'],
    summary: 'End future away effects, preserving elapsed history',
    request: { params, query: z.object({ revision: z.coerce.number().int().min(1) }) },
    responses: { 200: response(z.object({ ok: z.boolean() })), ...errors },
  }),
  async (c) => {
    const id = c.req.valid('param').id,
      period = (await readAwayPeriods(c.env.DB)).find((p) => p.id === id);
    if (!period) fail(stored('error', 'Away period not found.'), 404);
    const revision = c.req.valid('query').revision;
    if (period.revision !== revision) fail(stored('error', 'These away days changed. Review them again.'), 409);
    const { tz } = await household(c.env.DB),
      last = shiftGoalDate(todayInTz(tz), -1);
    const people = period.people
      .filter((p) => p.effectiveFrom && p.effectiveFrom <= last)
      .map((p) =>
        p.endDate > last
          ? { ...p, endDate: last, returnDayAway: true, effectiveTo: last }
          : p,
      );
    const handoffs = period.handoffs
      .filter((h) => h.startDate <= last)
      .map((h) => ({ ...h, endDate: h.endDate > last ? last : h.endDate }));
    const keepDue = period.keepDue.filter((k) =>
      people.some((p) => p.memberId === k.memberId),
    );
    try { await c.env.DB.batch([
      c.env.DB.prepare("SELECT json(CASE WHEN EXISTS(SELECT 1 FROM away_periods WHERE id=? AND revision=?) THEN 'true' ELSE 'away_period_changed' END)").bind(id, revision),
      ...(people.length
        ? [
            c.env.DB.prepare(
              'UPDATE away_periods SET data=?,revision=revision+1,updated_at=? WHERE id=?',
            ).bind(
              JSON.stringify({ ...period, people, handoffs, keepDue }),
              new Date().toISOString(),
              id,
            ),
            c.env.DB.prepare(
              'DELETE FROM away_people WHERE period_id=? AND start_date>?',
            ).bind(id, last),
            c.env.DB.prepare(
              'UPDATE away_people SET end_date=? WHERE period_id=? AND end_date>?',
            ).bind(last, id, last),
            c.env.DB.prepare(
              'DELETE FROM away_rules WHERE period_id=? AND start_date>?',
            ).bind(id, last),
            c.env.DB.prepare(
              'UPDATE away_rules SET end_date=? WHERE period_id=? AND end_date>?',
            ).bind(last, id, last),
          ]
        : [c.env.DB.prepare('DELETE FROM away_periods WHERE id=?').bind(id)]),
    ]); } catch (error) {
      if (String(error).includes('malformed JSON')) fail(stored('error', 'These away days changed. Review them again.'), 409);
      throw error;
    }
    emit(c, 'settings.changed', {});
    emit(c, 'chore.changed', {});
    return c.json({ ok: true }, 200);
  },
);
