import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventActivity, pickEventActivity, resolveFollow } from '../src/event-activity-plan.ts';
const e = {
  id: 'soccer',
  calendarId: 'home',
  title: 'Soccer practice',
  start: '2030-03-04T16:00:00Z',
  end: '2030-03-04T17:00:00Z',
  allDay: false,
  occurrenceStart: null,
  seriesId: null,
  rrule: null,
  location: 'Park',
  leaveAt: '2030-03-04T15:40:00Z',
  prepAt: null,
};
const rule = {
  member_id: 'sam',
  calendar_id: 'home',
  target: 'soccer',
  scope: 'occurrence' as const,
  occurrence_start: '',
  enabled: 1,
  minutes: 15,
  show_now: null,
};
test('event follow: off by default; occurrence overrides series; stable across time edits', () => {
  assert.equal(resolveFollow(e, []), undefined);
  assert.equal(resolveFollow(e, [rule])?.enabled, 1);
  assert.equal(resolveFollow({ ...e, start: '2030-03-04T16:30:00Z' }, [rule])?.enabled, 1);
  const repeating = { ...e, rrule: 'FREQ=DAILY', occurrenceStart: e.start };
  assert.equal(
    resolveFollow(repeating, [
      { ...rule, scope: 'series' },
      { ...rule, occurrence_start: new Date(e.start).toISOString(), enabled: 0 },
    ])?.enabled,
    0,
  );
});
test('event follow: leave, start, end stages; all day and finished excluded; lifetime bounded', () => {
  const a = eventActivity(e, rule)!;
  assert.equal(a.showAt, '2030-03-04T15:25:00.000Z');
  assert.equal(pickEventActivity([a], Date.parse('2030-03-04T15:24:00Z')), null);
  assert.equal(pickEventActivity([a], Date.parse('2030-03-04T15:30:00Z'))?.stage, 'leave');
  assert.equal(pickEventActivity([a], Date.parse('2030-03-04T15:45:00Z'))?.stage, 'start');
  assert.equal(pickEventActivity([a], Date.parse('2030-03-04T16:30:00Z'))?.stage, 'end');
  assert.equal(pickEventActivity([a], Date.parse(e.end)), null);
  assert.equal(eventActivity({ ...e, allDay: true }, rule), null);
  const long = eventActivity({ ...e, end: '2030-03-06T17:00:00Z' }, rule)!;
  assert.equal(Date.parse(long.endsAt) - Date.parse(long.showAt), 8 * 3600000);
});
test('event follow: in-progress event wins over upcoming; disabled occurrence stays hidden', () => {
  const a = eventActivity(e, rule)!;
  const b = eventActivity(
    { ...e, id: 'next', start: '2030-03-04T16:40:00Z', end: '2030-03-04T17:40:00Z', leaveAt: null },
    rule,
  )!;
  assert.equal(pickEventActivity([b, a], Date.parse('2030-03-04T16:30:00Z'))?.activity, a.activity);
  assert.equal(eventActivity(e, { ...rule, enabled: 0 }), null);
});

import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { fileURLToPath } from 'node:url';
import { runEventLiveActivities } from '../src/event-live-activities.ts';
import { seal } from '../src/crypto.ts';
import type { Env } from '../src/env.ts';
async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const key = btoa(
    String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))),
  );
  const sent: any[] = [];
  let status = 200;
  const env: Env = {
    DB: db,
    ADMIN_API_KEY: 'test-admin',
    PUBLIC_URL: 'http://localhost',
    ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    APNS_KEY_ID: crypto.randomUUID(),
    APNS_TEAM_ID: 'TEAM123',
    APNS_KEY: `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`,
    APNS_BUNDLE_ID: 'family.kinwall.app',
    APNS_SEND: async (r) => {
      sent.push(JSON.parse(r.body).aps);
      return { status };
    },
  };
  const app = createApp();
  const request = (path: string, method = 'GET', body?: unknown, token = 'test-admin') =>
    app.request(
      path,
      {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );
  const json = async (path: string, method = 'GET', body?: unknown, token?: string) => {
    const r = await request(path, method, body, token);
    assert.ok(r.ok, `${r.status} ${await r.clone().text()}`);
    return r.json() as Promise<any>;
  };
  await json('/api/settings', 'PATCH', { timezone: 'UTC' });
  const sam = await json('/api/members', 'POST', { name: 'Sam', color: '#FF8FA3' });
  const phone = await json('/api/keys', 'POST', { name: 'Sam phone', scope: 'display' });
  await json(`/api/keys/${phone.id}`, 'PATCH', { owner: sam.id });
  const cal = await json('/api/calendars', 'POST', { kind: 'local', name: 'Home' });
  const event = await json('/api/events', 'POST', {
    calendarId: cal.id,
    title: 'Soccer',
    start: '2030-03-04T16:00:00Z',
    end: '2030-03-04T17:00:00Z',
    allDay: false,
    reminders: [],
  });
  return {
    db,
    env,
    sent,
    json,
    request,
    phone,
    cal,
    event,
    sam,
    setStatus: (n: number) => {
      status = n;
    },
  };
}
test('event follows: own device only; wall and admin without owner refused; read-only calendar does not block a personal follow', async () => {
  const f = await setup(),
    path = `/api/events/${f.event.id}/follow`;
  assert.equal((await f.request(path, 'PUT', { enabled: true })).status, 403);
  const wall = await f.json('/api/keys', 'POST', { name: 'Wall', scope: 'display' });
  assert.equal((await f.request(path, 'PUT', { enabled: true }, wall.key)).status, 403);
  assert.equal((await f.json(path, 'GET', undefined, f.phone.key)).enabled, false);
  await f.db.prepare('UPDATE calendars SET writable=0,display_edit=0 WHERE id=?').bind(f.cal.id).run();
  assert.equal((await f.json(path, 'PUT', { enabled: true }, f.phone.key)).enabled, true);
  assert.equal((await f.request(path, 'PUT', { enabled: true, memberId: 'other' }, f.phone.key)).status, 400);
  assert.equal((await f.request(path, 'PUT', { enabled: true, scope: 'series' }, f.phone.key)).status, 400);
  assert.equal((await f.request(path, 'PUT', { enabled: true, showNow: true }, f.phone.key)).status, 400);
});
test('event follows: series choice, occurrence exception, hidden events and resync-stable ids', async () => {
  const f = await setup();
  await f.json(`/api/events/${f.event.id}`, 'PATCH', { rrule: 'FREQ=DAILY;COUNT=3' });
  const path = `/api/events/${f.event.id}/follow`,
    occurrenceStart = '2030-03-05T16:00:00Z';
  await f.json(path, 'PUT', { enabled: true, scope: 'series', occurrenceStart }, f.phone.key);
  await f.json(path, 'PUT', { enabled: false, scope: 'occurrence', occurrenceStart }, f.phone.key);
  assert.equal(
    (
      await f.json(
        `${path}?occurrenceStart=${encodeURIComponent(occurrenceStart)}`,
        'GET',
        undefined,
        f.phone.key,
      )
    ).enabled,
    false,
  );
  assert.equal(
    (await f.json(`${path}?occurrenceStart=2030-03-06T16%3A00%3A00Z`, 'GET', undefined, f.phone.key)).enabled,
    true,
  );
  await f.json(`/api/events/${f.event.id}/hidden`, 'PUT', { scope: 'series' });
  assert.equal(
    (
      await f.request(
        `${path}?occurrenceStart=${encodeURIComponent(occurrenceStart)}`,
        'GET',
        undefined,
        f.phone.key,
      )
    ).status,
    404,
  );
});
test('event activities: opt-in independent of transitions, start/update/end, failed delivery retries, deletion cleanup', async () => {
  const f = await setup(),
    path = `/api/events/${f.event.id}/follow`,
    token = 'ab'.repeat(32);
  await f.json(path, 'PUT', { enabled: true }, f.phone.key);
  await f.json(
    '/api/live-activities/tokens',
    'PUT',
    { kind: 'start', token, preferences: { events: true, leaveBy: false } },
    f.phone.key,
  );
  await runEventLiveActivities(f.env, new Date('2030-03-04T15:44:00Z'));
  assert.equal(f.sent.length, 0);
  f.setStatus(503);
  await runEventLiveActivities(f.env, new Date('2030-03-04T15:45:00Z'));
  assert.equal(f.sent.at(-1).event, 'start');
  f.setStatus(200);
  await runEventLiveActivities(f.env, new Date('2030-03-04T15:46:00Z'));
  assert.equal(f.sent.length, 2);
  const activity = f.sent.at(-1).attributes.activity;
  // Insert a native update token without a mutation reconcile at the fixture's real (2026) clock.
  await f.db
    .prepare(
      "INSERT INTO live_activity_tokens(id,device,api_key_id,kind,activity,token,created_at) VALUES(?,?,?,'update',?,?,?)",
    )
    .bind(
      'update',
      `key:${f.phone.id}`,
      f.phone.id,
      activity,
      await seal(f.env, 'cd'.repeat(32), 'live-activity-token:update'),
      '2030-03-04T15:46:00Z',
    )
    .run();
  await runEventLiveActivities(f.env, new Date('2030-03-04T16:05:00Z'));
  assert.equal(f.sent.at(-1).event, 'update');
  assert.equal(f.sent.at(-1)['content-state'].detail, 'Ends in');
  const count = f.sent.length;
  await runEventLiveActivities(f.env, new Date('2030-03-04T16:06:00Z'));
  assert.equal(f.sent.length, count, 'unchanged content is not pushed');
  await f.db.prepare('DELETE FROM events WHERE id=?').bind(f.event.id).run();
  await runEventLiveActivities(f.env, new Date('2030-03-04T16:07:00Z'));
  assert.equal(f.sent.at(-1).event, 'end');
});

test('event follows: muted occurrences suppress legacy countdowns without showing an event activity', async () => {
 const {eventPlans}=await import('../src/routes/event-follows.ts');
 const f=await setup();
 await f.json(`/api/events/${f.event.id}/follow`,'PUT',{enabled:false},f.phone.key);
 const plans=await eventPlans(f.db,f.sam.id,new Date('2030-03-04T15:00:00Z'),new Date('2030-03-04T18:00:00Z'));
 assert.equal(plans.length,1);assert.equal(plans[0].muted,true);
 assert.equal(pickEventActivity(plans,Date.parse('2030-03-04T16:30:00Z')),null);
});

test('event follow: synced choices survive row replacement and start-time edits; family members stay independent', async () => {
 const f=await setup();
 await f.db.prepare("UPDATE calendars SET kind='ics',writable=0 WHERE id=?").bind(f.cal.id).run();
 await f.db.prepare("UPDATE events SET external_id='provider-instance',series_id='provider-series' WHERE id=?").bind(f.event.id).run();
 const path=`/api/events/${f.event.id}/follow`;
 await f.json(path,'PUT',{enabled:true},f.phone.key);
 const row=(await f.db.prepare('SELECT * FROM events WHERE id=?').bind(f.event.id).first<Record<string,unknown>>())!;
 await f.db.prepare('DELETE FROM events WHERE id=?').bind(f.event.id).run();
 row.start='2030-03-04T16:30:00Z';row.end='2030-03-04T17:30:00Z';
 const columns=Object.keys(row);
 await f.db.prepare(`INSERT INTO events(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...columns.map(k=>row[k])).run();
 assert.equal((await f.json(path,'GET',undefined,f.phone.key)).enabled,true);
 const alex=await f.json('/api/members','POST',{name:'Alex',color:'#123456'});
 const other=await f.json('/api/keys','POST',{name:'Alex phone',scope:'display'});await f.json(`/api/keys/${other.id}`,'PATCH',{owner:alex.id});
 assert.equal((await f.json(path,'GET',undefined,other.key)).enabled,false);
});

test('event follow: Show now starts a fresh bounded window for a long event already underway', () => {
 const now='2030-03-05T16:00:00Z';
 const p=eventActivity({...e,end:'2030-03-06T17:00:00Z'},{...rule,show_now:now})!;
 assert.equal(p.showAt,new Date(now).toISOString());assert.equal(pickEventActivity([p],Date.parse(now))?.stage,'end');
 assert.equal(Date.parse(p.endsAt)-Date.parse(p.showAt),8*3600000);
});

test('event follow: unusually long imported titles and locations fit the push display', () => {
 const p=eventActivity({...e,title:'⚽'.repeat(2000),location:'📍'.repeat(2000)},rule)!;
 assert.equal(Array.from(p.title).length,120);assert.equal(Array.from(p.location!).length,160);
 assert.ok(new TextEncoder().encode(JSON.stringify({event:p,title:p.title,alert:{title:p.title}})).length<3500);
});

test('event activities: medicine preference changes cannot start the same event twice while its update token is pending', async () => {
 const f=await setup();
 await f.json(`/api/events/${f.event.id}/follow`,'PUT',{enabled:true},f.phone.key);
 const registration={kind:'start',token:'ab'.repeat(32),preferences:{events:true,leaveBy:false,medications:false,medicationNames:false}};
 await f.json('/api/live-activities/tokens','PUT',registration,f.phone.key);
 await runEventLiveActivities(f.env,new Date('2030-03-04T16:10:00Z'));
 assert.equal(f.sent.filter(p=>p.event==='start').length,1);
 await f.json('/api/live-activities/tokens','PUT',{...registration,preferences:{...registration.preferences,medications:true,medicationNames:true}},f.phone.key);
 await runEventLiveActivities(f.env,new Date('2030-03-04T16:11:00Z'));
 assert.equal(f.sent.filter(p=>p.event==='start').length,1,'an unrelated preference update must not create another Lock Screen card');
});

test('event activities: accepted starts from the previous release stay claimed across preference changes', async () => {
 const {sha256Hex}=await import('../src/auth.ts');
 const {eventPlans}=await import('../src/routes/event-follows.ts');
 const f=await setup();
 await f.json(`/api/events/${f.event.id}/follow`,'PUT',{enabled:true},f.phone.key);
 const registration={kind:'start',token:'ab'.repeat(32),preferences:{events:true,leaveBy:false,medications:false}};
 await f.json('/api/live-activities/tokens','PUT',registration,f.phone.key);
 const plans=await eventPlans(f.db,f.sam.id,new Date('2030-03-04T15:00:00Z'),new Date('2030-03-04T18:00:00Z'));
 const key=`ela:${await sha256Hex(`key:${f.phone.id}:0:${plans[0].activity}`)}`;
 await f.db.prepare('INSERT INTO sent_notifications(key,sent_at) VALUES(?,?)').bind(key,'2030-03-04T16:00:00Z').run();
 await runEventLiveActivities(f.env,new Date('2030-03-04T16:10:00Z'));
 await f.json('/api/live-activities/tokens','PUT',{...registration,preferences:{...registration.preferences,medications:true}},f.phone.key);
 await runEventLiveActivities(f.env,new Date('2030-03-04T16:11:00Z'));
 assert.equal(f.sent.filter(p=>p.event==='start').length,0,'the old accepted start must not replay during upgrade');
});

test('event activities: overlapping reconciliation ticks claim only one start', async () => {
 const f=await setup();
 await f.json(`/api/events/${f.event.id}/follow`,'PUT',{enabled:true},f.phone.key);
 await f.json('/api/live-activities/tokens','PUT',{kind:'start',token:'ab'.repeat(32),preferences:{events:true,leaveBy:false}},f.phone.key);
 await Promise.all(Array.from({length:4},()=>runEventLiveActivities(f.env,new Date('2030-03-04T16:10:00Z'))));
 assert.equal(f.sent.filter(p=>p.event==='start').length,1);
});
