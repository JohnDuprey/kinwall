// A contact's phones come back with originalValue and normalizedValue. Sending a phone back with a
// new value (the way an API client or an assistant edits one: read the contact, change the number,
// send the phones) saves the new number, never the one it replaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const ADMIN = 'kw_contacts_admin';
function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  return async (url: string, method = 'GET', body?: unknown) => {
    const res = await app.request(url, { method, headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
}

test('contacts: changing a phone number sent back with its originalValue saves the new number', async () => {
  const req = setup();
  const created = await req('/api/contacts', 'POST', { kind: 'service', name: 'Dr. Sam (dentist)', phones: [{ label: 'Office', value: '+1 555 010 0100' }] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const [phone] = created.body.phones;
  assert.equal(phone.originalValue, '+1 555 010 0100');
  const patched = await req(`/api/contacts/${created.body.id}`, 'PATCH', { phones: [{ ...phone, value: '+1 555 010 0199' }] });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(patched.body.phones[0].value, '+1 555 010 0199');
  assert.equal(patched.body.phones[0].normalizedValue, '+15550100199');
  const read = await req(`/api/contacts/${created.body.id}`);
  assert.equal(read.body.phones[0].value, '+1 555 010 0199', 'the new number is what was saved');
});
