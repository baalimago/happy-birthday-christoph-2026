import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeather, seeded } from './weather.js';

/** Run the weather for `seconds` at 4 steps a second. */
function run(seconds, input, seed = 1) {
  const w = createWeather(seeded(seed));
  const frames = [];
  const events = [];
  for (let i = 0; i < seconds * 4; i++) {
    const f = w.step(0.25, input);
    frames.push(f);
    for (const e of f.events) events.push({ ...e, time: i * 0.25 + e.at });
  }
  return { frames, events };
}

const calm = { wind: 0.2, speed: 0, land: 0 };
const breeze = { wind: 0.7, speed: 0.6, land: 0 };

test('every value stays in range', () => {
  const { frames, events } = run(600, breeze);
  for (const f of frames) {
    for (const k of ['gust', 'sea', 'swell']) assert.ok(f[k] >= 0 && f[k] <= 1, `${k} ${f[k]}`);
  }
  for (const e of events) {
    assert.ok(e.size >= 0 && e.size <= 1);
    assert.ok(e.pan >= -1 && e.pan <= 1);
    assert.ok(e.at >= 0 && e.at <= 0.25 + 1e-9, `at ${e.at}`);
  }
});

test('waves come one by one, unevenly, in different sizes', () => {
  const waves = run(600, breeze).events.filter((e) => e.kind === 'wave');
  assert.ok(waves.length > 50 && waves.length < 200, `${waves.length} waves in 10 minutes`);
  const gaps = waves.slice(1).map((w, i) => w.time - waves[i].time);
  const distinctGaps = new Set(gaps.map((g) => g.toFixed(1)));
  assert.ok(distinctGaps.size > 15, 'gaps vary');
  const sizes = waves.map((w) => w.size);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) > 0.3, 'sizes vary');
});

test('sets of bigger waves come and go', () => {
  const swells = run(900, breeze).frames.map((f) => f.swell);
  assert.ok(Math.max(...swells) > 0.8, 'a set arrives');
  assert.ok(Math.min(...swells.slice(40)) < 0.65, 'and a lull follows');
});

test('the sea builds with the wind, slowly', () => {
  const w = createWeather(seeded(3));
  let f = w.step(0.25, calm);
  const low = f.sea;
  f = w.step(0.25, { ...calm, wind: 1 });
  assert.ok(f.sea - low < 0.05, 'not at once');
  for (let i = 0; i < 4 * 180; i++) f = w.step(0.25, { ...calm, wind: 1 });
  assert.ok(f.sea > low + 0.4, 'but within a few minutes');
});

test('the game can report sea and gust itself', () => {
  const f = createWeather(seeded(4)).step(0.25, { ...breeze, sea: 0.9, gust: 0.8 });
  assert.equal(f.sea, 0.9);
  assert.ok(f.gust >= 0.8);
});

test('gusts wander: not stuck, not periodic', () => {
  const gusts = run(300, breeze).frames.map((f) => f.gust);
  assert.ok(Math.max(...gusts) - Math.min(...gusts) > 0.3);
});

test('slaps only underway, surf only near land', () => {
  assert.equal(run(120, calm).events.filter((e) => e.kind === 'slap').length, 0);
  assert.ok(run(120, breeze).events.filter((e) => e.kind === 'slap').length > 10);
  assert.equal(run(120, breeze).events.filter((e) => e.kind === 'surf').length, 0);
  assert.ok(run(120, { ...breeze, land: 0.9 }).events.filter((e) => e.kind === 'surf').length > 5);
});
