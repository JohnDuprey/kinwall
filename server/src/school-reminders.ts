// School travel reminders (notify.ts runSchoolTravel, docs/using/school.md#bus-and-pickup-reminders):
// before the bus comes and drops off, and before a grown-up's drop-off or pickup, on a kid's school
// days and half days (not days off, weekends or summer). Kids on the same bus at the same time share
// one reminder ("Bus at 7:42 AM: Maya and Leo"), and so do kids one grown-up takes at the same time.
// A half day's ride home is at the kid's halfFromSchoolTime; without one there's no reminder home.
// Pure, so test/school-days.test.ts covers the schedule.
import type { DayKind } from './school-days.ts';

export type TravelKid = { memberId: string; toSchoolBy: string | null; toSchoolTime: string | null; fromSchoolBy: string | null; fromSchoolTime: string | null; halfFromSchoolTime: string | null };
export type TravelReminder = { key: string; leg: 'to' | 'from'; by: string; time: string; half: boolean; kidIds: string[]; lead: number };

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Every leg today with a reminder, grouped by how (the bus or a grown-up) and when. */
export function travelLegs(kids: TravelKid[], kinds: Map<string, DayKind>, date: string, lead: { bus: number | null; pickup: number | null }): TravelReminder[] {
  const groups = new Map<string, TravelReminder>();
  for (const k of kids) {
    const kind = kinds.get(k.memberId);
    if (kind !== 'school' && kind !== 'half') continue;
    const half = kind === 'half';
    for (const [leg, by, time] of [['to', k.toSchoolBy, k.toSchoolTime], ['from', k.fromSchoolBy, half ? k.halfFromSchoolTime : k.fromSchoolTime]] as const) {
      const before = by === 'bus' ? lead.bus : lead.pickup;
      if (!by || !time || before == null) continue;
      const key = `school-travel:${date}:${leg}:${by}:${time}`;
      const g = groups.get(key) ?? { key, leg, by, time, half: half && leg === 'from', kidIds: [], lead: before };
      g.kidIds.push(k.memberId);
      groups.set(key, g);
    }
  }
  return [...groups.values()];
}

/** The legs whose reminder is due at `now` ("HH:MM", household time): from `lead` minutes before until the time. */
export function dueTravel(legs: TravelReminder[], now: string): TravelReminder[] {
  return legs.filter(l => minutes(now) >= minutes(l.time) - l.lead && minutes(now) < minutes(l.time));
}
