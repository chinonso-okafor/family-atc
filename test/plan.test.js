import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIcs } from '../src/ics.js';
import { buildPlan, suggestions, wouldConflict } from '../src/plan.js';
import { planBriefing } from '../src/briefing.js';

const family = [
  { id: 'mom', name: 'Mom', role: 'adult' },
  { id: 'dad', name: 'Dad', role: 'adult' },
  { id: 'ada', name: 'Ada', role: 'kid' },
  { id: 'ben', name: 'Ben', role: 'kid' },
];
const rangeStart = new Date(2026, 9, 26);
const rangeEnd = new Date(2026, 10, 2);
const events = family.flatMap((p) => parseIcs(readFileSync(new URL(`../samples/${p.id}.ics`, import.meta.url), 'utf8'),
  { person: p.id, rangeStart, rangeEnd }));
const carpool = [{ name: 'The Garcias', note: 'swim' }];

test('a trip nobody can drive is an open slot that the carpool can fill', () => {
  const plan = buildPlan({ events, family, carpool, travelMin: 20 });
  const open = plan.alerts.filter((a) => a.kind === 'none');
  assert.equal(open.length, 3);
  const fixes = suggestions(plan, open[0]);
  assert.equal(fixes.length, 1);
  assert.match(fixes[0].label, /Ask The Garcias/);
});

test('applying a fix as an override clears that alert', () => {
  const first = buildPlan({ events, family, carpool, travelMin: 20 });
  const [fix] = suggestions(first, first.alerts.find((a) => a.kind === 'none'));
  const next = buildPlan({ events, family, carpool, travelMin: 20, overrides: { [fix.tripId]: fix.driver } });
  assert.equal(next.alerts.filter((a) => a.kind === 'none').length, 2);
});

test('handing a trip to a busy parent raises a driver-busy alert', () => {
  const first = buildPlan({ events, family, carpool, travelMin: 20 });
  const tue = first.trips.find((t) => t.start.getDay() === 2 && t.driver === 'dad');
  assert.ok(wouldConflict(first, tue, 'mom'));
  const next = buildPlan({ events, family, carpool, travelMin: 20, overrides: { [tue.id]: 'mom' } });
  const away = next.alerts.find((a) => a.kind === 'away');
  assert.equal(away.event.title, 'Client dinner');
});

test('the same driver on two overlapping trips is double-booked', () => {
  const at = (h, m = 0) => new Date(2026, 0, 5, h, m);
  const evs = [
    { id: 'a', person: 'ada', title: 'Soccer', location: 'Park', start: at(16, 30), end: at(18) },
    { id: 'b', person: 'ben', title: 'Swim', location: 'Pool', start: at(16, 30), end: at(17, 15) },
  ];
  const fam = [{ id: 'mom', name: 'Mom', role: 'adult' }, { id: 'dad', name: 'Dad', role: 'adult' },
    { id: 'ada', name: 'Ada', role: 'kid' }, { id: 'ben', name: 'Ben', role: 'kid' }];
  const first = buildPlan({ events: evs, family: fam, travelMin: 20 });
  assert.equal(first.alerts.length, 0);
  const [dropA, dropB] = first.trips.filter((t) => t.kind === 'dropoff');
  const next = buildPlan({ events: evs, family: fam, travelMin: 20, overrides: { [dropB.id]: dropA.driver } });
  const dbl = next.alerts.find((x) => x.kind === 'double');
  assert.ok(dbl);
  assert.ok(suggestions(next, dbl).length > 0); // the other parent is free
});

test('a handoff too short to make is reported and has no driver fix', () => {
  const plan = buildPlan({ events, family, carpool, travelMin: 20 });
  const late = plan.alerts.find((a) => a.kind === 'late');
  assert.ok(late);
  assert.equal(suggestions(plan, late).length, 0);
});

test('the briefing follows the live plan, overrides included', () => {
  const copy = (a) => ({ h: a.kind, p: '' });
  const fmt = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const plan = buildPlan({ events, family, carpool, travelMin: 20 });
  const text = planBriefing({ plan, weekStart: rangeStart, copy, suggestions, fmt });
  assert.match(text, /5 things to sort out/); // 3 open slots, a handoff too short to make, one tight turn on Thursday
  assert.match(text, /Try: Ask The Garcias/);
  assert.match(text, /Driving: /);
});
