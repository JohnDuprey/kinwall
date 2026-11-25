import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChecks, tripClock } from '../src/travel-context.ts';

test('travel review: one traveler flying overnight does not cover lodging for the remaining family', () => {
  const trip = {
    startDate: '2027-07-10', endDate: '2027-07-12', memberIds: ['alex', 'maya'],
    stops: [], stayGroups: [], items: [],
    legs: [{ id: 'flight', mode: 'flight', booking: 'booked', memberIds: ['alex'], departDate: '2027-07-10', departTime: '23:00', departTz: 'America/New_York', arriveDate: '2027-07-11', arriveTime: '09:00', arriveTz: 'Europe/London' }],
  };
  const alone = planChecks(trip).filter(c => c.code === 'uncovered_nights');
  assert.equal(alone.reduce((n, c) => n + (c.count ?? 0), 0), 2);
  trip.legs[0].memberIds = ['alex', 'maya'];
  const together = planChecks(trip).filter(c => c.code === 'uncovered_nights');
  assert.equal(together.reduce((n, c) => n + (c.count ?? 0), 0), 1);
});

test('travel review: destination clock stays at the departure stop on the morning of a known evening flight', () => {
  const trip = {
    startDate: '2027-07-10', endDate: '2027-07-15',
    stops: [{ id: 'west', timezone: 'America/Los_Angeles', arriveDate: '2027-07-10', leaveDate: '2027-07-12' }],
    legs: [{ id: 'flight', mode: 'flight', booking: 'booked', memberIds: [], departDate: '2027-07-12', departTime: '18:00', departTz: 'America/Los_Angeles', arriveDate: '2027-07-13', arriveTime: '11:00', arriveTz: 'Europe/London' }],
  };
  const morning = tripClock(trip, new Date('2027-07-12T16:00:00Z'), 'America/New_York');
  assert.equal(morning.timeZone, 'America/Los_Angeles');
  assert.equal(morning.today, '2027-07-12');
  const afterArrival = tripClock(trip, new Date('2027-07-13T11:00:00Z'), 'America/New_York');
  assert.equal(afterArrival.timeZone, 'Europe/London');
});

test('travel review: a solo flight or rental booking does not set the whole family clock', () => {
  const trip = {
    startDate: '2027-07-10', endDate: '2027-07-15', memberIds: ['alex', 'sam'],
    stops: [{ id: 'harbor', timezone: 'America/Chicago', arriveDate: '2027-07-10', leaveDate: '2027-07-15' }],
    legs: [{ id: 'solo', mode: 'flight', booking: 'booked', memberIds: ['sam'], departDate: '2027-07-11', departTime: '08:30', departTz: 'America/New_York', arriveDate: '2027-07-11', arriveTime: '11:05', arriveTz: 'America/Denver' }],
  };
  assert.equal(tripClock(trip, new Date('2027-07-11T14:00Z'), 'UTC').timeZone, 'America/Chicago');
  trip.legs = [{ ...trip.legs[0], id: 'car', mode: 'rental', memberIds: [], departDate: '2027-07-10', arriveDate: '2027-07-15', arriveTz: 'America/New_York' }];
  assert.equal(tripClock(trip, new Date('2027-07-11T14:00Z'), 'UTC').timeZone, 'America/Chicago');
});

test('travel review: a rental-car possession window is not a travel-time overlap', () => {
  const trip = {
    startDate: '2027-07-10', endDate: '2027-07-15', memberIds: ['alex'], stops: [], stayGroups: [], items: [],
    legs: [
      { id: 'car', mode: 'rental', booking: 'booked', memberIds: ['alex'], departDate: '2027-07-10', departTime: '10:00', departTz: 'UTC', arriveDate: '2027-07-15', arriveTime: '15:00', arriveTz: 'UTC' },
      { id: 'drive', mode: 'drive', booking: 'none', memberIds: ['alex'], departDate: '2027-07-12', departTime: '10:00', departTz: 'UTC', arriveDate: '2027-07-12', arriveTime: '14:00', arriveTz: 'UTC' },
    ],
  };
  assert.ok(!planChecks(trip).some(c => c.code === 'travel_overlap'));
  trip.legs[0].arriveDate = '2027-07-09';
  assert.ok(planChecks(trip).some(c => c.code === 'travel_backwards' && c.ids.includes('car')));
});
