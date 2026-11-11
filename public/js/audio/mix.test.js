import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cues, hullShare, mix } from './mix.js';

const log = (over = {}) => ({
  heading: 0,
  speed: 0,
  windFrom: 0,
  windSpeed: 0.9,
  relative: 1,
  sheet: 0.5,
  best: 0.5,
  trim: 1,
  engine: false,
  ...over,
});

test('before the first log there is a quiet sea and a light breeze, nothing else', () => {
  const l = mix({ near: null, notice: '', reading: false });
  assert.ok(l.sea > 0 && l.wind > 0);
  assert.equal(l.wash, 0);
  assert.equal(l.luff, 0);
  assert.equal(l.engine, 0);
  assert.equal(l.gulls, 0);
  assert.equal(l.duck, 1);
});

test('speed brings up the wash and brightens it', () => {
  const slow = mix({ log: log({ speed: 1 }) });
  const fast = mix({ log: log({ speed: 8 }) });
  assert.ok(fast.wash > slow.wash);
  assert.ok(fast.washTone > slow.washTone);
  assert.equal(mix({ log: log({ speed: 99 }) }).wash, 1);
});

test('wind strength drives wind, whistle and the sea', () => {
  const calm = mix({ log: log({ windSpeed: 0.55 }) });
  const gale = mix({ log: log({ windSpeed: 1.25 }) });
  assert.ok(gale.wind > calm.wind);
  assert.ok(gale.windTone > calm.windTone);
  assert.ok(gale.whistle > calm.whistle);
  assert.ok(gale.sea > calm.sea);
  assert.ok(gale.whistle <= 1 && calm.whistle >= 0);
});

test('a badly trimmed sail luffs, but not under engine', () => {
  assert.equal(mix({ log: log({ trim: 1 }) }).luff, 0);
  assert.ok(mix({ log: log({ trim: 0.2 }) }).luff > 0.4);
  assert.equal(mix({ log: log({ trim: 0.2, engine: true }) }).luff, 0);
  assert.equal(mix({ log: log({ engine: true }) }).engine, 1);
});

test('gulls near a port or near land', () => {
  assert.equal(mix({ log: log(), near: 'wittgenstein' }).gulls, 1);
  assert.equal(mix({ log: log({ land: 0.4 }) }).gulls, 0.4);
  assert.equal(mix({ log: log() }).gulls, 0);
});

test('a card or the chart ducks the sea', () => {
  assert.ok(mix({ log: log(), reading: true }).duck < 1);
  assert.ok(mix({ log: log(), chart: true }).duck < 1);
});

test('a worn hull creaks more', () => {
  assert.ok(mix({ log: log() }, { hull: 0.2 }).creak > mix({ log: log() }, { hull: 1 }).creak);
  assert.equal(hullShare(100), 1);
  assert.equal(hullShare(50), 0.5);
  assert.equal(hullShare(0.5), 0.5);
  assert.equal(hullShare(undefined), 1);
});

test('levels are always finite numbers, even from nonsense', () => {
  const l = mix({ log: log({ speed: NaN, windSpeed: Infinity, trim: -3 }) }, { hull: NaN });
  for (const [k, v] of Object.entries(l)) assert.ok(Number.isFinite(v), `${k} = ${v}`);
});

test('cues: a new port rings the bells; an old one a single bell', () => {
  const before = { passage: { near: null }, voyage: { found: ['a'] } };
  assert.deepEqual(cues(before, { passage: { near: 'b' }, voyage: { found: ['a', 'b'] } }), [
    'found',
  ]);
  assert.deepEqual(cues(before, { passage: { near: 'a' }, voyage: { found: ['a'] } }), ['arrive']);
  assert.deepEqual(cues(before, { passage: { near: 'c' }, voyage: { found: ['a'] } }), []);
});

test('cues: notices fire once, on the change', () => {
  const at = (notice) => ({ passage: { notice }, voyage: {} });
  assert.deepEqual(cues(at(''), at('aground')), ['aground']);
  assert.deepEqual(cues(at('aground'), at('aground')), []);
  assert.deepEqual(cues(at('aground'), at('wrecked')), ['wrecked']);
  assert.deepEqual(cues(at('wrecked'), at('repaired')), ['repaired']);
  assert.deepEqual(cues(at(''), at('edge')), ['edge']);
  assert.deepEqual(cues(at('edge'), at('')), []);
});
