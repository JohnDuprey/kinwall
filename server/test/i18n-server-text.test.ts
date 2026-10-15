// The server's own text in German (server/src/locales/de.json): a sample of each area, and that the
// language follows the request (Accept-Language, else the family's) and stays English for MCP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { battery } from '../src/battery.ts';
import { analyze } from '../src/insights.ts';
import { stepsToWords } from '../src/dial-steps.ts';
import { pickNudge, medFollowup } from '../src/nudges.ts';
import { stored, translateStored, words } from '../src/i18n.ts';
import { dateAnnounced } from '../src/outing-reminders.ts';

const de = { t: words('de').t, lang: 'de' };

test('battery reasons and heads-ups in German', () => {
  const day = { date: '2026-10-15', sleep: 'good' as const, feelings: ['tired'], goalSet: false, chores: 2, choreDone: 0, choreDue: 10,
    events: [{ title: 'Swim', start: '09:00', end: '11:30' }, { title: 'Party', start: '11:30', end: '14:00' }, { title: 'Art', start: '14:00', end: '16:00' }, { title: 'Soccer', start: '19:00', end: '20:30' }] };
  const b = battery([day], '2026-10-15', undefined, 'de');
  const reasons = b.days[0].reasons.map((r) => r.text);
  assert.ok(reasons.includes('Schlaf: gut'), reasons.join(' | '));
  assert.ok(reasons.includes('Gefühl: müde') || reasons.some((r) => r.includes('müde')), reasons.join(' | '));
  assert.ok(reasons.includes('4 Termine'), reasons.join(' | '));
  assert.match(b.warnings[0].text, /^Heute sieht voll aus: 4 Termine, 2 Aufgaben und ein später Abend\./);
  assert.equal(battery([day], '2026-10-15').warnings[0].text.startsWith('Today looks full: 4 events, 2 chores, and a late evening.'), true, 'English by default');
});

test('insight summaries in German', () => {
  const d = { date: '2026-10-15', checkedIn: true, sleep: 'good' as const, feelings: [], goalSet: true, goalOutcome: 'yes' as const, journalEntries: 2, journalMoods: [], chores: 3, points: 15, activityMinutes: 75, booksFinished: 1, events: 1, lastEventEnd: null };
  const text = Object.fromEntries(analyze([d], true, 'de').summary.map((s) => [s.id, s.text]));
  assert.equal(text.checkins, 'An 1 von 1 Tag eingecheckt');
  assert.equal(text.activity, words('de').t('Spent {time} on activities', { time: '1 Std. 15 Min.' }));
  assert.equal(analyze([d]).summary[0].text, 'Checked in on 1 of 1 day');
});

test('nudges: the same parts, written in German', () => {
  const n = { kind: 'leave' as const, title: 'Fußball', minutes: 20, at: '15:40', seed: 'x', name: 'Leo' };
  const en = pickNudge(n), ger = pickNudge(n, [], de);
  assert.deepEqual(ger.seen, en.seen, 'which line is picked never depends on the language');
  assert.notEqual(ger.line, en.line);
  assert.match(ger.line, /Fußball/);
  assert.match(medFollowup('Maya', '20 Uhr', 'dose1', de), /Medikamente von Maya/);
});

test('refill steps, outing notes, stored text', () => {
  assert.equal(stepsToWords([{ kind: 'wait', seconds: 4 }, { kind: 'press', digits: '2' }], 'de'), words('de').t('{steps}, then {last}', { steps: words('de').tn(4, 'wait {n} second', 'wait {n} seconds'), last: 'drücke 2' }).replace(/^./, (c) => c.toUpperCase()) + '.');
  const r = dateAnnounced({ id: 'o', title: 'Zirkus', kind: 'upcoming', startsOn: '2026-10-17', endsOn: null, startTime: null, buyBy: null, interest: [{ memberId: 'm1', level: 'really' }] } as never, null)!;
  assert.match(r.text('de').body, /Samstag/);
  assert.match(r.body, /Saturday/);
  // A stored template: the more specific one wins.
  const s = stored('security', '"{device}" now belongs to {name} (a kid\'s device)', { device: 'Tablet', name: 'Leo' });
  assert.equal(translateStored('de', 'security', s), '„Tablet“ gehört jetzt Leo (Gerät eines Kindes)');
});

test("errors: the screen's language, else the family's; MCP's English stays", async () => {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: 'kw_admin', PUBLIC_URL: 'http://localhost' } as unknown as Env;
  const app = createApp();
  const get = async (lang?: string) => (await (await app.request('/api/members/nope/battery', { headers: { Authorization: 'Bearer kw_admin', ...(lang ? { 'Accept-Language': lang } : {}) } }, env)).json() as { error: string }).error;
  const english = await get();
  assert.equal(await get('de-DE,de;q=0.9'), translateStored('de', 'error', english));
  assert.notEqual(await get('de'), english);
  await db.prepare("INSERT INTO settings (key, value) VALUES ('language', 'de')").run();
  assert.equal(await get(), translateStored('de', 'error', english), "no header: the family's German");
  assert.equal(await get('en'), english);
});
