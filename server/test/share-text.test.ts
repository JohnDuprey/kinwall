// What the "Add to Kinwall" Shortcut sends as text (POST /api/share): ISBNs, a book's title and
// author, and an event off a flyer or invite (OCR text or the Shortcut's Use Model answer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookQuery, findIsbn, parseEventText } from '../src/share-text.ts';

test('findIsbn: ISBN-13 and ISBN-10 with or without dashes; a bad check digit or a phone number is none', () => {
  assert.equal(findIsbn('9780547928227'), '9780547928227');
  assert.equal(findIsbn('ISBN 978-0-547-92822-7\n$14.99'), '9780547928227');
  assert.equal(findIsbn('ISBN-10: 0-547-92822-X'), '9780547928227', 'an X check digit');
  assert.equal(findIsbn('ISBN-10: 0-547-92822-5'), null, 'wrong check digit');
  assert.equal(findIsbn('ISBN 0-306-40615-2'), '9780306406157', 'ISBN-10 becomes ISBN-13');
  assert.equal(findIsbn('080442957X'), '9780804429573');
  assert.equal(findIsbn('Call 555-0100 or 555 867 5309'), null);
  assert.equal(findIsbn('9780547928228'), null, 'wrong check digit');
  assert.equal(findIsbn('Wool by Hugh Howey'), null);
});

test('bookQuery: Title/Author lines, "X by Y", or a cover\'s first line with a "by" line under it', () => {
  assert.deepEqual(bookQuery('Title: Wool\nAuthor: Hugh Howey'), { title: 'Wool', author: 'Hugh Howey' });
  assert.deepEqual(bookQuery('**Title:** The Hobbit\n**Author:** unknown'), { title: 'The Hobbit', author: null });
  assert.deepEqual(bookQuery('Wool by Hugh Howey'), { title: 'Wool', author: 'Hugh Howey' });
  assert.deepEqual(bookQuery('NEW YORK TIMES BESTSELLER\nWOOL\nby Hugh Howey'), { title: 'WOOL', author: 'Hugh Howey' });
  assert.deepEqual(bookQuery('Holes'), { title: 'Holes', author: null });
  assert.deepEqual(bookQuery('  \n '), { title: null, author: null });
});

const TODAY = '2026-03-01';

test('event text: the suggested Title/Date/Time/Place lines', () => {
  assert.deepEqual(parseEventText('Title: Spring fair\nDate: Saturday, May 9\nTime: 10 AM - 2 PM\nPlace: Lincoln Elementary', TODAY),
    { title: 'Spring fair', date: '2026-05-09', time: '10:00', end: '14:00', place: 'Lincoln Elementary', notes: null });
  // Markdown bold, a numeric date with a year, a range with one am/pm, Location for Place.
  assert.deepEqual(parseEventText('**Title:** Band concert\n**Date:** 5/21/2026\n**Time:** 6:30-8:30pm\n**Location:** 12 Elm St, Springfield', TODAY),
    { title: 'Band concert', date: '2026-05-21', time: '18:30', end: '20:30', place: '12 Elm St, Springfield', notes: null });
  // What a model writes when it can't tell: no time, no place.
  assert.deepEqual(parseEventText('Title: Picture day\nDate: 2026-04-14\nTime: unknown\nPlace: none', TODAY),
    { title: 'Picture day', date: '2026-04-14', time: null, end: null, place: null, notes: null });
});

test('event text: a flyer read off a photo', () => {
  assert.deepEqual(parseEventText('SPRING FAIR\nSat May 9\n10am - 2pm\nLincoln Elementary School\nGames, food and fun for the whole family!', TODAY),
    { title: 'Spring Fair', date: '2026-05-09', time: '10:00', end: '14:00', place: 'Lincoln Elementary School', notes: 'Games, food and fun for the whole family!' });
  assert.deepEqual(parseEventText("You're invited!\nMaya's 7th birthday party\nSunday, June 14th at 2:00 PM\nWhere: 45 Oak Ave\nRSVP to Alex 555-0100", TODAY),
    { title: "Maya's 7th birthday party", date: '2026-06-14', time: '14:00', end: null, place: '45 Oak Ave', notes: 'RSVP to Alex 555-0100' });
  assert.deepEqual(parseEventText('Fall Book Fair\nOctober 3rd, 2026 from 11-2pm\nin the school library', TODAY),
    { title: 'Fall Book Fair', date: '2026-10-03', time: '11:00', end: '14:00', place: 'the school library', notes: null });
  assert.deepEqual(parseEventText('Soccer picnic 12 noon at Riverside Park, 6/6', TODAY),
    { title: 'Soccer picnic', date: '2026-06-06', time: '12:00', end: null, place: 'Riverside Park', notes: null });
});

test('event text: a date already past this year is next year; a weekday alone is the next one', () => {
  assert.equal(parseEventText('Winter concert Jan 5 7 p.m.', '2026-11-20').date, '2027-01-05');
  assert.equal(parseEventText('Winter concert Jan 5 7 p.m.', '2026-11-20').time, '19:00');
  assert.equal(parseEventText('Bake sale this Saturday 9am', '2026-03-04').date, '2026-03-07'); // a Wednesday
  assert.equal(parseEventText('Feb 30 party', TODAY).date, null, 'no such day');
});

test('event text: times without a date, AM/PM forms, 12 o\'clock', () => {
  assert.deepEqual(parseEventText('Pickup at 3:15 pm', TODAY), { title: 'Pickup', date: null, time: '15:15', end: null, place: null, notes: null });
  assert.equal(parseEventText('Lunch 12 pm', TODAY).time, '12:00');
  assert.equal(parseEventText('Lock-in 12 a.m.', TODAY).time, '00:00');
  assert.equal(parseEventText('Open house 9 AM', TODAY).time, '09:00');
  assert.deepEqual(parseEventText('Title: Swim\nTime: 18:00 - 19:30', TODAY), { title: 'Swim', date: null, time: '18:00', end: '19:30', place: null, notes: null });
  // A phone number, a price or a grade isn't a time.
  assert.deepEqual(parseEventText('Car wash\nCall 555-0100, $5 a car, grades 3-5', TODAY), { title: 'Car wash', date: null, time: null, end: null, place: null, notes: 'Call 555-0100, $5 a car, grades 3-5' });
});

test('event text: a party invite read off a photo, decoration and all', () => {
  // A photo's text comes out in reading order: the decorative ring first ("IN MY BIRTHDAY ERA"),
  // then the real name of the party, then the place over two lines, then the RSVP.
  const invite = 'I\nN\nMY BIRTHDAY\nMaya Rivers\nis turning\n6\nERA\njoin us to celebrate\nMAYA\'S 6th BIRTHDAY\n' +
    'Join us for the bounce house, pizza, & s\'mores!\nSaturday, October 17th 3:00 - 5:00pm\nat The Rivers Residence\n12 Elm Road, Springfield\n' +
    'RSVP to Sam by 10/10\n555-0100'
  assert.deepEqual(parseEventText(invite, '2026-10-07'),
    { title: "Maya's 6th Birthday", date: '2026-10-17', time: '15:00', end: '17:00', place: 'The Rivers Residence, 12 Elm Road, Springfield',
      notes: "Join us for the bounce house, pizza, & s'mores!\nRSVP to Sam by 10/10 · 555-0100" });
});

test("event text: the model's Place with no street takes the street from the photo's text under ---", () => {
  // The phone sends the model's lines, a --- line, then the words as the photo read them.
  const raw = "MAYA'S 6th BIRTHDAY\nSaturday, October 17th 3:00 - 5:00pm\nat The Rivers Residence\n12 Elm Road, Springfield\nRSVP to Sam by 10/10";
  const model = "Title: Maya's 6th Birthday\nDate: Saturday, October 17, 2026\nTime: 3:00 PM - 5:00 PM\nPlace: The Rivers Residence";
  assert.deepEqual(parseEventText(`${model}\n---\n${raw}`, '2026-10-07'),
    { title: "Maya's 6th Birthday", date: '2026-10-17', time: '15:00', end: '17:00', place: 'The Rivers Residence, 12 Elm Road, Springfield', notes: 'RSVP to Sam by 10/10' });
  // A Place that has its street keeps it as it is.
  assert.equal(parseEventText(`Title: Swim meet\nPlace: Oak Pool, 9 Lake Ave\n---\nSwim meet\n40 Main Street, Springfield`, TODAY).place, 'Oak Pool, 9 Lake Ave');
  // The street line already names the venue: it is the place.
  assert.equal(parseEventText(`Title: Bake sale\nPlace: Grace Church\n---\nBake sale\nGrace Church, 3 Hill Rd, Springfield`, TODAY).place, 'Grace Church, 3 Hill Rd, Springfield');
  // No street anywhere: the Place line alone. An RSVP line's address isn't the place.
  assert.equal(parseEventText(`Title: Picnic\nPlace: Riverside Park\n---\nPicnic at Riverside Park\nRSVP to 12 Elm Road`, TODAY).place, 'Riverside Park');
  // The model's own lines win over the photo's: its Title and Time, not the photo's.
  assert.deepEqual(parseEventText(`Title: Book fair\nTime: 9 AM\n---\nTime: 10am\nFall Fair`, TODAY), { title: 'Book fair', date: null, time: '09:00', end: null, place: null, notes: null });
});

// The made-up invite as the Android tablet sent it: ML Kit's header lines (a time it read without the
// pm, a bare street), then the words as read.
const INVITE = "join us to celebrate\nMAYA'S 6th BIRTHDAY\nBounce house, pizza & s'mores!\nSaturday, October 24th 3:00 - 5:00pm\nat The Rivers Residence\n12 Elm Road, Springfield\nRSVP to Sam by 10/20\n555-0100";

test("event text: a header time with no pm or no end gives way to the words' fuller range for the same start", () => {
  for (const time of ['3:00', '3:00 AM', '3:00 AM - 3:00 PM']) {
    const e = parseEventText(`Date: October 24\nTime: ${time}\nPlace: 12 Elm Road, Springfield\n---\n${INVITE}`, '2026-10-07');
    assert.deepEqual([e.date, e.time, e.end], ['2026-10-24', '15:00', '17:00'], time);
  }
  // Without the --- line too (the lines, a blank line, then the words).
  assert.deepEqual(['time', 'end'].map((k) => parseEventText(`Date: October 24\nTime: 3:00 AM\n\n${INVITE}`, '2026-10-07')[k as 'time']), ['15:00', '17:00']);
  // A full header range stays; so does a header for another start than the words'.
  assert.deepEqual(['time', 'end'].map((k) => parseEventText(`Time: 3:00 PM - 4:30 PM\n---\n${INVITE}`, '2026-10-07')[k as 'time']), ['15:00', '16:30']);
  assert.equal(parseEventText(`Time: 9 AM\n---\nDoors 10am - noon`, '2026-10-07').time, '09:00');
  // Words with no am/pm don't override the header.
  assert.equal(parseEventText(`Time: 3:00 PM\n---\nParty 3:00 - 5:00`, '2026-10-07').time, '15:00');
});

test('event text: a bare street Place takes the "at" venue line right above it in the words', () => {
  const e = parseEventText(`Title: Maya's 6th Birthday\nPlace: 12 Elm Road, Springfield\n---\n${INVITE}`, '2026-10-07');
  assert.equal(e.place, 'The Rivers Residence, 12 Elm Road, Springfield');
  assert.equal(parseEventText(`Place: 12 Elm Road\n\n${INVITE}`, '2026-10-07').place, 'The Rivers Residence, 12 Elm Road');
  // No venue line right above the street: the street alone.
  assert.equal(parseEventText('Place: 9 Lake Ave\n---\nSwim meet\nat noon\nOak Pool\n9 Lake Ave', '2026-10-07').place, '9 Lake Ave');
});

test('event text: the rest worth knowing goes in notes', () => {
  assert.deepEqual(parseEventText(INVITE, '2026-10-07'), {
    title: "Maya's 6th Birthday", date: '2026-10-24', time: '15:00', end: '17:00', place: 'The Rivers Residence, 12 Elm Road, Springfield',
    notes: "Bounce house, pizza & s'mores!\nRSVP to Sam by 10/20 · 555-0100",
  });
  // What to bring or wear, costs and links stay; decoration doesn't.
  const flyer = "You're invited!\nI\nN\n6\nLeo's pool party\nSunday, June 14th at 2:00 PM\nat Oak Pool\nBring a towel\nWear sunscreen\n$5 a swimmer\nhttps://leo.example/rsvp\nFun";
  assert.equal(parseEventText(flyer, TODAY).notes, 'Bring a towel\nWear sunscreen\n$5 a swimmer\nhttps://leo.example/rsvp');
  // The model's Notes line, plus an RSVP or phone line it dropped from the words.
  assert.equal(parseEventText(`Title: Maya's 6th Birthday\nNotes: Bounce house and pizza\n---\n${INVITE}`, '2026-10-07').notes, 'Bounce house and pizza\nRSVP to Sam by 10/20 · 555-0100');
  assert.equal(parseEventText(`Title: Swim\nDetails: RSVP to Sam by 10/20, 555-0100\n---\n${INVITE}`, '2026-10-07').notes, 'RSVP to Sam by 10/20, 555-0100', 'already there');
  assert.equal(parseEventText(`Title: Swim\nNotes: none\n---\nSwim\nCall 555-0100`, TODAY).notes, 'Call 555-0100');
  // Kept short: a line at most 200 characters, 1,000 in all.
  const long = parseEventText(`Party\n${Array.from({ length: 12 }, (_, i) => `Bring item number ${i} ${'x'.repeat(300)}`).join('\n')}`, TODAY).notes!;
  assert.ok(long.length <= 1000 && long.split('\n').every((l) => l.length <= 200), String(long.length));
});
