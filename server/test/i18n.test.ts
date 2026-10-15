// server/src/i18n.ts: which language a request or a push gets, and the translators.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { familyLang, headerLang, translateStored, words } from '../src/i18n.ts';
import { loadSubs } from '../src/notify.ts';

test('headerLang: the first language Kinwall comes in, by q; else null', () => {
  assert.equal(headerLang('de'), 'de');
  assert.equal(headerLang('de-AT,en;q=0.5'), 'de');
  assert.equal(headerLang('fr-FR, en-US;q=0.8, de;q=0.9'), 'de');
  assert.equal(headerLang('fr, es'), null);
  assert.equal(headerLang('de;q=0, en'), 'en');
  assert.equal(headerLang(undefined), null);
});

test('words: English is the key and the fallback; counts and lists follow the language', () => {
  const en = words('en');
  assert.equal(en.t('Hi {name}', { name: 'Leo' }), 'Hi Leo');
  assert.equal(en.tn(1, '{n} chore left', '{n} chores left'), '1 chore left');
  assert.equal(en.tn(1200, '{n} point', '{n} points'), '1,200 points');
  assert.equal(en.list(['Leo', 'Maya', 'Sam']), 'Leo, Maya, and Sam');
  const de = words('de');
  assert.equal(de.t('Text nobody translated {x}', { x: 1 }), 'Text nobody translated 1', 'a missing entry shows the English');
  assert.equal(de.tn(1200, '{n} point', '{n} points').startsWith('1.200'), true, 'German thousands');
  assert.equal(de.list(['Leo', 'Maya', 'Sam']), 'Leo, Maya und Sam');
  assert.equal(translateStored('en', 'error', 'Only Leo can change this'), 'Only Leo can change this');
  assert.equal(translateStored('de', 'error', 'Nothing matches this at all, 42'), 'Nothing matches this at all, 42', 'unknown text stays as written');
});

test("familyLang and a push device's language: the owner's, else the family's", async () => {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  assert.equal(await familyLang(db), 'en');
  await db.prepare("INSERT INTO settings (key, value) VALUES ('language', 'de')").run();
  assert.equal(await familyLang(db), 'de');
  await db.prepare("INSERT INTO members (id, name, color, language, created_at) VALUES ('m1', 'Leo', '#e57', 'en', '2026-01-01'), ('m2', 'Maya', '#57e', NULL, '2026-01-01')").run();
  await db.prepare("INSERT INTO api_keys (id, name, hash, prefix, created_at, scope, owner) VALUES ('k1', 'leo', 'h1', 'p', '2026-01-01', 'display', 'm1'), ('k2', 'maya', 'h2', 'p', '2026-01-01', 'display', 'm2'), ('k3', 'wall', 'h3', 'p', '2026-01-01', 'display', 'shared')").run();
  const sub = (id: string, key: string) => db.prepare("INSERT INTO push_subscriptions (id, api_key_id, endpoint, p256dh, auth, device_name, member_ids, prefs, created_at) VALUES (?, ?, ?, 'p', 'a', 'd', '[]', '{}', '2026-01-01')").bind(id, key, `https://push.example/${id}`).run();
  await sub('s1', 'k1'); await sub('s2', 'k2'); await sub('s3', 'k3');
  const langs = Object.fromEntries((await loadSubs(db)).map((s) => [s.id, s.lang]));
  assert.deepEqual(langs, { s1: 'en', s2: 'de', s3: 'de' }, "Leo picked English; Maya and the wall follow the family's German");
});
