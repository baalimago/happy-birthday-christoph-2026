import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EDGE, START } from './chart-data.js';
import { ENGINE_SPEED, MAX_SPEED, bearingTo, damageFor, newBoat, sail, windAt } from './sailing.js';
import { getTerrain, isWater } from './terrain.js';

/**
 * @typedef {import('./sailing.js').Boat} Boat
 * @typedef {import('./sailing.js').Helm} Helm
 * @typedef {import('./sailing.js').Wind} Wind
 * @typedef {import('./sailing.js').Outcome} Outcome
 * @typedef {import('./terrain.js').Terrain} Terrain
 */

const DEG = Math.PI / 180;
const DT = 0.05;
const terrain = getTerrain();
/** Open water well clear of everything, for the tests that only care about the wind. */
const OPEN = { x: -700, z: -300, heading: 0 };

/** A sea with no land at all, for the estimate of the length of the game. @type {Terrain} */
const emptySea = {
  n: 2,
  extent: 2400,
  heights: new Float32Array(4).fill(-5),
  forest: new Float32Array(4),
  ports: [],
  cave: { ax: 9e6, az: 9e6, bx: 9e6 + 1, bz: 9e6, radius: 1, hall: 1, roof: 1 },
  volcano: { x: 0, z: 0, radius: 0, height: 0, crater: 0 },
};

/** @param {Partial<Helm>} [orders] @returns {Helm} */
function helm(orders = {}) {
  return { left: false, right: false, out: false, in: false, engine: false, ...orders };
}

/** @param {number} angle */
function wrap(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/**
 * Sail for a while with fixed orders, keeping the sheet at its best when asked.
 * @param {Boat} boat @param {Helm} orders @param {Wind} wind @param {number} seconds
 * @param {{ trimmed?: boolean, sea?: Terrain }} [options]
 * @returns {Outcome}
 */
function run(boat, orders, wind, seconds, { trimmed = false, sea = terrain } = {}) {
  let outcome = sail(boat, orders, wind, 0, sea);
  for (let t = 0; t < seconds; t += DT) {
    if (trimmed) boat.sheet = outcome.best;
    outcome = sail(boat, orders, wind, DT, sea);
  }
  return outcome;
}

test('the wind never jumps, and stays within its range', () => {
  let last = windAt(0);
  let low = Infinity;
  let high = -Infinity;
  let widest = 0;
  let lightest = Infinity;
  let gustiest = 0;
  let calmest = Infinity;
  let roughest = 0;
  for (let t = 0.5; t <= 7200; t += 0.5) {
    const wind = windAt(t);
    assert.ok(wind.from >= 0 && wind.from < Math.PI * 2, `bearing ${wind.from} at ${t}`);
    assert.ok(wind.speed >= 0.35 && wind.speed <= 1.6, `speed ${wind.speed} at ${t}`);
    const veer = Math.abs(wrap(wind.from - last.from));
    assert.ok(veer < 2 * DEG, `the wind swung ${veer / DEG} degrees in half a second at ${t}`);
    assert.ok(Math.abs(wind.speed - last.speed) < 0.1, `the wind jumped in strength at ${t}`);
    const off = wrap(wind.from - 247.5 * DEG) / DEG;
    low = Math.min(low, off);
    high = Math.max(high, off);
    widest = Math.max(widest, wind.speed);
    lightest = Math.min(lightest, wind.speed);
    gustiest = Math.max(gustiest, wind.gust);
    calmest = Math.min(calmest, wind.sea);
    roughest = Math.max(roughest, wind.sea);
    last = wind;
  }
  assert.ok(low > -52 && high < 52, `swings ${low.toFixed(1)} to ${high.toFixed(1)}`);
  assert.ok(low < -25 && high > 25, 'the wind does shift about');
  assert.ok(widest > 1.3, 'there are squalls');
  assert.ok(lightest < 0.6, 'there are lulls');
  assert.ok(gustiest > 0.8, 'gusts pass over');
  assert.ok(roughest - calmest > 0.4, 'the sea state changes');
  assert.deepEqual(windAt(123.4), windAt(123.4));
});

test('the first leg north out of harbour never needs a tack', () => {
  for (let t = 0; t <= 7200; t += 5) {
    const off = Math.abs(wrap(windAt(t).from - START.heading)) / DEG;
    assert.ok(off > 60, `the wind is ${off.toFixed(0)} degrees off the bow at ${t}`);
  }
});

test('a new boat lies at her berth with the sheet half out', () => {
  assert.deepEqual(newBoat({ x: 3, z: -4, heading: 1 }), {
    x: 3,
    z: -4,
    heading: 1,
    speed: 0,
    lean: 0,
    sheet: 0.5,
    boom: 0,
  });
});

test('the best sheet runs from hauled in close-hauled to right out on a run', () => {
  const boat = newBoat(OPEN);
  let last = 0;
  for (let degrees = 0; degrees <= 180; degrees += 5) {
    const { best, relative } = sail(boat, helm(), { from: degrees * DEG, speed: 1 }, 0, terrain);
    assert.ok(Math.abs(relative - degrees * DEG) < 1e-9);
    assert.ok(best >= last, `best is monotonic at ${degrees}`);
    last = best;
  }
  const at = (/** @type {number} */ degrees) =>
    sail(boat, helm(), { from: degrees * DEG, speed: 1 }, 0, terrain).best;
  assert.ok(at(45) >= 0.1 && at(45) <= 0.15);
  assert.ok(Math.abs(at(90) - 0.5) < 0.05);
  assert.equal(at(180), 1);
  // The same on the other tack, with the wind over the port side.
  const port = sail(boat, helm(), { from: -90 * DEG, speed: 1 }, 0, terrain);
  assert.ok(port.relative < 0);
  assert.equal(port.best, at(90));
});

test('trim is forgiving near the best setting and gone 0.45 away', () => {
  const boat = newBoat(OPEN);
  const wind = { from: 90 * DEG, speed: 1 };
  const { best } = sail(boat, helm(), wind, 0, terrain);
  const at = (/** @type {number} */ sheet) => {
    boat.sheet = sheet;
    return sail(boat, helm(), wind, 0, terrain).trim;
  };
  assert.equal(at(best), 1);
  assert.ok(at(best + 0.12) > 0.85);
  assert.ok(at(best - 0.12) > 0.85);
  assert.ok(at(best + 0.3) < 0.5);
  assert.equal(at(best + 0.45), 0);
});

test('the sheet eases out and hauls in at about 0.6 a second', () => {
  const boat = newBoat(OPEN);
  const wind = { from: 0, speed: 1 };
  run(boat, helm({ out: true }), wind, 0.5);
  assert.ok(Math.abs(boat.sheet - 0.8) < 0.04, `sheet ${boat.sheet}`);
  run(boat, helm({ out: true }), wind, 2);
  assert.equal(boat.sheet, 1);
  run(boat, helm({ in: true }), wind, 3);
  assert.equal(boat.sheet, 0);
});

test('on a beam reach, well trimmed, she settles near full speed within 20 seconds', () => {
  for (const speed of [0.7, 1, 1.2]) {
    const boat = newBoat(OPEN);
    const wind = { from: 90 * DEG, speed };
    run(boat, helm(), wind, 20, { trimmed: true });
    const full = MAX_SPEED * speed;
    assert.ok(boat.speed > 0.88 * full && boat.speed <= full, `${boat.speed} of ${full}`);
    const before = boat.speed;
    run(boat, helm(), wind, 5, { trimmed: true });
    assert.ok(Math.abs(boat.speed - before) < 0.05, 'the speed is steady');
    assert.ok(boat.z > OPEN.z + 80, 'and she has made her way north');
  }
});

test('a broad reach is the fastest point of sail, a run and a beat are slower', () => {
  const steady = (/** @type {number} */ degrees) => {
    const boat = newBoat(OPEN);
    run(boat, helm(), { from: degrees * DEG, speed: 1 }, 40, { trimmed: true });
    return boat.speed / MAX_SPEED;
  };
  assert.ok(Math.abs(steady(120) - 1) < 0.02);
  assert.ok(Math.abs(steady(180) - 0.75) < 0.03);
  assert.ok(Math.abs(steady(45) - 0.6) < 0.03);
  assert.ok(steady(30) < 0.02);
});

test('head to wind she loses her way and stops', () => {
  const boat = newBoat(OPEN);
  boat.speed = 6;
  const wind = { from: 0, speed: 1 };
  run(boat, helm(), wind, 4, { trimmed: true });
  assert.ok(boat.speed > 2.5, `she carries her way for a while: ${boat.speed}`);
  run(boat, helm(), wind, 40, { trimmed: true });
  assert.ok(Math.abs(boat.speed) < 0.1, `speed ${boat.speed}`);
});

test('badly trimmed she is much slower', () => {
  const wind = { from: 90 * DEG, speed: 1 };
  const good = newBoat(OPEN);
  run(good, helm(), wind, 30, { trimmed: true });
  const slack = newBoat(OPEN);
  slack.sheet = 1;
  run(slack, helm(), wind, 30);
  const pinned = newBoat(OPEN);
  pinned.sheet = 0;
  run(pinned, helm(), wind, 30);
  assert.ok(slack.speed < good.speed * 0.3, `sheet right out: ${slack.speed} of ${good.speed}`);
  assert.ok(pinned.speed < good.speed * 0.3, `sheet right in: ${pinned.speed} of ${good.speed}`);
});

test('the engine alone gives about ENGINE_SPEED head to wind', () => {
  const boat = newBoat(OPEN);
  const outcome = run(boat, helm({ engine: true }), { from: 0, speed: 1 }, 20);
  assert.ok(Math.abs(boat.speed - ENGINE_SPEED) < 0.1, `speed ${boat.speed}`);
  assert.ok(Math.abs(outcome.relative) < 1e-9);
  // Under sail and engine together the faster of the two wins.
  const reaching = newBoat(OPEN);
  run(reaching, helm({ engine: true }), { from: 120 * DEG, speed: 1 }, 30, { trimmed: true });
  assert.ok(reaching.speed > 7);
});

test('the rudder is sluggish with no way on and crisp at speed', () => {
  const wind = { from: 0, speed: 1 };
  const still = newBoat(OPEN);
  run(still, helm({ right: true }), wind, 1);
  assert.ok(still.heading > 0.1 && still.heading < 0.4, `stopped: ${still.heading}`);
  const moving = newBoat(OPEN);
  moving.speed = 6;
  run(moving, helm({ right: true }), wind, 1);
  assert.ok(moving.heading > 0.8, `at speed: ${moving.heading}`);
  const port = newBoat(OPEN);
  port.speed = 6;
  run(port, helm({ left: true }), wind, 1);
  assert.ok(port.heading < -0.8);
});

test('a tack from close-hauled at speed carries her through the wind onto the other tack', () => {
  // The wind is from the north; she starts close-hauled on starboard tack, heading north-west.
  const wind = { from: 0, speed: 1 };
  const boat = newBoat({ ...OPEN, heading: -48 * DEG });
  let outcome = run(boat, helm(), wind, 25, { trimmed: true });
  assert.ok(outcome.relative > 0, 'the wind is over the starboard side');
  assert.ok(boat.speed > 4, `close-hauled at ${boat.speed}`);
  assert.ok(boat.boom < -2 * DEG, 'the boom lies to port');
  assert.ok(boat.lean < -0.05, 'she heels to port, away from the wind');

  // Helm down: turn to starboard through the wind until she points north-east.
  let slowest = boat.speed;
  let seconds = 0;
  while (boat.heading < 48 * DEG) {
    boat.sheet = outcome.best;
    outcome = sail(boat, helm({ right: true }), wind, DT, terrain);
    slowest = Math.min(slowest, boat.speed);
    seconds += DT;
    assert.ok(seconds < 10, 'she is caught in irons');
  }
  assert.ok(slowest > 2.5, `she kept way on through the tack: ${slowest}`);
  assert.ok(outcome.relative < 0, 'the wind is now over the port side');

  run(boat, helm(), wind, 15, { trimmed: true });
  assert.ok(boat.speed > 4, `sailing again at ${boat.speed}`);
  assert.ok(boat.boom > 2 * DEG, 'the boom has come across to starboard');
  assert.ok(boat.lean > 0.05, 'and she heels to starboard');
  assert.ok(boat.x > OPEN.x - 200 && boat.z > OPEN.z, 'she is making ground to windward');
});

test('even from a standstill in irons she can bear away and sail', () => {
  const wind = { from: 0, speed: 1 };
  const boat = newBoat(OPEN);
  run(boat, helm({ right: true }), wind, 6, { trimmed: true });
  assert.ok(boat.heading > 45 * DEG, `she has paid off to ${boat.heading / DEG}`);
  const outcome = run(boat, helm(), wind, 10, { trimmed: true });
  assert.ok(outcome.trim > 0.99);
  assert.ok(boat.speed > 3);
});

test('the boom lies to leeward on both tacks and swings across smoothly in a gybe', () => {
  for (const [from, side] of [
    [90, -1],
    [-90, 1],
    [140, -1],
    [-140, 1],
    [50, -1],
    [-50, 1],
  ]) {
    const boat = newBoat(OPEN);
    run(boat, helm(), { from: from * DEG, speed: 1 }, 5, { trimmed: true });
    assert.equal(Math.sign(boat.boom), side, `wind from ${from}`);
    assert.ok(Math.abs(boat.boom) <= boat.sheet * 80 * DEG + 1e-9);
    assert.equal(Math.sign(boat.lean), side, `heel with the wind from ${from}`);
    assert.ok(Math.abs(boat.lean) <= 0.22 + 1e-9);
  }
  // Half out on a beam reach the boom stands at 40 degrees.
  const reach = newBoat(OPEN);
  run(reach, helm(), { from: 90 * DEG, speed: 1 }, 5);
  assert.ok(Math.abs(reach.boom + 40 * DEG) < 1 * DEG);

  // A gybe: the wind crosses the stern and the boom follows without a jump.
  const boat = newBoat(OPEN);
  boat.sheet = 1;
  run(boat, helm(), { from: 160 * DEG, speed: 1 }, 5);
  assert.ok(boat.boom < -70 * DEG);
  let last = boat.boom;
  for (let t = 0; t < 4; t += DT) {
    sail(boat, helm(), { from: -160 * DEG, speed: 1 }, DT, terrain);
    assert.ok(Math.abs(boat.boom - last) < 15 * DEG, 'the boom swings, it does not jump');
    last = boat.boom;
  }
  assert.ok(boat.boom > 70 * DEG);
});

test('head to wind the boom only shivers about the centreline', () => {
  const boat = newBoat(OPEN);
  let widest = 0;
  let crossings = 0;
  let last = 0;
  for (let t = 0; t < 10; t += DT) {
    sail(boat, helm(), { from: 5 * DEG, speed: 1 }, DT, terrain);
    widest = Math.max(widest, Math.abs(boat.boom));
    if (Math.sign(boat.boom) !== Math.sign(last)) crossings++;
    last = boat.boom;
  }
  assert.ok(widest < 12 * DEG, `it swings ${widest / DEG} degrees`);
  assert.ok(widest > 0.5 * DEG && crossings > 4, 'it shivers');
});

test('she heels most when reaching and close-hauled, little on a run', () => {
  const heel = (/** @type {number} */ degrees) => {
    const boat = newBoat(OPEN);
    run(boat, helm(), { from: degrees * DEG, speed: 1 }, 20, { trimmed: true });
    return Math.abs(boat.lean);
  };
  assert.ok(heel(90) > 0.15 && heel(90) <= 0.22);
  assert.ok(heel(50) > 0.1);
  assert.ok(heel(175) < 0.06);
  assert.ok(heel(10) < 0.01);
});

test('running at speed into the mainland south of the start she goes aground', () => {
  const boat = newBoat({ ...START, heading: Math.PI });
  const wind = { from: 270 * DEG, speed: 1 };
  let struck = 0;
  let hardest = 0;
  let outcome = sail(boat, helm(), wind, 0, terrain);
  for (let t = 0; t < 60; t += DT) {
    boat.sheet = outcome.best;
    outcome = sail(boat, helm({ engine: true }), wind, DT, terrain);
    assert.ok(isWater(terrain, boat.x, boat.z), `ashore at (${boat.x}, ${boat.z})`);
    if (outcome.event === 'aground') {
      if (struck === 0) {
        assert.ok(outcome.impact > 2, `first impact ${outcome.impact}`);
        assert.ok(boat.speed < 0, 'she bounces back');
        assert.ok(Math.abs(boat.speed + 0.3 * outcome.impact) < 1e-9);
      }
      struck++;
      hardest = Math.max(hardest, outcome.impact);
    } else {
      assert.equal(outcome.impact, 0);
    }
  }
  assert.ok(struck > 0, 'she never reached the shore');
  assert.ok(damageFor(hardest) > 0.05);
  assert.ok(boat.z < START.z - 20 && boat.z > START.z - 60, `she lies off the beach: ${boat.z}`);
});

test('a slow grounding is a harmless nudge', () => {
  // Find the beach due south of the start, then creep onto it.
  let z = START.z;
  while (isWater(terrain, START.x, z - 1.5)) z -= 0.25;
  const boat = newBoat({ x: START.x, z: z + 0.5, heading: Math.PI });
  boat.speed = 0.2;
  let outcome = sail(boat, helm(), { from: Math.PI, speed: 1 }, DT, terrain);
  for (let t = 0; t < 10 && outcome.event === ''; t += DT) {
    boat.speed = 0.2;
    outcome = sail(boat, helm(), { from: Math.PI, speed: 1 }, DT, terrain);
  }
  assert.equal(outcome.event, 'aground');
  assert.ok(outcome.impact > 0 && outcome.impact < 0.3);
  assert.equal(damageFor(outcome.impact), 0);
});

test('she cannot slide sideways through the rock of the cave tunnel', () => {
  const { ax, az, bx, radius } = terrain.cave;
  // In the middle of the tunnel, turned square to it, under engine: she must stay in the tunnel.
  for (const heading of [0, Math.PI, 30 * DEG, 150 * DEG, -60 * DEG]) {
    // (The western third of the tunnel lies outside the island, in open water.)
    const boat = newBoat({ x: ax + (bx - ax) * 0.7, z: az, heading });
    const wind = { from: heading, speed: 1 };
    let struck = false;
    for (let t = 0; t < 30; t += DT) {
      const outcome = sail(boat, helm({ engine: true }), wind, DT, terrain);
      struck ||= outcome.event === 'aground';
      assert.ok(isWater(terrain, boat.x, boat.z), `in the rock at (${boat.x}, ${boat.z})`);
      if (boat.x > ax + (bx - ax) * 0.55) {
        assert.ok(Math.abs(boat.z - az) < radius, `she left the tunnel at (${boat.x}, ${boat.z})`);
      }
    }
    assert.ok(struck);
  }
  // And she can motor the whole way in from the mouth to the chamber.
  const boat = newBoat({ x: ax - 20, z: az, heading: 90 * DEG });
  for (let t = 0; t < 60 && boat.x < bx; t += DT) {
    const outcome = sail(boat, helm({ engine: true }), { from: 90 * DEG, speed: 1 }, DT, terrain);
    assert.equal(outcome.event, '');
  }
  assert.ok(boat.x >= bx, 'she reached the chamber');
});

test('she can always get off the shore again', () => {
  const boat = newBoat({ ...START, heading: Math.PI });
  boat.speed = 5;
  const wind = { from: 270 * DEG, speed: 1 };
  run(boat, helm({ engine: true }), wind, 30);
  // Put the helm over and motor away to the north.
  run(boat, helm({ engine: true, right: true }), wind, 12);
  for (let t = 0; t < 40; t += DT) {
    const off = wrap(0 - boat.heading);
    const orders = helm({ engine: true, right: off > 0.05, left: off < -0.05 });
    sail(boat, orders, wind, DT, terrain);
  }
  assert.ok(boat.z > START.z, `she is back off the beach at ${boat.z}`);
});

test('damage grows smoothly with the speed of the impact', () => {
  assert.equal(damageFor(0), 0);
  assert.equal(damageFor(0.3), 0);
  assert.equal(damageFor(0.5), 0);
  assert.ok(Math.abs(damageFor(2) - 0.08) < 0.01);
  assert.ok(Math.abs(damageFor(4) - 0.25) < 0.02);
  assert.ok(Math.abs(damageFor(MAX_SPEED) - 0.6) < 0.06);
  assert.equal(damageFor(-4), damageFor(4));
  assert.equal(damageFor(1000), 1);
  let last = 0;
  for (let impact = 0; impact <= 12; impact += 0.05) {
    const damage = damageFor(impact);
    assert.ok(damage >= last && damage <= 1 && damage - last < 0.01);
    last = damage;
  }
});

test('the edge of the chart turns her back', () => {
  for (const berth of [
    { x: EDGE - 5, z: 300, heading: 90 * DEG },
    { x: -EDGE + 5, z: -300, heading: -90 * DEG },
    { x: 200, z: EDGE - 5, heading: 0 },
  ]) {
    const boat = newBoat(berth);
    boat.speed = 6;
    let turned = false;
    for (let t = 0; t < 30; t += DT) {
      const outcome = sail(boat, helm({ engine: true }), { from: 0, speed: 0.6 }, DT, emptySea);
      turned ||= outcome.event === 'edge';
      assert.ok(Math.abs(boat.x) <= EDGE && Math.abs(boat.z) <= EDGE);
    }
    assert.ok(turned);
    assert.ok(Math.abs(boat.x) < EDGE - 10 && Math.abs(boat.z) < EDGE - 10, 'she is back inside');
    assert.ok(Math.abs(bearingTo(boat, { x: 0, z: 0 }).angle) < 60 * DEG, 'heading for the middle');
  }
});

test('bearingTo gives the distance and the angle off the bow', () => {
  const boat = newBoat({ x: 10, z: 10, heading: 0 });
  const ahead = bearingTo(boat, { x: 10, z: 30 });
  assert.equal(ahead.distance, 20);
  assert.ok(Math.abs(ahead.angle) < 1e-9);
  assert.ok(Math.abs(bearingTo(boat, { x: 20, z: 10 }).angle - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(bearingTo(boat, { x: 0, z: 10 }).angle + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(Math.abs(bearingTo(boat, { x: 10, z: 0 }).angle) - Math.PI) < 1e-9);
  // Heading east, a point to the north is on the port beam.
  boat.heading = Math.PI / 2;
  assert.ok(Math.abs(bearingTo(boat, { x: 10, z: 20 }).angle + Math.PI / 2) < 1e-9);
  assert.ok(bearingTo(boat, { x: 30, z: 5 }).angle > 0);
});

/**
 * A naive but competent helmsman sails the ports in order on a sea with no land: straight at
 * each mark when she can lay it, otherwise close-hauled 50 degrees off the wind, always trimmed.
 * @param {number} setOff the time on the wind's clock when she sails
 * @returns {{ legs: number[], total: number, logged: number }} seconds per leg and overall, and distance sailed
 */
function circuit(setOff) {
  const port = (/** @type {string} */ id) => {
    const found = terrain.ports.find((p) => p.id === id);
    assert.ok(found);
    return found;
  };
  const marks = [
    port('wittgenstein'),
    port('juniper'),
    port('quickjs'),
    port('edge'),
    port('dioxus'),
    { x: terrain.cave.ax, z: terrain.cave.az },
    port('strand'),
  ];
  const boat = newBoat(START);
  const dt = 0.1;
  const legs = [];
  let time = 0;
  let logged = 0;
  let tack = 0;
  let outcome = sail(boat, helm(), windAt(setOff), 0, emptySea);
  for (const mark of marks) {
    const started = time;
    while (bearingTo(boat, mark).distance > 30) {
      const wind = windAt(setOff + time);
      const course = Math.atan2(mark.x - boat.x, mark.z - boat.z);
      const upwind = wrap(course - wind.from);
      let steer = course;
      if (Math.abs(upwind) < 50 * DEG) {
        // Keep the tack she is on until the other one points 25 degrees nearer the mark.
        if (tack === 0 || Math.abs(upwind - tack * 50 * DEG) > 75 * DEG) tack = upwind < 0 ? -1 : 1;
        steer = wind.from + tack * 50 * DEG;
      } else {
        tack = 0;
      }
      const off = wrap(steer - boat.heading);
      boat.sheet = outcome.best;
      outcome = sail(boat, helm({ right: off > 0.03, left: off < -0.03 }), wind, dt, emptySea);
      logged += Math.abs(boat.speed) * dt;
      time += dt;
      assert.ok(time < 4 * 3600, 'she never arrives');
    }
    legs.push(time - started);
  }
  return { legs, total: time, logged };
}

test('a competent helmsman sails the whole circuit in a sensible time', (t) => {
  const totals = [];
  for (const setOff of [0, 600, 1500, 2700, 4000]) {
    const { legs, total, logged } = circuit(setOff);
    totals.push(total / 60);
    t.diagnostic(
      `circuit setting off at ${setOff} s: ${(total / 60).toFixed(1)} min, ` +
        `${logged.toFixed(0)} units sailed, mean ${(logged / total).toFixed(2)} units/s; ` +
        `legs (min): ${legs.map((leg) => (leg / 60).toFixed(1)).join(', ')}`,
    );
  }
  const mean = totals.reduce((sum, minutes) => sum + minutes, 0) / totals.length;
  t.diagnostic(`mean circuit time ${mean.toFixed(1)} min`);
  // Loose bounds only: the game should be neither a sprint nor a slog.
  assert.ok(mean > 8 && mean < 60, `mean circuit ${mean.toFixed(1)} minutes`);
});

test('the rocket drives the boat at ten times the best sailing speed, whatever the wind', () => {
  const boat = newBoat({ x: 0, z: 0, heading: 0 });
  const helm = { left: false, right: false, out: false, in: false, engine: false, rocket: true };
  // Dead into the wind, where no sail draws.
  const wind = { from: 0, speed: 1 };
  for (let i = 0; i < 600; i++) {
    sail(boat, helm, wind, 1 / 60, terrain);
    boat.x = 0;
    boat.z = 0;
  }
  assert.ok(Math.abs(boat.speed - MAX_SPEED * 10) < 5, `speed ${boat.speed}`);
  // With the rocket out the way runs off, and the boat is back to sailing speeds.
  helm.rocket = false;
  for (let i = 0; i < 60 * 40; i++) {
    sail(boat, helm, wind, 1 / 60, terrain);
    boat.x = 0;
    boat.z = 0;
  }
  assert.ok(boat.speed < MAX_SPEED, `speed ${boat.speed}`);
});

test('the wind is not the same everywhere: gusts lie in patches', () => {
  const here = windAt(600, 0, 0);
  let differs = false;
  for (let x = -1000; x <= 1000; x += 100) {
    const there = windAt(600, x, 400);
    if (Math.abs(there.speed - here.speed) > 0.15) differs = true;
  }
  assert.ok(differs);
});
