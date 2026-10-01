import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVCards } from '../src/contacts-domain.ts';

const lines = (...l: string[]) => l.join('\r\n') + '\r\n';
const pairs = (v: { label: string; value: string }[]) => v.map((x) => `${x.label}: ${x.value}`);

// As Apple Contacts shares a card: vCard 3.0, item groups with X-ABLabel, folded base64 PHOTO.
const APPLE = lines(
  'BEGIN:VCARD', 'VERSION:3.0', 'PRODID:-//Apple Inc.//iPhone OS 18.0//EN',
  'N:Alvarez;Rosa;María;;', 'FN:Rosa María Alvarez', 'NICKNAME:Grandma Rosa',
  'ORG:Sunrise Clinic;Pediatrics', 'TITLE:Nurse practitioner',
  'item1.TEL;type=CELL;type=VOICE;type=pref:(555) 010-2233', 'item1.X-ABLabel:_$!<Mobile>!$_',
  'TEL;type=HOME;type=VOICE:555-010-4455',
  'item2.TEL:555-010-9988', 'item2.X-ABLabel:Garden shed 🌻',
  'TEL;type=WORK;type=FAX:555-010-7766',
  'TEL;type=IPHONE;type=CELL;type=VOICE:555-010-1000',
  'item3.EMAIL;type=INTERNET;type=pref:rosa@example.com', 'item3.X-ABLabel:_$!<Home>!$_',
  'EMAIL;type=INTERNET;type=WORK:rosa.alvarez@clinic.example.org',
  'item4.ADR;type=HOME;type=pref:;;123 Maple Grove Rd\\nApt 4B;Springfield;OR;97477;United States', 'item4.X-ABADR:us',
  'ADR;type=WORK:;;500 Clinic Way;Eugene;OR;97401;',
  'item5.URL;type=pref:https\\://rosas-garden.example.com', 'item5.X-ABLabel:_$!<HomePage>!$_',
  'BDAY;VALUE=date:1952-03-14',
  'item6.X-ABDATE;type=pref:1975-06-21', 'item6.X-ABLabel:_$!<Anniversary>!$_',
  'NOTE:Loves tulips.\\nCall before 8pm\\, please.',
  'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD/9j/4AAQSkZJRgABAQAAAQABAAD/9j/4AAQSkZJRgABA',
  ' QAAAQABAAD/9j/4AAQSkZJRgABAQAAAQABAAD==',
  'CATEGORIES:Family,Grandparents',
  'END:VCARD',
);

test('vCard: an Apple Contacts card keeps every field with readable labels', () => {
  const [c] = parseVCards(APPLE);
  assert.equal(c.name, 'Rosa María Alvarez');
  assert.equal(c.givenName, 'Rosa');
  assert.equal(c.familyName, 'Alvarez');
  assert.equal(c.nickname, 'Grandma Rosa');
  assert.equal(c.organization, 'Sunrise Clinic, Pediatrics');
  assert.equal(c.title, 'Nurse practitioner');
  assert.equal(c.kind, 'person');
  assert.deepEqual(pairs(c.phones), ['Mobile: (555) 010-2233', 'Home: 555-010-4455', 'Garden shed 🌻: 555-010-9988', 'Work fax: 555-010-7766', 'iPhone: 555-010-1000']);
  assert.deepEqual(pairs(c.emails), ['Home: rosa@example.com', 'Work: rosa.alvarez@clinic.example.org']);
  assert.deepEqual(c.addresses, [
    { label: 'Home', street: '123 Maple Grove Rd\nApt 4B', city: 'Springfield', region: 'OR', postalCode: '97477', country: 'United States' },
    { label: 'Work', street: '500 Clinic Way', city: 'Eugene', region: 'OR', postalCode: '97401', country: '' },
  ]);
  assert.deepEqual(pairs(c.websites), ['Home page: https://rosas-garden.example.com']);
  assert.deepEqual(c.dates, [{ label: 'birthday', date: '1952-03-14' }, { label: 'anniversary', date: '1975-06-21' }]);
  assert.equal(c.notes, 'Loves tulips.\nCall before 8pm, please.');
  assert.deepEqual(c.tags, ['Family', 'Grandparents']);
});

test('vCard: a birthday without a year, and a business card with only a company', () => {
  const [jae, school] = parseVCards(lines(
    'BEGIN:VCARD', 'VERSION:3.0', 'N:Park;Jae;;;', 'FN:Jae Park', 'BDAY;X-APPLE-OMIT-YEAR=1604:1604-11-02', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'N:;;;;', 'FN:Maple Grove School', 'ORG:Maple Grove School;', 'X-ABShowAs:COMPANY',
    'item1.TEL;type=MAIN:555-010-5000', 'END:VCARD',
  ));
  assert.deepEqual(jae.dates, [{ label: 'birthday', date: '--11-02' }]);
  assert.equal(school.kind, 'organization');
  assert.equal(school.organization, 'Maple Grove School');
  assert.deepEqual(pairs(school.phones), ['Main: 555-010-5000']);
  // No FN at all: the company is the name.
  assert.equal(parseVCards(lines('BEGIN:VCARD', 'VERSION:3.0', 'N:;;;;', 'ORG:Corner Pharmacy', 'END:VCARD'))[0].name, 'Corner Pharmacy');
});

test('vCard: Android 2.1 with quoted-printable, bare types and a custom label', () => {
  const [z] = parseVCards(lines(
    'BEGIN:VCARD', 'VERSION:2.1',
    'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:L=C3=B3pez;Zo=C3=AB;;;',
    'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Zo=C3=AB L=C3=B3pez',
    'TEL;CELL;PREF:555-010-1212', 'TEL;HOME:555-010-3434',
    'TEL;X-CUSTOM(CHARSET=UTF-8,ENCODING=QUOTED-PRINTABLE,Soccer coach):555-010-5656',
    'EMAIL;HOME:zoe@example.com',
    'ADR;HOME;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;;12 Elm St=0A=', 'Unit 3;Springfield;OR;97477;US',
    'NOTE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Carpool on Tuesdays =F0=9F=9A=97',
    'BDAY:1990-07-04',
    'PHOTO;ENCODING=BASE64;JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD', ' /9j/4AAQSkZJRgABAQAAAQABAAD', '',
    'END:VCARD',
  ));
  assert.equal(z.name, 'Zoë López');
  assert.equal(z.givenName, 'Zoë');
  assert.deepEqual(pairs(z.phones), ['Mobile: 555-010-1212', 'Home: 555-010-3434', 'Soccer coach: 555-010-5656']);
  assert.deepEqual(pairs(z.emails), ['Home: zoe@example.com']);
  assert.equal(z.addresses[0].street, '12 Elm St\nUnit 3');
  assert.equal(z.notes, 'Carpool on Tuesdays 🚗');
  assert.deepEqual(z.dates, [{ label: 'birthday', date: '1990-07-04' }]);
});

test('vCard: 4.0 tel: URIs, quoted type lists and basic dates', () => {
  const [s] = parseVCards(lines(
    'BEGIN:VCARD', 'VERSION:4.0', 'FN:Sam Okafor', 'N:Okafor;Sam;;;',
    'TEL;VALUE=uri;TYPE="voice,cell";PREF=1:tel:+1-555-010-7878',
    'TEL;VALUE=uri;TYPE="work,voice":tel:+1-555-010-8989;ext=12',
    'EMAIL;TYPE=work:sam@work.example.com', 'BDAY:--0412', 'ANNIVERSARY:20100815T000000Z', 'KIND:individual',
    'END:VCARD',
  ));
  assert.deepEqual(pairs(s.phones), ['Mobile: +1-555-010-7878', 'Work: +1-555-010-8989 ext. 12']);
  assert.deepEqual(s.dates, [{ label: 'birthday', date: '--04-12' }, { label: 'anniversary', date: '2010-08-15' }]);
  assert.equal(parseVCards(lines('BEGIN:VCARD', 'VERSION:4.0', 'FN:Town Library', 'KIND:location', 'END:VCARD'))[0].kind, 'place');
});

test('vCard: an oversized or empty value is trimmed or skipped, not a failed import', () => {
  const [c] = parseVCards(lines(
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Leo', 'TEL:', `item1.TEL:555-010-4242`, `item1.X-ABLabel:${'x'.repeat(80)}`,
    `NOTE:${'n'.repeat(12_000)}`, 'BDAY:sometime', 'END:VCARD',
  ));
  assert.equal(c.phones.length, 1);
  assert.equal(c.phones[0].label.length, 50);
  assert.equal(c.notes?.length, 10_000);
  assert.deepEqual(c.dates, []);
});
