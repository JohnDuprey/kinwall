import { enqueueMedicinePush } from '../src/medicine-push-retries.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createKinwall } from '../src/entry.ts';
import { nextReminderAt } from '../src/reminder-schedule.ts';
import { sealMedication, sealLog, NO_REFILL } from '../src/routes/medications.ts';
import { sha256Hex } from '../src/auth.ts';
import type { Env } from '../src/env.ts';

const at=(s:string)=>new Date(`2030-03-04T${s}Z`);
async function fixture() {
 const DB=openDb(':memory:'); applyMigrations(DB,fileURLToPath(new URL('../migrations',import.meta.url)));
 const env:Env={DB,ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='};
 await DB.prepare("INSERT INTO settings(key,value) VALUES ('timezone','UTC'),('medications','true')").run();
 await DB.prepare("INSERT INTO members(id,name,color,grown_up,created_at) VALUES ('sam','Sam','#123456',1,'2030-01-01')").run();
 const med:{id:string;memberId:string;name:string;dose:string;times:(string|{wake:true;latest:string})[];days:number[];lateWindow:'3h'|'evening'|'endOfDay'|'none';refill:typeof NO_REFILL;endDate?:string|null}={id:'med',memberId:'sam',name:'private-test-medicine',dose:'private-dose',times:['09:00'],days:[0,1,2,3,4,5,6],lateWindow:'3h' as const,refill:NO_REFILL};
 const save=async()=>DB.prepare('INSERT INTO medications(id,member_id,data,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(med.id,med.memberId,await sealMedication(env,med),'2030-01-01','2030-01-01').run();
 await save();
 const log=async(data:Record<string,unknown>)=>DB.prepare('INSERT INTO medication_log(medication_id,date,log,updated_at) VALUES (?,?,?,?) ON CONFLICT(medication_id,date) DO UPDATE SET log=excluded.log').bind('med','2030-03-04',await sealLog(env,'med','2030-03-04',data as never),'2030-03-04').run();
 return {DB,env,med,save,log};
}
test('reminder plan: a 9 AM dose advances an 8:59–9:04 maintenance window to 9:00',async()=>{
 const {env}=await fixture();
 assert.equal(await nextReminderAt(env,at('08:59:00'),at('09:04:00')),at('09:00:00').getTime());
 assert.equal(await nextReminderAt(env,at('08:50:00'),at('08:55:00')),null);
});
test('reminder plan: taken/skipped, disabled, and expired courses do not wake for a dose',async()=>{
 for(const status of ['taken','skipped']) {
  const {env,log}=await fixture(); await log({'09:00':{status}});
  assert.equal(await nextReminderAt(env,at('08:59:00'),at('09:04:00')),null);
 }
 const expired=await fixture(); expired.med.endDate='2030-03-03'; await expired.save();
 assert.equal(await nextReminderAt(expired.env,at('08:59:00'),at('09:04:00')),null);
 const {env,DB}=await fixture(); await DB.prepare("UPDATE settings SET value='false' WHERE key='medications'").run();
 assert.equal(await nextReminderAt(env,at('08:59:00'),at('09:04:00')),null);
});
test('reminder plan: claimed due times do not busy-loop, but snoozes wake at their own deadline',async()=>{
 const {env,DB,log}=await fixture();
 await DB.prepare('INSERT INTO sent_notifications(key,sent_at) VALUES (?,?)').bind('med:'+await sha256Hex('due:med:2030-03-04:09:00'),at('09:00:00').toISOString()).run();
 assert.equal(await nextReminderAt(env,at('09:01:00'),at('09:06:00')),null);
 await log({'09:00':{snoozedUntil:at('09:03:00').toISOString()}});
 assert.equal(await nextReminderAt(env,at('09:01:00'),at('09:06:00')),at('09:03:00').getTime());
});
test('reminder plan: an overdue unclaimed dose requests a prompt wake, never a replay hours later',async()=>{
 const {env}=await fixture();
 assert.equal(await nextReminderAt(env,at('09:01:00'),at('09:06:00')),at('09:01:00').getTime());
 assert.equal(await nextReminderAt(env,at('09:31:00'),at('09:36:00')),null);
});
test('reminder-only entry point sends at 9:00 once without running calendar sync',async()=>{
 const {env,DB}=await fixture(); const host=createKinwall(env);
 const prepare=DB.prepare.bind(DB);
 DB.prepare=((sql:string)=>{if(/FROM calendars/.test(sql))assert.fail('reminder-only wake must not scan calendars'); return prepare(sql);}) as typeof DB.prepare;
 await host.reminders(at('09:00:00')); await host.reminders(at('09:00:01'));
 assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='medication'").first<any>()).n,1);
 assert.equal(await host.nextReminderAt(at('09:00:02'),at('09:04:00')),null);
});

test('reminder plan: wake-dose latest, child late note and long-window follow-up use the delivery deadlines',async()=>{
 const f=await fixture();
 f.med.times=[{wake:true,latest:'09:00'}]; await f.save();
 assert.equal(await nextReminderAt(f.env,at('08:59:00'),at('09:04:00')),at('09:00:00').getTime());
 f.med.times=['09:00']; await f.save();
 await f.DB.prepare("UPDATE members SET grown_up=0 WHERE id='sam'").run();
 await f.DB.prepare('INSERT INTO sent_notifications(key,sent_at) VALUES (?,?)').bind('med:'+await sha256Hex('due:med:2030-03-04:09:00'),at('09:00:00').toISOString()).run();
 assert.equal(await nextReminderAt(f.env,at('09:29:00'),at('09:34:00')),at('09:30:00').getTime());
 f.med.lateWindow='evening'; await f.save();
 assert.equal(await nextReminderAt(f.env,at('14:29:00'),at('14:34:00')),at('14:30:00').getTime());
 assert.equal(await nextReminderAt(f.env,at('18:59:00'),at('19:04:00')),at('19:00:00').getTime());
});
test('reminder plan: household timezone and weekday filters apply across midnight',async()=>{
 const f=await fixture(); f.med.days=[1]; await f.save();
 await f.DB.prepare("UPDATE settings SET value='America/Los_Angeles' WHERE key='timezone'").run();
 assert.equal(await nextReminderAt(f.env,at('16:59:00'),at('17:04:00')),at('17:00:00').getTime());
 f.med.days=[2]; await f.save();
 assert.equal(await nextReminderAt(f.env,at('16:59:00'),at('17:04:00')),null);
});
test('reminder plan: daylight-saving due times follow the same converter as delivery',async()=>{
 const f=await fixture(); f.med.times=['09:00']; await f.save();
 await f.DB.prepare("UPDATE settings SET value='America/New_York' WHERE key='timezone'").run();
 const from=new Date('2030-03-10T12:59:00Z'), before=new Date('2030-03-10T13:04:00Z');
 assert.equal(await nextReminderAt(f.env,from,before),Date.parse('2030-03-10T13:00:00Z'));
});

test('reminder plan: sealed retry deadlines can wake before maintenance',async()=>{
 const f=await fixture();
 await f.DB.prepare("INSERT INTO push_subscriptions(id,endpoint,p256dh,auth,device_name,created_at) VALUES ('phone',?,'','encrypted-token','Test phone','2030-03-04')").bind('apns:'+'a'.repeat(64)).run();
 await enqueueMedicinePush(f.env,{id:'phone',endpoint:'apns:'+'a'.repeat(64),auth:'encrypted-token',prefs:'{}',member_ids:'[]',lang:'en',gateway_credential:'v1:fake'}, {title:'Medicine',body:'Generic'},'snapshot',at('09:00:00').getTime());
 await f.DB.prepare('INSERT INTO sent_notifications(key,sent_at) VALUES (?,?)').bind('med:'+await sha256Hex('due:med:2030-03-04:09:00'),at('09:00:00').toISOString()).run();
 assert.equal(await nextReminderAt(f.env,at('09:00:01'),at('09:04:00')),at('09:01:00').getTime());
});
