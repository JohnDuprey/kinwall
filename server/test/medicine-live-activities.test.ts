import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey } from '../src/auth.ts';
import { runMedicineLiveActivities } from '../src/medicine-live-activities.ts';
import type { Env } from '../src/env.ts';
import type { NativePushRequest } from '../src/native-push.ts';
const START = 'ab'.repeat(32), UPDATE = 'cd'.repeat(32);
const at = (time: string) => new Date(`2030-03-04T${time}:00Z`);
async function fixture(t: { after(f: () => void): void }) {
 mock.timers.enable({ apis: ['Date'], now: at('07:00') }); t.after(() => mock.timers.reset());
 const db = openDb(':memory:'); applyMigrations(db,fileURLToPath(new URL('../migrations',import.meta.url)));
 const env: Env = { DB: db, ADMIN_API_KEY:'test-admin', ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
 const app=createApp(), sent: Extract<NativePushRequest,{type:'liveactivity'}>[]=[];
 let failing=false;
 const req=async(path:string,method='GET',body?:unknown,key='test-admin')=> app.request(path,{method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},env);
 const json=async(path:string,method='GET',body?:unknown,key?:string):Promise<any>=>{const r=await req(path,method,body,key); assert.ok(r.ok,`${path}: ${r.status} ${await r.clone().text()}`);return r.status===204 ? null : r.json();};
 await json('/api/settings','PATCH',{timezone:'UTC',medications:true,quietFrom:'07:00',quietTo:'09:00'});
 const sam=await json('/api/members','POST',{name:'Sam',grownUp:true,color:'#FF8FA3'});
 const leo=await json('/api/members','POST',{name:'Leo',color:'#7ED9A6'});
 const phone=await createApiKey(db,"Sam's phone",'admin',{owner:sam.id});
 const kid=await createApiKey(db,"Leo's phone",'display',{owner:leo.id});
 const med=await json('/api/medications','POST',{memberId:sam.id,name:'Private medicine',dose:'1 tablet',times:['08:00'],lateWindow:'evening'});
 const register=(key=phone.key,preferences={leaveBy:false,medications:true,medicationNames:false,kidDoses:false})=>json('/api/live-activities/tokens','PUT',{kind:'start',token:START,preferences},key);
 const enable=()=>{env.NATIVE_PUSH_SEND=async r=>{if(r.type==='liveactivity')sent.push(r);return{ok:!failing,gone:false};};};
 const tick=async(time:string)=>{mock.timers.setTime(at(time).getTime());await runMedicineLiveActivities(env,at(time));};
 return{db,env,req,json,sam,leo,phone,kid,med,register,enable,tick,sent,fail:(v:boolean)=>{failing=v;}};
}
test('medicine activities start with the app closed, independently of travel reminders and night hours, once',async t=>{
 const f=await fixture(t);await f.register();f.enable();await f.tick('07:59');assert.equal(f.sent.length,0);
 await f.tick('08:00');assert.equal(f.sent.length,1);const a=f.sent[0].aps;
 assert.equal(a.event,'start');assert.equal(a['attributes-type'],'KinwallActivityAttributes');
 assert.equal((a.attributes as any).kind,'medication');assert.equal((a.attributes as any).dose.medicationId,f.med.id);
 assert.ok(!JSON.stringify(a).includes('Private medicine'));assert.match((a.attributes as any).name,/Sam/);
 await f.tick('08:01');assert.equal(f.sent.length,1);
});
test('medicine activities update at the follow-up point and end when taken on another device',async t=>{
 const f=await fixture(t);await f.register();f.enable();await f.tick('08:00');const activity=(f.sent[0].aps.attributes as any).activity;
 await f.json('/api/live-activities/tokens','PUT',{kind:'update',token:UPDATE,activity,endsAt:at('20:00').toISOString()},f.phone.key);
 f.sent.length=0;await f.tick('14:00');assert.equal(f.sent.at(-1)?.aps.event,'update');assert.match((f.sent.at(-1)?.aps['content-state'] as any).title,/Still time/);
 const count=f.sent.length;await f.tick('14:01');assert.equal(f.sent.length,count,'unchanged state is not pushed again');
 await f.json(`/api/medications/${f.med.id}/doses`,'POST',{date:'2030-03-04',time:'08:00',action:'taken'});
 assert.equal(f.sent.at(-1)?.aps.event,'end','the successful write reconciles immediately');
});
test('snooze ends the current activity, and the dose can start again after the snooze',async t=>{
 const f=await fixture(t);await f.register();f.enable();await f.tick('08:00');const activity=(f.sent[0].aps.attributes as any).activity;
 await f.json('/api/live-activities/tokens','PUT',{kind:'update',token:UPDATE,activity,endsAt:at('20:00').toISOString()},f.phone.key);
 await f.json(`/api/medications/${f.med.id}/doses`,'POST',{date:'2030-03-04',time:'08:00',action:'snooze'},f.phone.key);
 assert.equal(f.sent.at(-1)?.aps.event,'end');const count=f.sent.length;await f.tick('08:09');assert.equal(f.sent.length,count);
 await f.tick('08:10');assert.equal(f.sent.at(-1)?.aps.event,'start');
});
test('only explicit parent opt-in includes kids; a kid cannot enable household medicine activities',async t=>{
 const f=await fixture(t);await f.json(`/api/medications/${f.med.id}`,'DELETE');
 await f.json('/api/medications','POST',{memberId:f.leo.id,name:'Private kid medicine',times:['08:00']});
 await f.register();f.enable();await f.tick('08:00');assert.equal(f.sent.length,0);
 await f.register(f.phone.key,{leaveBy:false,medications:true,medicationNames:true,kidDoses:true});
 assert.equal(f.sent.at(-1)?.aps.event,'start');assert.match(JSON.stringify(f.sent.at(-1)?.aps),/Private kid medicine/);
 assert.equal((await f.req('/api/live-activities/tokens','PUT',{kind:'start',token:START,preferences:{medications:true,kidDoses:true}},f.kid.key)).status,403);
});
test('old registrations do not opt into medicine pushes; disabled features stop activities and failed sends retry',async t=>{
 const f=await fixture(t);await f.json('/api/live-activities/tokens','PUT',{kind:'start',token:START},f.phone.key);f.enable();await f.tick('08:00');assert.equal(f.sent.length,0);
 f.fail(true);await f.register();const n=f.sent.length;await f.tick('08:01');assert.ok(f.sent.length>n,'a failed start is not marked delivered');
 f.fail(false);await f.tick('08:02');const activity=(f.sent.at(-1)?.aps.attributes as any).activity;
 await f.json('/api/live-activities/tokens','PUT',{kind:'update',token:UPDATE,activity,endsAt:at('20:00').toISOString()},f.phone.key);
 f.fail(true);await f.json('/api/settings','PATCH',{medications:false});
 assert.equal(f.sent.at(-1)?.aps.event,'end');assert.equal((await f.db.prepare("SELECT count(*) AS n FROM live_activity_tokens WHERE kind='update'").first<{n:number}>())?.n,1);
 f.fail(false);await f.tick('08:03');assert.equal(f.sent.at(-1)?.aps.event,'end');assert.equal((await f.db.prepare("SELECT count(*) AS n FROM live_activity_tokens WHERE kind='update'").first<{n:number}>())?.n,0);
});

test('a parent-only snooze hides a kid’s activity on that parent’s phone, leaving the kid’s own activity active',async t=>{
 const f=await fixture(t);await f.json(`/api/medications/${f.med.id}`,'DELETE');
 const med=await f.json('/api/medications','POST',{memberId:f.leo.id,name:'Private kid medicine',times:['08:00']});
 await f.register(f.phone.key,{leaveBy:false,medications:true,medicationNames:false,kidDoses:true});
 const kidStart='ef'.repeat(32),kidUpdate='12'.repeat(32);
 await f.json('/api/live-activities/tokens','PUT',{kind:'start',token:kidStart,preferences:{medications:true}},f.kid.key);
 f.enable();await f.tick('08:00');assert.equal(f.sent.length,2);
 const activity=(f.sent[0].aps.attributes as any).activity;
 await f.json('/api/live-activities/tokens','PUT',{kind:'update',token:UPDATE,activity,endsAt:at('11:00').toISOString()},f.phone.key);
 await f.json('/api/live-activities/tokens','PUT',{kind:'update',token:kidUpdate,activity,endsAt:at('11:00').toISOString()},f.kid.key);
 f.sent.length=0;
 await f.json(`/api/medications/${med.id}/doses`,'POST',{date:'2030-03-04',time:'08:00',action:'snooze'},f.phone.key);
 assert.deepEqual(f.sent.filter(s=>s.aps.event==='end').map(s=>s.token),[UPDATE]);
 assert.ok(!JSON.stringify(f.sent).includes('Private kid medicine'));
 await f.tick('08:10');assert.equal(f.sent.at(-1)?.aps.event,'start');assert.equal(f.sent.at(-1)?.token,START);
});
test('a start-of-day dose can start remotely as soon as its person checks in elsewhere',async t=>{
 const f=await fixture(t);await f.json(`/api/medications/${f.med.id}`,'PATCH',{times:[{wake:true,latest:'12:00'}]});
 await f.register();f.enable();await f.tick('07:01');assert.equal(f.sent.length,0);
 await f.json(`/api/members/${f.sam.id}/day-started`,'POST',{},f.phone.key);
 assert.equal(f.sent.at(-1)?.aps.event,'start');assert.equal((f.sent.at(-1)?.aps.attributes as any).dose.time,'wake');
});

test('correcting a dose back to unmarked and re-enabling reminders can restart it, without repeats from token refresh',async t=>{
 const f=await fixture(t);await f.register();f.enable();await f.tick('08:00');
 const activity=(f.sent[0].aps.attributes as any).activity;
 await f.json('/api/live-activities/tokens','PUT',{kind:'update',token:UPDATE,activity,endsAt:at('20:00').toISOString()},f.phone.key);
 await f.json(`/api/medications/${f.med.id}/doses`,'POST',{date:'2030-03-04',time:'08:00',action:'taken'});
 await f.json(`/api/medications/${f.med.id}/doses`,'POST',{date:'2030-03-04',time:'08:00',action:'unmark'});
 assert.equal(f.sent.at(-1)?.aps.event,'start');
 const n=f.sent.length;await f.register();assert.equal(f.sent.length,n,'routine registration does not restart an already-sent activity');
 await f.register(f.phone.key,{leaveBy:false,medications:false,medicationNames:false,kidDoses:false});
 await f.register();assert.equal(f.sent.at(-1)?.aps.event,'start');assert.equal(f.sent.length,n+1);
});

test('foreground-only iOS activities survive before start registration, but explicit unregistration ends them',async t=>{
 const f=await fixture(t);f.enable();await f.tick('08:00');
 const {medicineActivityId}=await import('../src/medicine-live-activities.ts');
 const activity=await medicineActivityId(f.med.id,'2030-03-04','08:00',false,at('20:00').getTime());
 await f.json('/api/live-activities/tokens','PUT',{kind:'update',token:UPDATE,activity,endsAt:at('20:00').toISOString()},f.phone.key);
 assert.equal(f.sent.length,0,'does not immediately end a foreground activity on iOS without push-to-start');
 await f.json('/api/live-activities/tokens','DELETE',{},f.phone.key);
 assert.equal(f.sent.at(-1)?.aps.event,'end');
});

for (const action of ['taken', 'skipped']) test(`${action} clears the dose on every subscribed device, including foreground-only activities`, async t => {
 const f=await fixture(t);
 const tablet=await createApiKey(f.db,"Sam's tablet",'admin',{owner:f.sam.id});
 const {medicineActivityId}=await import('../src/medicine-live-activities.ts');
 const activity=await medicineActivityId(f.med.id,'2030-03-04','08:00',false,at('20:00').getTime());
 const named=await medicineActivityId(f.med.id,'2030-03-04','08:00',true,at('20:00').getTime());
 await f.register();f.enable();await f.tick('08:00');
 await f.json('/api/live-activities/tokens','PUT',{kind:'update',token:UPDATE,activity,endsAt:at('20:00').toISOString()},f.phone.key);
 const tabletToken='34'.repeat(32);
 await f.json('/api/live-activities/tokens','PUT',{kind:'update',token:tabletToken,activity:named,endsAt:at('20:00').toISOString()},tablet.key);
 // A different person's unmarked dose must keep its foreground countdown.
 const other=await f.json('/api/medications','POST',{memberId:f.leo.id,name:'Other medicine',times:['08:00'],lateWindow:'evening'});
 const otherActivity=await medicineActivityId(other.id,'2030-03-04','08:00',false,at('20:00').getTime());
 await f.json('/api/live-activities/tokens','PUT',{kind:'update',token:'56'.repeat(32),activity:otherActivity,endsAt:at('20:00').toISOString()},f.kid.key);
 f.sent.length=0;
 await f.json(`/api/medications/${f.med.id}/doses`,'POST',{date:'2030-03-04',time:'08:00',action});
 assert.deepEqual(f.sent.filter(s=>s.aps.event==='end').map(s=>s.token).sort(),[UPDATE,tabletToken].sort());
 const {results:remaining}=await f.db.prepare("SELECT activity FROM live_activity_tokens WHERE kind='update'").all<{activity:string}>();
 assert.deepEqual(remaining.map(r=>r.activity),[otherActivity]);
});

test('completed foreground activities retry failed ends and end even if their token arrives after the mark',async t=>{
 const f=await fixture(t);f.enable();await f.tick('08:00');
 const {medicineActivityId}=await import('../src/medicine-live-activities.ts');
 const activity=await medicineActivityId(f.med.id,'2030-03-04','08:00',false,at('20:00').getTime());
 await f.json(`/api/medications/${f.med.id}/doses`,'POST',{date:'2030-03-04',time:'08:00',action:'taken'});
 f.fail(true);
 await f.json('/api/live-activities/tokens','PUT',{kind:'update',token:UPDATE,activity,endsAt:at('20:00').toISOString()},f.phone.key);
 assert.equal(f.sent.at(-1)?.aps.event,'end');
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM live_activity_tokens WHERE kind='update'").first<{n:number}>())?.n,1);
 f.fail(false);await f.tick('08:01');
 assert.equal(f.sent.at(-1)?.aps.event,'end');
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM live_activity_tokens WHERE kind='update'").first<{n:number}>())?.n,0);
});
