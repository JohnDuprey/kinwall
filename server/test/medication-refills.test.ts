// Medicine refills (routes/medication-refills.ts): refill details sealed at rest, the contact to ask with
// its phone menu (checked on the contact), one open "Request refill" to-do per medicine, who may see the
// card, the reminder day, the MCP tools behind aiHealthAccess, and old refill places becoming contacts.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { openNote, runNotifications } from '../src/notify.ts';
import { convertRefillPlaces, fillScript, howOften, telUri } from '../src/routes/medication-refills.ts';
import { dialToSteps, stepsToDial } from '../src/dial-steps.ts';
import { seal } from '../src/crypto.ts';
import { NO_REFILL } from '../src/routes/medications.ts';
import type { Env } from '../src/env.ts';
import { createApiKey } from '../src/auth.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const at = (local: string, date = '2026-09-28') => new Date(`${date}T${local}:00-07:00`);
// Must never show up raw in the database.
const OFFICE = 'Maple Street Pediatrics';
const PHONE = '(555) 010-2233';
const STEPS = 'Prescriptions';
const PHARMACY = 'zz-corner-pharmacy';
const DOB = '2016-03-04';
const MED = 'zz-sleepy-syrup';
const MENU = [{ kind: 'wait', seconds: 4 }, { kind: 'press', digits: '2', label: STEPS }, { kind: 'press', digits: '1#' }];

async function setup() {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: at('07:00') });
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: KEY } as Env;
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN, headers: Record<string, string> = {}) => {
    const res = await createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers } }, env);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  await req('/api/settings', 'PATCH', { timezone: 'America/Los_Angeles', medications: true });
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#F5A65B' })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' })).json;
  const key = async (owner?: string) => (await createApiKey(db as never, `k-${owner ?? 'wall'}`, 'display', { owner: owner ?? null })).key;
  const contact = (await req('/api/contacts', 'POST', { kind: 'service', name: OFFICE, relationship: 'Medical', phones: [{ label: 'Office', value: PHONE, menu: MENU }], websites: [{ label: 'Clinic app', value: 'https://portal.example.com/refills' }, { label: 'Bad', value: 'javascript:alert(1)' }] })).json;
  const med = (await req('/api/medications', 'POST', { memberId: leo.id, name: MED, dose: '5 ml', times: ['08:00', '20:00'], refill: { contactId: contact.id, pharmacy: PHARMACY, dateOfBirth: DOB, callback: '555-0100' } })).json;
  const raw = (table: string) => db.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>().results;
  return { env, db, req, leo, maya, key, contact, med, raw };
}

test('refills: refill details are sealed at rest; the card shows the contact, fills in the message and dials the menu', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, med, contact, raw } = await setup();
  assert.deepEqual(med.refill, { contactId: contact.id, pharmacyContactId: null, pharmacy: PHARMACY, dateOfBirth: DOB, callback: '555-0100', remindOn: null });
  const stored = JSON.stringify(raw('medications'));
  for (const s of [OFFICE, contact.id, PHARMACY, DOB, '555-0100', MED]) assert.equal(stored.includes(s), false, s);
  assert.equal(JSON.stringify(raw('contacts')).includes(MED), false, 'nothing about the medicine on the contact');

  const card = (await req(`/api/medications/${med.id}/refill`)).json;
  assert.deepEqual(card.contact, {
    id: contact.id, name: OFFICE,
    phones: [{ label: 'Office', number: PHONE, steps: `Wait 4 seconds, press 2 (${STEPS}), then press 1#.`, telUri: 'tel:5550102233,,21%23' }],
    websites: [{ label: 'Clinic app', url: 'https://portal.example.com/refills' }],
  });
  assert.match(card.script, /refill request for Leo, date of birth March 4, 2016\./);
  assert.match(card.script, new RegExp(`${MED}, 5 ml, taken twice a day\\.`));
  assert.match(card.script, new RegExp(`send it to ${PHARMACY}`));
  assert.equal(card.request, null);
  assert.equal((await req(`/api/medications/${med.id}`, 'PATCH', { refill: { contactId: 'nope' } })).status, 400, 'a contact that isn\'t there');
});

test('refills: a contact phone\'s menu steps are checked; Call on the contact sheet uses them', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, contact } = await setup();
  const phone = (menu: unknown[]) => ({ phones: [{ label: 'Office', value: PHONE, menu }] });
  for (const step of [{ kind: 'press', digits: '2w1' }, { kind: 'press', digits: ',' }, { kind: 'press', digits: '' }, { kind: 'wait', seconds: 0 }, { kind: 'wait', seconds: 61 }, { kind: 'beep' }, { kind: 'confirm', digits: '1' }]) {
    assert.equal((await req('/api/contacts', 'POST', { name: 'x', ...phone([step]) })).status, 400, JSON.stringify(step));
    assert.equal((await req(`/api/contacts/${contact.id}`, 'PATCH', phone([step]))).status, 400, `patch ${JSON.stringify(step)}`);
  }
  assert.equal((await req('/api/contacts', 'POST', { name: 'x', ...phone(Array.from({ length: 21 }, () => ({ kind: 'confirm' }))) })).status, 400, 'at most 20 steps');
  const made = (await req('/api/contacts', 'POST', { name: 'x', ...phone([{ kind: 'wait', seconds: 3 }, { kind: 'press', digits: '*0#' }, { kind: 'confirm', label: 'Front desk' }, { kind: 'press', digits: '9' }]) })).json;
  assert.deepEqual(made.phones[0].menu[2], { kind: 'confirm', label: 'Front desk' });
  assert.equal((await req(`/api/contacts/${made.id}`)).json.phones[0].menu.length, 4, 'kept');
  assert.equal(telUri('+1 (555) 010-2233', ';2'), 'tel:+15550102233;2');
  assert.equal(telUri('', ',,2'), null);
});

test('refills: one open request per medicine, with one bell note; done closes it and a new one can open', async (t) => {
  t.after(() => mock.timers.reset());
  const { env, req, med, raw } = await setup();
  const open = () => req(`/api/medications/${med.id}/refill-request`, 'POST', { action: 'open' });
  const first = await open();
  assert.equal(first.status, 201);
  assert.equal(first.json.created, true);
  const [again, together] = await Promise.all([open(), open()]);
  assert.deepEqual([again.json.created, together.json.created], [false, false]);
  assert.equal(again.json.request.at, first.json.request.at);
  const notes = raw('notifications').filter((n) => n.kind === 'medication');
  assert.equal(notes.length, 1);
  assert.match(String(notes[0].title), /^enc:v1:/, 'the bell note is sealed');
  assert.equal((await openNote(env, notes[0] as any)).title, `Request refill: ${MED} for Leo`);
  assert.ok((await req(`/api/medications/${med.id}/refill`)).json.request);

  assert.equal((await req(`/api/medications/${med.id}/refill-request`, 'POST', { action: 'done' })).status, 200);
  assert.equal((await req(`/api/medications/${med.id}/refill`)).json.request, null);
  assert.equal((await open()).json.created, true, 'a new one after it was requested');
});

test('refills: the card and request on parent devices and the person\'s own device only', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, leo, maya, key, med, contact } = await setup();
  const wall = await key();
  const leos = await key(leo.id);
  const mayas = await key(maya.id);
  assert.equal((await req(`/api/medications/${med.id}/refill`, 'GET', undefined, leos)).status, 200);
  assert.equal((await req(`/api/medications/${med.id}/refill-request`, 'POST', { action: 'open' }, leos)).status, 201, 'a kid can ask for their own');
  for (const [who, k, h] of [['wall', wall, {}], ["Maya's device", mayas, {}], ['connected app', ADMIN, { 'X-Kinwall-Source': 'mcp' }]] as const) {
    assert.equal((await req(`/api/medications/${med.id}/refill`, 'GET', undefined, k, h)).status, 403, `${who}: card`);
    assert.equal((await req(`/api/medications/${med.id}/refill-request`, 'POST', { action: 'open' }, k, h)).status, 403, `${who}: request`);
  }
  // The contact as Leo's device may see it: a grown-ups-only one isn't shown on his card.
  assert.equal((await req(`/api/medications/${med.id}/refill`, 'GET', undefined, leos)).json.contact.name, contact.name);
  await req(`/api/contacts/${contact.id}`, 'PATCH', { visibility: 'adults' });
  assert.equal((await req(`/api/medications/${med.id}/refill`, 'GET', undefined, leos)).json.contact, null);
});

test('refills: a reminder day opens a request at 9 AM that day, once', async (t) => {
  t.after(() => mock.timers.reset());
  const { env, req, med } = await setup();
  await req(`/api/medications/${med.id}`, 'PATCH', { refill: { remindOn: '2026-09-28' } });
  await runNotifications(env, at('08:30'));
  assert.equal((await req(`/api/medications/${med.id}/refill`)).json.request, null, 'not before 9');
  await runNotifications(env, at('09:01'));
  assert.ok((await req(`/api/medications/${med.id}/refill`)).json.request);
  const after = (await req('/api/medications')).json[0];
  assert.equal(after.refill.remindOn, null, 'used up');
  assert.equal(after.refill.pharmacy, PHARMACY, 'the rest kept');
  await req(`/api/medications/${med.id}/refill-request`, 'POST', { action: 'done' });
  await runNotifications(env, at('09:30'));
  assert.equal((await req(`/api/medications/${med.id}/refill`)).json.request, null, 'not again');
});

test('refills: MCP tools read the card and start a request, only with aiHealthAccess', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, med } = await setup();
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await req('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ADMIN, { Accept: 'application/json, text/event-stream' });
    return res.json.result;
  };
  assert.equal((await call('get_medication_refill', { medicine: 'sleepy', member: 'leo' })).isError, true, 'off until the family allows it');
  await req('/api/settings', 'PATCH', { aiHealthAccess: true });
  const card = (await call('get_medication_refill', { medicine: 'sleepy', member: 'leo' })).structuredContent.refill;
  assert.equal(card.medicationId, med.id);
  assert.equal(card.contact.phones[0].telUri, 'tel:5550102233,,21%23');
  assert.equal((await call('request_medication_refill', { medicine: MED })).structuredContent.created, true);
  assert.equal((await call('request_medication_refill', { medicine: MED })).structuredContent.created, false);
  assert.equal((await call('request_medication_refill', { medicine: MED, done: true })).structuredContent.request, null);
  await req('/api/contacts', 'POST', { kind: 'service', name: 'Rose City Pharmacy', relationship: 'Medical' });
  await req('/api/contacts', 'POST', { kind: 'person', name: 'Rose Aunt' });
  const set = (await call('set_medication_pharmacy', { medicine: MED, pharmacy: 'rose' })).structuredContent.pharmacy;
  assert.equal(set.name, 'Rose City Pharmacy', 'a pharmacy-looking contact wins');
  assert.ok(set.contactId);
  assert.equal((await call('set_medication_pharmacy', { medicine: MED, pharmacy: 'Corner Drugstore' })).structuredContent.pharmacy.contactId, null);
  // Where to ask, by contact name; a phone menu through create_contact.
  const made = (await call('create_contact', { kind: 'service', name: 'Rose Family Clinic', relationship: 'Medical', phones: [{ label: 'Office', value: '555-010-7788', menu: [{ kind: 'wait', seconds: 2 }, { kind: 'press', digits: '3', label: 'Refills' }] }] })).structuredContent;
  assert.equal(made.contact?.phones?.[0]?.menu?.length ?? made.phones?.[0]?.menu?.length, 2);
  assert.equal((await call('set_medication_refill_contact', { medicine: MED, contact: 'rose family' })).structuredContent.contact.name, 'Rose Family Clinic');
  assert.equal((await call('get_medication_refill', { medicine: MED })).structuredContent.refill.contact.phones[0].steps, 'Wait 2 seconds, then press 3 (Refills).');
  assert.equal((await call('set_medication_refill_contact', { medicine: MED, contact: 'nobody like this' })).isError, true);
  assert.equal((await call('set_medication_refill_contact', { medicine: MED, contact: '' })).structuredContent.contact, null);
});

test('refills: the message template and how often', () => {
  const m = { id: 'm', memberId: 'l', name: 'Allergy medicine', dose: '', times: ['08:00'], days: [1, 2, 3, 4, 5], endDate: null, totalDoses: null, lateWindow: '3h' as const, dosesLeft: null, refill: NO_REFILL, refillRequest: null, createdAt: '', updatedAt: '' };
  assert.equal(howOften(m), 'once a day on weekdays');
  assert.equal(howOften({ ...m, times: ['08:00', '12:00', '18:00'], days: [0, 3] }), '3 times a day on Sun, Wed');
  const s = fillScript(m, 'Leo');
  assert.match(s, /date of birth \[date of birth\]/);
  assert.match(s, /Allergy medicine, \[dose\]/);
  assert.equal(fillScript(m, 'Leo', '', '{name} needs {medicine}. {unknown}'), 'Leo needs Allergy medicine. {unknown}');
});

test('refills: the logs never see the refill details or the message', async (t) => {
  t.after(() => mock.timers.reset());
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  try {
    const { req, med } = await setup();
    await req(`/api/medications/${med.id}`, 'PATCH', { refill: { callback: `call ${PHARMACY}` } }); // 400
    await req(`/api/medications/${med.id}/refill`);
    await req(`/api/medications/${med.id}/refill-request`, 'POST', { action: 'open' });
  } finally { methods.forEach((m, i) => { console[m] = saved[i]; }); }
  for (const s of [OFFICE, PHARMACY, MED, DOB, '010-2233']) assert.equal(lines.join('\n').includes(s), false, s);
});

test('refills: refill places from before become contacts, their medicines point to them, once', async (t) => {
  t.after(() => mock.timers.reset());
  const { env, db, req, leo, contact, raw } = await setup();
  const place = async (id: string, data: Record<string, unknown>) => db.prepare('INSERT INTO medication_refill_contacts (id, data, created_at, updated_at) VALUES (?,?,?,?)').bind(id, await seal(env, JSON.stringify(data), `${id}:refill`), '2026-09-01', '2026-09-01').run();
  // A new office (saved before steps, with a raw dial string), and one already in contacts by name.
  await place('p-new', { name: 'Hillside Clinic', appName: 'Hillside app', appLink: 'hillside://refills', website: 'https://hillside.example.org', phone: '555-010-6000', dialDigits: ',,2;1#', script: 'Custom words' });
  await place('p-same', { name: OFFICE.toUpperCase(), phone: PHONE, menu: [{ kind: 'press', digits: '9' }], website: 'https://maple.example.org' });
  await place('p-bare', { name: 'Walk-in desk', phone: '', menu: [] });
  const a = (await req('/api/medications', 'POST', { memberId: leo.id, name: 'zz-a', times: ['08:00'] })).json;
  const b = (await req('/api/medications', 'POST', { memberId: leo.id, name: 'zz-b', times: ['08:00'], refill: { pharmacy: PHARMACY } })).json;
  // As saved before: pointing to the places (the API now refuses ids that aren't contacts).
  const { sealMedication, openMedication } = await import('../src/routes/medications.ts');
  for (const [m, to] of [[a, 'p-new'], [b, 'p-same']] as const) {
    const row = db.prepare('SELECT * FROM medications WHERE id = ?').bind(m.id).first<any>();
    const open = await openMedication(env, row);
    db.prepare('UPDATE medications SET data = ? WHERE id = ?').bind(await sealMedication(env, { ...open, refill: { ...open.refill, contactId: to } }), m.id).run();
  }
  const before = (await req('/api/contacts')).json.length;

  assert.equal(await convertRefillPlaces(env), 3);
  assert.equal(raw('medication_refill_contacts').length, 0, 'the places are gone');
  const all = (await req('/api/contacts')).json;
  assert.equal(all.length, before + 2, 'one new contact per place, none for the one already there');
  const hill = all.find((c: any) => c.name === 'Hillside Clinic');
  assert.equal(hill.kind, 'service');
  assert.equal(hill.relationship, 'Medical');
  assert.deepEqual(hill.phones.map((p: any) => [p.label, p.value, p.menu]), [['Office', '555-010-6000', [{ kind: 'wait', seconds: 4 }, { kind: 'press', digits: '2' }, { kind: 'confirm' }, { kind: 'press', digits: '1#' }]]]);
  assert.deepEqual(hill.websites.map((w: any) => [w.label, w.value]), [['Hillside app', 'hillside://refills'], ['Website', 'https://hillside.example.org']]);
  assert.equal(JSON.stringify(hill).includes('Custom words'), false, 'the old message stays out of contacts');
  const same = all.find((c: any) => c.id === contact.id);
  assert.equal(same.phones.length, 1, 'same number: no second phone');
  assert.equal(same.phones[0].menu.length, 3, 'its own menu kept');
  assert.deepEqual(same.websites.map((w: any) => w.value), ['https://portal.example.com/refills', 'javascript:alert(1)', 'https://maple.example.org']);
  assert.ok(all.find((c: any) => c.name === 'Walk-in desk'));

  const meds = (await req('/api/medications')).json;
  assert.equal(meds.find((m: any) => m.id === a.id).refill.contactId, hill.id);
  assert.equal(meds.find((m: any) => m.id === b.id).refill.contactId, contact.id);
  assert.equal(meds.find((m: any) => m.id === b.id).refill.pharmacy, PHARMACY, 'the rest kept');
  assert.equal((await req(`/api/medications/${a.id}/refill`)).json.contact.phones[0].telUri, 'tel:5550106000,,2;1%23');

  assert.equal(await convertRefillPlaces(env), 0, 'nothing the second time');
  assert.equal((await req('/api/contacts')).json.length, before + 2);
  assert.deepEqual(dialToSteps(stepsToDial(hill.phones[0].menu)), hill.phones[0].menu);
});

test('refills: a backup with refill places imports them as contacts', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, raw } = await setup();
  const backup = (await req('/api/export')).json;
  const med = backup.medications[0];
  med.refill.contactId = 'old-place';
  backup.medicationRefillContacts = [{ id: 'old-place', name: 'Lakeside Clinic', appName: '', appLink: '', website: '', phone: '555-010-9000', menu: [{ kind: 'press', digits: '4' }], phoneSteps: 'Press 4.', dialDigits: '4', script: '', createdAt: 'x', updatedAt: 'x' }];
  assert.equal((await req('/api/import', 'POST', backup)).status, 200);
  assert.equal(raw('medication_refill_contacts').length, 0);
  const lake = (await req('/api/contacts')).json.find((c: any) => c.name === 'Lakeside Clinic');
  assert.deepEqual(lake.phones[0].menu, [{ kind: 'press', digits: '4' }]);
  assert.equal((await req('/api/medications')).json.find((m: any) => m.id === med.id).refill.contactId, lake.id);
});

test('refills: the pharmacy can be a family contact; the card and message use it, a missing one is refused', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, med, leo, key } = await setup();
  const ph = (await req('/api/contacts', 'POST', { kind: 'service', name: 'Rose City Pharmacy', relationship: 'Medical', phones: [{ label: 'Pharmacy', value: '555-010-4455' }], addresses: [{ street: '210 Main Street', city: 'Maple Grove', region: 'OR' }], visibility: 'adults' })).json;
  assert.equal((await req(`/api/medications/${med.id}`, 'PATCH', { refill: { pharmacyContactId: 'nope' } })).status, 400);
  assert.equal((await req(`/api/medications/${med.id}`, 'PATCH', { refill: { pharmacyContactId: ph.id } })).status, 200);
  const card = (await req(`/api/medications/${med.id}/refill`)).json;
  assert.deepEqual(card.pharmacy, { name: 'Rose City Pharmacy', contactId: ph.id, phone: '555-010-4455', telUri: 'tel:5550104455', address: '210 Main Street, Maple Grove, OR' });
  assert.match(card.script, /send it to Rose City Pharmacy\./);
  // A grown-ups-only contact on Leo's own device: the typed name instead.
  const leos = await key(leo.id);
  const kid = (await req(`/api/medications/${med.id}/refill`, 'GET', undefined, leos)).json;
  assert.deepEqual(kid.pharmacy, { name: PHARMACY, contactId: null, phone: null, telUri: null, address: null });
  assert.equal(JSON.stringify((await req('/api/medications')).json).includes('Rose City'), false, 'only the id is kept with the medicine');
});
