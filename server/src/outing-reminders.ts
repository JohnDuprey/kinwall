// Outing reminders (notify.ts runOutings, docs/using/outings.md#reminders): which notes are due today,
// each with the key it's sent under once (sent_notifications) and who gets it. Pure, so
// test/outing-reminders.test.ts covers the schedule. "Date announced" is sent when someone saves the
// date (routes/outings.ts), the rest from the morning tick.
//
//   heads-up      a week before and the day before an outing someone ⭐ (not once it's on the
//                 calendar: the event's own reminder takes over). Those who ⭐ it; grown-ups too
//                 when a kid did.
//   buy tickets   3 days before "Get tickets by", and that morning, if anyone marked it and nobody
//                 said "We have tickets". Grown-ups.
//   on sale       the day before tickets go on sale, and at that time, if anyone marked it. Grown-ups.
//   last chance   a week before a run ends, for marked ones not on the calendar. Those who marked it.
import { addDays } from './outing-rules.ts';

export interface ReminderOuting {
  id: string; title: string; kind: 'upcoming' | 'place'; startsOn: string | null; endsOn: string | null; startTime: string | null; buyBy: string | null;
  ticketsOnSaleAt: string | null; gotTickets: boolean; calendarEventId: string | null; archived: boolean; emoji: string | null;
  interest: { memberId: string; level: 'interested' | 'really' }[];
}
export interface ReminderPerson { id: string; name: string; grownUp: boolean }
export interface OutingReminder { key: string; outingId: string; title: string; body: string; memberIds: string[]; grownUps: boolean }

export const HEADS_UP_DAYS = [7, 1];
export const BUY_DAYS = 3;
export const LAST_CHANCE_DAYS = 7;

const names = (ids: string[], people: ReminderPerson[]) => {
  const n = people.filter((p) => ids.includes(p.id)).map((p) => p.name);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : n[0] ?? '';
};
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
const monthDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The reminders due on `today` (household date), given the on-sale times already in household
 * terms (`saleOn`: YYYY-MM-DD, `saleAt`: "10:00 AM", `saleNow`: that time has come). */
export function dueReminders(outings: ReminderOuting[], people: ReminderPerson[], today: string, sale: (o: ReminderOuting) => { saleOn: string; saleAt: string; saleNow: boolean } | null): OutingReminder[] {
  const out: OutingReminder[] = [];
  const kids = new Set(people.filter((p) => !p.grownUp).map((p) => p.id));
  for (const o of outings) {
    if (o.archived || o.kind !== 'upcoming' || !o.interest.length) continue;
    const e = o.emoji ? `${o.emoji} ` : '';
    const stars = o.interest.filter((i) => i.level === 'really').map((i) => i.memberId);
    const marked = o.interest.map((i) => i.memberId);
    if (o.startsOn && stars.length && !o.calendarEventId && !(o.endsOn && o.startsOn < today)) {
      for (const n of HEADS_UP_DAYS) {
        if (o.startsOn !== addDays(today, n)) continue;
        const who = names(stars, people);
        out.push({
          key: `outing:${o.id}:headsup${n}:${o.startsOn}`, outingId: o.id, memberIds: stars, grownUps: stars.some((id) => kids.has(id)),
          title: `${e}${o.title} is ${n === 1 ? 'tomorrow' : 'a week away'}`,
          body: `${who} ${stars.length === 1 ? 'really wants' : 'really want'} to go.`,
        });
      }
    }
    if (o.buyBy && !o.gotTickets) {
      if (o.buyBy === addDays(today, BUY_DAYS)) out.push({ key: `outing:${o.id}:buy${BUY_DAYS}:${o.buyBy}`, outingId: o.id, memberIds: [], grownUps: true, title: `🎟 Get tickets for ${o.title} by ${weekday(o.buyBy)}`, body: `${names(marked, people)} marked it.` });
      if (o.buyBy === today) out.push({ key: `outing:${o.id}:buy0:${o.buyBy}`, outingId: o.id, memberIds: [], grownUps: true, title: `🎟 Today's the last day to get tickets for ${o.title}`, body: `${names(marked, people)} marked it.` });
    }
    const s = !o.gotTickets ? sale(o) : null;
    if (s) {
      if (s.saleOn === addDays(today, 1)) out.push({ key: `outing:${o.id}:onsale1:${s.saleOn}`, outingId: o.id, memberIds: [], grownUps: true, title: `🎟 Tickets for ${o.title} go on sale tomorrow at ${s.saleAt}`, body: `${names(marked, people)} marked it.` });
      if (s.saleOn === today && s.saleNow) out.push({ key: `outing:${o.id}:onsale0:${s.saleOn}`, outingId: o.id, memberIds: [], grownUps: true, title: `🎟 Tickets for ${o.title} are on sale now`, body: `${names(marked, people)} marked it.` });
    }
    if (o.endsOn && o.startsOn && o.endsOn !== o.startsOn && !o.calendarEventId && o.endsOn === addDays(today, LAST_CHANCE_DAYS)) {
      out.push({ key: `outing:${o.id}:lastchance:${o.endsOn}`, outingId: o.id, memberIds: marked, grownUps: false, title: `${e}${o.title} closes ${monthDay(o.endsOn)}`, body: 'One more week to go.' });
    }
  }
  return out;
}

/** "Date announced": someone saved a date on an outing others ⭐. Those who ⭐ it, except whoever saved it. */
export function dateAnnounced(o: ReminderOuting, by: string | null): OutingReminder | null {
  const stars = o.interest.filter((i) => i.level === 'really' && i.memberId !== by).map((i) => i.memberId);
  if (!o.startsOn || !stars.length || o.archived) return null;
  return { key: `outing:${o.id}:dated:${o.startsOn}`, outingId: o.id, memberIds: stars, grownUps: false, title: `${o.emoji ? `${o.emoji} ` : ''}${o.title}: the date is set`, body: `It's ${new Date(`${o.startsOn}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}.` };
}
