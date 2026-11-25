import { stored, requestLang, translateStored } from '../i18n.ts';
import { createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import type { Env } from '../env.ts';
import type { KinwallStatement } from '../db.ts';
import { createRouter } from '../router.ts';
import {
  TripSchema,
  TripSummarySchema,
  TripInputSchema,
  TripPatchSchema,
  StopInputSchema,
  StayGroupInputSchema,
  StayInputSchema,
  StayPriceSchema,
  LegInputSchema,
  ItemInputSchema,
  PublicTravelUrlSchema,
  endpointInstant,
  type Trip,
  CareInputSchema, CareSchema, validCareDates, sparseShape,
} from '../travel-schemas.ts';
import { tripClock, planChecks } from '../travel-context.ts';
import { household } from './members.ts';
import { ErrorSchema } from '../schemas.ts';
import { readFeatures } from './settings.ts';
import { actorOf, requestKey, isConnectedApp, ownerBlock, deviceOwner } from '../auth.ts';
import { encrypt, decrypt } from '../crypto.ts';
import { emit } from '../bus.ts';
import { grownUpViewer, hiddenTripIds, tripVisible } from '../trip-audience.ts';
import { readPolls } from './polls.ts';
import { fetchRecipeImage, fetchRecipePage } from '../outbound.ts';
import { clean, openingTags, jsonLdNodes, isType } from '../recipe-web.ts';
import { createEvent } from './events.ts';
import { EventInputSchema } from '../schemas.ts';
import { shiftGoalDate } from '../chore-goal.ts';
import { readAwayPeriods } from './away.ts';
export const travelRoutes = createRouter();
type C = Context<{ Bindings: Env }>;
type Row = {
  id: string;
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
  description: 'Trip',
  ...body(schema),
});
const errors = Object.fromEntries(
  [400, 403, 404, 409, 502].map((n) => [
    n,
    {
      description: 'Invalid, forbidden, missing, changed or unavailable',
      ...body(ErrorSchema),
    },
  ]),
);
const params = z.object({ id: z.string() }),
  childParams = params.extend({ childId: z.string() }),
  revision = z.number().int().min(1);
function fail(
  message: string,
  status: 400 | 403 | 404 | 409 | 502 = 400,
): never {
  throw new HTTPException(status, { message });
}
async function parent(c: C) {
  if ((await requestKey(c))?.scope !== 'admin')
    fail(stored('error', 'A grown-up needs to manage this plan.'), 403);
}
async function members(c: C, ids: string[]) {
  if (new Set(ids).size !== ids.length) fail(stored('error', 'Choose each person once.'));
  for (const id of ids)
    if (
      !(await c.env.DB.prepare('SELECT id FROM members WHERE id=?')
        .bind(id)
        .first())
    )
      fail(stored('error', 'Choose a person in your family.'));
}
async function privateAllowed(c: C, t: Trip): Promise<boolean> {
  if (await isConnectedApp(c)) return false;
  if (await grownUpViewer(c)) return true;
  const k = await requestKey(c);
  if (!k?.owner || k.owner === 'shared')
    return t.detailsAudience === 'everyone' && t.detailsOnWall;
  return t.detailsAudience === 'everyone';
}
export async function careAllowed(c: C): Promise<boolean> {
  if (await isConnectedApp(c)) return false;
  const k = await requestKey(c);
  if(k?.deviceKind==='wall' || k?.deviceKind==='kid' || k?.owner==='shared')return false;
  if (k?.scope === 'admin') return true;
  if (k?.deviceKind !== 'grownup' || !k?.owner || k.owner === 'shared') return false;
  return !!(await c.env.DB.prepare('SELECT grown_up FROM members WHERE id=?').bind(k.owner).first<{grown_up:number}>())?.grown_up;
}
export const careAad = (tripId: string, id: string) => JSON.stringify(['trip-care',tripId,id]);
const childTables = {
  stops: 'trip_stops',
  'stay-groups': 'trip_stay_groups',
  stays: 'trip_stays',
  legs: 'trip_legs',
  items: 'trip_items',
} as const;
/** Raw backup reads deliberately bypass feature gates; false never decrypts protected data. */
export async function readTrip(
  c: C,
  id: string,
  includeDetails = true,
): Promise<Trip | null> {
  const db = c.env.DB,
    row = await db
      .prepare('SELECT * FROM trips WHERE id=?')
      .bind(id)
      .first<Row>();
  if (!row) return null;
  const values = await db.batch<{ id: string; data: string }>(
    Object.values(childTables).map((table) =>
      db.prepare(`SELECT id,data FROM ${table} WHERE trip_id=?`).bind(id),
    ),
  );
  const [stops, groups, stays, legs, items] = values.map((res) =>
    res.results
      .map((v) => ({ ...JSON.parse(v.data), id: v.id }))
      .sort(
        (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.id.localeCompare(b.id),
      ),
  );
  const t = {
    audience: 'everyone', audienceMemberIds: [], connectedApps: false, // saved before the settings existed
    ...JSON.parse(row.data),
    id,
    revision: row.revision,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as Trip;
  t.viewTimeZone ??= null;
  const knownMembers=new Set((await db.prepare('SELECT id FROM members').all<{id:string}>()).results.map(m=>m.id));
  t.memberIds=t.memberIds.filter(id=>knownMembers.has(id));t.marks=t.marks.filter(m=>knownMembers.has(m.memberId));
  t.packingListIds=(await db.prepare('SELECT id FROM lists WHERE id IN(SELECT value FROM json_each(?)) AND archived=0').bind(JSON.stringify(t.packingListIds)).all<{id:string}>()).results.map(r=>r.id);
  t.canSeeDetails = includeDetails && (await privateAllowed(c, t));
  const secrets = (
    await db
      .prepare('SELECT id,data FROM trip_private WHERE trip_id=?')
      .bind(id)
      .all<{ id: string; data: string }>()
  ).results;
  for (const child of [...stays, ...legs]) {
    const secret = secrets.find((s) => s.id === child.id);
    child.hasDetails = !!secret;
    child.details =
      secret && t.canSeeDetails
        ? JSON.parse(await decrypt(c.env, secret.data, secret.id))
        : null;
  }
  const features = await readFeatures(db);
  // Keep context internally even when Polls is off, to enforce frozen decision meaning.
  const polls = await readPolls(db, { includeHidden: true });
  t.stops = stops;
  t.legs = legs;
  t.stayGroups = groups.map((g) => {
    const poll = polls.find((p) => p.id === g.pollId);
    return {
      ...g,
      options: stays.filter((s) => s.groupId === g.id),
      poll: poll && features.polls
        ? {
            id: poll.id,
            status: poll.status,
            options: poll.options.map((o) => ({ id: o.id, stayId: o.stayId })),
            votes: poll.options.flatMap((o) =>
              o.votes.map((memberId) => ({
                memberId,
                optionId: o.stayId ?? o.id,
              })),
            ),
            voterIds: t.memberIds,
          }
        : null,
    };
  });
  t.items = items;
  for (const item of t.items) {
    item.missing = false;
    if (item.kind !== 'activity') {
      const table = { outing: 'outings', meal: 'meals', event: 'events' }[
        item.kind
      ];
      item.missing =
        !item.refId ||
        !(await db
          .prepare(`SELECT id FROM ${table} WHERE id=?`)
          .bind(item.refId)
          .first());
    }
  }
  const pubs = (
    await db
      .prepare('SELECT * FROM trip_publications WHERE trip_id=?')
      .bind(id)
      .all<{
        source_kind: 'span' | 'leg' | 'stay' | 'item';
        source_id: string;
        calendar_id: string;
        event_id: string | null;
        state: 'added' | 'failed' | 'pending';
      }>()
  ).results;
  const link = (p: (typeof pubs)[number]) => ({
    eventId: p.event_id,
    calendarId: p.calendar_id,
    state: p.state,
    error:
      p.state === 'failed'
        ? 'Check the calendar before trying again.'
        : p.state === 'pending'
          ? 'Calendar save needs review.'
          : null,
  });
  t.calendar = {
    span: pubs.some((p) => p.source_kind === 'span')
      ? link(pubs.find((p) => p.source_kind === 'span')!)
      : null,
    items: pubs.flatMap((p) =>
      p.source_kind === 'span'
        ? []
        : [{ kind: p.source_kind, id: p.source_id, link: link(p) }],
    ),
  };
  t.awayPeriodIds = (
    await db
      .prepare('SELECT id FROM away_periods WHERE trip_id=?')
      .bind(id)
      .all<{ id: string }>()
  ).results.map((v) => v.id);
  t.counts = {
    stops: stops.length,
    stayGroups: groups.length,
    staysChosen: groups.filter((g) => g.chosenOptionId).length,
    staysBooked: stays.filter((s) =>
      ['booked', 'confirmed_family'].includes(s.booking),
    ).length,
    legs: legs.length,
    legsBooked: legs.filter((l) => l.booking === 'booked').length,
    openVotes: t.stayGroups.filter((g) => g.poll?.status === 'open').length,
    planned: items.filter((i) => i.date).length,
    ideas: items.filter((i) => !i.date).length,
  };
  const k = await requestKey(c), admin = k?.scope === 'admin';
  t.can = {
    edit: admin,
    addStays: admin,
    choose: admin,
    suggest: admin || !!(await deviceOwner(c)),
    vote: features.polls && (admin || !k?.owner || k.owner === 'shared' || t.memberIds.includes(k.owner)),
  };
  t.canSeeCare = includeDetails && await careAllowed(c);
  t.canEditCare = t.canSeeCare && !!admin;
  t.care = [];
  t.careUnavailable = false;
  if(t.canSeeCare) {
    const rows=(await db.prepare('SELECT id,data FROM trip_care WHERE trip_id=?').bind(id).all<{id:string;data:string}>()).results;
    for(const row of rows) {
      try {
        const care=CareSchema.parse({...JSON.parse(await decrypt(c.env,row.data,careAad(id,row.id))),id:row.id});
        if(!validCareDates(care)){t.careUnavailable=true;continue;}
        t.care.push(care);
      } catch { t.careUnavailable=true; }
    }
    t.care.sort((a,b)=>a.sort-b.sort || a.id.localeCompare(b.id));
  }
  t.travelDay = tripClock(t,new Date(),(await household(db)).tz);
  t.checks = planChecks(t);
  return t;
}
async function trip(c: C): Promise<Trip> {
  const t = await readTrip(c, c.req.param('id')!);
  // A trip someone may not see reads as missing, so a surprise stays one.
  if (!t || !(await tripVisible(c, t))) fail(stored('error', 'Trip not found.'), 404);
  return t;
}
function tripData(t: Trip) {
  return {
    ...TripInputSchema.parse(
      Object.fromEntries(
        Object.keys(TripInputSchema.shape).map((k) => [
          k,
          (t as unknown as Record<string, unknown>)[k],
        ]),
      ),
    ),
    marks: t.marks,
  };
}
async function mutate(
  c: C,
  t: Trip,
  rev: number,
  writes: KinwallStatement[] = [],
  data = tripData(t),
) {
  if (rev !== t.revision)
    fail(stored('error', 'This trip changed. Open it again before saving.'), 409);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM trips WHERE id=? AND revision=?) THEN 'true' ELSE 'trip_changed' END)",
      ).bind(t.id, rev),
      ...writes,
      c.env.DB.prepare(
        'UPDATE trips SET data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',
      ).bind(JSON.stringify(data), new Date().toISOString(), t.id, rev),
    ]);
  } catch (e) {
    if (String(e).includes('malformed JSON'))
      fail(stored('error', 'This trip changed. Open it again before saving.'), 409);
    throw e;
  }
  emit(c, 'trip.changed', { id: t.id });
  return (await readTrip(c, t.id))!;
}
async function validateTrip(c: C, t: z.infer<typeof TripInputSchema>) {
  if (t.endDate && (!t.startDate || t.endDate < t.startDate))
    fail(stored('error', 'Choose an end date on or after the start date.'));
  if (t.detailsOnWall && t.detailsAudience !== 'everyone')
    fail(stored('error', 'Choose Everyone before showing booking details on the wall.'));
  await members(c, t.memberIds);
  await members(c, t.audienceMemberIds);
  for (const id of t.packingListIds)
    if (
      !(await c.env.DB.prepare(
        "SELECT id FROM lists WHERE id=? AND archived=0",
      )
        .bind(id)
        .first())
    )
      fail(stored('error', 'Choose an existing active list.'));
}
travelRoutes.use('/api/trips*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  if (!(await readFeatures(c.env.DB)).trips)
    return c.json({ error: 'Trips is turned off in Features.' }, 404);
  await next();
});
travelRoutes.openapi(createRoute({
  method: 'get', path: '/api/trips/links', tags: ['Trips'],
  summary: 'Basic trip links for meals, outings and calendar events; no reservation details',
  responses: { 200: response(z.array(z.object({ kind: z.enum(['meal','event','outing']), refId: z.string(), tripId: z.string(), title: z.string(), emoji: z.string().nullable() }))), ...errors },
}), async c => {
  const db = c.env.DB;
  const [trips, items, publications] = await db.batch<{id:string;data:string;trip_id:string;event_id:string}>([
    db.prepare('SELECT id,data FROM trips'),
    db.prepare('SELECT trip_id,data FROM trip_items'),
    db.prepare("SELECT trip_id,event_id FROM trip_publications WHERE event_id IS NOT NULL AND state='added'"),
  ]);
  const hidden = await hiddenTripIds(c);
  const byId = new Map(trips.results.filter(row => !hidden.has(row.id)).map(row => [row.id, TripInputSchema.strip().parse(JSON.parse(row.data))]));
  const links = new Map<string,{kind:'meal'|'event'|'outing';refId:string;tripId:string;title:string;emoji:string|null}>();
  const add = (kind:'meal'|'event'|'outing', refId:string, tripId:string) => {
    const trip = byId.get(tripId); if (!trip) return;
    links.set(`${kind}:${refId}:${tripId}`, {kind,refId,tripId,title:trip.title,emoji:trip.emoji});
  };
  for (const row of items.results) {
    const item = ItemInputSchema.strip().parse(JSON.parse(row.data));
    if (item.kind !== 'activity' && item.refId) add(item.kind, item.refId, row.trip_id);
  }
  for (const row of publications.results) add('event', row.event_id, row.trip_id);
  return c.json([...links.values()], 200);
});
travelRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/trips',
    tags: ['Trips'],
    summary:
      'Basic family trip plans, including trips this child is not joining',
    request: { query: z.object({ archived: z.string().optional() }) },
    responses: { 200: response(z.array(TripSummarySchema)), ...errors },
  }),
  async (c) => {
    const hidden = await hiddenTripIds(c);
    const rows = (
      await c.env.DB.prepare(
        'SELECT id FROM trips ORDER BY updated_at DESC,id',
      ).all<{ id: string }>()
    ).results.filter((r) => !hidden.has(r.id));
    const all = await Promise.all(rows.map((r) => readTrip(c, r.id, false)));
    return c.json(
      all
        .filter(
          (t): t is Trip =>
            !!t && (!t.archivedAt || c.req.valid('query').archived === '1'),
        )
        .map((t) => ({
          ...tripData(t),
          id: t.id,
          revision: t.revision,
          createdBy: t.createdBy,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          counts: t.counts,
          travelDay: t.travelDay,
        })),
      200,
    );
  },
);
travelRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/trips',
    tags: ['Trips'],
    summary: 'Create a trip idea or dated plan',
    request: { body: body(TripInputSchema) },
    responses: { 201: response(TripSchema), ...errors },
  }),
  async (c) => {
    await parent(c);
    const input = c.req.valid('json');
    const raw=await c.req.json();
    if (
      (await isConnectedApp(c)) &&
      ('detailsAudience' in raw || 'detailsOnWall' in raw || 'audience' in raw || 'audienceMemberIds' in raw || 'connectedApps' in raw)
    )
      fail(stored('error', 'Connected apps cannot change who sees a trip or its booking details.'), 403);
    await validateTrip(c, input);
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await c.env.DB.prepare(
      'INSERT INTO trips(id,data,created_by,created_at,updated_at) VALUES(?,?,?,?,?)',
    )
      .bind(
        id,
        JSON.stringify({ ...input, marks: [] }),
        (await actorOf(c)).memberId,
        now,
        now,
      )
      .run();
    emit(c, 'trip.changed', { id });
    return c.json((await readTrip(c, id))!, 201);
  },
);
travelRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/trips/{id}',
    tags: ['Trips'],
    summary: 'Read a trip, with booking details projected for the viewer',
    request: { params },
    responses: { 200: response(TripSchema), ...errors },
  }),
  async (c) => c.json(await trip(c), 200),
);
travelRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/trips/{id}',
    tags: ['Trips'],
    summary:
      'Edit a trip; date edits never move existing arrangements or away days',
    request: { params, body: body(TripPatchSchema) },
    responses: { 200: response(TripSchema), ...errors },
  }),
  async (c) => {
    await parent(c);
    const { revision: rev, ...input } = c.req.valid('json');
    if (
      (await isConnectedApp(c)) &&
      ('detailsAudience' in input || 'detailsOnWall' in input || 'audience' in input || 'audienceMemberIds' in input || 'connectedApps' in input)
    )
      fail(stored('error', 'Connected apps cannot change who sees a trip or its booking details.'), 403);
    const t = await trip(c);
    if (
      input.memberIds &&
      JSON.stringify(input.memberIds) !== JSON.stringify(t.memberIds) &&
      t.stayGroups.some((g) => g.poll?.status === 'open')
    )
      fail(stored('error', 'Close the stay vote before changing its participants.'), 409);
    const data = { ...tripData(t), ...input };
    await validateTrip(c, data);
    return c.json(await mutate(c, t, rev, [], data), 200);
  },
);
travelRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/trips/{id}',
    tags: ['Trips'],
    summary:
      'Delete a trip, preserving linked calendars, meals, outings and away history',
    request: {
      params,
      query: z.object({ revision: z.coerce.number().int().min(1) }),
    },
    responses: { 200: response(z.object({ ok: z.boolean() })), ...errors },
  }),
  async (c) => {
    await parent(c);
    const t = await trip(c),
      rev = c.req.valid('query').revision;
    if (rev !== t.revision) fail(stored('error', 'This trip changed. Review it again.'), 409);
    try { await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE trips SET revision=CASE WHEN revision=? THEN revision ELSE NULL END WHERE id=?',
      ).bind(rev, t.id),
      c.env.DB.prepare(
        'DELETE FROM polls WHERE id IN(SELECT poll_id FROM trip_stay_polls WHERE trip_id=?)',
      ).bind(t.id),
      c.env.DB.prepare('DELETE FROM trips WHERE id=?').bind(t.id),
    ]); } catch (error) {
      if (String(error).includes('trips.revision')) fail(stored('error', 'This trip changed. Review it again.'), 409);
      throw error;
    }
    emit(c, 'trip.changed', { id: t.id });
    return c.json({ ok: true }, 200);
  },
);
const markInput = z.object({
  memberId: z.string(),
  kind: z.enum(['interested', 'really']).nullable(),
});
for (const item of [false, true])
  travelRoutes.openapi(
    createRoute({
      method: 'put',
      path: item
        ? '/api/trips/{id}/items/{childId}/marks'
        : '/api/trips/{id}/marks',
      tags: ['Trips'],
      summary: 'Set or remove your interest in a trip or activity',
      request: { params: item ? childParams : params, body: body(markInput) },
      responses: { 200: response(TripSchema), ...errors },
    }),
    async (c) => {
      const t = await trip(c),
        { memberId, kind } = c.req.valid('json');
      const blocked = await ownerBlock(c, memberId);
      if (blocked) fail(blocked, 403);
      await members(c, [memberId]);
      const target = item
        ? t.items.find(
            (i) => i.id === c.req.param('childId') && i.kind === 'activity',
          )
        : t;
      if (!target) fail(stored('error', 'Activity not found.'), 404);
      target.marks = [
        ...target.marks.filter((m) => m.memberId !== memberId),
        ...(kind ? [{ memberId, kind }] : []),
      ];
      return c.json(
        await mutate(
          c,
          t,
          t.revision,
          item
            ? [
                c.env.DB.prepare(
                  'UPDATE trip_items SET data=? WHERE id=? AND trip_id=?',
                ).bind(JSON.stringify(Object.fromEntries(Object.entries(target).filter(([key]) => key !== 'missing'))), target.id, t.id),
              ]
            : [],
        ),
        200,
      );
    },
  );
for (const method of ['post','patch','delete'] as const) {
  const create = method === 'post';
  travelRoutes.openapi(createRoute({
    method, path:create ? '/api/trips/{id}/care' : '/api/trips/{id}/care/{childId}',tags:['Trips'],
    summary:'Manage private manual home or pet care on a full-access device; never creates chores or helper access',
    request:{params:create ? params : childParams,...(method==='delete' ? {query:z.object({revision:z.coerce.number().int().min(1)}).strict()} : {body:body((create ? CareInputSchema : z.object(sparseShape(CareInputSchema.shape)).strict()).extend({revision}).strict())})},
    responses:{200:response(TripSchema),201:response(TripSchema),...errors},
  }),async c=>{
    await parent(c);
    if(!await careAllowed(c))fail(stored('error', 'Manage private care from a grown-up’s own device.'),403);
    const t=await trip(c), id=create ? crypto.randomUUID() : c.req.param('childId')!;
    const old=t.care.find(v=>v.id===id);
    if(!create && !old)fail(stored('error', 'Care arrangement not found.'),404);
    const raw=method==='delete' ? {} : await c.req.json();
    const expected=method==='delete' ? Number(c.req.query('revision')) : raw.revision;
    if(create && (await c.env.DB.prepare('SELECT COUNT(*) AS count FROM trip_care WHERE trip_id=?').bind(t.id).first<{count:number}>())!.count>=100)fail(stored('error', 'A trip can have up to 100 care arrangements.'));
    let statement:KinwallStatement;
    if(method==='delete')statement=c.env.DB.prepare('DELETE FROM trip_care WHERE id=? AND trip_id=?').bind(id,t.id);
    else {
      const {revision:_rev,...fields}=raw;
      const parsed=CareInputSchema.safeParse(Object.fromEntries(Object.entries({...old,...fields}).filter(([key])=>key in CareInputSchema.shape)));
      if(!parsed.success || !validCareDates(parsed.data))fail(stored('error', 'Check the care dates and checklist. Use a date range of at most ten years.'));
      const payload={...parsed.data,id,updatedAt:new Date().toISOString()};
      const encrypted=await encrypt(c.env,JSON.stringify(payload),careAad(t.id,id));
      statement=c.env.DB.prepare('INSERT INTO trip_care(id,trip_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(id,t.id,encrypted);
    }
    return c.json(await mutate(c,t,expected,[statement]),create ? 201 : 200);
  });
}
const schemas = {
  stops: StopInputSchema,
  'stay-groups': StayGroupInputSchema,
  stays: StayInputSchema,
  legs: LegInputSchema,
  items: ItemInputSchema,
};
for (const kind of Object.keys(childTables) as (keyof typeof childTables)[])
  for (const method of ['post', 'patch', 'delete'] as const) {
    const schema = schemas[kind];
    travelRoutes.openapi(
      createRoute({
        method,
        path:
          method === 'post'
            ? `/api/trips/{id}/${kind}`
            : `/api/trips/{id}/${kind}/{childId}`,
        tags: ['Trips'],
        summary: `${method} trip ${kind}; grown-ups manage plans, children suggest activities`,
        request: {
          params: method === 'post' ? params : childParams,
          ...(method === 'delete'
            ? { query: z.object({ revision: z.coerce.number().int().min(1) }) }
            : {
                body: body(
                  (method === 'post' ? schema : schema.partial()).extend({
                    revision: revision.optional(),
                  }),
                ),
              }),
        },
        responses: {
          200: response(TripSchema),
          201: response(TripSchema),
          ...errors,
        },
      }),
      async (c) => {
        const t = await trip(c),
          admin = (await requestKey(c))?.scope === 'admin',
          raw = method === 'delete' ? {} : await c.req.json(),
          { revision: rev, ...fields } = raw;
        if (
          !admin &&
          !(
            method === 'post' &&
            kind === 'items' &&
            !!(await deviceOwner(c)) &&
            fields.kind === 'activity' &&
            !fields.date &&
            !fields.time
          )
        )
          fail(stored('error', 'A grown-up needs to manage this plan.'), 403);
        const expected =
          method === 'delete'
            ? Number(c.req.query('revision'))
            : (rev ?? (!admin ? t.revision : 0));
        if (!expected) fail(stored('error', 'Include the current trip revision.'));
        const id =
          method === 'post' ? crypto.randomUUID() : c.req.param('childId')!;
        const table = childTables[kind],
          row =
            method === 'post'
              ? null
              : await c.env.DB.prepare(
                  `SELECT data FROM ${table} WHERE id=? AND trip_id=?`,
                )
                  .bind(id, t.id)
                  .first<{ data: string }>();
        if (method !== 'post' && !row) fail(stored('error', 'Plan item not found.'), 404);
        const old = row ? JSON.parse(row.data) : null;
        const merged = { ...old, ...fields };
        const input: any =
          method === 'delete'
            ? old
            : schema.parse(
                Object.fromEntries(
                  Object.keys(schema.shape)
                    .filter((k) => k in merged)
                    .map((k) => [k, merged[k]]),
                ),
              );
        const writes: KinwallStatement[] = [];
        if (kind === 'stays' || kind === 'stay-groups') {
          const group =
            kind === 'stays'
              ? t.stayGroups.find(
                  (g) => g.id === (input?.groupId ?? old?.groupId),
                )
              : t.stayGroups.find((g) => g.id === id);
          if (kind === 'stays' && !group)
            fail(stored('error', 'Stay group not found in this trip.'));
          const material =
            kind === 'stay-groups' ||
            method !== 'patch' ||
            Object.keys(fields).some(
              k => !['booking', 'notes', 'details'].includes(k) && JSON.stringify(input?.[k]) !== JSON.stringify(old?.[k]),
            );
          const previousGroup=kind==='stays'&&old?.groupId!==input.groupId?t.stayGroups.find(g=>g.id===old?.groupId):undefined;
          const affected=[...new Set([group,previousGroup].filter((g):g is NonNullable<typeof g>=>!!g))];
          for(const group of affected){
          const currentPoll=group.pollId?(await readPolls(c.env.DB,{id:group.pollId,includeHidden:true}))[0]:null;
          if (currentPoll?.status === 'open' && material)
            fail(stored('error', 'Close the stay vote before changing its choices.'), 409);
          if (material && (group.pollId || (kind==='stays'&&group.chosenOptionId===id))) {
            const { options: _, poll: __, ...gd } = group;
            gd.pollId = null;
            if (kind === 'stays' && group.chosenOptionId === id) {
              gd.chosenOptionId = null;
              gd.chosenBy = null;
              gd.chosenAt = null;
            }
            writes.push(
              c.env.DB.prepare(
                'UPDATE trip_stay_groups SET data=? WHERE id=?',
              ).bind(JSON.stringify(gd), group.id),
            );
            if(kind==='stay-groups'&&old)old.pollId=null;
          }
          }
        }
        if (method !== 'delete') {
          if (
            kind === 'stops' &&
            input.arriveDate &&
            input.leaveDate &&
            input.leaveDate < input.arriveDate
          )
            fail(stored('error', 'A stop cannot end before it starts.'));
          if (kind === 'stay-groups') {
            if (input.stopId && !t.stops.some((s) => s.id === input.stopId))
              fail(stored('error', 'Stop not found in this trip.'));
            if (
              input.checkIn &&
              input.checkOut &&
              input.checkOut < input.checkIn
            )
              fail(stored('error', 'Checkout cannot be before check-in.'));
          }
          if (kind === 'stays') {
            if (input.booking === 'confirmed_family' && input.kind !== 'family')
              fail(stored('error', 'Confirmed with family is for family homes.'));
            if (input.cost === 'price' && !input.price)
              fail(stored('error', 'Enter the price and its currency.'));
            if (input.cost === 'free') input.price = null;
          }
          if (kind === 'legs') {
            await members(c, input.memberIds);
            let depart: Date | null, arrive: Date | null;
            try {
              depart = endpointInstant(
                input.departDate,
                input.departTime,
                input.departTz,
              );
              arrive = endpointInstant(
                input.arriveDate,
                input.arriveTime,
                input.arriveTz,
              );
            } catch {
              fail(
                stored('error', 'Choose a local time that exists in the endpoint time zone.'),
              );
            }
            if (depart! && arrive! && arrive! < depart!)
              fail(stored('error', 'Arrival cannot be before departure.'));
          }
          if (kind === 'items') {
            if (input.kind === 'activity') {
              if (!input.title) fail(stored('error', 'Give this activity a name.'));
            } else {
              const features = await readFeatures(c.env.DB);
              if (
                (input.kind === 'outing' && !features.outings) ||
                (input.kind === 'meal' && !features.meals)
              )
                fail(stored('error', 'Turn on the linked feature first.'));
              const tbl = { outing: 'outings', meal: 'meals', event: 'events' }[
                input.kind as 'outing' | 'meal' | 'event'
              ];
              if (
                !input.refId ||
                !(await c.env.DB.prepare(`SELECT id FROM ${tbl} WHERE id=?`)
                  .bind(input.refId)
                  .first())
              )
                fail(stored('error', 'Linked plan not found.'));
              if (!input.label) fail(stored('error', 'Give the linked plan a label.'));
            }
          }
        }
        if ('details' in fields) {
          if (await isConnectedApp(c))
            fail(stored('error', 'Connected apps cannot read or change booking details.'), 403);
          const secret = fields.details;
          if (secret)
            writes.push(
              c.env.DB.prepare(
                'INSERT INTO trip_private(id,trip_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
              ).bind(
                id,
                t.id,
                await encrypt(c.env, JSON.stringify(input.details), id),
              ),
            );
          else
            writes.push(
              c.env.DB.prepare(
                'DELETE FROM trip_private WHERE id=? AND trip_id=?',
              ).bind(id, t.id),
            );
        }
        if (method === 'delete') {
          if(kind==='stay-groups')writes.unshift(c.env.DB.prepare('DELETE FROM polls WHERE id IN(SELECT poll_id FROM trip_stay_polls WHERE group_id=?)').bind(id));
          writes.push(
            c.env.DB.prepare(
              `DELETE FROM ${table} WHERE id=? AND trip_id=?`,
            ).bind(id, t.id),
            c.env.DB.prepare(
              'DELETE FROM trip_private WHERE id=? AND trip_id=?',
            ).bind(id, t.id),
          );
          if (kind === 'stay-groups')
            writes.unshift(
              c.env.DB.prepare(
                'DELETE FROM trip_private WHERE id IN(SELECT id FROM trip_stays WHERE group_id=?)',
              ).bind(id),
            );
          if (kind === 'stops')
            for (const g of t.stayGroups.filter((g) => g.stopId === id)) {
              const { options: _, poll: __, ...data } = g;
              writes.push(
                c.env.DB.prepare(
                  'UPDATE trip_stay_groups SET data=? WHERE id=?',
                ).bind(JSON.stringify({ ...data, stopId: null }), g.id),
              );
            }
        } else {
          const { details: _, ...data } = input;
          const meta =
            kind === 'stays'
              ? {
                  addedBy: old?.addedBy ?? (await actorOf(c)).memberId,
                  bookedBy:
                    input.booking === old?.booking
                      ? old?.bookedBy ?? null
                      : input.booking === 'none'
                      ? null
                      : (await actorOf(c)).memberId,
                }
              : kind === 'stay-groups'
                ? {
                    pollId: old?.pollId ?? null,
                    chosenOptionId: old?.chosenOptionId ?? null,
                    chosenBy: old?.chosenBy ?? null,
                    chosenAt: old?.chosenAt ?? null,
                  }
                : kind === 'items'
                  ? {
                      suggestedBy:
                        old?.suggestedBy ?? (await actorOf(c)).memberId,
                      marks: old?.marks ?? [],
                    }
                  : {};
          const value = JSON.stringify({ ...data, ...meta, id });
          writes.push(
            kind === 'stays'
              ? c.env.DB.prepare(
                  'INSERT INTO trip_stays(id,trip_id,group_id,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id,data=excluded.data',
                ).bind(id, t.id, input.groupId, value)
              : c.env.DB.prepare(
                  `INSERT INTO ${table}(id,trip_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
                ).bind(id, t.id, value),
          );
        }
        return c.json(
          await mutate(c, t, expected, writes),
          method === 'post' ? 201 : 200,
        );
      },
    );
  }
travelRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/trips/{id}/stay-groups/{childId}/choose',
    tags: ['Trips'],
    summary: 'Explicitly choose a stay, independently of votes and booking',
    request: {
      params: childParams,
      body: body(z.object({ revision, optionId: z.string().nullable() })),
    },
    responses: { 200: response(TripSchema), ...errors },
  }),
  async (c) => {
    await parent(c);
    const t = await trip(c),
      g = t.stayGroups.find((g) => g.id === c.req.param('childId'));
    if (!g) fail(stored('error', 'Stay group not found.'), 404);
    const input = c.req.valid('json');
    if (input.optionId && !g.options.some((o) => o.id === input.optionId))
      fail(stored('error', 'Choose an option in this stay group.'));
    const { options: _, poll: __, ...data } = g;
    return c.json(
      await mutate(c, t, input.revision, [
        c.env.DB.prepare('UPDATE trip_stay_groups SET data=? WHERE id=?').bind(
          JSON.stringify({
            ...data,
            chosenOptionId: input.optionId,
            chosenBy: input.optionId ? (await actorOf(c)).memberId : null,
            chosenAt: input.optionId ? new Date().toISOString() : null,
          }),
          g.id,
        ),
      ]),
      200,
    );
  },
);
travelRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/trips/{id}/stay-groups/{childId}/vote',
    tags: ['Trips'],
    summary: 'Start or restart a participant stay vote using Family polls',
    request: {
      params: childParams,
      body: body(z.object({ revision, restart: z.boolean().optional() })),
    },
    responses: { 200: response(TripSchema), ...errors },
  }),
  async (c) => {
    await parent(c);
    if (!(await readFeatures(c.env.DB)).polls)
      fail(stored('error', 'Turn on Family polls to vote.'), 404);
    const t = await trip(c),
      g = t.stayGroups.find((g) => g.id === c.req.param('childId'));
    if (!g) fail(stored('error', 'Stay group not found.'), 404);
    const input = c.req.valid('json');
    if (g.pollId && !input.restart)
      fail(stored('error', 'This group already has a vote. Choose Restart to ask again.'), 409);
    if (g.options.length < 2 || g.options.length > 12)
      fail(stored('error', 'A vote needs two to twelve stay choices.'));
    if (!t.memberIds.length)
      fail(stored('error', 'Choose the people going before starting a vote.'));
    const id = crypto.randomUUID(),
      now = new Date().toISOString(),
      { options: _, poll: __, ...data } = g;
    const writes = [
      ...(g.pollId
        ? [
            c.env.DB.prepare(
              "UPDATE polls SET status='closed',closed_at=coalesce(closed_at,?) WHERE id=?",
            ).bind(now, g.pollId),
          ]
        : []),
      c.env.DB.prepare(
        "INSERT INTO polls(id,question,status,created_by,created_at) VALUES(?,?,'open',?,?)",
      ).bind(
        id,
        `${t.title}: ${g.label}`.slice(0, 200),
        (await actorOf(c)).memberId,
        now,
      ),
      c.env.DB.prepare('INSERT INTO trip_stay_polls VALUES(?,?,?)').bind(
        id,
        t.id,
        g.id,
      ),
      ...g.options.flatMap((o, sort) => {
        const oid = crypto.randomUUID();
        return [
          c.env.DB.prepare(
            'INSERT INTO poll_options(id,poll_id,label,sort) VALUES(?,?,?,?)',
          ).bind(oid, id, o.name, sort),
          c.env.DB.prepare('INSERT INTO trip_poll_options VALUES(?,?)').bind(
            oid,
            o.id,
          ),
        ];
      }),
      c.env.DB.prepare('UPDATE trip_stay_groups SET data=? WHERE id=?').bind(
        JSON.stringify({ ...data, pollId: id }),
        g.id,
      ),
    ];
    const updated = await mutate(c, t, input.revision, writes);
    emit(c, 'poll.changed', { id, status: 'open' });
    return c.json(updated, 200);
  },
);
travelRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/trips/stays/{optionId}/image',
    tags: ['Trips'],
    summary: 'Authenticated stored listing image, guarded like Meals images',
    request: { params: z.object({ optionId: z.string() }) },
    responses: { 200: { description: 'Image bytes' }, ...errors },
  }),
  async (c) => {
    const row = await c.env.DB.prepare('SELECT data FROM trip_stays WHERE id=?')
      .bind(c.req.valid('param').optionId)
      .first<{ data: string }>();
    const url = row && JSON.parse(row.data).imageUrl;
    if (!url) fail(stored('error', 'Picture not found.'), 404);
    const result = await fetchRecipeImage(
      { ...c.env, ALLOW_PRIVATE_FEED_URLS: undefined },
      url,
      'stay picture',
    );
    if ('error' in result)
      return c.json({ error: result.error }, result.status);
    c.header('Cache-Control', 'private, max-age=604800');
    return c.body(result.image, 200, {
      'Content-Type': result.type,
      ...(result.etag ? { ETag: result.etag } : {}),
    });
  },
);
travelRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/trips/link-preview',
    tags: ['Trips'],
    summary:
      'Preview public listing metadata for review; manual save always remains available',
    request: { body: body(z.object({ url: PublicTravelUrlSchema })) },
    responses: {
      200: response(
        z.object({
          ok: z.boolean(),
          reason: z.string().optional(),
          name: z.string().nullable(),
          town: z.string().nullable(),
          siteName: z.string().nullable(),
          imageUrl: z.string().nullable(),
          sourceUrl: z.string(),
          finalUrl: z.string(),
          fetchedAt: z.string(),
          price: StayPriceSchema.nullable(),
          sleeps: z.number().nullable(),
        }),
      ),
      ...errors,
    },
  }),
  async (c) => {
    await parent(c);
    const { url } = c.req.valid('json'),
      fetchedAt = new Date().toISOString(),
      empty = {
        name: null,
        town: null,
        siteName: null,
        imageUrl: null,
        price: null,
        sleeps: null,
        sourceUrl: url,
        finalUrl: url,
        fetchedAt,
      };
    const result = await fetchRecipePage(
      { ...c.env, ALLOW_PRIVATE_FEED_URLS: undefined },
      url,
    );
    if ('error' in result)
      return c.json(
        {
          ...empty,
          ok: false,
          reason: result.status === 400 ? 'blocked' : 'unreadable',
        },
        200,
      );
    const meta = new Map<string, string>();
    for (const tag of openingTags(result.html, 'meta')) {
      const attrs = Object.fromEntries(
        [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
          (m) => [m[1].toLowerCase(), m[2] ?? m[3]],
        ),
      );
      if (attrs.property || attrs.name)
        meta.set(
          (attrs.property ?? attrs.name).toLowerCase(),
          clean(attrs.content ?? ''),
        );
    }
    const n = jsonLdNodes(result.html).find((n) =>
      [
        'Hotel',
        'LodgingBusiness',
        'VacationRental',
        'Accommodation',
        'House',
        'Apartment',
      ].some((type) => isType(n, type)),
    );
    const addr =
      n?.address && typeof n.address === 'object'
        ? (n.address as Record<string, unknown>)
        : null;
    let rawImage =
      typeof n?.image === 'string'
        ? n.image
        : Array.isArray(n?.image)
          ? n.image[0]
          : (meta.get('og:image') ?? meta.get('twitter:image'));
    if(rawImage&&typeof rawImage==='object')rawImage=(rawImage as {url?:unknown;contentUrl?:unknown}).url??(rawImage as {contentUrl?:unknown}).contentUrl;
    let imageUrl: string | null = null;
    try {
      if (!rawImage) throw new Error();
      const u = new URL(String(rawImage), result.url).href;
      if (PublicTravelUrlSchema.safeParse(u).success) imageUrl = u;
    } catch {
      /* absent */
    }
    const name =
      clean(
        n?.name ??
          meta.get('og:title') ??
          meta.get('twitter:title') ??
          result.html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1],
      ).slice(0, 200) || null;
    const offer=Array.isArray(n?.offers)?n.offers[0]:n?.offers;
    let price:z.infer<typeof StayPriceSchema>|null=null;
    if(offer&&typeof offer==='object'){
      const o=offer as Record<string,unknown>,currency=String(o.priceCurrency??'').toUpperCase();
      if(/^[A-Z]{3}$/.test(currency)&&/^\d+(?:\.\d+)?$/.test(String(o.price??''))){
        const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2;
        const amount=Number(o.price)*10**digits,amountMinor=Math.round(amount);
        if(Number.isSafeInteger(amountMinor)&&Math.abs(amount-amountMinor)<0.000001)price={amountMinor,currency,basis:null,fees:'unknown',observedOn:fetchedAt.slice(0,10),context:stored('travel', 'As published on the listing; confirm dates, guests and fees.')};
      }
    }
    const capacity=n?.occupancy&&typeof n.occupancy==='object'?(n.occupancy as Record<string,unknown>).maxValue:n?.numberOfGuests;
    const sleeps=Number.isInteger(Number(capacity))&&Number(capacity)>0&&Number(capacity)<=1000?Number(capacity):null;
    if (price?.context) price.context = translateStored(await requestLang(c), 'travel', price.context);
    return c.json(
      {
        ...empty,
        ok: !!name,
        name,
        town: clean(addr?.addressLocality).slice(0, 200) || null,
        siteName:
          meta.get('og:site_name')?.slice(0, 200) ??
          new URL(result.url).hostname,
        imageUrl,
        price,sleeps,
        finalUrl: result.url,
      },
      200,
    );
  },
);
travelRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/trips/{id}/date-change/preview',
    tags: ['Trips'],
    summary: 'Review linked dates without shifting existing arrangements',
    request: {
      params,
      body: body(
        z.object({
          startDate: TripInputSchema.shape.startDate,
          endDate: TripInputSchema.shape.endDate,
        }),
      ),
    },
    responses: {
      200: response(
        z.object({
          care: z.array(z.object({id:z.string(),title:z.string(),date:z.string().nullable()})).optional(),
          away: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              date: z.string().nullable(),
            }),
          ),
          events: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              date: z.string().nullable(),
            }),
          ),
          meals: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              date: z.string().nullable(),
            }),
          ),
          bookedLegs: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              date: z.string().nullable(),
            }),
          ),
          bookedStays: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              date: z.string().nullable(),
            }),
          ),
        }),
      ),
      ...errors,
    },
  }),
  async (c) => {
    await parent(c);
    const t = await trip(c),
      away = (await readAwayPeriods(c.env.DB))
        .filter((p) => p.tripId === t.id)
        .map((p) => ({
          id: p.id,
          title: p.label,
          date: p.people[0]?.effectiveFrom ?? null,
        }));
    return c.json(
      {
        ...(t.canSeeCare ? {care:t.care.filter(c=>c.status!=='canceled').map(c=>({id:c.id,title:c.title,date:c.fromDate}))} : {}),
        away,
        events: [...(t.calendar.span?.state === 'added' ? [{id:t.calendar.span.eventId ?? t.id,title:t.title,date:t.startDate}] : []), ...t.calendar.items.filter(i => i.link.state === 'added').map((i) => ({
          id: i.link.eventId ?? i.id,
          title: t.title,
          date: null,
        }))],
        meals: t.items
          .filter((i) => i.kind === 'meal')
          .map((i) => ({ id: i.refId!, title: i.label ?? '', date: i.date })),
        bookedLegs: t.legs
          .filter((l) => l.booking === 'booked')
          .map((l) => ({ id: l.id, title: l.title ?? '', date: l.departDate })),
        bookedStays: t.stayGroups.flatMap((g) =>
          g.options
            .filter((o) => ['booked', 'confirmed_family'].includes(o.booking))
            .map((o) => ({ id: o.id, title: o.name, date: g.checkIn })),
        ),
      },
      200,
    );
  },
);
travelRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/trips/{id}/calendar',
    tags: ['Trips'],
    summary:
      'Explicitly publish trip dates or chosen timed items, with durable retry receipts',
    request: {
      params,
      body: body(
        z.object({
          revision,
          calendarId: z.string(),
          span: z.boolean().default(false),
          legs: z.array(z.string()).default([]),
          stays: z.array(z.string()).default([]),
          items: z.array(z.string()).default([]),
        }),
      ),
    },
    responses: { 200: response(TripSchema), ...errors },
  }),
  async (c) => {
    await parent(c);
    const t = await trip(c),
      input = c.req.valid('json');
    if (input.revision !== t.revision)
      fail(stored('error', 'This trip changed. Review it again.'), 409);
    const sources: {
      kind: string;
      id: string;
      title: string;
      start: string;
      end: string;
      allDay: boolean;
    }[] = [];
    if (input.span) {
      if (!t.startDate || !t.endDate)
        fail(stored('error', 'Choose exact trip dates before adding them to the calendar.'));
      sources.push({
        kind: 'span',
        id: t.id,
        title: t.title,
        start: t.startDate,
        end: shiftGoalDate(t.endDate, 1),
        allDay: true,
      });
    }
    for (const id of input.legs) {
      const l = t.legs.find((l) => l.id === id);
      if (!l) fail(stored('error', 'Travel leg not found.'));
      const a = endpointInstant(l.departDate, l.departTime, l.departTz),
        b = endpointInstant(l.arriveDate, l.arriveTime, l.arriveTz);
      if (!a || !b || b <= a)
        fail(
          stored('error', 'A calendar leg needs exact endpoint dates, times and time zones.'),
        );
      sources.push({
        kind: 'leg',
        id,
        title: l.title ?? `${l.from ?? ''} → ${l.to ?? ''}`,
        start: a.toISOString(),
        end: b.toISOString(),
        allDay: false,
      });
    }
    for (const id of input.stays) {
      const g = t.stayGroups.find((g) => g.chosenOptionId === id),
        stay = g?.options.find((o) => o.id === id);
      if (!g || !stay || !g.checkIn || !g.checkOut || g.checkOut <= g.checkIn)
        fail(stored('error', 'Only a chosen stay with exact nights can be added.'));
      sources.push({
        kind: 'stay',
        id,
        title: stay.name,
        start: g.checkIn,
        end: g.checkOut,
        allDay: true,
      });
    }
    for (const id of input.items) {
      const item = t.items.find((i) => i.id === id);
      if (!item || item.kind !== 'activity')
        fail(stored('error', 'Publish linked records from their own calendar controls.'));
      const start = endpointInstant(item.date, item.time, item.tz);
      if (!start)
        fail(stored('error', 'A calendar activity needs an exact date, time and time zone.'));
      sources.push({
        kind: 'item',
        id,
        title: item.title ?? '',
        start: start.toISOString(),
        end: new Date(start.getTime() + 3600000).toISOString(),
        allDay: false,
      });
    }
    // Reserve each identity before external I/O. Lost responses are deliberately left pending,
    // never blindly replayed into a second provider event.
    for (const source of sources) {
      const receipt = crypto.randomUUID();
      let inserted:{results:{id:string}[]}[];
      try{inserted=await c.env.DB.batch<{id:string}>([
        c.env.DB.prepare('UPDATE trips SET revision=CASE WHEN revision=? THEN revision ELSE NULL END WHERE id=?').bind(t.revision,t.id),
        c.env.DB.prepare("INSERT INTO trip_publications(id,trip_id,source_kind,source_id,calendar_id,state) VALUES(?,?,?,?,?,'pending') ON CONFLICT(trip_id,source_kind,source_id,calendar_id) DO UPDATE SET id=excluded.id,state='pending' WHERE trip_publications.state='failed' RETURNING id").bind(receipt,t.id,source.kind,source.id,input.calendarId),
      ]);}catch(e){if(String(e).includes('trips.revision'))fail(stored('error', 'This trip changed. Review it again.'),409);throw e;}
      if (!inserted[1].results.length) continue;
      const result = await createEvent(
        c,
        EventInputSchema.parse({
          calendarId: input.calendarId,
          title: source.title,
          start: source.start,
          end: source.end,
          allDay: source.allDay,
          memberIds: t.memberIds,
          description: `Kinwall trip: ${c.env.PUBLIC_URL ?? ''}/#/trips?trip=${t.id}`,
        }),
        receipt,
      );
      if ('error' in result) {
        await c.env.DB.prepare(
          "UPDATE trip_publications SET state=? WHERE id=?",
        )
          .bind(result.status===502?'pending':'failed',receipt)
          .run();
        continue;
      }
      await c.env.DB.prepare(
        "UPDATE trip_publications SET state='added',event_id=? WHERE id=?",
      )
        .bind(result.row.id, receipt)
        .run();
      emit(c, 'events.changed', {});
    }
    emit(c, 'trip.changed', { id: t.id });
    return c.json((await readTrip(c, t.id))!, 200);
  },
);
