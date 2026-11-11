import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEATURES, START } from './chart-data.js';
import { getTerrain, heightAt, isWater } from './terrain.js';

const terrain = getTerrain();

/** @param {string} id */
function feature(id) {
  const found = FEATURES.find((f) => f.id === id);
  assert.ok(found, `no feature ${id}`);
  return found;
}

test('the start is afloat with 150 units of clear water due north', () => {
  for (let d = 0; d <= 150; d++) {
    for (const off of [-3, 0, 3]) {
      assert.ok(
        isWater(terrain, START.x + off, START.z + d),
        `not floatable at (${START.x + off}, ${START.z + d})`,
      );
    }
  }
});

test('there are seven ports in the agreed order', () => {
  assert.deepEqual(
    terrain.ports.map((port) => port.id),
    ['wittgenstein', 'juniper', 'quickjs', 'edge', 'dioxus', 'plato', 'strand'],
  );
});

test('every lighthouse stands on land within 30 units of floatable water', () => {
  for (const port of terrain.ports) {
    if (port.kind !== 'light') continue;
    const at = `${port.id} (${port.x.toFixed(1)}, ${port.z.toFixed(1)})`;
    assert.ok(port.base > 0.5, `${at} stands at ${port.base.toFixed(2)}`);
    assert.ok(heightAt(terrain, port.x, port.z) > 0.5, `${at} is not on land`);
    let afloat = false;
    for (let r = 2; r <= 30 && !afloat; r += 2) {
      for (let a = 0; a < 36 && !afloat; a++) {
        const angle = (a / 36) * Math.PI * 2;
        afloat = isWater(terrain, port.x + Math.sin(angle) * r, port.z + Math.cos(angle) * r);
      }
    }
    assert.ok(afloat, `${at} has no floatable water within 30 units`);
  }
});

test('the cave: the chamber and the tunnel float, the rock beside the tunnel does not', () => {
  const { ax, az, bx, bz, hall } = terrain.cave;
  const port = terrain.ports.find((p) => p.kind === 'cave');
  assert.ok(port);
  assert.equal(port.x, bx);
  assert.equal(port.z, bz);
  assert.ok(isWater(terrain, bx, bz), 'the middle of the chamber');
  for (let a = 0; a < 12; a++) {
    const angle = (a / 12) * Math.PI * 2;
    const r = hall - 2;
    assert.ok(
      isWater(terrain, bx + Math.sin(angle) * r, bz + Math.cos(angle) * r),
      'inside the chamber',
    );
  }
  const length = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / length;
  const uz = (bz - az) / length;
  for (let d = 0; d <= length; d++) {
    const x = ax + ux * d;
    const z = az + uz * d;
    assert.ok(isWater(terrain, x, z), `tunnel centreline at (${x.toFixed(1)}, ${z.toFixed(1)})`);
  }
  // Midway along, 15 units off the centreline on either side, is solid rock.
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  for (const side of [-1, 1]) {
    const x = mx - uz * 15 * side;
    const z = mz + ux * 15 * side;
    assert.ok(
      !isWater(terrain, x, z),
      `rock at (${x.toFixed(1)}, ${z.toFixed(1)}) floats: height ${heightAt(terrain, x, z).toFixed(2)}`,
    );
    assert.ok(heightAt(terrain, x, z) > 1, 'the rock beside the tunnel stands above the sea');
  }
});

test('the cave mouth can be reached from the open sea', () => {
  const { ax, az, bx, bz } = terrain.cave;
  const length = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / length;
  const uz = (bz - az) / length;
  for (let d = 0; d <= 60; d++) {
    const x = ax - ux * d;
    const z = az - uz * d;
    assert.ok(isWater(terrain, x, z), `approach at (${x.toFixed(1)}, ${z.toFixed(1)})`);
  }
});

test("the volcano's crater is lower than its rim", () => {
  const { x, z, crater, height, radius } = terrain.volcano;
  assert.ok(radius > 0 && crater > 0);
  const floor = heightAt(terrain, x, z);
  for (let a = 0; a < 16; a++) {
    const angle = (a / 16) * Math.PI * 2;
    const rim = heightAt(terrain, x + Math.sin(angle) * crater, z + Math.cos(angle) * crater);
    assert.ok(rim > floor + 3, `rim ${rim.toFixed(1)} against floor ${floor.toFixed(1)}`);
  }
  assert.ok(floor < height, 'the crater floor lies below the stated rim height');
  assert.ok(floor > 5, 'the crater is up the mountain, not at sea level');
});

test('every reef has a rock above water and floatable water around it', () => {
  for (const reef of FEATURES.filter((f) => f.kind === 'reef')) {
    let top = -Infinity;
    for (let dz = -reef.radius; dz <= reef.radius; dz += 1) {
      for (let dx = -reef.radius; dx <= reef.radius; dx += 1) {
        top = Math.max(top, heightAt(terrain, reef.x + dx, reef.z + dz));
      }
    }
    assert.ok(top > 0, `${reef.id}: highest rock at ${top.toFixed(2)}`);
    let afloat = 0;
    const ring = reef.radius * 1.5;
    for (let a = 0; a < 72; a++) {
      const angle = (a / 72) * Math.PI * 2;
      if (isWater(terrain, reef.x + Math.sin(angle) * ring, reef.z + Math.cos(angle) * ring)) {
        afloat++;
      }
    }
    // Unsafe Rocks lie hard by the QuickJS island, so not the whole ring is open water.
    assert.ok(afloat >= 48, `${reef.id}: only ${afloat} of 72 points round it float`);
  }
});

test('nothing but the mainland reaches within 60 units of the start', () => {
  for (const f of FEATURES) {
    if (f.kind === 'mainland') continue;
    const reach = f.kind === 'strand' ? f.radius * 2.6 * 1.5 : f.radius * 1.5;
    const clear = Math.hypot(f.x - START.x, f.z - START.z) - reach;
    assert.ok(clear > 60, `${f.id} comes within ${clear.toFixed(0)} units of the start`);
  }
  // And on the grid itself: any ground near the start that is not deep water is the mainland's,
  // which lies to the south and on the two arms of the bay.
  const mainland = feature('mainland');
  for (let dz = -60; dz <= 60; dz += 2) {
    for (let dx = -60; dx <= 60; dx += 2) {
      if (Math.hypot(dx, dz) > 60) continue;
      const x = START.x + dx;
      const z = START.z + dz;
      if (heightAt(terrain, x, z) > 0) {
        assert.ok(z < mainland.z + 40, `land at (${x}, ${z}) is not the mainland coast`);
      }
    }
  }
});
