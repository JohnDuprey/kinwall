import { nextMedicinePushRetryAt } from './medicine-push-retries.ts';
import type { Env } from './env.ts';
import { hostTimezone } from './env.ts';
import { readFeatures } from './routes/settings.ts';
import { addDays, doseAt, loadLogs, loadMedications, scheduledOn, timeKey } from './routes/medications.ts';
import { todayInTz } from './routes/members.ts';
import { sha256Hex } from './auth.ts';
import { MED_GRACE_MS, REFILL_REMIND_AT, medicineReminderTimes } from './medicine-reminder-times.ts';

/** Next medicine deadline before the host's routine tick (at most 24 hours ahead).
 * Only a timestamp leaves this function; health schedules stay encrypted in storage. */
export async function nextReminderAt(env: Env, now: Date, before: Date): Promise<number | null> {
  if (!(await readFeatures(env.DB)).trackersHealth) return null;
  const { results: settings } = await env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('medications','timezone')").all<{ key: string; value: string }>();
  if (settings.find(s => s.key === 'medications')?.value !== 'true') return null;
  const tz = settings.find(s => s.key === 'timezone')?.value ?? hostTimezone();
  const today = todayInTz(tz, now), yesterday = addDays(today,-1), tomorrow = addDays(today,1);
  const meds = await loadMedications(env);
  if (!meds.length) return null;
  const logs = await loadLogs(env,meds.map(m => m.id),yesterday,tomorrow);
  const { results: members } = await env.DB.prepare('SELECT id,grown_up FROM members').all<{ id: string; grown_up: number }>();
  const candidates: { at: number; key: string }[] = [];
  const horizon = Math.min(before.getTime(), now.getTime() + 86400000);
  for (const med of meds) {
    const member = members.find(m => m.id === med.memberId);
    if (!member) continue;
    for (const date of [yesterday,today,tomorrow]) {
      if (!scheduledOn(med,date)) continue;
      for (const time of med.times) {
        const entry = logs.get(`${med.id}:${date}`)?.[timeKey(time)];
        if (entry?.status) continue;
        const { due,snooze,follow,late } = medicineReminderTimes(med,date,time,tz,entry,!!member.grown_up);
        for (const target of [due,snooze,follow,late]) {
          if (target && Number.isFinite(target.at) && target.at <= horizon && target.at > now.getTime() - MED_GRACE_MS) candidates.push(target);
        }
      }
    }
  }
  // Batched, indexed dedupe lookups; past but unclaimed deadlines ask the host to wake promptly.
  const hashed = await Promise.all(candidates.map(async c => ({ at: c.at, key: `med:${await sha256Hex(c.key)}` })));
  let next = await nextMedicinePushRetryAt(env,now.getTime(),horizon);
  for (let i=0; i<hashed.length; i+=100) {
    const batch = hashed.slice(i,i+100);
    const { results } = await env.DB.prepare('SELECT key FROM sent_notifications WHERE key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(batch.map(c=>c.key))).all<{ key: string }>();
    const claimed = new Set(results.map(r=>r.key));
    for (const c of batch) if (!claimed.has(c.key)) next = Math.min(next ?? Infinity,Math.max(now.getTime(),c.at));
  }
  for (const med of meds) {
    if (!med.refill.remindOn || med.refillRequest || !members.some(m=>m.id===med.memberId)) continue;
    const at = Math.max(now.getTime(),doseAt(med.refill.remindOn,REFILL_REMIND_AT,tz));
    if (at <= horizon) next = Math.min(next ?? Infinity,at);
  }
  return next;
}
