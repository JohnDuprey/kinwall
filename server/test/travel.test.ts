import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { awayContext } from '../src/away.ts';
import { streakStats } from '../src/routes/leaderboard.ts';
import { schoolworkOff } from '../src/school-days.ts';
import { todayInTz } from '../src/routes/members.ts';
import { shiftGoalDate } from '../src/chore-goal.ts';
import { StayDetailsSchema, LegDetailsSchema } from '../src/travel-schemas.ts';
test('trips: booking links accept web pages and reject executable or embedded-content URLs', () => {
  for (const schema of [StayDetailsSchema, LegDetailsSchema]) {
    assert.equal(schema.safeParse({ manageUrl: 'https://booking.example/manage?reservation=fake' }).success, true);
    for (const manageUrl of ['javascript:alert(1)', 'data:text/html,demo', 'file:///tmp/demo', 'https://user:password@booking.example/manage']) {
      assert.equal(schema.safeParse({ manageUrl }).success, false, manageUrl);
    }
  }
});
export async function travelSetup() {
  const db = openDb(':memory:');
  applyMigrations(
    db,
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations'),
  );
  const env: Env = {
    DB: db,
    ADMIN_API_KEY: 'fc_travel_test',
    ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  };
  const app = createApp();
  const send = async (
    method: string,
    url: string,
    body?: unknown,
    key = 'fc_travel_test',
    headers = {},
  ) => {
    const res = await app.request(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );
    return {
      status: res.status,
      body: (await res.json()) as any,
      headers: res.headers,
    };
  };
  const alex = (
    await send('POST', '/api/members', {
      name: 'Alex',
      color: '#336699',
      grownUp: true,
    })
  ).body;
  const maya = (
    await send('POST', '/api/members', { name: 'Maya', color: '#339966' })
  ).body;
  const leo = (
    await send('POST', '/api/members', { name: 'Leo', color: '#996633' })
  ).body;
  const key = (
    await send('POST', '/api/keys', { name: 'Maya tablet', scope: 'display' })
  ).body;
  await send('PATCH', `/api/keys/${key.id}`, { kind: 'kid', owner: maya.id });
  const wall = (
    await send('POST', '/api/keys', { name: 'Kitchen wall', scope: 'display' })
  ).body;
  await send('PATCH', `/api/keys/${wall.id}`, {
    kind: 'wall',
    owner: 'shared',
  });
  const features = (await send('GET', '/api/settings')).body.features;
  await send('PATCH', '/api/settings', {
    features: { ...features, trips: true },
  });
  return { db, env, send, alex, maya, leo, kidKey: key.key, wallKey: wall.key };
}
test('trips security: only an owned device can add an attributed child suggestion', async () => {
  const t = await travelSetup();
  let trip = (await t.send('POST','/api/trips',{title:'Family plans',memberIds:[t.maya.id]})).body;
  const wall = await t.send('POST',`/api/trips/${trip.id}/items`,{kind:'activity',title:'Anonymous wall suggestion'},t.wallKey);
  assert.equal(wall.status,403,'shared screens cannot create unowned suggestions');
  assert.equal((await t.send('GET',`/api/trips/${trip.id}`,undefined,t.wallKey)).body.can.suggest,false);
  const kid = await t.send('POST',`/api/trips/${trip.id}/items`,{kind:'activity',title:'Visit the tide pools'},t.kidKey);
  assert.equal(kid.status,201,JSON.stringify(kid.body));trip=kid.body;
  assert.equal(trip.items[0].suggestedBy,t.maya.id);
  assert.equal((await t.send('PATCH',`/api/trips/${trip.id}/items/${trip.items[0].id}`,{revision:trip.revision,title:'Changed'},t.kidKey)).status,403);
  assert.equal((await t.send('POST',`/api/trips/${trip.id}/items`,{kind:'activity',title:'Scheduled by child',date:'2027-07-10'},t.kidKey)).status,403);
});
test('trips security: reservation projection, privilege boundaries and media tokens fail closed', async () => {
  const t=await travelSetup();
  const grownupKey=(await t.send('POST','/api/keys',{name:'Alex everyday tablet',scope:'display'})).body;
  await t.send('PATCH',`/api/keys/${grownupKey.id}`,{kind:'grownup',owner:t.alex.id});
  let trip=(await t.send('POST','/api/trips',{title:'Public family plans',memberIds:[t.maya.id]})).body;
  trip=(await t.send('POST',`/api/trips/${trip.id}/stay-groups`,{revision:trip.revision,label:'Public town'})).body;
  const secret='PRIVATE-BOOKING-ONLY-FAKE';
  trip=(await t.send('POST',`/api/trips/${trip.id}/stays`,{revision:trip.revision,groupId:trip.stayGroups[0].id,name:'Public family home',kind:'family',details:{address:secret,codes:secret,manageUrl:'https://example.com/manage?reservation=fake'}})).body;
  const stayId=trip.stayGroups[0].options[0].id;
  for(const [audience,onWall] of [['grownups',false],['everyone',false],['everyone',true]] as const){
    trip=(await t.send('PATCH',`/api/trips/${trip.id}`,{revision:trip.revision,detailsAudience:audience,detailsOnWall:onWall})).body;
    for(const [key,allowed] of [['fc_travel_test',true],[grownupKey.key,true],[t.kidKey,audience==='everyone'],[t.wallKey,audience==='everyone'&&onWall]] as const){
      const read=await t.send('GET',`/api/trips/${trip.id}`,undefined,key);
      assert.equal(read.status,200);assert.equal(JSON.stringify(read.body).includes(secret),allowed);
      assert.match(read.headers.get('cache-control')??'',/no-store/);
      const connected=await t.send('GET',`/api/trips/${trip.id}`,undefined,key,{'X-Kinwall-Source':'mcp'});
      assert.equal(JSON.stringify(connected.body).includes(secret),false,'connected clients never get reservation fields');
    }
  }
  for(const path of ['/api/trips','/api/trips/links','/api/export'])assert.equal(JSON.stringify((await t.send('GET',path)).body).includes(secret),false,path);
  for(const key of [t.kidKey,t.wallKey,grownupKey.key]){
    for(const [method,path,body] of [
      ['PATCH',`/api/trips/${trip.id}`,{revision:trip.revision,detailsAudience:'everyone'}],
      ['POST',`/api/trips/${trip.id}/stays`,{revision:trip.revision,groupId:trip.stayGroups[0].id,name:'Unauthorized'}],
      ['POST','/api/trips/link-preview',{url:'https://example.com'}],
      ['POST','/api/away/preview',{label:'Unauthorized',people:[{memberId:t.maya.id,startDate:'2027-07-10',endDate:'2027-07-12'}]}],
      ['GET','/api/export?includeTripDetails=1',undefined],
    ] as const)assert.equal((await t.send(method,path,body,key)).status,403,`${method} ${path}`);
  }
  for(const body of [{revision:trip.revision,detailsAudience:'everyone'},{revision:trip.revision,detailsOnWall:false}])assert.equal((await t.send('PATCH',`/api/trips/${trip.id}`,body,undefined,{'X-Kinwall-Source':'mcp'})).status,403);
  assert.equal((await t.send('PATCH',`/api/trips/${trip.id}/stays/${stayId}`,{revision:trip.revision,details:{codes:'connector-write'}},undefined,{'X-Kinwall-Source':'mcp'})).status,403);
  const token=(await t.send('GET','/api/media-token',undefined,t.kidKey)).body.token;
  const app=createApp();
  for(const path of [`/api/trips/${trip.id}?key=${encodeURIComponent(token)}`,`/api/trips/stays/${stayId}/image`]){
    const unauth=await app.request(path,{},t.env);assert.equal(unauth.status,401,path);
    assert.equal((await unauth.text()).includes(secret),false);
  }
  assert.equal((await app.request(`/api/trips/stays/${stayId}/image`,{headers:{Authorization:`Bearer ${token}`}},t.env)).status,401,'media tokens are not bearer API credentials');
  const log:string[]=[];const oldError=console.error;console.error=(...args)=>{log.push(args.map(String).join(' '))};
  try{
    const rejected=await t.send('PATCH',`/api/trips/${trip.id}/stays/${stayId}`,{revision:trip.revision,details:{codes:secret.repeat(300)}});
    assert.equal(rejected.status,400);assert.equal(JSON.stringify(rejected.body).includes(secret),false);
    assert.equal(log.join('\n').includes(secret),false,'validation never logs reservation contents');
  }finally{console.error=oldError;}
});
test('trips security: listing and image fetches reject private redirects, credential URLs and active content', async () => {
  const t=await travelSetup();t.env.ALLOW_PRIVATE_FEED_URLS='1';
  const calls:string[]=[];
  t.env.OUTBOUND_FETCH=async input=>{calls.push(String(input));return new Response(null,{status:302,headers:{Location:'https://127.0.0.1/private'}})};
  for(const url of ['https://127.1/','https://2130706433/','https://0x7f000001/','https://[::ffff:127.0.0.1]/','https://localhost./','https://user:password@example.com/','file:///tmp/demo','javascript:alert(1)']){
    assert.equal((await t.send('POST','/api/trips/link-preview',{url})).status,400,url);
  }
  assert.equal(calls.length,0,'hostile initial URLs never reach outbound fetch');
  const redirect=await t.send('POST','/api/trips/link-preview',{url:'https://example.com/public-listing'});
  assert.equal(redirect.body.ok,false);assert.deepEqual(calls,['https://example.com/public-listing'],'private redirect never fetched even with LAN feed opt-out');
  let trip=(await t.send('POST','/api/trips',{title:'Image guard'})).body;
  trip=(await t.send('POST',`/api/trips/${trip.id}/stay-groups`,{revision:trip.revision,label:'Demo stay'})).body;
  trip=(await t.send('POST',`/api/trips/${trip.id}/stays`,{revision:trip.revision,groupId:trip.stayGroups[0].id,name:'Demo stay',imageUrl:'https://example.com/saved.png'})).body;
  const imageId=trip.stayGroups[0].options[0].id;
  const app=createApp();
  for(const response of [
    new Response('<svg onload="alert(1)"></svg>',{headers:{'Content-Type':'image/svg+xml'}}),
    new Response('<html>not a picture</html>',{headers:{'Content-Type':'image/png'}}),
    new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'Content-Type':'image/png','Content-Length':String(8*1024*1024+1)}}),
  ]){
    t.env.OUTBOUND_FETCH=async()=>response;
    const image=await app.request(`/api/trips/stays/${imageId}/image?url=https://127.0.0.1/private`,{headers:{Authorization:'Bearer fc_travel_test'}},t.env);
    assert.equal(image.status,502);assert.equal(image.headers.get('X-Content-Type-Options'),'nosniff');
  }
});
test('away security: ending an edited period requires its current revision and leaves stale requests unchanged', async () => {
  const t=await travelSetup();
  const draft={label:'Family visit',people:[{memberId:t.maya.id,startDate:'2027-07-10',endDate:'2027-07-12'}]};
  const preview=await t.send('POST','/api/away/preview',draft);
  const period=(await t.send('POST','/api/away',{...draft,token:preview.body.token})).body;
  const edited={...draft,id:period.id,revision:period.revision,label:'Family visit extended',people:[{...draft.people[0],endDate:'2027-07-14'}]};
  const nextReview=await t.send('POST','/api/away/preview',edited);
  const next=await t.send('PATCH',`/api/away/${period.id}`,{...edited,token:nextReview.body.token});
  assert.equal(next.status,200,JSON.stringify(next.body));
  assert.equal((await t.send('DELETE',`/api/away/${period.id}?revision=${period.revision}`)).status,409,'stale editor cannot end a newly reviewed period');
  assert.equal((await t.send('GET',`/api/away/${period.id}`)).body.people[0].endDate,'2027-07-14');
  assert.equal((await t.send('DELETE',`/api/away/${period.id}`)).status,400,'ending requires an explicit revision');
  assert.equal((await t.send('DELETE',`/api/away/${period.id}?revision=${next.body.revision}`)).status,200);
  assert.equal((await t.send('GET',`/api/away/${period.id}`)).status,404,'wholly future period ends');
});
test('trips: basic plans for every child; protected family stays encrypted and projected, conflicts guarded', async () => {
  const t = await travelSetup();
  let r = await t.send('POST', '/api/trips', {
    title: 'Thanksgiving with family',
    memberIds: [t.alex.id],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  let trip = r.body;
  assert.equal(
    (await t.send('GET', `/api/trips/${trip.id}`, undefined, t.kidKey)).status,
    200,
  );
  r = await t.send('POST', `/api/trips/${trip.id}/stay-groups`, {
    revision: trip.revision,
    label: 'Maple Falls',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  trip = r.body;
  r = await t.send('POST', `/api/trips/${trip.id}/stays`, {
    revision: trip.revision,
    groupId: trip.stayGroups[0].id,
    kind: 'family',
    name: 'Family home (demo)',
    booking: 'confirmed_family',
    details: { address: 'Demo street', codes: 'fake-code' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  trip = r.body;
  assert.equal(trip.stayGroups[0].options[0].cost, 'unknown');
  const raw = await t.db
    .prepare('SELECT data FROM trip_private')
    .first<{ data: string }>();
  assert.ok(raw?.data.startsWith('v1:'));
  assert.ok(!raw!.data.includes('fake-code'));
  const kid = await t.send('GET', `/api/trips/${trip.id}`, undefined, t.kidKey);
  assert.equal(kid.body.stayGroups[0].options[0].details, null);
  assert.equal(kid.body.stayGroups[0].options[0].hasDetails, true);
  assert.equal(kid.body.can.vote, false, 'a child not going is not offered a stay vote');
  assert.match(kid.headers.get('Cache-Control')!, /no-store/);
  assert.equal(
    (
      await t.send('PATCH', `/api/trips/${trip.id}`, {
        revision: 1,
        title: 'stale',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await t.send(
        'POST',
        `/api/trips/${trip.id}/stays`,
        { revision: trip.revision, groupId: trip.stayGroups[0].id, name: 'No' },
        t.kidKey,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await t.send('GET', `/api/trips/${trip.id}`, undefined, undefined, {
        'X-Kinwall-Source': 'mcp',
      })
    ).body.stayGroups[0].options[0].details,
    null,
  );
});
test('away: reviewed standalone periods pause without changing recurrence and preserve completed work', async () => {
  const t = await travelSetup();
  const chore = (
    await t.send('POST', '/api/chores', {
      title: 'Read',
      memberId: t.maya.id,
      rrule: 'FREQ=DAILY',
      dueDate: '2026-11-01',
      points: 5,
    })
  ).body;
  const draft = {
    label: 'Camp',
    people: [
      {
        memberId: t.maya.id,
        startDate: '2026-11-23',
        endDate: '2026-11-25',
        leaveDayAway: true,
        returnDayAway: false,
      },
    ],
    keepDue: [],
    handoffs: [],
  };
  const preview = await t.send('POST', '/api/away/preview', draft);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.ok(preview.body.paused.some((r: any) => r.choreId === chore.id));
  const saved = await t.send('POST', '/api/away', {
    ...draft,
    token: preview.body.token,
  });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const pausedTick = await t.send('POST', `/api/chores/${chore.id}/complete`, { date: '2026-11-23' }, t.kidKey);
  assert.equal(pausedTick.status, 400, 'an offline or API tick must not complete a paused chore');
  assert.equal(await t.db.prepare('SELECT id FROM chore_completions WHERE chore_id=?').bind(chore.id).first(), null);
  assert.ok(
    !(await t.send('GET', '/api/chores/day?date=2026-11-23')).body.some(
      (c: any) => c.id === chore.id,
    ),
  );
  assert.ok(
    (await t.send('GET', '/api/chores/day?date=2026-11-25')).body.some(
      (c: any) => c.id === chore.id,
    ),
  );
  assert.equal(
    (
      await t.db
        .prepare('SELECT rrule,active FROM chores WHERE id=?')
        .bind(chore.id)
        .first<any>()
    )?.rrule,
    'FREQ=DAILY',
  );
  const settings = (await t.send('GET', '/api/settings')).body;
  await t.send('PATCH', '/api/settings', {
    features: { ...settings.features, trips: false },
  });
  assert.equal((await t.send('GET', '/api/away')).body.length, 1);
  assert.ok(
    !(await t.send('GET', '/api/chores/day?date=2026-11-23')).body.some(
      (c: any) => c.id === chore.id,
    ),
  );
});
test('away: temporary handoff routes duty and credit to the recipient, then restores source', async () => {
  const t = await travelSetup();
  const chore = (
    await t.send('POST', '/api/chores', {
      title: 'Feed the fish',
      memberId: t.maya.id,
      rrule: 'FREQ=DAILY',
      dueDate: '2026-11-01',
      points: 5,
    })
  ).body;
  const draft = {
    label: 'Visit',
    people: [
      { memberId: t.maya.id, startDate: '2026-11-23', endDate: '2026-11-24' },
    ],
    handoffs: [
      {
        choreId: chore.id,
        fromMemberId: t.maya.id,
        toMemberId: t.leo.id,
        startDate: '2026-11-23',
        endDate: '2026-11-24',
      },
    ],
  };
  const preview = await t.send('POST', '/api/away/preview', draft);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(
    (await t.send('POST', '/api/away', { ...draft, token: preview.body.token }))
      .status,
    201,
  );
  const today = (
    await t.send('GET', '/api/chores/day?date=2026-11-23')
  ).body.find((c: any) => c.id === chore.id);
  assert.equal(today.memberId, t.leo.id);
  assert.equal(today.handoff.fromMemberId, t.maya.id);
  assert.equal(
    (await t.send('GET', '/api/chores/day?date=2026-11-25')).body.find(
      (c: any) => c.id === chore.id,
    ).memberId,
    t.maya.id,
  );
  const key = (
    await t.send('POST', '/api/keys', { name: 'Leo tablet', scope: 'display' })
  ).body;
  await t.send('PATCH', `/api/keys/${key.id}`, {
    kind: 'kid',
    owner: t.leo.id,
  });
  const done = await t.send(
    'POST',
    `/api/chores/${chore.id}/complete`,
    { date: '2026-11-23', memberId: t.leo.id },
    key.key,
  );
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const cc = await t.db
    .prepare('SELECT member_id FROM chore_completions WHERE chore_id=?')
    .bind(chore.id)
    .first<any>();
  assert.equal(cc.member_id, t.leo.id);
  const undo = await t.send('DELETE', `/api/chores/${chore.id}/complete?date=2026-11-23`, undefined, key.key);
  assert.equal(undo.status, 200, 'the handoff recipient can undo their own work');
  await t.send('POST', `/api/chores/${chore.id}/complete`, { date: '2026-11-23', memberId: t.leo.id }, key.key);
  assert.equal(
    (
      await t.send(
        'POST',
        `/api/chores/${chore.id}/complete`,
        { date: '2026-11-23', memberId: t.maya.id },
        t.kidKey,
      )
    ).status,
    403,
  );
});
test('trips: sparse edits preserve participants, dates, audience and protected data', async () => {
  const t = await travelSetup();
  let trip = (
    await t.send('POST', '/api/trips', {
      title: 'Visit',
      memberIds: [t.maya.id],
      startDate: '2026-11-25',
      endDate: '2026-11-27',
      detailsAudience: 'everyone',
    })
  ).body;
  const result = await t.send('PATCH', `/api/trips/${trip.id}`, {
    title: 'Family visit',
    revision: trip.revision,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  trip = result.body;
  assert.equal(trip.startDate, '2026-11-25');
  assert.deepEqual(trip.memberIds, [t.maya.id]);
  assert.equal(trip.detailsAudience, 'everyone');
  const mcp = await t.send(
    'PATCH',
    `/api/trips/${trip.id}`,
    { title: 'Visit again', revision: trip.revision },
    undefined,
    { 'X-Kinwall-Source': 'mcp' },
  );
  assert.equal(mcp.status, 200, JSON.stringify(mcp.body));
});
test('trips: stay votes use typed options, one vote per participant and no automatic selection', async () => {
  const t = await travelSetup();
  let trip = (
    await t.send('POST', '/api/trips', {
      title: 'Visit',
      memberIds: [t.alex.id, t.maya.id],
    })
  ).body;
  trip = (
    await t.send('POST', `/api/trips/${trip.id}/stay-groups`, {
      revision: trip.revision,
      label: 'Stay',
    })
  ).body;
  const gid = trip.stayGroups[0].id;
  for (const name of ['Family home (demo)', 'Hotel']) {
    const r = await t.send('POST', `/api/trips/${trip.id}/stays`, {
      revision: trip.revision,
      groupId: gid,
      name,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    trip = r.body;
  }
  let r = await t.send(
    'POST',
    `/api/trips/${trip.id}/stay-groups/${gid}/vote`,
    { revision: trip.revision },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  trip = r.body;
  const group = trip.stayGroups[0],
    poll = group.poll,
    stayId = group.options[0].id,
    optionId = poll.options.find((o: any) => o.stayId === stayId).id;
  assert.notEqual(stayId, optionId);
  assert.equal(
    (
      await t.send('PUT', `/api/polls/${poll.id}/vote`, {
        memberId: t.leo.id,
        optionId,
      })
    ).status,
    403,
  );
  r = await t.send(
    'PUT',
    `/api/polls/${poll.id}/vote`,
    { memberId: t.maya.id, optionId },
    t.kidKey,
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  trip = (await t.send('GET', `/api/trips/${trip.id}`)).body;
  assert.deepEqual(trip.stayGroups[0].poll.votes, [
    { memberId: t.maya.id, optionId: stayId },
  ]);
  assert.equal(
    (
      await t.send('PATCH', `/api/trips/${trip.id}/stays/${stayId}`, {
        revision: trip.revision,
        name: 'Changed meaning',
      })
    ).status,
    409,
  );
  assert.equal(
    (await t.send('POST', `/api/polls/${poll.id}/close`, {})).body
      .winnerOptionId,
    null,
  );
  trip = (await t.send('GET', `/api/trips/${trip.id}`)).body;
  assert.equal(trip.stayGroups[0].chosenOptionId, null);
  trip = (
    await t.send('POST', `/api/trips/${trip.id}/stay-groups/${gid}/choose`, {
      revision: trip.revision,
      optionId: stayId,
    })
  ).body;
  assert.equal(trip.stayGroups[0].options[0].booking, 'none');
  const sameStay = trip.stayGroups[0].options.find((s:any)=>s.id===stayId);
  trip = (await t.send('PATCH', `/api/trips/${trip.id}/stays/${stayId}`, {revision:trip.revision,name:` ${sameStay.name} `,booking:'booked'})).body;
  assert.equal(trip.stayGroups[0].chosenOptionId, stayId, 'unchanged fields do not clear the choice');
  assert.equal(trip.stayGroups[0].pollId, poll.id, 'booking does not detach the vote');
  await t.db.prepare("UPDATE trip_stays SET data=json_set(data,'$.bookedBy',?) WHERE id=?").bind(t.alex.id,stayId).run();
  trip = (await t.send('PATCH', `/api/trips/${trip.id}/stays/${stayId}`, {revision:trip.revision,notes:'Bring a travel cot'})).body;
  assert.equal(trip.stayGroups[0].options.find((s:any)=>s.id===stayId).bookedBy,t.alex.id,'notes preserve booking attribution');
  const settings = (await t.send('GET', '/api/settings')).body;
  await t.send('PATCH', '/api/settings', {
    features: { ...settings.features, trips: false },
  });
  assert.equal((await t.send('GET', `/api/polls/${poll.id}`)).status, 404);
  assert.deepEqual((await t.send('GET', '/api/polls')).body, []);
});
test('trips: editable guarded metadata and stored image media tokens, never arbitrary URL fetches', async () => {
  const t = await travelSetup();
  const calls: string[] = [];
  t.env.ALLOW_PRIVATE_FEED_URLS = '1';
  t.env.OUTBOUND_FETCH = async (input) => {
    const u = String(input);
    calls.push(u);
    return u.endsWith('.png')
      ? new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
          headers: { 'Content-Type': 'image/png', ETag: '"demo"' },
        })
      : new Response(
          '<html><script type="application/ld+json">{"@type":"Hotel","name":"Demo stay","address":{"addressLocality":"Maple Falls","streetAddress":"Do not import"},"image":"https://example.com/demo.png"}</script><meta property="og:site_name" content="Demo listing"></html>',
          { headers: { 'Content-Type': 'text/html' } },
        );
  };
  const preview = await t.send('POST', '/api/trips/link-preview', {
    url: 'https://example.com/stay',
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.name, 'Demo stay');
  assert.equal(preview.body.town, 'Maple Falls');
  assert.ok(!JSON.stringify(preview.body).includes('Do not import'));
  assert.equal(
    (
      await t.send('POST', '/api/trips/link-preview', {
        url: 'https://127.0.0.1/stay',
      })
    ).status,
    400,
  );
  let trip = (await t.send('POST', '/api/trips', { title: 'Visit' })).body;
  trip = (
    await t.send('POST', `/api/trips/${trip.id}/stay-groups`, {
      label: 'Stay',
      revision: trip.revision,
    })
  ).body;
  trip = (
    await t.send('POST', `/api/trips/${trip.id}/stays`, {
      groupId: trip.stayGroups[0].id,
      name: 'Our edited name',
      imageUrl: preview.body.imageUrl,
      revision: trip.revision,
    })
  ).body;
  const stay = trip.stayGroups[0].options[0];
  const token = (await t.send('GET', '/api/media-token', undefined, t.kidKey))
    .body.token;
  const app = createApp();
  const image = await app.request(
    `/api/trips/stays/${stay.id}/image?key=${encodeURIComponent(token)}&url=https://127.0.0.1/private`,
    {},
    t.env,
  );
  assert.equal(image.status, 200, await image.clone().text());
  assert.equal(image.headers.get('Content-Type'), 'image/png');
  assert.match(image.headers.get('Cache-Control')!, /private.*604800/);
  assert.equal(image.headers.get('ETag'), '"demo"');
  assert.equal(calls.at(-1), 'https://example.com/demo.png');
});
test('trips: endpoint timezones handle date lines and unknown zones, calendar publication is explicit and retry-safe', async () => {
  const t = await travelSetup();
  let trip = (
    await t.send('POST', '/api/trips', {
      title: 'Visit',
      startDate: '2026-11-25',
      endDate: '2026-11-27',
    })
  ).body;
  let r = await t.send('POST', `/api/trips/${trip.id}/legs`, {
    revision: trip.revision,
    mode: 'flight',
    departDate: '2026-11-23',
    departTime: '10:00',
    departTz: 'Asia/Tokyo',
    arriveDate: '2026-11-22',
    arriveTime: '18:00',
    arriveTz: 'America/Los_Angeles',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  trip = r.body;
  r = await t.send('POST', `/api/trips/${trip.id}/legs`, {
    revision: trip.revision,
    mode: 'train',
    departDate: '2026-11-25',
    departTime: '08:00',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  trip = r.body;
  assert.equal(trip.legs.find((l: any) => l.mode === 'train').departTz, null);
  const cal = (
    await t.send('POST', '/api/calendars', {
      name: 'Family plans',
      color: '#336699',
      kind: 'local',
    })
  ).body;
  assert.ok(cal.id, JSON.stringify(cal));
  for (let i = 0; i < 2; i++) {
    r = await t.send('POST', `/api/trips/${trip.id}/calendar`, {
      revision: trip.revision,
      calendarId: cal.id,
      span: true,
      legs: [trip.legs.find((l: any) => l.mode === 'flight').id],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    trip = r.body;
  }
  const events = (
    await t.db
      .prepare('SELECT id,start,end FROM events WHERE calendar_id=?')
      .bind(cal.id)
      .all<any>()
  ).results;
  assert.equal(events.length, 2);
  assert.ok(
    events.some((e) => e.start === '2026-11-25' && e.end === '2026-11-28'),
  );
  const dateReview = await t.send('POST', `/api/trips/${trip.id}/date-change/preview`, {startDate:'2027-01-01',endDate:'2027-01-04'});
  assert.ok(dateReview.body.events.some((e:any)=>e.id===trip.calendar.span.eventId),'date review includes the published span');
  const links = await t.send('GET','/api/trips/links',undefined,t.kidKey);
  assert.equal(links.status,200);
  assert.equal(links.body.length,2);
  assert.ok(links.body.every((l:any)=>l.kind==='event'&&l.tripId===trip.id&&l.title===trip.title));
  assert.deepEqual(Object.keys(links.body[0]).sort(),['kind','refId','tripId','title','emoji'].sort(),'reverse links contain basic fields only');
  r = await t.send('PATCH', `/api/trips/${trip.id}`, {
    revision: trip.revision,
    startDate: '2027-01-01',
    endDate: '2027-01-04',
  });
  assert.equal(r.status, 200);
  trip = r.body;
  assert.equal(
    (
      await t.db
        .prepare('SELECT start FROM events WHERE start=?')
        .bind('2026-11-25')
        .first<any>()
    )?.start,
    '2026-11-25',
  );
  assert.equal(
    (
      await t.send(
        'DELETE',
        `/api/trips/${trip.id}?revision=${trip.revision - 1}`,
      )
    ).status,
    409,
  );
  assert.equal(
    (await t.send('DELETE', `/api/trips/${trip.id}?revision=${trip.revision}`))
      .status,
    200,
  );
  assert.equal(
    (
      await t.db
        .prepare('SELECT count(*) n FROM events WHERE calendar_id=?')
        .bind(cal.id)
        .first<any>()
    )?.n,
    2,
  );
});
test('away: reviews are stale after source edits; overlapping periods union and away recipients are rejected', async () => {
  const t = await travelSetup(),
    chore = (
      await t.send('POST', '/api/chores', {
        title: 'Plants',
        memberId: t.maya.id,
        dueDate: '2026-11-01',
        rrule: 'FREQ=DAILY',
      })
    ).body;
  const draft = {
    label: 'Visit',
    people: [
      { memberId: t.maya.id, startDate: '2026-11-23', endDate: '2026-11-25' },
    ],
  };
  let p = await t.send('POST', '/api/away/preview', draft);
  await t.send('PATCH', `/api/chores/${chore.id}`, { title: 'Water plants' });
  assert.equal(
    (await t.send('POST', '/api/away', { ...draft, token: p.body.token }))
      .status,
    409,
  );
  for (let i = 0; i < 2; i++) {
    p = await t.send('POST', '/api/away/preview', draft);
    assert.equal(
      (await t.send('POST', '/api/away', { ...draft, token: p.body.token }))
        .status,
      201,
    );
  }
  const bad = {
    ...draft,
    people: [
      ...draft.people,
      { memberId: t.leo.id, startDate: '2026-11-24', endDate: '2026-11-25' },
    ],
    handoffs: [
      {
        choreId: chore.id,
        fromMemberId: t.maya.id,
        toMemberId: t.leo.id,
        startDate: '2026-11-23',
        endDate: '2026-11-25',
      },
    ],
  };
  p = await t.send('POST', '/api/away/preview', bad);
  assert.ok(
    p.body.conflicts.some(
      (v: any) => v.kind === 'recipient-away' && v.blocking,
    ),
  );
  assert.equal(
    (await t.send('POST', '/api/away', { ...bad, token: p.body.token })).status,
    409,
  );
  assert.equal(
    (await t.send('POST', '/api/away/preview', draft, t.kidKey)).status,
    403,
  );
});
test('away: streaks bridge long absence, school days off agree with daily duty, flexible intervals excuse failure', async () => {
  const t = await travelSetup();
  const chore = (
    await t.send('POST', '/api/chores', {
      title: 'Read',
      memberId: t.maya.id,
      dueDate: '2026-01-01',
      rrule: 'FREQ=DAILY',
    })
  ).body;
  const row = await t.db
    .prepare('SELECT * FROM chores WHERE id=?')
    .bind(chore.id)
    .first<any>();
  const away = awayContext(
    [
      {
        period_id: 'demo',
        member_id: t.maya.id,
        start_date: '2026-08-01',
        end_date: '2026-11-23',
      },
    ],
    [],
    [t.maya.id],
  );
  const first = away.streakStart(t.maya.id, '2026-11-23');
  assert.ok(first < '2026-08-01');
  const keys = new Set(
    ['2026-07-31', '2026-07-30', '2026-07-29'].map((d) => `${row.id}:${d}`),
  );
  const policy = { memberId: t.maya.id, away, schoolOff: () => false };
  const longAway = awayContext([{period_id:'long-demo',member_id:t.maya.id,start_date:'2016-01-01',end_date:'2026-11-23'}],[],[t.maya.id]);
  const longRow = {...row,due_date:'2015-01-01'};
  const longFirst = longAway.streakStart(t.maya.id,'2026-11-23');
  assert.equal(streakStats([longRow],new Set(['2015-12-31','2015-12-30','2015-12-29'].map(d=>`${row.id}:${d}`)),'UTC','2026-11-23',0,Math.round((Date.parse('2026-11-23')-Date.parse(longFirst))/86400000)+1,{memberId:t.maya.id,away:longAway,schoolOff:()=>false}).current,3,'long absence bridges without truncating earned streak history');
  assert.equal(
    streakStats(
      [row],
      keys,
      'UTC',
      '2026-11-23',
      0,
      Math.round((Date.parse('2026-11-23') - Date.parse(first)) / 86400000) + 1,
      policy,
    ).current,
    3,
  );
  const features = (await t.send('GET', '/api/settings')).body.features;
  await t.send('PATCH', '/api/settings', {
    features: { ...features, school: true },
  });
  await t.send('PUT', `/api/school/kids/${t.maya.id}`, { mode: 'enrolled' });
  await t.send('PUT', `/api/school/days/${t.maya.id}/2026-11-20`, {
    kind: 'off',
  });
  const work = {
    ...row,
    school_kind: 'lesson',
    school_subject_id: 'ss-reading',
    school_days_off: 0,
  };
  const noSchool = await schoolworkOff(t.env.DB, '2026-11-19', '2026-11-20', [
    work,
  ]);
  assert.ok(noSchool(work, '2026-11-20'));
  const noAway = awayContext([], [], [t.maya.id]);
  assert.equal(
    streakStats(
      [work],
      new Set([`${row.id}:2026-11-19`]),
      'UTC',
      '2026-11-20',
      0,
      2,
      { memberId: t.maya.id, away: noAway, schoolOff: noSchool },
    ).current,
    1,
  );
  const goal={...row,due_date:'2026-11-09',repeat_goal:JSON.stringify({times:3,every:1,unit:'week',weekStart:1})};
  const partWeek=awayContext([{period_id:'demo',member_id:t.maya.id,start_date:'2026-11-17',end_date:'2026-11-17'}],[],[t.maya.id]);
  assert.equal(streakStats([goal],new Set([`${row.id}:2026-11-09`,`${row.id}:2026-11-10`,`${row.id}:2026-11-11`]),'UTC','2026-11-23',0,15,{memberId:t.maya.id,away:partWeek,schoolOff:()=>false}).current,1,'a partly away interval neither fails nor grants a free done day');
});
test('away: recipient approval and routine duty follow the handoff, with bedtime and earned history preserved',async(context)=>{
 context.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-23T12:00:00Z')});
 const t=await travelSetup();await t.send('PATCH','/api/settings',{timezone:'UTC'});
 await t.send('PATCH',`/api/members/${t.leo.id}`,{needsApproval:true});await t.send('PATCH',`/api/members/${t.maya.id}`,{needsApproval:false});
 const chore=(await t.send('POST','/api/chores',{title:'Feed the fish',memberId:t.maya.id,rrule:'FREQ=DAILY',dueDate:'2026-11-01',points:5})).body;
 for(const memberId of [t.maya.id,t.leo.id])assert.equal((await t.send('PUT',`/api/routine-mode/${memberId}`,{enabled:true,cutoff:'19:30',requiredChoreIds:memberId===t.maya.id?[chore.id]:[]})).status,200);
 const draft={label:'Visit',people:[{memberId:t.maya.id,startDate:'2026-11-23',endDate:'2026-11-24'}],handoffs:[{choreId:chore.id,fromMemberId:t.maya.id,toMemberId:t.leo.id,startDate:'2026-11-23',endDate:'2026-11-24'}]};
 const preview=(await t.send('POST','/api/away/preview',draft)).body;assert.equal((await t.send('POST','/api/away',{...draft,token:preview.token})).status,201);
 const donor=(await t.send('GET',`/api/routine-mode/${t.maya.id}`)).body,recipient=(await t.send('GET',`/api/routine-mode/${t.leo.id}`)).body;
 assert.equal(donor.locked,false);assert.ok(recipient.remaining.some((r:any)=>r.id===chore.id));assert.ok(new Date(donor.validUntil)<=new Date('2026-11-24T00:00:00Z'));
 const key=(await t.send('POST','/api/keys',{name:'Leo tablet',scope:'display'})).body;await t.send('PATCH',`/api/keys/${key.id}`,{kind:'kid',owner:t.leo.id});
 const done=await t.send('POST',`/api/chores/${chore.id}/complete`,{date:'2026-11-23'},key.key);assert.equal(done.status,200,JSON.stringify(done.body));assert.equal(done.body.pending,true,'recipient approval replaces source person default');
 assert.equal((await t.send('GET',`/api/routine-mode/${t.leo.id}`)).body.locked,true);
 assert.equal((await t.send('POST',`/api/chores/${chore.id}/approve`,{date:'2026-11-23'})).status,200);
 assert.equal((await t.send('GET',`/api/routine-mode/${t.leo.id}`)).body.locked,false);
 const board=(await t.send('GET','/api/leaderboard?period=today')).body;assert.equal(board.find((m:any)=>m.memberId===t.leo.id).points,5);assert.equal(board.find((m:any)=>m.memberId===t.maya.id).points,0);
 const period=(await t.send('GET','/api/away')).body[0];await t.send('DELETE',`/api/away/${period.id}?revision=${period.revision}`);
 const cc=await t.db.prepare('SELECT member_id,points_awarded,status FROM chore_completions WHERE chore_id=?').bind(chore.id).first<any>();assert.deepEqual({...cc},{member_id:t.leo.id,points_awarded:5,status:'approved'});
});

test('trips: link every active list type, unlink without deleting, reject missing and archived lists', async () => {
  const { send } = await travelSetup();
  const ids: string[] = [];
  for (const data of [
    {name:'Packing',kind:'reusable'}, {name:'Trip groceries',kind:'shopping',catalog:'groceries'},
    {name:'Travel shopping',kind:'shopping',catalog:'shopping'}, {name:'Before we go',kind:'todo'},
    {name:'Cabin pantry',kind:'todo',purpose:'pantry'},
  ]) {
    const r=await send('POST','/api/lists',data);assert.equal(r.status,201,JSON.stringify(r.body));ids.push(r.body.id);
  }
  const created=await send('POST','/api/trips',{title:'List planning',packingListIds:ids});
  assert.equal(created.status,201,JSON.stringify(created.body));
  let trip=created.body;assert.deepEqual([...trip.packingListIds].sort(),[...ids].sort());
  const unlinked=await send('PATCH',`/api/trips/${trip.id}`,{revision:trip.revision,packingListIds:[]});
  assert.equal(unlinked.status,200);trip=unlinked.body;
  for(const id of ids) assert.equal((await send('GET',`/api/lists/${id}`)).status,200);
  assert.equal((await send('PATCH',`/api/trips/${trip.id}`,{revision:trip.revision,packingListIds:['missing']})).status,400);
  await send('PATCH',`/api/lists/${ids[0]}`,{archived:true});
  assert.equal((await send('PATCH',`/api/trips/${trip.id}`,{revision:trip.revision,packingListIds:[ids[0]]})).status,400);
});
