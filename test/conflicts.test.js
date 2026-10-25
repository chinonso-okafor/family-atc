import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIcs } from '../src/ics.js';
import { detectConflicts, buildRideLegs } from '../src/conflicts.js';
import { makeTravelTime, haversineKm } from '../src/travel.js';
import { calendarGaps } from '../src/briefing.js';

const family = [
  { id: 'mom', name: 'Mom', role: 'adult' },
  { id: 'dad', name: 'Dad', role: 'adult' },
  { id: 'ada', name: 'Ada', role: 'kid' },
  { id: 'ben', name: 'Ben', role: 'kid' },
];
const rangeStart = new Date(2026, 9, 26); // Mon Oct 26 2026, local time
const rangeEnd = new Date(2026, 10, 2);
const load = (id) => parseIcs(readFileSync(new URL(`../samples/${id}.ics`, import.meta.url), 'utf8'),
  { person: id, rangeStart, rangeEnd });
const events = family.flatMap((p) => load(p.id));
const hm = (d) => `${d.getDay()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

test('expands recurrences, moved instances and all-day events', () => {
  const ada = events.filter((e) => e.person === 'ada');
  const soccer = ada.filter((e) => e.title.startsWith('Soccer practice')).map((e) => hm(e.start));
  assert.deepEqual(soccer, ['2 16:30', '4 17:00']); // Thursday was moved to 5pm
  assert.ok(ada.find((e) => e.title === 'Halloween').allDay);
  assert.equal(events.filter((e) => e.person === 'mom' && e.title === 'Work').length, 5);
  assert.ok(events.find((e) => e.title.startsWith('Lunch')).free);
});

test('handoff between two of one kid\'s activities becomes a single leg', () => {
  const legs = buildRideLegs(events, ['ada'], 20).filter((l) => l.start.getDay() === 3);
  assert.deepEqual(legs.map((l) => l.kind), ['dropoff', 'handoff', 'pickup']);
  assert.equal(legs[1].from, 'Harmony Music Studio');
  assert.equal(legs[1].to, 'Lincoln Library');
});

test('finds the sample week\'s three driver conflicts', () => {
  const { conflicts } = detectConflicts(events, family);
  const summary = conflicts.map((c) => `${c.type} ${c.leg?.kind} ${hm(c.start)}`);
  assert.deepEqual(summary, [
    'no-driver dropoff 2 16:10', // Tue: soccer + swim drop-offs, one free adult
    'no-driver dropoff 3 15:40', // Wed: Mom at dentist, Dad at work
    'tight-handoff handoff 3 16:45', // Wed: piano ends 4:45, robotics starts 5:00, 20 min away
    'no-driver dropoff 6 08:40', // Sat: Mom at yoga, Dad golfing
  ]);
  // Tuesday: two drop-offs at once (soccer + swim), Dad is the only free adult
  const tue = conflicts[0];
  assert.equal(tue.drivingElsewhere[0].adult, 'dad');
  assert.equal(tue.busy[0].event.title, 'Client dinner');
});

test('siblings to the same place share a car', () => {
  const evs = [
    { id: 'a', person: 'ada', location: 'Pool', start: new Date(2026, 0, 1, 16), end: new Date(2026, 0, 1, 17) },
    { id: 'b', person: 'ben', location: 'pool ', start: new Date(2026, 0, 1, 16), end: new Date(2026, 0, 1, 17) },
  ];
  const legs = buildRideLegs(evs, ['ada', 'ben'], 20);
  assert.equal(legs.length, 2);
  assert.deepEqual(legs[0].kids, ['ada', 'ben']);
});

test('a kid in two places at once is flagged', () => {
  const evs = [
    { id: 'a', person: 'ben', location: 'X', start: new Date(2026, 0, 1, 16), end: new Date(2026, 0, 1, 17) },
    { id: 'b', person: 'ben', location: 'Y', start: new Date(2026, 0, 1, 16, 30), end: new Date(2026, 0, 1, 18) },
  ];
  const { conflicts } = detectConflicts(evs, [{ id: 'mom', role: 'adult' }, { id: 'ben', role: 'kid' }]);
  assert.equal(conflicts[0].type, 'double-booked');
});

test('travel time uses coordinates when known, flat buffer otherwise', () => {
  const places = { a: { lat: 40.0, lng: -75.0 }, b: { lat: 40.05, lng: -75.0 } };
  const t = makeTravelTime({ places, fallbackMin: 20 });
  assert.ok(Math.abs(haversineKm(places.a, places.b) - 5.56) < 0.05);
  assert.equal(t('a', 'b'), 20); // ~7.8 km road at 35 km/h + 5 min overhead -> 18.4 -> 20
  assert.equal(t('a', 'unknown'), 20);
  assert.equal(t('a', 'a'), 5);
});

test('a short real drive turns a tight handoff into a clean one', () => {
  const places = { 'harmony music studio': { lat: 40, lng: -75 }, 'lincoln library': { lat: 40.003, lng: -75 } };
  const t = makeTravelTime({ places, fallbackMin: 20 });
  const { conflicts } = detectConflicts(events, family, { travelMin: t });
  assert.ok(!conflicts.some((c) => c.type === 'tight-handoff'));
});

test('calendar gaps are called out', () => {
  const gaps = calendarGaps(events.filter((e) => e.person !== 'ben'), family);
  assert.ok(gaps.some((g) => g.startsWith('Ben has no events')));
  const noLoc = [{ person: 'ada', title: 'Tutor', location: '', start: new Date(), end: new Date() }];
  assert.ok(calendarGaps(noLoc, [{ id: 'ada', name: 'Ada', role: 'kid' }])[0].includes('no location'));
});

