// Pure schedule shared by the API and notification tick. IDs use the original occurrence,
// never a changed start time; provider rows already have stable deterministic IDs.
export type FollowRule = {
  member_id: string;
  calendar_id: string;
  target: string;
  scope: 'occurrence' | 'series';
  occurrence_start: string;
  enabled: number;
  minutes: number;
  show_now: string | null;
  revision?: number;
};
export type FollowEvent = {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  occurrenceStart: string | null;
  seriesId: string | null;
  rrule: string | null;
  location: string | null;
  leaveAt?: string | null;
  prepAt?: string | null;
};
export const occurrenceOf = (e: FollowEvent) =>
  e.occurrenceStart ? new Date(e.occurrenceStart).toISOString() : '';
export function resolveFollow(e: FollowEvent, rules: FollowRule[]) {
  const occurrence = occurrenceOf(e);
  return (
    rules.find(
      (r) =>
        r.calendar_id === e.calendarId &&
        r.scope === 'occurrence' &&
        r.target === e.id &&
        r.occurrence_start === occurrence,
    ) ??
    rules.find(
      (r) => r.calendar_id === e.calendarId && r.scope === 'series' && r.target === (e.seriesId ?? e.id),
    )
  );
}
export type EventActivity = {
  muted?: boolean;
  activity: string;
  eventId: string;
  occurrenceStart: string | null;
  title: string;
  location: string | null;
  showAt: string;
  startsAt: string;
  endsAt: string;
  eventEndsAt: string;
  leadAt: string | null;
  prep: boolean;
};
export function eventActivity(e: FollowEvent, r: FollowRule): EventActivity | null {
  if (!r.enabled || e.allDay) return null;
  const start = Date.parse(e.start),
    end = Date.parse(e.end);
  const lead = e.prepAt ?? e.leaveAt ?? null;
  const anchor = lead ? Math.min(start, Date.parse(lead)) : start;
  const show = r.show_now
    ? Date.parse(r.show_now)
    : anchor - r.minutes * 60000;
  if (![start, end, show, anchor].every(Number.isFinite) || end <= start) return null;
  return {
    activity: `event:${e.id}@${occurrenceOf(e)}:${r.scope}:${r.revision ?? 1}`,
    eventId: e.id,
    occurrenceStart: e.occurrenceStart,
    // Keep the ActivityKit push comfortably within its payload limit, including multibyte text.
    title: Array.from(e.title).slice(0, 120).join(''),
    location: e.location ? Array.from(e.location).slice(0, 160).join('') : null,
    showAt: new Date(show).toISOString(),
    startsAt: e.start,
    endsAt: new Date(Math.min(end, show + 8 * 3600000)).toISOString(),
    eventEndsAt: e.end,
    leadAt: lead,
    prep: !!e.prepAt,
  };
}
export function pickEventActivity(plans: EventActivity[], now: number) {
  const a = plans
    .filter((p) => !p.muted && Date.parse(p.showAt) <= now && now < Date.parse(p.endsAt))
    .sort(
      (a, b) =>
        Number(Date.parse(b.startsAt) <= now) - Number(Date.parse(a.startsAt) <= now) ||
        Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
        a.activity.localeCompare(b.activity),
    )[0];
  if (!a) return null;
  const stage =
    now >= Date.parse(a.startsAt)
      ? 'end'
      : a.leadAt && now < Date.parse(a.leadAt)
        ? a.prep
          ? 'prep'
          : 'leave'
        : 'start';
  return { ...a, stage, at: stage === 'end' ? a.eventEndsAt : stage === 'start' ? a.startsAt : a.leadAt! };
}
