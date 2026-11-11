import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KRAKEN_BITE, KRAKEN_SPEED, SLOTS, createFauna } from './fauna.js';

/** Open sea everywhere. */
const sea = () => true;
const DT = 1 / 30;

/**
 * Sail a straight line north at a steady speed for a while.
 * @param {ReturnType<typeof createFauna>} fauna
 * @param {number} seconds @param {number} speed
 * @param {(x: number, z: number) => boolean} [water]
 */
function cruise(fauna, seconds, speed, water = sea) {
  const boat = { x: 0, z: 0, heading: 0, speed };
  /** @type {string[]} */
  const seen = [];
  let hull = 0;
  for (let s = 0; s < seconds; s += DT) {
    boat.z += speed * DT;
    const { sightings, strike } = fauna.step(boat, DT, water);
    seen.push(...sightings);
    hull += strike;
    assert.ok(fauna.beasts.length <= SLOTS, 'never more creatures than the shader has room for');
  }
  return { boat, seen, hull };
}

test('a long passage meets dolphins, whales and flying fish, and keeps them near the boat', () => {
  const fauna = createFauna(7);
  const { boat, seen } = cruise(fauna, 900, 5);
  for (const kind of ['dolphin-leap', 'whale-blow', 'flyingfish']) {
    assert.ok(seen.includes(kind), `saw ${kind}`);
  }
  for (const beast of fauna.beasts) {
    assert.ok(Math.hypot(beast.x - boat.x, beast.z - boat.z) < 180);
    assert.ok(Number.isFinite(beast.y) && Number.isFinite(beast.pitch));
  }
});

test('gulls come near land, and cry', () => {
  const fauna = createFauna(3);
  // Land 100 units east of the course.
  const { seen } = cruise(fauna, 300, 3, (x) => x < 100);
  assert.ok(seen.includes('gull-cry'));
});

test('nothing moves while hove to', () => {
  const fauna = createFauna(5);
  cruise(fauna, 120, 4);
  const before = JSON.stringify(fauna.beasts);
  fauna.step({ x: 0, z: 480, heading: 0, speed: 4 }, 0, sea);
  assert.equal(JSON.stringify(fauna.beasts), before);
});

test('a slow boat is caught by the kraken and loses some hull', () => {
  const fauna = createFauna(11);
  const boat = { x: 0, z: 0, heading: 0, speed: 3 };
  assert.ok(fauna.summonKraken(boat, sea));
  assert.ok(!fauna.summonKraken(boat, sea), 'only one at a time');
  /** @type {string[]} */
  const seen = [];
  let hull = 0;
  for (let s = 0; s < 60 && fauna.kraken; s += DT) {
    boat.z += boat.speed * DT;
    const { sightings, strike } = fauna.step(boat, DT, sea);
    seen.push(...sightings);
    hull += strike;
  }
  assert.ok(seen.includes('kraken-strike'));
  assert.equal(hull, KRAKEN_BITE, 'it strikes once');
  assert.equal(fauna.kraken, null, 'and sinks away again');
});

test('a fast boat outruns the kraken', () => {
  const fauna = createFauna(13);
  const boat = { x: 0, z: 0, heading: 0, speed: KRAKEN_SPEED + 1.5 };
  fauna.summonKraken(boat, sea);
  /** @type {string[]} */
  const seen = [];
  for (let s = 0; s < 90 && fauna.kraken; s += DT) {
    boat.z += boat.speed * DT;
    seen.push(...fauna.step(boat, DT, sea).sightings);
  }
  assert.ok(!seen.includes('kraken-strike'));
  assert.ok(seen.includes('kraken-gone'));
});

test('the kraken is very rare: seldom more than once in an hour of open-water sailing', () => {
  let risen = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const { seen } = cruise(createFauna(seed * 101), 3600, 6.5);
    risen += seen.filter((s) => s === 'kraken-rise').length;
  }
  assert.ok(risen <= 18, `rose ${risen} times in six hours`);
});

test('no kraken in the first minutes of a voyage', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { seen } = cruise(createFauna(seed), 200, 6);
    assert.ok(!seen.includes('kraken-rise'));
  }
});
