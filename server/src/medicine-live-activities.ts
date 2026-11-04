// Medicine Live Activities are independent of event reminders, including during night hours.
// Tokens and medicine data remain sealed; persisted identifiers/state are one-way fingerprints.
import type { Env } from './env.ts';
import { sha256Hex } from './auth.ts';
import { unseal } from './crypto.ts';
import { nativePushConfigured, sendNativeLiveActivity } from './native-push.ts';
import { readFeatures } from './routes/settings.ts';
import { addDays, dueAt, loadLogs, loadMedications, medicineLabel, scheduledOn, timeKey, windowEnd } from './routes/medications.ts';
import { todayInTz } from './routes/members.ts';
import { familyLang, isLang, words } from './i18n.ts';
import { formatTime, hour12For } from './timeFormat.ts';
import { hostTimezone } from './env.ts';
import { swiftDate, unixSeconds } from './apns.ts';

export type ActivityPreferences = { events:boolean; leaveBy: boolean; medications: boolean; medicationNames: boolean; kidDoses: boolean };
export function activityPreferences(raw: string): ActivityPreferences {
  let p: Partial<ActivityPreferences> = {};
  try { p = JSON.parse(raw); } catch { /* old or damaged: no medicine opt-in */ }
  return { events:p?.events === true, leaveBy: p?.leaveBy !== false, medications: p?.medications === true, medicationNames: p?.medicationNames === true, kidDoses: p?.kidDoses === true };
}
export const medicineActivityId = async (id: string, date: string, time: string, names: boolean, until: number) =>
  `medication:${await sha256Hex(`medication:${id}:${date}:${time}:${new Date(until).toISOString()}`)}:${names ? 'names' : 'private'}`;
type Token = { id: string; device: string; kind: string; activity: string; token: string; preferences: string; state_hash: string; generation: number; ends_at: string | null; owner: string | null; scope: string | null };
type Person = { id: string; name: string; grown_up: number; language: string | null };

export async function runMedicineLiveActivities(env: Env, now = new Date()): Promise<void> {
  if (!await nativePushConfigured(env)) return;
  const db = env.DB;
  const { results: tokens } = await db.prepare('SELECT t.*,COALESCE(k.owner,g.owner) AS owner,COALESCE(k.scope,g.scope) AS scope FROM live_activity_tokens t LEFT JOIN api_keys k ON k.id=t.api_key_id LEFT JOIN oauth_grants g ON g.id=t.oauth_grant_id').all<Token>();
  if (!tokens.some(t => (t.kind === 'start' && activityPreferences(t.preferences).medications) || t.activity.startsWith('medication:'))) return;
  const { results: settings } = await db.prepare("SELECT key,value FROM settings WHERE key IN ('medications','timezone','timeFormat','location')").all<{ key: string; value: string }>();
  const prefs = new Map(settings.map(s => [s.key,s.value]));
  const on = prefs.get('medications') === 'true' && (await readFeatures(db)).trackersHealth;
  const tz = prefs.get('timezone') ?? hostTimezone(), today = todayInTz(tz,now);
  let country: string | undefined;
  try { country = JSON.parse(prefs.get('location') ?? 'null')?.countryCode; } catch { /* unset */ }
  const h12 = hour12For(prefs.get('timeFormat'),country), fam = await familyLang(db);
  const meds = on ? await loadMedications(env) : [];
  const logs = meds.length ? await loadLogs(env,meds.map(m => m.id),addDays(today,-1),today) : new Map();
  const { results: members } = await db.prepare('SELECT id,name,grown_up,language FROM members').all<Person>();
  const member = new Map(members.map(m => [m.id,m]));
  const send = async (token: Token, aps: Record<string,unknown>, priority: 5 | 10 = 10) => {
    const result = await sendNativeLiveActivity(env,await unseal(env,token.token,`live-activity-token:${token.id}`),{timestamp:unixSeconds(now.getTime()),...aps},priority);
    if (result.gone) await db.prepare('DELETE FROM live_activity_tokens WHERE id=? AND token=?').bind(token.id,token.token).run();
    return result;
  };
  const starts = tokens.filter(t => t.kind === 'start');
  // Include devices whose start token was revoked: their remaining medicine activities must end.
  for (const device of new Set(tokens.filter(t => t.kind === 'start' || t.activity.startsWith('medication:')).map(t => t.device))) {
    const start = starts.find(t => t.device === device), owner = start?.owner ? member.get(start.owner) : undefined;
    const p = activityPreferences(start?.preferences ?? '{}');
    const { t } = words(owner && isLang(owner.language) ? owner.language : fam);
    const candidates = [];
    if (start && owner && p.medications && on) for (const m of meds) {
      const who = member.get(m.memberId);
      if (!who || (who.id !== owner.id && !(p.kidDoses && start.scope === 'admin' && owner.grown_up && !who.grown_up))) continue;
      for (const date of [addDays(today,-1),today]) {
        if (!scheduledOn(m,date)) continue;
        for (const time of m.times) {
          const key = timeKey(time), e = logs.get(`${m.id}:${date}`)?.[key];
          const due = dueAt(time,date,tz,e), until = windowEnd(m.lateWindow,date,due,tz);
          const snooze = Math.max(Date.parse(e?.snoozedUntil ?? '') || 0,Date.parse(e?.snoozedFor?.[owner.id] ?? '') || 0);
          if (e?.status || now.getTime() < Math.max(due,snooze) || now.getTime() >= until) continue;
          candidates.push({m,who,date,time:key,due,until,snooze,edited:e?.editedAt ?? '',activity:await medicineActivityId(m.id,date,key,p.medicationNames,until)});
        }
      }
    }
    candidates.sort((a,b) => a.due-b.due || a.activity.localeCompare(b.activity));
    const next = candidates[0];
    const updates = tokens.filter(t => t.device === device && t.kind === 'update' && t.activity.startsWith('medication:'));
    let blocked = false;
    for (const old of updates.filter(u => u.activity !== next?.activity)) {
      // iOS 17.0/17.1 and the first foreground token can have no push-to-start registration.
      // Preserve their local activity unless it expired, the feature is off, or start was revoked.
      let revoked = false;
      try { revoked = JSON.parse(old.preferences)?.endRequested === true; } catch { /* no request */ }
      if (!start && on && !revoked && (!old.ends_at || Date.parse(old.ends_at) > now.getTime())) continue;
      const result = await send(old,{event:'end','dismissal-date':unixSeconds(now.getTime()),'content-state':{title:'',detail:null,date:null,count:0,done:true}});
      if (result.ok || result.gone) await db.prepare('DELETE FROM live_activity_tokens WHERE id=? AND token=?').bind(old.id,old.token).run();
      else blocked = true; // keep the token for retry; don't create a second activity in the meantime
    }
    if (!next || !start || blocked) continue;
    const name = next.who.name.split(' ')[0];
    const late = next.until-next.due > 3*3600000 && now.getTime() >= next.due+(next.until-next.due)/2;
    const label = p.medicationNames ? medicineLabel(next.m) : t("{name}'s medicine",{name});
    const headline = next.who.id === owner!.id
      ? late ? t("Still time for {name}'s medicine",{name}) : t("Time for {name}'s medicine",{name})
      : `${name} · ${p.medicationNames ? medicineLabel(next.m) : next.time === 'wake' ? t('Start-of-day medicine') : t('{time} medicine',{time:formatTime(next.time,{h12})})}`;
    const content = {title:headline+(candidates.length>1 ? ` · ${t('+{n} more',{n:candidates.length-1})}` : ''),detail:late?'late':'due',date:swiftDate(next.until),count:0,done:false};
    const current = updates.find(u => u.activity === next.activity);
    if (current) {
      const hash = await sha256Hex(JSON.stringify(content));
      if (current.state_hash === hash) continue;
      const changed = await db.prepare('UPDATE live_activity_tokens SET state_hash=? WHERE id=? AND token=? AND state_hash=?').bind(hash,current.id,current.token,current.state_hash).run();
      if (!changed.meta.changes) continue;
      const result = await send(current,{event:'update','content-state':content,'stale-date':unixSeconds(next.until)},5);
      if (!result.ok && !result.gone) await db.prepare('UPDATE live_activity_tokens SET state_hash=? WHERE id=? AND token=? AND state_hash=?').bind(current.state_hash,current.id,current.token,hash).run();
    } else {
      const key = `mla:${await sha256Hex(`${device}:${start.generation}:${next.activity}:${next.snooze}:${next.edited}`)}`;
      const claimed = await db.prepare('INSERT INTO sent_notifications(key,sent_at) VALUES(?,?) ON CONFLICT(key) DO NOTHING').bind(key,now.toISOString()).run();
      if (!claimed.meta.changes) continue;
      const result = await send(start,{event:'start','attributes-type':'KinwallActivityAttributes',attributes:{kind:'medication',name:label,activity:next.activity,endsAt:swiftDate(next.until),dose:{medicationId:next.m.id,date:next.date,time:next.time}},'content-state':content,'stale-date':unixSeconds(next.until),alert:{title:headline,body:t('Tap to mark it taken.')}});
      if (!result.ok && !result.gone) await db.prepare('DELETE FROM sent_notifications WHERE key=? AND sent_at=?').bind(key,now.toISOString()).run();
    }
  }
}
