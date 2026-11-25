import { choose, chromium, assert, api, test, context, go, shot, finish, closeContext, base, output } from './common.mjs';
import {writeFile} from 'node:fs/promises';
const browser = await chromium.launch({headless:true});
try {
const {page} = await context(browser);
page.setDefaultTimeout(12000);
const members=await api('GET','/api/members'), ids=Object.fromEntries(members.map(m=>[m.name,m.id]));
const settings=await api('GET','/api/settings');
await api('PATCH','/api/settings',{features:{...settings.features,trips:true,polls:true}});
const addDay=(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
const start=addDay(new Date().toISOString().slice(0,10),14), end=addDay(start,7);
const title='Docker family adventure';
let trip;
const route=(part='')=>`#/trips?trip=${trip.id}${part?`&part=${part}`:''}`;
const fresh=async()=>trip=await api('GET',`/api/trips/${trip.id}`);
const dialog=()=>page.getByRole('dialog').last();
async function save(label='Save') {const d=dialog(); await d.getByRole('button',{name:label,exact:true}).click(); await d.waitFor({state:'hidden'});}
async function zone(label,search) { await dialog().getByRole('button',{name:new RegExp(`^${label}:`)}).click(); await dialog().getByRole('searchbox').fill(search); await dialog().locator('.sheet-links .sheet-link').first().click(); }
await test('Create an undated trip idea through the browser',async()=>{
 await go(page,'#/trips');await page.getByRole('button',{name:'Add trip',exact:true}).click();
 await dialog().getByLabel('Name',{exact:true}).fill(title);
 await dialog().getByLabel('Or say when in words').fill('Next school break');
 await save(); await page.getByRole('heading',{name:title,exact:true}).waitFor();
 trip=(await api('GET','/api/trips')).find(t=>t.title===title);await fresh();
 assert.equal(trip.startDate,null);assert.equal(trip.memberIds.length,4);assert.equal(trip.status,'idea');
 await shot(page,'01-undated-idea');
});
await test('Edit dates, destination and plan status without booking anything',async()=>{
 await page.getByRole('button',{name:'Edit trip',exact:true}).click();
 await dialog().getByLabel('First day').fill(start);await dialog().getByLabel('Last day').fill(end);
 await dialog().getByLabel('Where',{exact:true}).fill('Harbor Point → Pine Ridge');
 await dialog().getByLabel('About this trip').fill('Beach first, then family time.');
 await dialog().getByRole('radio',{name:/Planning/}).click();await save();
 await page.waitForResponse(r=>r.url().endsWith(`/api/trips/${trip.id}`)&&r.request().method()==='GET').catch(()=>{});
 await fresh(); assert.equal(trip.startDate,start);assert.equal(trip.status,'planning');assert.equal(trip.counts.staysBooked,0);
});
await test('Manage and reorder multiple destinations with their own dates and timezones',async()=>{
 await go(page,route('stops'));
 for(const [name,from,to] of [['Harbor Point',start,addDay(start,4)],['Pine Ridge',addDay(start,4),end]]){
  await page.getByRole('button',{name:'Add a stop',exact:true}).click();await dialog().getByLabel('Name',{exact:true}).fill(name);await dialog().getByLabel('Town (optional)').fill(name);await zone('Time zone there','America/Chicago');await dialog().getByLabel('Arrive',{exact:true}).fill(from);await dialog().getByLabel('Leave',{exact:true}).fill(to);await save();
 }
 await page.getByRole('button',{name:'Move Pine Ridge up',exact:true}).click();
 await page.locator('.trip-stop').first().getByText('Pine Ridge',{exact:true}).waitFor();await fresh();assert.equal([...trip.stops].sort((a,b)=>a.sort-b.sort)[0].label,'Pine Ridge');
 await page.getByRole('button',{name:'Move Pine Ridge down',exact:true}).click();await page.locator('.trip-stop').first().getByText('Harbor Point',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Edit Harbor Point',exact:true}).click();await dialog().getByLabel('Notes (optional)').fill('Coastal stop');await save();await fresh();assert.equal(trip.stops.find(s=>s.label==='Harbor Point').notes,'Coastal stop');await shot(page,'01b-multiple-stops');
});
await test('Create a dated stay decision and two priced places by hand',async()=>{
 await go(page,route('stays'));await page.getByRole('button',{name:'Add a stay',exact:true}).first().click();
 await dialog().getByLabel('Name',{exact:true}).fill('Harbor nights');await dialog().getByLabel('Arrive',{exact:true}).fill(start);await dialog().getByLabel('Leave',{exact:true}).fill(addDay(start,4));await save();
 for(const [name,amount] of [['Seagrass Cottage','212'],['Harbor Inn','245']]){
  await page.getByRole('button',{name:'Add a place',exact:true}).click();
  await dialog().getByLabel('Name',{exact:true}).fill(name);await dialog().getByLabel('Town (optional)').fill('Harbor Point');
  await choose(dialog(),'Cost','A price');await dialog().getByLabel('Price as listed').fill(amount);
  await dialog().getByLabel('Street address').fill('123 Demo Lane');await dialog().getByLabel('Confirmation number').fill('DEMO-PRIVATE-123');await dialog().getByLabel('Door, lockbox or Wi-Fi codes').fill('FAKE-LOCK-987');
  await save('Add to Harbor nights');
 }
 await fresh();assert.equal(trip.stayGroups[0].options.length,2);assert.equal(trip.stayGroups[0].options.find(o=>o.name==='Seagrass Cottage').price.amountMinor,21200);
 await page.getByLabel('Sort by price').check();await shot(page,'02-stay-comparison');
});
await test('Vote once, change a vote, close, explicitly choose and book without losing choice',async()=>{
 await page.getByRole('button',{name:'🗳 Ask the family',exact:true}).click();
 await page.locator('.trip-vote .poll-who-btn').filter({hasText:'Alex'}).click();
 const cottage=page.getByRole('article',{name:'Seagrass Cottage',exact:true});
 await cottage.getByRole('button',{name:'Vote for this',exact:true}).click();
 await page.getByText('1 of 4 voted',{exact:false}).waitFor();
 await page.getByRole('article',{name:'Harbor Inn',exact:true}).getByRole('button',{name:'Vote for this',exact:true}).click();
 await fresh();assert.equal(trip.stayGroups[0].poll.votes.length,1,'changing a vote stays one vote');
 await cottage.getByRole('button',{name:'Vote for this',exact:true}).click();
 await page.getByRole('button',{name:'Someone else',exact:true}).click();await page.locator('.trip-vote .poll-who-btn').filter({hasText:'Maya'}).click();
 await page.getByRole('article',{name:'Harbor Inn',exact:true}).getByRole('button',{name:'Vote for this',exact:true}).click();
 await page.getByText('It’s a tie',{exact:false}).first().waitFor();
 await page.getByRole('button',{name:'End voting',exact:true}).click();
 await fresh();assert.equal(trip.stayGroups[0].chosenOptionId,null);
 await cottage.getByRole('button',{name:'Choose this one',exact:true}).click();
 await cottage.getByRole('button',{name:'Edit Seagrass Cottage',exact:true}).click();await choose(dialog(),'Booking','Booked');await save();
 await fresh();const chosen=trip.stayGroups[0].options.find(o=>o.name==='Seagrass Cottage');assert.equal(trip.stayGroups[0].chosenOptionId,chosen.id);assert.equal(chosen.booking,'booked');
 await cottage.getByText('★ Chosen',{exact:false}).waitFor();await shot(page,'03-chosen-and-booked');
});
await test('Family-home stays need only a name and distinguish unknown from free',async()=>{
 await page.getByRole('button',{name:'Add a stay',exact:true}).click();await dialog().getByLabel('Name',{exact:true}).fill('Family nights');await dialog().getByLabel('Arrive',{exact:true}).fill(addDay(start,4));await dialog().getByLabel('Leave',{exact:true}).fill(end);await save();
 const group=page.locator('.trip-stay-group').filter({has:page.getByRole('heading',{name:/Family nights/})});await group.getByRole('button',{name:'Add a place',exact:true}).click();
 await choose(dialog(),'Kind of place','Staying with family');await dialog().getByLabel('Name',{exact:true}).fill('Family home demo');await choose(dialog(),'With the family','Confirmed with family');await save('Add to Family nights');
 const card=page.getByRole('article',{name:'Family home demo',exact:true});await card.getByText('Cost not set yet',{exact:true}).waitFor();await card.getByText('🏡 Confirmed with family',{exact:true}).waitFor();
 await card.getByRole('button',{name:'Choose this one',exact:true}).click();await fresh();assert.equal(trip.stayGroups[1].options[0].sourceUrl,null);assert.equal(trip.stayGroups[1].options[0].cost,'unknown');
 await shot(page,'04-family-home');
});
await test('Blocked listing links remain editable and can be saved manually',async()=>{
 await page.locator('.trip-stay-group').first().getByRole('button',{name:'Add a place',exact:true}).click();
 await dialog().getByLabel('Link (optional)').fill('https://127.0.0.1/private');await dialog().getByRole('button',{name:'Read the page',exact:true}).click();
 await dialog().locator('.field-error').waitFor();
 await dialog().getByLabel('Link (optional)').fill('');await dialog().getByLabel('Name',{exact:true}).fill('Manual fallback');await save('Add to Harbor nights');
 await page.getByRole('article',{name:'Manual fallback',exact:true}).waitFor();await fresh();
});
await test('Public metadata preview enriches a listing and the URL image uses private browser caching',async()=>{
 await go(page,route('stays'));
 // A stable public page with genuine Open Graph tags exercises the same generic metadata path.
 // Hotel/rental JSON-LD price and capacity extraction has separate server fixture coverage.
 const listing='https://www.python.org/';
 await page.locator('.trip-stay-group').first().getByRole('button',{name:'Add a place',exact:true}).click();await dialog().getByLabel('Link (optional)').fill(listing);await dialog().getByRole('button',{name:'Read the page',exact:true}).click();
 await dialog().getByLabel('Name',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('input[placeholder="Seagrass Cottage"]')?.value==='Welcome to Python.org',null,{timeout:25000});
 await dialog().getByLabel('Name',{exact:true}).fill('Edited parsed cottage');await shot(page,'04b-metadata-editable-preview');
 await save('Add to Harbor nights');const card=page.getByRole('article',{name:'Edited parsed cottage',exact:true});await card.waitFor();
 await card.locator('img').waitFor();await card.locator('img').evaluate(img=>img.decode());
 const pictureBox=await card.locator('.stay-photo').boundingBox();assert.ok(Math.abs(pictureBox.height-pictureBox.width*9/16)<2,'listing pictures stay in a bounded 16:9 frame');
 const source=await card.locator('img').getAttribute('src');assert.ok(source.includes('/api/trips/stays/'));assert.ok(!source.includes('httpbin.org'));
 const image=await page.request.get(new URL(source,base).href);assert.equal(image.status(),200);assert.match(image.headers()['cache-control'],/private.*604800/);
 await fresh();const parsed=trip.stayGroups[0].options.find(o=>o.name==='Edited parsed cottage');assert.equal(parsed.imageUrl,'https://www.python.org/static/opengraph-icon-200x200.png');assert.equal(parsed.siteName,'Python.org');assert.equal(parsed.price,null);
 const stores=await page.evaluate(async()=>{
  const cacheEntries=typeof caches==='undefined'?[]:await Promise.all((await caches.keys()).map(async name=>({name,urls:(await(await caches.open(name)).keys()).map(r=>r.url)})));
  const request=indexedDB.open('kinwall-offline');const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
  const offline=await Promise.all([...db.objectStoreNames].map(async name=>{const store=db.transaction(name).objectStore(name);const r=store.getAll();const values=await new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return{name,values}}));db.close();
  return {secure:isSecureContext,cacheEntries,offline};
 });
 assert.ok(stores.secure,'use localhost runner network to exercise service-worker/offline storage');
 assert.ok(!JSON.stringify(stores.cacheEntries).includes('/api/trips/'),'trip images/API never enter Cache Storage');assert.ok(!JSON.stringify(stores.offline).includes('DEMO-PRIVATE-123'),'protected fields never enter IndexedDB');
 assert.ok(!JSON.stringify(stores.offline).includes('Edited parsed cottage'),'trip records never enter IndexedDB');await writeFile(`${output}/browser-storage.json`,JSON.stringify(stores,null,2));
 await shot(page,'04c-cached-listing-picture');
});
await test('Add transportation with each endpoint timezone and private reservation fields',async()=>{
 await go(page,route('travel'));await page.getByRole('button',{name:'Add a leg',exact:true}).click();
 await dialog().getByLabel('Name (optional)').fill('Fly to Harbor Point');await dialog().getByLabel('From',{exact:true}).fill('Demo airport east');await dialog().getByLabel('To',{exact:true}).fill('Demo airport central');
 await dialog().getByLabel('Date',{exact:true}).nth(0).fill(start);await dialog().getByLabel('Time',{exact:true}).nth(0).fill('07:05');await zone('Time zone where it leaves','America/New_York');
 await dialog().getByLabel('Date',{exact:true}).nth(1).fill(start);await dialog().getByLabel('Time',{exact:true}).nth(1).fill('09:12');await zone('Time zone where it arrives','America/Chicago');
 await choose(dialog(),'Booking','Booked');await dialog().getByLabel('Confirmation number').fill('DEMO-FLIGHT-456');await save();
 await fresh();assert.equal(trip.legs[0].departTz,'America/New_York');assert.equal(trip.legs[0].arriveTz,'America/Chicago');
 await page.locator('.trip-leg-clock').filter({hasText:/7:05 AM.*9:12 AM/}).waitFor();await shot(page,'05-transportation');
});
await test('Every transportation mode supports manual plan records without reservations',async()=>{
 for(const mode of ['drive','train','bus','ferry','rental','other']){
  await page.getByRole('button',{name:'Add a leg',exact:true}).click();await choose(dialog(),'How',{drive:'Drive',train:'Train',bus:'Bus',ferry:'Ferry',rental:'Rental car',other:'Other'}[mode]);await dialog().getByLabel('Name (optional)').fill(`Demo ${mode}`);await save();
 }
 await fresh();assert.equal(trip.legs.length,7);assert.equal(trip.legs.filter(l=>l.booking==='booked').length,1);
});
await test('Add a timed activity using the day-plan UI',async()=>{
 await go(page,route('plan'));await page.getByRole('button',{name:'Add something to do',exact:true}).click();
 await dialog().getByLabel('What',{exact:true}).fill('Tide pools');await choose(dialog(),'Day',new Date(`${start}T12:00:00`).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}));await dialog().getByLabel('Time (optional)').fill('13:30');await zone('Time zone there','America/Chicago');await save('Add');
 await fresh();assert.ok(trip.items.some(i=>i.title==='Tide pools'&&i.time==='13:30'&&i.tz==='America/Chicago'));
 await shot(page,'06-day-plan');
});
let linkedMeal, unrelatedMeal;
await test('Link a selected meal to the itinerary and show its trip tag without importing home meals',async()=>{
 linkedMeal=await api('POST','/api/meals',{date:start,slot:'lunch',title:'Trip picnic',mealKind:'freeform'});
 unrelatedMeal=await api('POST','/api/meals',{date:start,slot:'dinner',title:'Unrelated home dinner',mealKind:'freeform'});
 await go(page,route('plan'));await page.getByRole('button',{name:'Link from Outings, Meals or the calendar',exact:true}).click();await choose(dialog(),'What to link','A meal');await dialog().getByRole('button',{name:/^A meal:/}).click();await dialog().getByRole('button',{name:/Trip picnic/}).click();await save('Link it');
 await page.getByRole('link').filter({hasText:'Trip picnic'}).waitFor();assert.ok(!(await page.locator('.trips-view').innerText()).includes('Unrelated home dinner'));
 await fresh();assert.ok(trip.items.some(i=>i.kind==='meal'&&i.refId===linkedMeal.id));assert.ok(!trip.items.some(i=>i.refId===unrelatedMeal.id));
 await go(page,`#/meals?date=${start}`);await page.locator('.meal-trip-tag').filter({hasText:title}).waitFor();await shot(page,'06b-linked-meal-tag');
});
let linkedOuting;
await test('Link an existing outing without copying or changing the source',async()=>{
 linkedOuting=await api('POST','/api/outings',{title:'Harbor museum visit',kind:'upcoming',startsOn:start});
 await go(page,route('plan'));await page.getByRole('button',{name:'Link from Outings, Meals or the calendar',exact:true}).click();await dialog().getByRole('button',{name:/^An outing:/}).click();await dialog().getByRole('button',{name:/Harbor museum visit/}).click();await save('Link it');await fresh();
 assert.ok(trip.items.some(i=>i.kind==='outing'&&i.refId===linkedOuting.id));const source=await api('GET',`/api/outings/${linkedOuting.id}`);assert.equal(source.startsOn,start);await page.getByRole('link').filter({hasText:'Harbor museum visit'}).waitFor();
});
await test('Trip lists create every type, link existing lists and preserve unlinked records',async()=>{
 await go(page,route('lists'));
 for(const kind of ['reusable','groceries','shopping','todo','pantry']){
  await page.getByRole('button',{name:'Make a list',exact:true}).click();
  await dialog().getByLabel('Name',{exact:true}).fill(`${title} ${kind}`);
  await choose(dialog(),'List type',{reusable:'Packing / reusable',groceries:'Groceries',shopping:'Shopping',todo:'To-do',pantry:'Pantry'}[kind]);await save('Create and link');
  await page.getByRole('link',{name:new RegExp(`${title} ${kind}`)}).waitFor();
 }
 await fresh();assert.equal(trip.packingListIds.length,5);
 const lists=await api('GET','/api/lists');
 for(const kind of ['reusable','groceries','shopping','todo','pantry']){
  const l=lists.find(l=>l.name===`${title} ${kind}`);assert(l);
  assert.equal(l.kind,kind==='groceries'||kind==='shopping'?'shopping':kind==='pantry'?'todo':kind);
  if(kind==='groceries'||kind==='shopping')assert.equal(l.catalog,kind);
  if(kind==='pantry')assert.equal(l.purpose,'pantry');
 }
 const existing=await api('POST','/api/lists',{name:'Existing cabin groceries',kind:'shopping',catalog:'groceries'});
 await page.reload();await page.getByRole('button',{name:/^Linked lists:/}).click();
 await dialog().getByRole('button',{name:'Existing cabin groceries',exact:false}).click();await dialog().getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('link',{name:/Existing cabin groceries/}).waitFor();await fresh();assert(trip.packingListIds.includes(existing.id));
 await page.getByRole('button',{name:/^Linked lists:/}).click();await dialog().getByRole('button',{name:'Existing cabin groceries',exact:false}).click();await dialog().getByRole('button',{name:'Done',exact:true}).click();
 await fresh();assert(!trip.packingListIds.includes(existing.id));assert.equal((await api('GET',`/api/lists/${existing.id}`)).list.id,existing.id);
 await go(page,route('packing'));await page.getByRole('heading',{name:'Lists',exact:true}).last().waitFor();
 await shot(page,'07-trip-lists');
 await page.setViewportSize({width:390,height:844});await shot(page,'07b-trip-lists-phone');
 await page.getByRole('button',{name:'Make a list',exact:true}).click();await dialog().getByLabel('Name',{exact:true}).fill('Supplies before leaving');await choose(dialog(),'List type','Shopping');await shot(page,'07c-trip-list-create-phone');await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
 await page.setViewportSize({width:1366,height:1024});await shot(page,'07d-trip-lists-wall');await page.setViewportSize({width:1024,height:768});
});
await test('Calendar publication is explicit, selected and idempotent',async()=>{
 await go(page,route('calendar'));await page.getByRole('button',{name:/^Calendar: /}).click();await dialog().getByRole('button',{name:'Family',exact:true}).click();
 for(const checkbox of await page.locator('.trip-cal-row input:not(:disabled)').all())await checkbox.check();
 await page.getByRole('button',{name:/^Add \d+ events?$/}).click();await page.getByText('✓ On the calendar',{exact:true}).first().waitFor();await fresh();
 assert.equal(trip.calendar.span.state,'added');assert.ok(trip.calendar.items.some(i=>i.kind==='leg'));assert.ok(trip.calendar.items.some(i=>i.kind==='stay'));assert.ok(trip.calendar.items.some(i=>i.kind==='item'));
 const before=await api('GET',`/api/events?from=${start}T00:00:00Z&to=${end}T23:59:59Z`);
 await page.reload();await page.getByRole('heading',{name:'On our calendar',exact:true}).waitFor();assert.equal(await page.locator('.trip-cal-row input:checked:disabled').count(),trip.calendar.items.length+1);
 const after=await api('GET',`/api/events?from=${start}T00:00:00Z&to=${end}T23:59:59Z`);assert.equal(after.length,before.length);await shot(page,'08-calendar-published');
});
await test('Trip date changes review the published span and preserve arrangements',async()=>{
 await go(page,route());await page.getByRole('button',{name:'Edit trip',exact:true}).click();await dialog().getByLabel('First day').fill(addDay(start,1));await dialog().getByLabel('Last day').fill(addDay(end,1));await dialog().getByRole('button',{name:'Save',exact:true}).click();
 await dialog().getByRole('button',{name:'Change the dates',exact:true}).waitFor();await shot(page,'09-date-change-review');await save('Change the dates');
 await fresh();assert.equal(trip.startDate,addDay(start,1));assert.equal(trip.legs[0].departDate,start);assert.equal(trip.stayGroups[0].checkIn,start);
 const events=await api('GET',`/api/events?from=${start}T00:00:00Z&to=${end}T23:59:59Z`);assert.ok(events.some(e=>e.id===trip.calendar.span.eventId&&e.start.startsWith(start)));
});
await test('Published calendar event links back to its trip',async()=>{
 await fresh();await go(page,`#/calendar?event=${trip.calendar.span.eventId}&at=${start}`);await page.getByRole('region',{name:'From Trips'}).getByRole('link').waitFor().catch(async()=>{await page.locator('.event-outing').filter({hasText:'From Trips:'}).getByRole('link').waitFor();});
 await shot(page,'09b-event-trip-link');
});
const kid=await api('POST','/api/keys',{name:'Docker Maya tablet',scope:'display'});await api('PATCH',`/api/keys/${kid.id}`,{kind:'kid',owner:ids.Maya});
const wall=await api('POST','/api/keys',{name:'Docker kitchen wall',scope:'display'});await api('PATCH',`/api/keys/${wall.id}`,{kind:'wall',owner:'shared'});
await test('Browser privacy matrix: grown-ups, everyone, and separate wall permission',async()=>{
 for(const [audience,onWall,kidVisible,wallVisible] of [['grownups',false,false,false],['everyone',false,true,false],['everyone',true,true,true]]){
  await fresh();await api('PATCH',`/api/trips/${trip.id}`,{revision:trip.revision,detailsAudience:audience,detailsOnWall:onWall});
  for(const [auth,visible,label] of [[kid.key,kidVisible,'kid'],[wall.key,wallVisible,'wall']]){
   const {ctx,page:p}=await context(browser,auth,{width:390,height:844});await go(p,route('stays'));await p.getByRole('heading',{name:'Places to stay',exact:true}).waitFor();
   const text=await p.locator('body').innerText();assert.equal(text.includes('123 Demo Lane'),visible,`${audience}/${onWall}/${label}`);assert.equal(text.includes('DEMO-PRIVATE-123'),visible);assert.ok(text.includes('212'));assert.equal(await p.getByRole('button',{name:'Add a place',exact:true}).count(),0);
   await shot(p,`privacy-${audience}-${onWall}-${label}`);
   await closeContext(ctx,`privacy-${audience}-${onWall}-${label}`);
  }
 }
 await fresh();await api('PATCH',`/api/trips/${trip.id}`,{revision:trip.revision,detailsAudience:'grownups',detailsOnWall:false});
});
await test('Kids suggest activities but cannot add stays or schedule their suggestions',async()=>{
 const {ctx,page:p}=await context(browser,kid.key);await go(p,route('plan'));await p.getByRole('button',{name:'Suggest something',exact:true}).click();const d=p.getByRole('dialog').last();await d.getByLabel('What',{exact:true}).fill('Mini golf idea');assert.equal(await d.getByLabel('Day',{exact:true}).count(),0);await d.getByRole('button',{name:'Suggest it',exact:true}).click();await d.waitFor({state:'hidden'});
 await fresh();const idea=trip.items.find(i=>i.title==='Mini golf idea');assert.equal(idea.suggestedBy,ids.Maya);assert.equal(idea.date,null);
 await shot(p,'10-kid-suggestion');
 await p.locator('.trip-plan-link').filter({hasText:'Mini golf idea'}).click();await p.getByRole('dialog').last().getByRole('button',{name:'Interested',exact:true}).click();await fresh();assert.ok(trip.items.find(i=>i.title==='Mini golf idea').marks.some(m=>m.memberId===ids.Maya));
 await closeContext(ctx,'kid-suggestion');
});
await test('Responsive visual matrix: phone, tablets, wall, landscape, light and dark',async()=>{
 for(const [label,width,height] of [['phone',390,844],['tablet-landscape',1024,768],['tablet-portrait',768,1024],['wall',1366,1024],['phone-landscape',844,390]]){
  for(const theme of ['light','dark']){
   await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:theme});await go(page,route());await page.getByRole('heading',{name:title,exact:true}).waitFor();await shot(page,`visual-${label}-${theme}-overview`);
   await go(page,route('stays'));await page.getByRole('article',{name:'Seagrass Cottage',exact:true}).waitFor();await shot(page,`visual-${label}-${theme}-stays`);
  }
 }
 await page.setViewportSize({width:844,height:230});await page.emulateMedia({colorScheme:'light'});await go(page,route('travel'));await page.getByRole('button',{name:'Add a leg',exact:true}).click();await dialog().getByLabel('Name (optional)').focus();await shot(page,'visual-phone-landscape-keyboard-form');await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
});
await test('Unknown/deleted trip never displays the previously viewed trip',async()=>{
 await go(page,'#/trips?trip=does-not-exist-demo');await page.getByText('This trip isn’t here anymore.',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:title,exact:true}).count(),0);await shot(page,'11-missing-trip');
});
await test('Ready, cancel, archive and restore preserve bookings and trip records',async()=>{
 await page.setViewportSize({width:1024,height:768});
 await go(page,route());await fresh();const booked=trip.counts.staysBooked;
 await Promise.all([page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith(`/api/trips/${trip.id}`)),(async()=>{await page.getByRole('button',{name:'Edit trip',exact:true}).click();await dialog().getByRole('radio',{name:/Ready/}).click();await dialog().getByRole('button',{name:'Save',exact:true}).click()})()]);await fresh();assert.equal(trip.status,'ready');assert.equal(trip.counts.staysBooked,booked);
 for(const [action,field,undo] of [['Not this time','canceledAt','Bring it back'],['Put away','archivedAt','Put it back on the list']]){
  await Promise.all([page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith(`/api/trips/${trip.id}`)),page.getByRole('button',{name:action,exact:true}).click()]);await fresh();assert.ok(trip[field]);
  await go(page,'#/trips');await page.locator('.trip-closed summary').click();const savedTrip=page.locator('.trip-closed').getByRole('link').filter({hasText:title});await savedTrip.waitFor();await shot(page,`12-put-away-${field}`);await savedTrip.click();await page.getByRole('button',{name:undo,exact:true}).waitFor();
  await Promise.all([page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith(`/api/trips/${trip.id}`)),page.getByRole('button',{name:undo,exact:true}).click()]);await fresh();assert.equal(trip[field],null);assert.equal(trip.stayGroups.length,2);
 }
});
await test('Feature off hides Trips everywhere while preserving stored plans',async()=>{
 const s=await api('GET','/api/settings');await api('PATCH','/api/settings',{features:{...s.features,trips:false}});
 try {
  await api('GET','/api/trips',undefined,undefined,404);await api('GET','/api/trips/links',undefined,undefined,404);
  await go(page,'#/');
  // This write came from another client. The existing app refreshes /api/rev every 30 seconds;
  // hash navigation intentionally does not reload settings. Verify that normal refresh cycle.
  await page.locator('nav').getByRole('link',{name:'Trips',exact:true}).waitFor({state:'hidden',timeout:40000});assert.equal(await page.locator('nav').getByRole('link',{name:'Trips',exact:true}).count(),0);
 }
 finally { await api('PATCH','/api/settings',{features:{...s.features,trips:true}});await page.reload();await page.locator('nav').getByRole('link',{name:'Trips',exact:true}).waitFor({state:'visible'}); }
 await fresh();assert.equal(trip.title,title);
});
await fresh();await writeFile(`${output}/fixture.json`,JSON.stringify({tripId:trip.id,start,end,title},null,2));
await test('Deleting a trip preserves its published events, linked meal and packing list',async()=>{
 const eventId=trip.calendar.span.eventId,listId=trip.packingListIds[0];await go(page,route());await page.getByRole('button',{name:'Delete trip…',exact:true}).click();const [deleted]=await Promise.all([page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes(`/api/trips/${trip.id}`)),page.getByRole('alertdialog').getByRole('button',{name:'Delete trip',exact:true}).click()]);assert.equal(deleted.status(),200);await page.waitForURL('**/#/trips');
 await api('GET',`/api/trips/${trip.id}`,undefined,undefined,404);
 const events=await api('GET',`/api/events?from=${start}T00:00:00Z&to=${end}T23:59:59Z`);assert.ok(events.some(e=>e.id===eventId));assert.ok((await api('GET',`/api/meals?from=${start}&to=${end}`)).some(m=>m.id===linkedMeal.id));assert.ok((await api('GET','/api/lists')).some(l=>l.id===listId));assert.equal((await api('GET',`/api/outings/${linkedOuting.id}`)).title,'Harbor museum visit');
});
} finally { await finish(browser); }
