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
    { title: 'Spring fair', date: '2026-05-09', time: '10:00', end: '14:00', place: 'Lincoln Elementary' });
  // Markdown bold, a numeric date with a year, a range with one am/pm, Location for Place.
  assert.deepEqual(parseEventText('**Title:** Band concert\n**Date:** 5/21/2026\n**Time:** 6:30-8:30pm\n**Location:** 12 Elm St, Springfield', TODAY),
    { title: 'Band concert', date: '2026-05-21', time: '18:30', end: '20:30', place: '12 Elm St, Springfield' });
  // What a model writes when it can't tell: no time, no place.
  assert.deepEqual(parseEventText('Title: Picture day\nDate: 2026-04-14\nTime: unknown\nPlace: none', TODAY),
    { title: 'Picture day', date: '2026-04-14', time: null, end: null, place: null });
});

test('event text: a flyer read off a photo', () => {
  assert.deepEqual(parseEventText('SPRING FAIR\nSat May 9\n10am - 2pm\nLincoln Elementary School\nGames, food and fun for the whole family!', TODAY),
    { title: 'SPRING FAIR', date: '2026-05-09', time: '10:00', end: '14:00', place: 'Lincoln Elementary School' });
  assert.deepEqual(parseEventText("You're invited!\nMaya's 7th birthday party\nSunday, June 14th at 2:00 PM\nWhere: 45 Oak Ave\nRSVP to Alex 555-0100", TODAY),
    { title: "Maya's 7th birthday party", date: '2026-06-14', time: '14:00', end: null, place: '45 Oak Ave' });
  assert.deepEqual(parseEventText('Fall Book Fair\nOctober 3rd, 2026 from 11-2pm\nin the school library', TODAY),
    { title: 'Fall Book Fair', date: '2026-10-03', time: '11:00', end: '14:00', place: 'the school library' });
  assert.deepEqual(parseEventText('Soccer picnic 12 noon at Riverside Park, 6/6', TODAY),
    { title: 'Soccer picnic', date: '2026-06-06', time: '12:00', end: null, place: 'Riverside Park' });
});

test('event text: a date already past this year is next year; a weekday alone is the next one', () => {
  assert.equal(parseEventText('Winter concert Jan 5 7 p.m.', '2026-11-20').date, '2027-01-05');
  assert.equal(parseEventText('Winter concert Jan 5 7 p.m.', '2026-11-20').time, '19:00');
  assert.equal(parseEventText('Bake sale this Saturday 9am', '2026-03-04').date, '2026-03-07'); // a Wednesday
  assert.equal(parseEventText('Feb 30 party', TODAY).date, null, 'no such day');
});

test('event text: times without a date, AM/PM forms, 12 o\'clock', () => {
  assert.deepEqual(parseEventText('Pickup at 3:15 pm', TODAY), { title: 'Pickup', date: null, time: '15:15', end: null, place: null });
  assert.equal(parseEventText('Lunch 12 pm', TODAY).time, '12:00');
  assert.equal(parseEventText('Lock-in 12 a.m.', TODAY).time, '00:00');
  assert.equal(parseEventText('Open house 9 AM', TODAY).time, '09:00');
  assert.deepEqual(parseEventText('Title: Swim\nTime: 18:00 - 19:30', TODAY), { title: 'Swim', date: null, time: '18:00', end: '19:30', place: null });
  // A phone number, a price or a grade isn't a time.
  assert.deepEqual(parseEventText('Car wash\nCall 555-0100, $5 a car, grades 3-5', TODAY), { title: 'Car wash', date: null, time: null, end: null, place: null });
});
