import { DUE_MS, LATE_MS, dueAt, timeKey, windowEnd, type Medication, type DoseEntry, type DoseTime } from './routes/medications.ts';

export const MED_GRACE_MS = 30 * 60_000;
export const REFILL_REMIND_AT = '09:00';
const NOTE_BEFORE_END_MS = 60 * 60_000;
type Target = { at: number; key: string };
/** Shared by delivery and alarm planning so snoozes, wake doses and long windows agree. */
export function medicineReminderTimes(m: Medication, date: string, time: DoseTime, tz: string, entry: DoseEntry | undefined, grownUp: boolean) {
  const at = dueAt(time, date, tz, entry), end = windowEnd(m.lateWindow, date, at, tz);
  const dose = `${m.id}:${date}:${timeKey(time)}`;
  return { end,
    due: { at, key: `due:${dose}` } as Target,
    snooze: entry?.snoozedUntil ? { at: Date.parse(entry.snoozedUntil), key: `snooze:${dose}:${entry.snoozedUntil}` } as Target : null,
    follow: end - at > DUE_MS ? { at: at + (end - at) / 2, key: `follow:${dose}` } as Target : null,
    late: !grownUp ? { at: end - at > DUE_MS ? end - NOTE_BEFORE_END_MS : at + LATE_MS, key: `late:${dose}` } as Target : null,
  };
}
