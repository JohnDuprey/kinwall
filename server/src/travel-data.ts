import { stored } from './i18n.ts';
// Durable trip/away backup records. Prepare every validation and encryption operation before
// returning statements to the existing single import transaction.
import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Env } from './env.ts';
import type { KinwallStatement } from './db.ts';
import { isConnectedApp } from './auth.ts';
import { decrypt, encrypt } from './crypto.ts';
import { shiftGoalDate } from './chore-goal.ts';
import { TripSchema, TripInputSchema, StopInputSchema, StayGroupInputSchema, StayInputSchema, LegInputSchema, ItemInputSchema, StayDetailsSchema, LegDetailsSchema, CareSchema, validCareDates } from './travel-schemas.ts';
import { AwayPeriodSchema } from './away-schemas.ts';
import { readTrip, careAad, careAllowed } from './routes/travel.ts';
import { readAwayPeriods } from './routes/away.ts';

type Ctx = Context<{ Bindings: Env }>;
export const TripDetailsBackupSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), tripId: z.string(), kind: z.literal('stay'), details: StayDetailsSchema }),
  z.object({ id: z.string(), tripId: z.string(), kind: z.literal('leg'), details: LegDetailsSchema }),
  z.object({ id: z.string().min(1).max(200), tripId: z.string().min(1).max(200), kind: z.literal('care'), details: CareSchema }).strict(),
]);
export class TravelBackupError extends Error {
  readonly status: 400 | 403;
  constructor(message: string, status: 400 | 403 = 400) { super(message); this.status = status; }
}
type Backup = { trips: z.infer<typeof TripSchema>[]; awayPeriods: z.infer<typeof AwayPeriodSchema>[]; tripDetails?: z.infer<typeof TripDetailsBackupSchema>[] };
type Refs = {
  members: { id: string }[]; calendars: { id: string }[]; events: { id: string }[];
  lists: { id: string }[]; chores: { id: string; memberId: string | null; schoolSubjectId?: string | null; schoolKind?: string | null }[];
  polls: { id: string; tripId?: string | null; stayGroupId?: string | null; options: { id: string; stayId?: string | null }[] }[];
};

export async function travelExport(c: Ctx, includeDetails = false): Promise<Backup> {
  if (includeDetails && await isConnectedApp(c)) throw new TravelBackupError(stored('error', 'Export booking details from a grown-up’s own device.'), 403);
  if(includeDetails && !await careAllowed(c))throw new TravelBackupError(stored('error', 'Manage private care from a grown-up’s own device.'),403);
  const db = c.env.DB;
  const rows = (await db.prepare('SELECT id FROM trips ORDER BY created_at, id').all<{ id: string }>()).results;
  const trips: z.infer<typeof TripSchema>[] = [];
  for (const row of rows) { const trip = await readTrip(c, row.id, false); if (trip) trips.push(TripSchema.parse(trip)); }
  const awayPeriods = await readAwayPeriods(db);
  if (!includeDetails) return { trips, awayPeriods };
  const privateRows = (await db.prepare("SELECT p.id, p.trip_id, p.data, CASE WHEN s.id IS NOT NULL THEN 'stay' ELSE 'leg' END AS kind FROM trip_private p LEFT JOIN trip_stays s ON s.id = p.id AND s.trip_id = p.trip_id LEFT JOIN trip_legs l ON l.id = p.id AND l.trip_id = p.trip_id WHERE s.id IS NOT NULL OR l.id IS NOT NULL ORDER BY p.trip_id, p.id").all<{ id: string; trip_id: string; data: string; kind: 'stay' | 'leg' }>()).results;
  const tripDetails = await Promise.all(privateRows.map(async row => TripDetailsBackupSchema.parse({ id: row.id, tripId: row.trip_id, kind: row.kind, details: JSON.parse(await decrypt(c.env, row.data, row.id)) }))).catch(() => {
    throw new TravelBackupError(stored('error', 'Private trip details could not be exported.'));
  });
  const careRows=(await db.prepare('SELECT id,trip_id,data FROM trip_care ORDER BY trip_id,id').all<{id:string;trip_id:string;data:string}>()).results;
  try {
    for(const row of careRows)tripDetails.push(TripDetailsBackupSchema.parse({id:row.id,tripId:row.trip_id,kind:'care',details:JSON.parse(await decrypt(c.env,row.data,careAad(row.trip_id,row.id)))}));
  } catch { throw new TravelBackupError(stored('error', 'Private care could not be exported.')); }
  return { trips, awayPeriods, tripDetails };
}

export async function prepareTravelImport(c: Ctx, input: Backup, refs: Refs): Promise<KinwallStatement[]> {
  if (await isConnectedApp(c) && (input.trips.length || input.tripDetails?.length)) throw new TravelBackupError(stored('error', 'Restore trip backups from a grown-up’s own device.'), 403);
  if(input.tripDetails?.some(row=>row.kind==='care') && !await careAllowed(c))throw new TravelBackupError(stored('error', 'Manage private care from a grown-up’s own device.'),403);
  const db = c.env.DB;
  const tables = ['members', 'calendars', 'events', 'lists', 'chores', 'polls'] as const;
  const known = new Map<string, Set<string>>();
  const existingRefs = await db.batch<{ id: string }>(tables.map(table => db.prepare(`SELECT id FROM ${table}`)));
  tables.forEach((table, i) => known.set(table, new Set([...existingRefs[i].results.map(row => row.id), ...refs[table].map(row => row.id)])));
  const member = (id: string | null) => id && known.get('members')!.has(id) ? id : null;
  const requireMember = (id: string) => { if (!member(id)) throw new TravelBackupError(stored('error', 'An away period refers to a missing family member.')); return id; };
  const unique = (ids: string[], what: string) => { if (new Set(ids).size !== ids.length) throw new TravelBackupError(stored('error', "Duplicate {value0} in trip backup.", {value0: what})); };
  unique(input.trips.map(t => t.id), 'trips');
  unique(input.awayPeriods.map(p => p.id), 'away periods');
  unique((input.tripDetails??[]).map(d=>d.id),'private trip records');
  unique(input.trips.flatMap(t => [...t.stops.map(s => s.id), ...t.stayGroups.flatMap(g => [g.id, ...g.options.map(s => s.id)]), ...t.legs.map(l => l.id), ...t.items.map(i => i.id)]), 'trip item ids');
  const writes: KinwallStatement[] = [];
  const put = (table: string, id: string, tripId: string, data: unknown, groupId?: string) => {
    const cols = groupId === undefined ? ['id', 'trip_id', 'data'] : ['id', 'trip_id', 'group_id', 'data'];
    const vals = groupId === undefined ? [id, tripId, JSON.stringify(data)] : [id, tripId, groupId, JSON.stringify(data)];
    writes.push(db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${cols.slice(1).map(col => `${col}=excluded.${col}`).join(',')}`).bind(...vals));
  };
  const childTables = ['trip_stops', 'trip_stay_groups', 'trip_stays', 'trip_legs', 'trip_items'] as const;
  const children = await db.batch<{ id: string; trip_id: string }>(childTables.map(table => db.prepare(`SELECT id, trip_id FROM ${table}`)));
  const owners = new Map(childTables.map((table, i) => [table, new Map(children[i].results.map(row => [row.id, row.trip_id]))]));
  const importedChildren = new Map<string, { tripId: string; kind: 'stay' | 'leg'; groupId?: string }>();
  const importedGroups = new Map<string, { tripId: string; pollId: string | null }>();
  const assertOwner = (table: typeof childTables[number], id: string, tripId: string) => {
    for (const [otherTable, ids] of owners) if (otherTable !== table && ids.has(id)) throw new TravelBackupError(stored('error', 'A trip item id is already used by another kind of item.'));
    const owner = owners.get(table)!.get(id);
    if (owner && owner !== tripId) throw new TravelBackupError(stored('error', 'A trip item already belongs to another trip.'));
    owners.get(table)!.set(id, tripId);
  };
  const existingTrips = new Set((await db.prepare('SELECT id FROM trips').all<{ id: string }>()).results.map(row => row.id));
  const careOwners=new Map((await db.prepare('SELECT id,trip_id FROM trip_care').all<{id:string;trip_id:string}>()).results.map(row=>[row.id,row.trip_id]));
  const careCounts=new Map<string,Set<string>>();
  for(const [id,tripId] of careOwners) {const ids=careCounts.get(tripId)??new Set<string>();ids.add(id);careCounts.set(tripId,ids);}
  const tripIds = new Set([...existingTrips, ...input.trips.map(t => t.id)]);
  for (const trip of input.trips) {
    const base = TripInputSchema.parse(Object.fromEntries(Object.keys(TripInputSchema.shape).map(key => [key, trip[key as keyof typeof trip]])));
    if (base.startDate && base.endDate && base.startDate > base.endDate) throw new TravelBackupError(stored('error', 'Trip end must not be before its start.'));
    if (base.detailsOnWall && base.detailsAudience !== 'everyone') throw new TravelBackupError(stored('error', 'Choose everyone before showing booking details on walls.'));
    base.memberIds = base.memberIds.filter(id => !!member(id));
    base.packingListIds = base.packingListIds.filter(id => known.get('lists')!.has(id));
    const data = { ...base, marks: trip.marks.filter(mark => !!member(mark.memberId)) };
    writes.push(db.prepare('INSERT INTO trips (id,data,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=trips.revision+1,updated_at=excluded.updated_at').bind(trip.id, JSON.stringify(data), Math.max(1, trip.revision), member(trip.createdBy), trip.createdAt, trip.updatedAt));
    unique(trip.stops.map(s => s.id), 'stops');
    unique(trip.stayGroups.map(g => g.id), 'stay groups');
    unique(trip.stayGroups.flatMap(g => g.options.map(s => s.id)), 'places to stay');
    unique(trip.legs.map(l => l.id), 'travel legs');
    unique(trip.items.map(i => i.id), 'day-plan items');
    const stopIds = new Set(trip.stops.map(s => s.id));
    for (const stop of trip.stops) { assertOwner('trip_stops', stop.id, trip.id); const { id, ...fields } = stop; put('trip_stops', id, trip.id, { ...StopInputSchema.parse(fields), id }); }
    for (const group of trip.stayGroups) {
      assertOwner('trip_stay_groups', group.id, trip.id);
      importedGroups.set(group.id, { tripId: trip.id, pollId: group.pollId });
      const options = new Set(group.options.map(s => s.id));
      const fields = StayGroupInputSchema.parse({ label: group.label, stopId: stopIds.has(group.stopId ?? '') ? group.stopId : null, checkIn: group.checkIn, checkOut: group.checkOut, sort: group.sort });
      if (fields.checkIn && fields.checkOut && fields.checkIn > fields.checkOut) throw new TravelBackupError(stored('error', 'Check-out must not be before check-in.'));
      put('trip_stay_groups', group.id, trip.id, { ...fields, id: group.id, pollId: group.pollId && known.get('polls')!.has(group.pollId) ? group.pollId : null, chosenOptionId: group.chosenOptionId && options.has(group.chosenOptionId) ? group.chosenOptionId : null, chosenBy: member(group.chosenBy), chosenAt: group.chosenAt });
      for (const stay of group.options) {
        assertOwner('trip_stays', stay.id, trip.id);
        importedChildren.set(stay.id, { tripId: trip.id, kind: 'stay', groupId: group.id });
        const { id, addedBy, bookedBy, details: _details, hasDetails: _has, ...fields } = stay;
        const base = StayInputSchema.parse({ ...fields, groupId: group.id });
        if (base.booking === 'confirmed_family' && base.kind !== 'family') throw new TravelBackupError(stored('error', 'Only family-home stays can be confirmed with family.'));
        put('trip_stays', id, trip.id, { ...base, id, addedBy: member(addedBy), bookedBy: member(bookedBy) }, group.id);
      }
    }
    for (const leg of trip.legs) {
      assertOwner('trip_legs', leg.id, trip.id);
      importedChildren.set(leg.id, { tripId: trip.id, kind: 'leg' });
      const { id, details: _details, hasDetails: _has, ...fields } = leg;
      const data = LegInputSchema.parse(fields); data.memberIds = data.memberIds.filter(id => !!member(id));
      put('trip_legs', id, trip.id, { ...data, id });
    }
    for (const item of trip.items) {
      assertOwner('trip_items', item.id, trip.id);
      const { id, suggestedBy, marks, missing: _missing, ...fields } = item;
      put('trip_items', id, trip.id, { ...ItemInputSchema.parse(fields), id, suggestedBy: member(suggestedBy), marks: marks.filter(mark => !!member(mark.memberId)) });
    }
    const publications = [...(trip.calendar.span ? [{ kind: 'span', id: trip.id, link: trip.calendar.span }] : []), ...trip.calendar.items];
    for (const publication of publications) {
      if (!known.get('calendars')!.has(publication.link.calendarId)) continue;
      const eventId = publication.link.eventId && known.get('events')!.has(publication.link.eventId) ? publication.link.eventId : null;
      const state = eventId ? publication.link.state : 'failed';
      writes.push(db.prepare('INSERT INTO trip_publications (id,trip_id,source_kind,source_id,calendar_id,event_id,state) VALUES (?,?,?,?,?,?,?) ON CONFLICT(trip_id,source_kind,source_id,calendar_id) DO UPDATE SET event_id=excluded.event_id,state=excluded.state').bind(crypto.randomUUID(), trip.id, publication.kind, publication.id, publication.link.calendarId, eventId, state));
    }
  }
  // Existing generic poll import runs first in the same batch. Restore typed trip context after
  // its option replacement, including closed historical rounds rather than only the current one.
  for (const poll of refs.polls) {
    const group = poll.stayGroupId ? importedGroups.get(poll.stayGroupId) : [...importedGroups.values()].find(g => g.pollId === poll.id);
    const groupId = poll.stayGroupId ?? [...importedGroups].find(([, g]) => g.pollId === poll.id)?.[0];
    if (!group || !groupId) continue;
    if (poll.tripId && poll.tripId !== group.tripId) throw new TravelBackupError(stored('error', 'A housing poll belongs to another trip.'));
    writes.push(db.prepare('INSERT INTO trip_stay_polls (poll_id,trip_id,group_id) VALUES (?,?,?) ON CONFLICT(poll_id) DO UPDATE SET trip_id=excluded.trip_id,group_id=excluded.group_id').bind(poll.id, group.tripId, groupId));
    for (const option of poll.options) if (option.stayId) {
      const stay = importedChildren.get(option.stayId);
      if (!stay || stay.kind !== 'stay' || stay.tripId !== group.tripId || stay.groupId !== groupId) throw new TravelBackupError(stored('error', 'A housing vote refers to a place outside its stay decision.'));
      writes.push(db.prepare('INSERT INTO trip_poll_options (option_id,stay_id) VALUES (?,?) ON CONFLICT(option_id) DO UPDATE SET stay_id=excluded.stay_id').bind(option.id, option.stayId));
    }
  }
  for (const privateRow of input.tripDetails ?? []) {
    if(privateRow.kind==='care') {
      const care=CareSchema.safeParse(privateRow.details);
      if(!care.success || care.data.id!==privateRow.id || !validCareDates(care.data) || !input.trips.some(t=>t.id===privateRow.tripId))throw new TravelBackupError(stored('error', 'Private care does not match an imported trip.'));
      const ids=careCounts.get(privateRow.tripId)??new Set<string>();ids.add(privateRow.id);careCounts.set(privateRow.tripId,ids);
      if(ids.size>100)throw new TravelBackupError(stored('error', 'A trip can have up to 100 care arrangements.'));
      if(careOwners.has(privateRow.id) && careOwners.get(privateRow.id)!==privateRow.tripId)throw new TravelBackupError(stored('error', 'A care arrangement already belongs to another trip.'));
      for(const ids of owners.values())if(ids.has(privateRow.id))throw new TravelBackupError(stored('error', 'A trip item id is already used by another kind of item.'));
      const encrypted=await encrypt(c.env,JSON.stringify(care.data),careAad(privateRow.tripId,privateRow.id));
      writes.push(db.prepare('INSERT INTO trip_care(id,trip_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(privateRow.id,privateRow.tripId,encrypted));
      continue;
    }
    const target = importedChildren.get(privateRow.id);
    if (!target || target.tripId !== privateRow.tripId || target.kind !== privateRow.kind) throw new TravelBackupError(stored('error', 'Booking details do not match an imported stay or travel leg.'));
    const encrypted = await encrypt(c.env, JSON.stringify(privateRow.details), privateRow.id);
    writes.push(db.prepare('INSERT INTO trip_private (id,trip_id,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET trip_id=excluded.trip_id,data=excluded.data').bind(privateRow.id, privateRow.tripId, encrypted));
  }
  const importedPeriodIds = new Set(input.awayPeriods.map(p => p.id));
  const existingPeople = (await db.prepare('SELECT period_id,member_id,start_date,end_date FROM away_people').all<{ period_id: string; member_id: string; start_date: string; end_date: string }>()).results.filter(p => !importedPeriodIds.has(p.period_id));
  const periods = input.awayPeriods.map(period => {
    try { new Intl.DateTimeFormat('en', { timeZone: period.timezone }); } catch { throw new TravelBackupError(stored('error', 'An away period has an invalid home timezone.')); }
    unique(period.people.map(p => p.memberId), 'people in an away period');
    const people = period.people.map(person => {
      requireMember(person.memberId);
      if (person.startDate > person.endDate || person.endDate > shiftGoalDate(person.startDate, 3660)) throw new TravelBackupError(stored('error', 'Choose an away date range of at most ten years.'));
      const from = shiftGoalDate(person.startDate, person.leaveDayAway ? 0 : 1);
      const to = shiftGoalDate(person.endDate, person.returnDayAway ? 0 : -1);
      return { ...person, effectiveFrom: from <= to ? from : null, effectiveTo: from <= to ? to : null };
    });
    return { ...period, people, tripId: period.tripId && tripIds.has(period.tripId) ? period.tripId : null, createdBy: member(period.createdBy) };
  });
  const allPeople = [...existingPeople, ...periods.flatMap(p => p.people.filter(person => person.effectiveFrom && person.effectiveTo).map(person => ({ period_id: p.id, member_id: person.memberId, start_date: person.effectiveFrom!, end_date: person.effectiveTo! })))];
  const existingChores = (await db.prepare('SELECT id,member_id,school_subject_id,school_kind FROM chores').all<{ id: string; member_id: string | null; school_subject_id: string | null; school_kind: string | null }>()).results;
  const choreOwners = new Map([...existingChores.map(ch => [ch.id, ch.member_id] as const), ...refs.chores.map(ch => [ch.id, ch.memberId] as const)]);
  const schoolwork = new Map([...existingChores.map(ch => [ch.id, !!(ch.school_subject_id || ch.school_kind)] as const), ...refs.chores.map(ch => [ch.id, !!(ch.schoolSubjectId || ch.schoolKind)] as const)]);
  const allHandoffs: { chore_id: string; start_date: string; end_date: string }[] = (await db.prepare("SELECT period_id,chore_id,start_date,end_date FROM away_rules WHERE kind='handoff'").all<{ period_id: string; chore_id: string; start_date: string; end_date: string }>()).results.filter(r => !importedPeriodIds.has(r.period_id));
  for (const period of periods) {
    const within = (memberId: string, from: string, to: string) => period.people.some(p => p.memberId === memberId && p.effectiveFrom && p.effectiveTo && p.effectiveFrom <= from && p.effectiveTo >= to);
    for (const handoff of period.handoffs) {
      requireMember(handoff.fromMemberId); requireMember(handoff.toMemberId);
      if (schoolwork.get(handoff.choreId)) throw new TravelBackupError(stored('error', 'Schoolwork can be paused or kept due, but cannot be handed to someone else.'));
      if (handoff.fromMemberId === handoff.toMemberId || choreOwners.get(handoff.choreId) !== handoff.fromMemberId || !within(handoff.fromMemberId, handoff.startDate, handoff.endDate) || handoff.startDate > handoff.endDate) throw new TravelBackupError(stored('error', 'A temporary handoff does not match its chore and away dates.'));
      if (allPeople.some(p => p.member_id === handoff.toMemberId && p.start_date <= handoff.endDate && p.end_date >= handoff.startDate)) throw new TravelBackupError(stored('error', 'A temporary handoff goes to someone who is away.'));
      if (allHandoffs.some(r => r.chore_id === handoff.choreId && r.start_date <= handoff.endDate && r.end_date >= handoff.startDate)) throw new TravelBackupError(stored('error', 'Temporary handoffs overlap.'));
      allHandoffs.push({ chore_id: handoff.choreId, start_date: handoff.startDate, end_date: handoff.endDate });
    }
    for (const keep of period.keepDue) if (choreOwners.get(keep.choreId) !== keep.memberId || !period.people.some(p => p.memberId === keep.memberId)) throw new TravelBackupError(stored('error', 'An away exception does not match its person and chore.'));
    writes.push(db.prepare('INSERT INTO away_periods (id,trip_id,data,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET trip_id=excluded.trip_id,data=excluded.data,revision=away_periods.revision+1,updated_at=excluded.updated_at').bind(period.id, period.tripId, JSON.stringify(period), Math.max(1, period.revision), period.createdBy, period.createdAt, period.updatedAt));
    writes.push(db.prepare('DELETE FROM away_rules WHERE period_id=?').bind(period.id), db.prepare('DELETE FROM away_people WHERE period_id=?').bind(period.id));
    for (const person of period.people) if (person.effectiveFrom && person.effectiveTo) {
      writes.push(db.prepare('INSERT INTO away_people (period_id,member_id,start_date,end_date) VALUES (?,?,?,?)').bind(period.id, person.memberId, person.effectiveFrom, person.effectiveTo));
      for (const keep of period.keepDue.filter(k => k.memberId === person.memberId)) writes.push(db.prepare("INSERT INTO away_rules (id,period_id,chore_id,from_member_id,to_member_id,kind,start_date,end_date) VALUES (?,?,?,?,NULL,'keep',?,?)").bind(crypto.randomUUID(), period.id, keep.choreId, keep.memberId, person.effectiveFrom, person.effectiveTo));
    }
    for (const handoff of period.handoffs) writes.push(db.prepare("INSERT INTO away_rules (id,period_id,chore_id,from_member_id,to_member_id,kind,start_date,end_date) VALUES (?,?,?,?,?,'handoff',?,?)").bind(handoff.id, period.id, handoff.choreId, handoff.fromMemberId, handoff.toMemberId, handoff.startDate, handoff.endDate));
  }
  return writes;
}
