import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripClock, zonedInstant, planChecks } from '../src/travel-context.ts';
import { travelSetup } from './travel.test.ts';
const base = {startDate:'2027-07-10',endDate:'2027-07-15',stops:[],legs:[],stayGroups:[],items:[]};
test('travel clock uses destination date and half-open stop boundaries', () => {
 const trip={...base,stops:[{id:'tokyo',timezone:'Asia/Tokyo',arriveDate:'2027-07-10',leaveDate:'2027-07-15'}]};
 assert.deepEqual(tripClock(trip,new Date('2027-07-10T00:00Z'),'America/Los_Angeles'),{today:'2027-07-10',timeZone:'Asia/Tokyo',source:'stop',stopId:'tokyo'});
 assert.equal(tripClock(trip,new Date('2027-07-14T15:00Z'),'America/Los_Angeles').source,'home');
 assert.equal(zonedInstant('2027-03-14','02:30','America/New_York'),null);
});
test('travel clock transitions exactly at known leg arrival and handles ambiguity', () => {
 const leg={id:'flight',booking:'booked',departDate:'2027-07-10',departTime:'23:00',departTz:'America/Los_Angeles',arriveDate:'2027-07-12',arriveTime:'04:00',arriveTz:'Asia/Tokyo'};
 const trip={...base,legs:[leg]};
 assert.equal(tripClock(trip,new Date('2027-07-11T18:59Z'),'UTC').timeZone,'America/Los_Angeles');
 assert.equal(tripClock(trip,new Date('2027-07-11T19:00Z'),'UTC').timeZone,'Asia/Tokyo');
 const stops=[{id:'a',timezone:'Asia/Tokyo',arriveDate:'2027-07-10',leaveDate:'2027-07-15'},{id:'b',timezone:'Europe/Paris',arriveDate:'2027-07-10',leaveDate:'2027-07-15'}];
 assert.equal(tripClock({...base,stops},new Date('2027-07-12T12:00Z'),'UTC').source,'home');
 assert.equal(tripClock({...base,stops,viewTimeZone:'Pacific/Honolulu'},new Date('2027-07-12T12:00Z'),'UTC').source,'override');
});
test('plan checks use exclusive checkout and interval gaps without per-day expansion', () => {
 const trip={...base,stayGroups:[{id:'g',checkIn:'2027-07-10',checkOut:'2027-07-12',chosenOptionId:'s',options:[{id:'s',booking:'booked'}]}]};
 assert.deepEqual(planChecks(trip),[{code:'uncovered_nights',part:'stays',from:'2027-07-12',to:'2027-07-15',ids:[],count:3}]);
 assert.equal(planChecks({...base,startDate:'0001-01-01',endDate:'9999-12-31'}).length,1);
 assert.equal(planChecks({...trip,canceledAt:'2027-01-01'}).length,0);
});
test('departure day keeps its known origin zone, and split-family flights do not hide lodging gaps', () => {
 const leg={id:'flight',mode:'flight',booking:'booked',memberIds:['alex'],departDate:'2027-07-10',departTime:'23:00',departTz:'Asia/Tokyo',arriveDate:'2027-07-11',arriveTime:'12:00',arriveTz:'America/Los_Angeles'};
 assert.equal(tripClock({...base,legs:[leg]},new Date('2027-07-10T01:00Z'),'America/New_York').timeZone,'Asia/Tokyo');
 const checks=planChecks({...base,memberIds:['alex','sam'],legs:[leg]});
 assert.equal(checks.find(c=>c.code==='uncovered_nights')?.from,'2027-07-10');
});
test('UTC travel checks ignore unknown endpoints and distinguish date-line travel from backwards chronology', () => {
 const flight={id:'flight',mode:'flight',booking:'booked',memberIds:[],departDate:'2027-07-10',departTime:'23:00',departTz:'America/Los_Angeles',arriveDate:'2027-07-12',arriveTime:'04:00',arriveTz:'Asia/Tokyo'};
 assert.ok(!planChecks({...base,legs:[flight]}).some(c=>c.code==='travel_backwards'));
 assert.ok(!planChecks({...base,endDate:'2027-07-12',legs:[flight]}).some(c=>c.code==='uncovered_nights'));
 const unknown={...flight,id:'unknown',arriveTz:null};
 assert.ok(!planChecks({...base,legs:[unknown]}).some(c=>c.code==='travel_backwards'));
 const backwards={...flight,id:'backwards',departTz:'UTC',arriveTz:'UTC',arriveDate:'2027-07-10',arriveTime:'22:00'};
 assert.ok(planChecks({...base,legs:[backwards]}).some(c=>c.code==='travel_backwards' && c.ids[0]==='backwards'));
 const crossing={...flight,id:'crossing',departDate:'2027-07-11',departTime:'18:00',departTz:'UTC',arriveDate:'2027-07-11',arriveTime:'22:00',arriveTz:'UTC'};
 assert.ok(planChecks({...base,legs:[flight,crossing]}).some(c=>c.code==='travel_overlap'));
 assert.ok(!planChecks({...base,legs:[{...flight,memberIds:['alex']},{...crossing,memberIds:['sam']}]}).some(c=>c.code==='travel_overlap'));
 assert.ok(!planChecks({...base,legs:[flight,{...crossing,booking:'canceled'}]}).some(c=>c.code==='travel_overlap'));
});
test('advisories cover every dated public plan part and only overlap chosen noncanceled stays', () => {
 const g=(id:string,from:string,to:string,chosen=true,booking='none')=>({id,checkIn:from,checkOut:to,chosenOptionId:chosen?id+'-stay':null,options:[{id:id+'-stay',booking}]});
 const trip={...base,stops:[{id:'stop',timezone:null,arriveDate:'2027-07-09',leaveDate:'2027-07-10'}],items:[{id:'activity',date:'2027-07-16'}],stayGroups:[g('a','2027-07-10','2027-07-13'),g('b','2027-07-12','2027-07-15'),g('outside','2027-07-16','2027-07-17',false),g('canceled','2027-07-09','2027-07-16',true,'canceled')]};
 const checks=planChecks(trip);
 assert.equal(checks.filter(c=>c.code==='overlapping_stays').length,1);
 assert.deepEqual(checks.find(c=>c.code==='overlapping_stays')?.ids,['a','b']);
 for(const id of ['stop','activity','outside'])assert.ok(checks.some(c=>c.code==='outside_trip' && c.ids.includes(id)));
 assert.ok(!checks.some(c=>c.ids.includes('canceled')));
 assert.ok(!checks.some(c=>c.code==='uncovered_nights'));
});
test('travel clocks handle DST, invalid endpoints, unknown zones and exact adjacent stop transitions', () => {
 assert.equal(zonedInstant('2027-02-30','12:00','UTC'),null);
 assert.equal(zonedInstant('2027-03-14','03:00','America/New_York')?.toISOString(),'2027-03-14T07:00:00.000Z');
 assert.equal(zonedInstant('2027-11-07','02:00','America/New_York')?.toISOString(),'2027-11-07T07:00:00.000Z');
 assert.equal(zonedInstant('2027-11-07','01:30','America/New_York'),null,'ambiguous repeated hours cannot support exact UTC overlap claims');
 const stops=[{id:'a',timezone:'Asia/Tokyo',arriveDate:'2027-07-10',leaveDate:'2027-07-12'},{id:'b',timezone:'Asia/Tokyo',arriveDate:'2027-07-12',leaveDate:'2027-07-15'}];
 assert.equal(tripClock({...base,stops},Date.parse('2027-07-11T14:59:59Z'),'UTC').stopId,'a');
 assert.equal(tripClock({...base,stops},Date.parse('2027-07-11T15:00:00Z'),'UTC').stopId,'b');
 assert.equal(tripClock({...base,stops:[{...stops[0],timezone:'Fake/Zone'}]},Date.parse('2027-07-11T10:00Z'),'UTC').source,'home');
});
test('known departure and arrival endpoints can supply day context even when the other endpoint is incomplete', () => {
 const leg={id:'flight',booking:'booked',departDate:'2027-07-10',departTime:'23:00',departTz:'Asia/Tokyo',arriveDate:null,arriveTime:null,arriveTz:null};
 assert.equal(tripClock({...base,legs:[leg]},Date.parse('2027-07-10T01:00Z'),'UTC').timeZone,'Asia/Tokyo');
 assert.equal(tripClock({...base,legs:[{...leg,departDate:null,departTime:null,departTz:null,arriveDate:'2027-07-10',arriveTime:'08:00',arriveTz:'Asia/Tokyo'}]},Date.parse('2027-07-10T01:00Z'),'UTC').timeZone,'Asia/Tokyo');
});
test('large disjoint schedules keep interval coverage and do not invent overlaps; dense warnings are capped', () => {
 const date=(n:number)=>new Date(Date.parse('2027-01-01T00:00Z')+n*86400000).toISOString().slice(0,10);
 const stayGroups=Array.from({length:1000},(_,i)=>({id:`g${i}`,checkIn:date(i),checkOut:date(i+1),chosenOptionId:`s${i}`,options:[{id:`s${i}`,booking:'booked'}]}));
 const legs=Array.from({length:1000},(_,i)=>({id:`l${i}`,booking:'booked',departDate:date(i),arriveDate:date(i),departTime:'10:00',arriveTime:'11:00',departTz:'UTC',arriveTz:'UTC'}));
 assert.deepEqual(planChecks({...base,startDate:date(0),endDate:date(1000),stayGroups,legs}),[]);
 assert.equal(planChecks({...base,stayGroups:stayGroups.map(g=>({...g,checkIn:base.startDate,checkOut:base.endDate}))}).length,200);
});
test('care stays encrypted and grownup projected, with revision guarded edits', async () => {
 const t=await travelSetup(); let trip=(await t.send('POST','/api/trips',{title:'Our Family trip'})).body;
 const secret='FAKE-PRIVATE-CARE';
 let result=await t.send('POST',`/api/trips/${trip.id}/care`,{revision:trip.revision,title:'Pet care',helperName:'Sam',helperContact:secret,instructions:secret,tasks:[{id:'feed',text:secret,done:false}],fromDate:'2027-07-10',toDate:'2027-07-15'});
 assert.equal(result.status,201,JSON.stringify(result.body)); trip=result.body;
 assert.equal(trip.care[0].helperContact,secret);
 const row=await t.db.prepare('SELECT data FROM trip_care WHERE trip_id=?').bind(trip.id).first<{data:string}>(); assert.ok(row); assert.ok(!row.data.includes(secret));
 for(const key of [t.kidKey,t.wallKey]) {const got=(await t.send('GET',`/api/trips/${trip.id}`,undefined,key)).body; assert.deepEqual(got.care,[]); assert.equal(got.canSeeCare,false);}
 assert.equal((await t.send('PATCH',`/api/trips/${trip.id}/care/${trip.care[0].id}`,{revision:trip.revision-1,title:'Changed'})).status,409);
 result=await t.send('PATCH',`/api/trips/${trip.id}/care/${trip.care[0].id}`,{revision:trip.revision,status:'confirmed'}); assert.equal(result.status,200); assert.equal(result.body.care[0].helperContact,secret);
 assert.equal((await t.send('POST',`/api/trips/${trip.id}/care`,{revision:result.body.revision,title:'Invalid',fromDate:'2027-07-15',toDate:'2027-07-10'})).status,400);
 const preview=await t.send('POST',`/api/trips/${trip.id}/date-change/preview`,{startDate:'2027-08-01',endDate:'2027-08-10'});
 assert.deepEqual(preview.body.care,[{id:trip.care[0].id,title:'Pet care',date:'2027-07-10'}]);
 assert.equal((await t.send('GET',`/api/trips/${trip.id}`)).body.care[0].fromDate,'2027-07-10');
 const connectedPreview=await t.send('POST',`/api/trips/${trip.id}/date-change/preview`,{startDate:'2027-08-01',endDate:'2027-08-10'},undefined,{'X-Kinwall-Source':'mcp'});
 assert.equal(connectedPreview.body.care,undefined);
});
test('family clock ignores solo travelers and rental bookings for departure, travel and arrival context', () => {
 const leg={id:'solo',mode:'flight',booking:'booked',memberIds:['sam'],departDate:'2027-07-11',departTime:'09:00',departTz:'America/Los_Angeles',arriveDate:'2027-07-11',arriveTime:'15:00',arriveTz:'America/New_York'};
 const trip={...base,memberIds:['alex','sam'],stops:[{id:'family',timezone:'Europe/London',arriveDate:'2027-07-10',leaveDate:'2027-07-15'}],legs:[leg]};
 for(const at of ['2027-07-11T14:00Z','2027-07-11T17:00Z','2027-07-11T21:00Z']) {
   assert.equal(tripClock(trip,new Date(at),'UTC').stopId,'family',at);
   assert.equal(tripClock({...trip,legs:[{...leg,mode:'rental',memberIds:[]}]},new Date(at),'UTC').stopId,'family');
 }
 assert.equal(tripClock({...trip,legs:[{...leg,memberIds:[]}]},new Date('2027-07-11T17:00Z'),'UTC').source,'leg');
});
test('rental booking intervals do not overlap travel but retain outside and backwards checks', () => {
 const leg={id:'flight',mode:'flight',booking:'booked',memberIds:[],departDate:'2027-07-11',departTime:'09:00',departTz:'UTC',arriveDate:'2027-07-11',arriveTime:'15:00',arriveTz:'UTC'};
 assert.ok(!planChecks({...base,legs:[leg,{...leg,id:'rental',mode:'rental'}]}).some(c=>c.code==='travel_overlap'));
 const checks=planChecks({...base,legs:[{...leg,id:'rental',mode:'rental',departDate:'2027-07-09',arriveDate:'2027-07-09',arriveTime:'08:00'}]});
 assert.ok(checks.some(c=>c.code==='outside_trip'));assert.ok(checks.some(c=>c.code==='travel_backwards'));
});
test('corrupt care preserves readable rows and generic writes, with a private unavailable flag and actual-row limit', async () => {
 const f=await travelSetup();let trip=(await f.send('POST','/api/trips',{title:'Our Family trip'})).body;
 trip=(await f.send('POST',`/api/trips/${trip.id}/care`,{revision:trip.revision,title:'Feed Biscuit'})).body;
 await f.db.prepare('INSERT INTO trip_care(id,trip_id,data) VALUES(?,?,?)').bind('corrupt',trip.id,'FAKE-CORRUPT-PRIVATE').run();
 const read=await f.send('GET',`/api/trips/${trip.id}`);
 assert.equal(read.status,200);assert.equal(read.body.canSeeCare,true);assert.equal(read.body.careUnavailable,true);assert.equal(read.body.care.length,1);
 for(const key of [f.kidKey,f.wallKey]){const child=await f.send('GET',`/api/trips/${trip.id}`,undefined,key);assert.equal(child.body.careUnavailable,false);assert.deepEqual(child.body.care,[]);}
 const changed=await f.send('PATCH',`/api/trips/${trip.id}`,{revision:trip.revision,title:'Saved despite corrupt care'});
 assert.equal(changed.status,200);assert.equal(changed.body.revision,trip.revision+1);
 assert.equal((await f.db.prepare('SELECT data FROM trip_care WHERE id=?').bind('corrupt').first<{data:string}>())?.data,'FAKE-CORRUPT-PRIVATE');
 for(let i=2;i<100;i++)await f.db.prepare('INSERT INTO trip_care(id,trip_id,data) VALUES(?,?,?)').bind(`bad-${i}`,trip.id,'FAKE-CORRUPT-PRIVATE').run();
 assert.equal((await f.send('POST',`/api/trips/${trip.id}/care`,{revision:changed.body.revision,title:'One too many'})).status,400);
 assert.equal((await f.send('GET','/api/export?includeTripDetails=1')).status,400);
});
test('explicit shared or wall full-access credentials cannot read private care', async () => {
 const f=await travelSetup();let trip=(await f.send('POST','/api/trips',{title:'Our Family trip'})).body;
 trip=(await f.send('POST',`/api/trips/${trip.id}/care`,{revision:trip.revision,title:'Private care'})).body;
 const key=(await f.send('POST','/api/keys',{name:'Fake legacy full-access screen',scope:'admin'})).body;
 // Current settings correctly prohibit creating this combination; model a legacy stored key.
 for(const [owner,kind] of [['shared',null],[null,'wall'],[f.maya.id,'kid']]){
   await f.db.prepare('UPDATE api_keys SET owner=?,device_kind=? WHERE id=?').bind(owner,kind,key.id).run();
   const read=await f.send('GET',`/api/trips/${trip.id}`,undefined,key.key);assert.equal(read.status,200);assert.equal(read.body.canSeeCare,false);assert.deepEqual(read.body.care,[]);
   assert.equal((await f.send('POST',`/api/trips/${trip.id}/care`,{revision:trip.revision,title:'Not allowed'},key.key)).status,403);
   assert.equal((await f.send('GET','/api/export?includeTripDetails=1',undefined,key.key)).status,403);
 }
});
