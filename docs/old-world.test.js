import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGE,
  MAX_SPEED,
  MIDDLE,
  PORT_HEIGHT,
  PORT_SPREAD,
  bearing,
  landAt,
  newBoat,
  sail,
} from './world.js';

const DT = 1 / 60;
const idle = { left: false, right: false, up: false, down: false };
const ahead = { ...idle, up: true };
const isle = { x: 7, z: 16, height: PORT_HEIGHT, spread: PORT_SPREAD };

/** @param {number} actual @param {number} expected @param {string} [message] */
function near(actual, expected, message, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message ?? 'value'}: ${actual} is not ${expected}`,
  );
}

test('landAt is above water at an island centre and below it far away', () => {
  assert.ok(landAt([isle], isle.x, isle.z) > 0);
  near(landAt([isle], isle.x, isle.z), PORT_HEIGHT - 0.35, 'the summit');
  assert.ok(landAt([isle], isle.x + 60, isle.z - 60) < 0);
  assert.ok(landAt([], 0, 0) < 0, 'open sea with no islands');
});

test('landAt takes the highest of overlapping islands', () => {
  const low = { x: 7, z: 16, height: 1, spread: 3 };
  assert.equal(landAt([low, isle], 7, 16), landAt([isle], 7, 16));
});

test('a new boat lies still at the origin, heading +z', () => {
  assert.deepEqual(newBoat(), { x: 0, z: 0, heading: 0, speed: 0, lean: 0 });
});

test('sail with up accelerates along the heading and never beyond MAX_SPEED', () => {
  const boat = newBoat();
  let last = 0;
  for (let step = 0; step < 60; step++) {
    assert.equal(sail(boat, ahead, DT, []), '');
    assert.ok(boat.speed > last, 'gathers way in the first second');
    last = boat.speed;
  }
  for (let step = 0; step < 600; step++) {
    sail(boat, ahead, DT, []);
    assert.ok(boat.speed <= MAX_SPEED, `speed ${boat.speed}`);
  }
  near(boat.speed, MAX_SPEED, 'top speed');
  assert.ok(boat.z > 50, 'moved along +z');
  near(boat.x, 0, 'no drift sideways');
});

test('sail moves the boat along whatever heading it has', () => {
  const boat = { ...newBoat(), heading: Math.PI / 2 };
  for (let step = 0; step < 300; step++) sail(boat, ahead, DT, []);
  assert.ok(boat.x > 10, 'moved along +x');
  near(boat.z, 0, 'no drift sideways');
});

test('a boat left alone loses way and does not move from rest', () => {
  const still = newBoat();
  sail(still, idle, DT, []);
  assert.deepEqual(still, newBoat());
  const boat = { ...newBoat(), speed: 6 };
  for (let step = 0; step < 60; step++) sail(boat, idle, DT, []);
  assert.ok(boat.speed > 0 && boat.speed < 6);
});

test('right increases the heading and left decreases it', () => {
  const starboard = newBoat();
  sail(starboard, { ...idle, right: true }, DT, []);
  assert.ok(starboard.heading > 0);
  const port = newBoat();
  sail(port, { ...idle, left: true }, DT, []);
  assert.ok(port.heading < 0);
  const both = newBoat();
  sail(both, { ...idle, left: true, right: true }, DT, []);
  assert.equal(both.heading, 0);
});

test('turning to starboard under way carries the boat towards +x', () => {
  const boat = newBoat();
  for (let step = 0; step < 120; step++) sail(boat, { ...ahead, right: true }, DT, []);
  assert.ok(boat.x > 0);
  assert.ok(boat.lean < 0, 'and she leans away from the turn');
});

test('sailing straight into an island reports aground and stays off the land', () => {
  const rock = { x: 0, z: 30, height: PORT_HEIGHT, spread: PORT_SPREAD };
  const boat = newBoat();
  const events = new Set();
  for (let step = 0; step < 1200; step++) {
    const before = { ...boat };
    const event = sail(boat, ahead, DT, [rock]);
    events.add(event);
    if (event === 'aground') {
      assert.equal(boat.x, before.x, 'held in place');
      assert.equal(boat.z, before.z, 'held in place');
      assert.ok(boat.speed <= 0, 'thrown back');
    }
    assert.ok(landAt([rock], boat.x, boat.z) < 0, `on land at z=${boat.z}`);
    assert.ok(boat.z < rock.z, 'never past the island');
  }
  assert.ok(events.has('aground'));
  assert.ok(!events.has('edge'));
  assert.ok(boat.z > 20, 'she did get close');
});

test('backing into an island runs aground too', () => {
  const rock = { x: 0, z: -8, height: PORT_HEIGHT, spread: PORT_SPREAD };
  const boat = newBoat();
  const events = new Set();
  for (let step = 0; step < 1200; step++) {
    events.add(sail(boat, { ...idle, down: true }, DT, [rock]));
    assert.ok(landAt([rock], boat.x, boat.z) < 0, `on land at z=${boat.z}`);
  }
  assert.ok(events.has('aground'));
});

test('beyond EDGE the boat is reported at the edge, pulled back and turned for home', () => {
  const boat = { ...newBoat(), x: MIDDLE.x, z: MIDDLE.z + EDGE + 4, heading: 0.3 };
  const out = () => Math.hypot(boat.x - MIDDLE.x, boat.z - MIDDLE.z);
  assert.equal(sail(boat, idle, DT, []), 'edge');
  near(out(), EDGE + 2, 'half the overshoot is taken back');
  assert.ok(boat.heading > 0.3, 'turning the short way round, to starboard');
  for (let step = 0; step < 600; step++) sail(boat, idle, DT, []);
  assert.ok(out() <= EDGE + 1e-6, `still ${out()} out`);
});

test('a boat driven at the edge never gets far past it and comes back', () => {
  const boat = { ...newBoat(), x: MIDDLE.x, z: MIDDLE.z + EDGE - 5, speed: MAX_SPEED };
  const out = () => Math.hypot(boat.x - MIDDLE.x, boat.z - MIDDLE.z);
  const events = new Set();
  let furthest = 0;
  for (let step = 0; step < 1800; step++) {
    events.add(sail(boat, ahead, DT, []));
    furthest = Math.max(furthest, out());
  }
  assert.ok(events.has('edge'));
  assert.ok(furthest < EDGE + 1, `went ${furthest} out`);
  assert.ok(out() < EDGE, `ended ${out()} out, still at the edge after 30 seconds`);
});

test('inside EDGE nothing is reported', () => {
  const boat = { ...newBoat(), x: MIDDLE.x, z: MIDDLE.z + EDGE - 1 };
  assert.equal(sail(boat, idle, DT, []), '');
});

test('bearing gives angle 0 dead ahead, positive to starboard, and the distance', () => {
  const boat = newBoat();
  assert.deepEqual(bearing(boat, { x: 0, z: 10 }), { distance: 10, angle: 0 });
  near(bearing(boat, { x: 10, z: 0 }).angle, Math.PI / 2, 'abeam to starboard');
  near(bearing(boat, { x: -10, z: 0 }).angle, -Math.PI / 2, 'abeam to port');
  near(Math.abs(bearing(boat, { x: 0, z: -10 }).angle), Math.PI, 'dead astern');
  near(bearing(boat, { x: 3, z: 4 }).distance, 5, 'distance');
  assert.ok(bearing(boat, { x: 3, z: 4 }).angle > 0);
});

test('bearing is relative to the heading and to where the boat is', () => {
  const boat = { ...newBoat(), x: 5, z: -2, heading: Math.PI / 2 };
  const east = bearing(boat, { x: 15, z: -2 });
  near(east.distance, 10, 'distance');
  near(east.angle, 0, 'dead ahead');
  near(bearing(boat, { x: 5, z: 8 }).angle, -Math.PI / 2, 'north is to port when heading east');
});

test('steering by the bearing brings the boat to the point', () => {
  const boat = newBoat();
  const point = { x: -24, z: 36 };
  for (let step = 0; step < 3600 && bearing(boat, point).distance > 1; step++) {
    const { angle } = bearing(boat, point);
    sail(boat, { ...ahead, right: angle > 0.05, left: angle < -0.05 }, DT, []);
  }
  assert.ok(bearing(boat, point).distance <= 1);
});
