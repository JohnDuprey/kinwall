import type { KinwallDb } from './db.ts';
import type { ChoreRow } from './routes/chores.ts';
import { shiftGoalDate } from './chore-goal.ts';
export type AwayRule = {
  id: string;
  period_id: string;
  chore_id: string;
  from_member_id: string;
  to_member_id: string | null;
  kind: 'keep' | 'handoff';
  start_date: string;
  end_date: string;
};
export type AwayPerson = {
  period_id: string;
  member_id: string;
  start_date: string;
  end_date: string;
};
export function awayContext(
  people: AwayPerson[],
  rules: AwayRule[],
  memberIds: string[],
) {
  const isAway = (memberId: string, date: string) =>
    people.some(
      (p) =>
        p.member_id === memberId && p.start_date <= date && p.end_date >= date,
    );
  const activeRules = (row: Pick<ChoreRow, 'id'>, date: string) =>
    rules.filter(
      (r) =>
        r.chore_id === row.id && r.start_date <= date && r.end_date >= date,
    );
  const duty = (
    row: Pick<ChoreRow, 'id' | 'member_id' | 'eligible_member_ids'>,
    date: string,
  ) => {
    const rs = activeRules(row, date),
      handoff = rs.find((r) => r.kind === 'handoff' && r.from_member_id === row.member_id);
    if (handoff)
      return {
        memberId: handoff.to_member_id,
        excused: !!handoff.to_member_id && isAway(handoff.to_member_id, date),
        eligibleMemberIds: null,
        handoff: {
          fromMemberId: handoff.from_member_id,
          until: handoff.end_date,
        },
      };
    if (row.member_id)
      return {
        memberId: row.member_id,
        excused:
          isAway(row.member_id, date) &&
          !rs.some(
            (r) => r.kind === 'keep' && r.from_member_id === row.member_id,
          ),
        eligibleMemberIds: null,
        handoff: null,
      };
    const original: string[] = row.eligible_member_ids
      ? JSON.parse(row.eligible_member_ids)
      : memberIds;
    const atHome = original.filter(
      (id) =>
        !isAway(id, date) ||
        rs.some((r) => r.kind === 'keep' && r.from_member_id === id),
    );
    return {
      memberId: null,
      excused: original.length > 0 && atHome.length === 0,
      eligibleMemberIds:
        !row.eligible_member_ids && atHome.length === memberIds.length
          ? null
          : atHome,
      handoff: null,
    };
  };
  return {
    people,
    rules,
    isAway,
    duty,
    forMember: (
      row: Pick<ChoreRow, 'id' | 'member_id' | 'eligible_member_ids'>,
      date: string,
      memberId: string,
    ) => {
      const d = duty(row, date);
      return (
        !d.excused &&
        (d.memberId
          ? d.memberId === memberId
          : d.eligibleMemberIds === null ||
            d.eligibleMemberIds.includes(memberId))
      );
    },
    touches: (memberId: string, from: string, to: string) =>
      people.some(
        (p) =>
          p.member_id === memberId && p.start_date <= to && p.end_date >= from,
      ),
    streakStart: (memberId: string, today: string, days = 60) => {
      const intervals=people.filter(p=>p.member_id===memberId&&p.start_date<=today).map(p=>({from:p.start_date,to:p.end_date>today?today:p.end_date})).sort((a,b)=>a.from.localeCompare(b.from));
      const union:{from:string;to:string}[]=[];
      for(const p of intervals){const last=union.at(-1);if(last&&p.from<=shiftGoalDate(last.to,1)){if(p.to>last.to)last.to=p.to;}else union.push({...p});}
      let cursor=today,remaining=days;
      for(const interval of union.reverse()){
        if(interval.from>cursor)continue;
        const gap=Math.max(0,Math.round((Date.parse(cursor)-Date.parse(interval.to))/86400000));
        if(gap>=remaining)break;
        remaining-=gap;cursor=shiftGoalDate(interval.from,-1);
      }
      const first=shiftGoalDate(cursor,1-remaining),cap=shiftGoalDate(today,-36600);
      return first<cap?cap:first;
    },
  };
}
export type AwayContext = ReturnType<typeof awayContext>;
/** Dated presentation only: never persist this projection back into the chore's schedule. */
export function effectiveChore<
  T extends Pick<ChoreRow, 'id' | 'member_id' | 'eligible_member_ids'>,
>(
  row: T,
  date: string,
  ctx: AwayContext,
): T & { handoff: { fromMemberId: string; until: string } | null } {
  const duty = ctx.duty(row, date);
  return {
    ...row,
    member_id: duty.memberId,
    eligible_member_ids:
      duty.memberId || duty.eligibleMemberIds === null
        ? null
        : JSON.stringify(duty.eligibleMemberIds),
    handoff: duty.handoff,
  };
}
export function awayStatements(db: KinwallDb, from: string, to: string) {
  return [
    db
      .prepare(
        'SELECT * FROM away_people WHERE start_date <= ? AND end_date >= ?',
      )
      .bind(to, from),
    db
      .prepare(
        'SELECT * FROM away_rules WHERE start_date <= ? AND end_date >= ?',
      )
      .bind(to, from),
    db.prepare('SELECT id FROM members'),
    db.prepare(AWAY_VERSION_SQL),
  ];
}
// Conservative across periods, but entirely metadata: saves/imports advance revisions atomically.
export const AWAY_VERSION_SQL="SELECT json_group_array(json_object('id',id,'revision',revision)) AS version FROM (SELECT id,revision FROM away_periods ORDER BY id)";
export function awayFromResults(
  results: { results: unknown[] }[],
): AwayContext {
  return awayContext(
    results[0].results as AwayPerson[],
    results[1].results as AwayRule[],
    (results[2].results as { id: string }[]).map((v) => v.id),
  );
}
export async function loadAway(
  db: KinwallDb,
  from: string,
  to: string,
): Promise<AwayContext> {
  return awayFromResults(await db.batch<unknown>(awayStatements(db, from, to)));
}
