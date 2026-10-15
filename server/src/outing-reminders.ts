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
//
// Each note's words come in any language (`text(lang)`: each device's, the family's for the feed);
// `title` and `body` are the English.
import { addDays } from './outing-rules.ts';
import { perLang, words, type Lang } from './i18n.ts';

export interface ReminderOuting {
  id: string; title: string; kind: 'upcoming' | 'place'; startsOn: string | null; endsOn: string | null; startTime: string | null; buyBy: string | null;
  ticketsOnSaleAt: string | null; gotTickets: boolean; calendarEventId: string | null; archived: boolean; emoji: string | null;
  interest: { memberId: string; level: 'interested' | 'really' }[];
}
export interface ReminderPerson { id: string; name: string; grownUp: boolean }
type NoteText = { title: string; body: string };
export interface OutingReminder { key: string; outingId: string; title: string; body: string; text: (lang: Lang) => NoteText; memberIds: string[]; grownUps: boolean }

export const HEADS_UP_DAYS = [7, 1];
export const BUY_DAYS = 3;
export const LAST_CHANCE_DAYS = 7;

const date = (day: string, lang: Lang, o: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString(words(lang).locale, { ...o, timeZone: 'UTC' });
const note = (base: Omit<OutingReminder, 'title' | 'body' | 'text'>, text: (lang: Lang) => NoteText): OutingReminder => ({ ...base, ...text('en'), text: perLang(text) });

/** The reminders due on `today` (household date), given the on-sale times already in household
 * terms (`saleOn`: YYYY-MM-DD, `saleAt`: "10:00 AM", `saleNow`: that time has come). */
export function dueReminders(outings: ReminderOuting[], people: ReminderPerson[], today: string, sale: (o: ReminderOuting) => { saleOn: string; saleAt: string; saleNow: boolean } | null): OutingReminder[] {
  const out: OutingReminder[] = [];
  const kids = new Set(people.filter((p) => !p.grownUp).map((p) => p.id));
  const names = (ids: string[], lang: Lang) => words(lang).list(people.filter((p) => ids.includes(p.id)).map((p) => p.name));
  for (const o of outings) {
    if (o.archived || o.kind !== 'upcoming' || !o.interest.length) continue;
    const e = o.emoji ? `${o.emoji} ` : '';
    const stars = o.interest.filter((i) => i.level === 'really').map((i) => i.memberId);
    const marked = o.interest.map((i) => i.memberId);
    if (o.startsOn && stars.length && !o.calendarEventId && !(o.endsOn && o.startsOn < today)) {
      for (const n of HEADS_UP_DAYS) {
        if (o.startsOn !== addDays(today, n)) continue;
        out.push(note({ key: `outing:${o.id}:headsup${n}:${o.startsOn}`, outingId: o.id, memberIds: stars, grownUps: stars.some((id) => kids.has(id)) }, (lang) => {
          const { t, tn } = words(lang);
          const vars = { outing: `${e}${o.title}`, who: names(stars, lang) };
          return {
            title: n === 1 ? t('{outing} is tomorrow', vars) : t('{outing} is a week away', vars),
            body: tn(stars.length, '{who} really wants to go.', '{who} really want to go.', vars),
          };
        }));
      }
    }
    // Ticket notes, to the grown-ups: what to do, and who marked it.
    const tickets = (key: string, title: (lang: Lang) => string) => out.push(note({ key, outingId: o.id, memberIds: [], grownUps: true }, (lang) => {
      const { t } = words(lang);
      return { title: title(lang), body: t('{who} marked it.', { who: names(marked, lang) }) };
    }));
    if (o.buyBy && !o.gotTickets) {
      const by = o.buyBy;
      if (by === addDays(today, BUY_DAYS)) tickets(`outing:${o.id}:buy${BUY_DAYS}:${by}`, (lang) => {
        const { t } = words(lang);
        return t('🎟 Get tickets for {outing} by {day}', { outing: o.title, day: date(by, lang, { weekday: 'long' }) });
      });
      if (by === today) tickets(`outing:${o.id}:buy0:${by}`, (lang) => {
        const { t } = words(lang);
        return t("🎟 Today's the last day to get tickets for {outing}", { outing: o.title });
      });
    }
    const s = !o.gotTickets ? sale(o) : null;
    if (s) {
      if (s.saleOn === addDays(today, 1)) tickets(`outing:${o.id}:onsale1:${s.saleOn}`, (lang) => {
        const { t } = words(lang);
        return t('🎟 Tickets for {outing} go on sale tomorrow at {time}', { outing: o.title, time: s.saleAt });
      });
      if (s.saleOn === today && s.saleNow) tickets(`outing:${o.id}:onsale0:${s.saleOn}`, (lang) => {
        const { t } = words(lang);
        return t('🎟 Tickets for {outing} are on sale now', { outing: o.title });
      });
    }
    if (o.endsOn && o.startsOn && o.endsOn !== o.startsOn && !o.calendarEventId && o.endsOn === addDays(today, LAST_CHANCE_DAYS)) {
      const ends = o.endsOn;
      out.push(note({ key: `outing:${o.id}:lastchance:${ends}`, outingId: o.id, memberIds: marked, grownUps: false }, (lang) => {
        const { t } = words(lang);
        return { title: t('{outing} closes {date}', { outing: `${e}${o.title}`, date: date(ends, lang, { month: 'short', day: 'numeric' }) }), body: t('One more week to go.') };
      }));
    }
  }
  return out;
}

/** "Date announced": someone saved a date on an outing others ⭐. Those who ⭐ it, except whoever saved it. */
export function dateAnnounced(o: ReminderOuting, by: string | null): OutingReminder | null {
  const stars = o.interest.filter((i) => i.level === 'really' && i.memberId !== by).map((i) => i.memberId);
  if (!o.startsOn || !stars.length || o.archived) return null;
  const day = o.startsOn;
  return note({ key: `outing:${o.id}:dated:${day}`, outingId: o.id, memberIds: stars, grownUps: false }, (lang) => {
    const { t } = words(lang);
    return { title: t('{outing}: the date is set', { outing: `${o.emoji ? `${o.emoji} ` : ''}${o.title}` }), body: t("It's {date}.", { date: date(day, lang, { weekday: 'long', month: 'long', day: 'numeric' }) }) };
  });
}
