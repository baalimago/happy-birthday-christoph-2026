// Builds the sea floor and the land from chart-data.js into one height grid, and answers
// questions about it. The same grid feeds the collision checks, the renderer and the map,
// so what the captain sees, hits and reads on the chart always agree. Pure: no DOM, no GPU.

import { CAVE_SHAPE, EXTENT, FEATURES, GRID, HOME_LIGHT, PORT_SPECS } from './chart-data.js';

/**
 * @typedef {import('./chart-data.js').Feature} Feature
 * @typedef {{ id: string, kind: 'light' | 'cave', x: number, z: number, base: number }} Port
 *   base is the height of the ground the lighthouse stands on
 * @typedef {{ ax: number, az: number, bx: number, bz: number, radius: number, hall: number, roof: number }} Cave
 *   a tunnel from the mouth (a) to the middle of the round chamber (b), in world coordinates
 * @typedef {{ x: number, z: number, radius: number, height: number, crater: number }} Volcano
 *
 * @typedef {object} Terrain
 * @property {number} n samples a side
 * @property {number} extent side of the world in units
 * @property {Float32Array} heights n*n, row-major, index = iz*n + ix; units above the sea,
 *   negative under it
 * @property {Float32Array} forest n*n, 0..1, how wooded the ground is
 * @property {Port[]} ports
 * @property {Cave} cave
 * @property {Volcano} volcano
 */

/** Ground lower than this is water a boat can float in. */
export const SHALLOW = -0.25;

/** @param {number} x @param {number} y */
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise, 0..1. @param {number} x @param {number} y */
export function noise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** @param {number} a @param {number} b @param {number} t */
function smoothstep(a, b, t) {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/** The mainland's coastline: land lies south of this z. The harbour bay is cut in round x = 0. */
function coast(/** @type {Feature} */ f, /** @type {number} */ x) {
  const wander = 46 * (noise(x / 210 + f.seed, 0.5) - 0.5) + 18 * (noise(x / 60, f.seed) - 0.5);
  const bay = 78 * Math.exp(-(x * x) / (2 * 48 * 48));
  return f.z + wander - bay;
}

/** How far the edge of an island lies from its middle on this bearing, as a share of its radius. */
function wobble(/** @type {Feature} */ f, /** @type {number} */ angle) {
  return (
    1 +
    0.2 * Math.sin(angle * 3 + f.seed) +
    0.11 * Math.sin(angle * 5 + f.seed * 2.3) +
    0.07 * Math.sin(angle * 9 + f.seed * 4.1)
  );
}

/**
 * Height of one feature at a point: positive is land, negative is sea floor.
 * @param {Feature} f @param {number} x @param {number} z
 */
function featureHeight(f, x, z) {
  if (f.kind === 'mainland') {
    const inland = coast(f, x) - z;
    if (inland <= 0) return Math.max(-5, inland * 0.12);
    return Math.min(f.height, inland * 0.28) * (0.7 + 0.6 * noise(x / 38, z / 38));
  }
  let dx = x - f.x;
  const dz = z - f.z;
  if (f.kind === 'strand') dx /= 2.6;
  const d = Math.hypot(dx, dz);
  if (d > f.radius * 1.5) return -5;

  if (f.kind === 'reef') {
    // A scatter of low rocks over a shoal.
    let h = -1.2 - 3 * smoothstep(0.5, 1.4, d / f.radius);
    for (let i = 0; i < 9; i++) {
      const a = hash(f.seed, i) * Math.PI * 2;
      const r = Math.sqrt(hash(i, f.seed)) * f.radius * 0.85;
      const rock = 5 + 4 * hash(f.seed + i, 7);
      const rd = Math.hypot(dx - Math.cos(a) * r, dz - Math.sin(a) * r);
      if (rd < rock) h = Math.max(h, f.height * (1 - rd / rock) * 1.6 - 0.4);
    }
    return h;
  }

  const angle = Math.atan2(dz, dx);
  const r = d / (f.radius * wobble(f, angle));
  if (r >= 1) return -Math.min(5, (r - 1) * f.radius * 0.12);
  const p = 1 - r;
  const rough = 0.75 + 0.5 * noise(x / 24 + f.seed, z / 24);
  let h;
  if (f.kind === 'mesa') {
    h = f.height * smoothstep(0, 0.2, p) * (0.92 + 0.08 * rough);
  } else if (f.kind === 'volcano') {
    h = f.height * Math.pow(p, 1.25) * (0.9 + 0.1 * rough);
    const crater = f.radius * 0.11;
    if (d < crater) h = Math.min(h, f.height * 0.86 - (crater - d) * 1.3);
  } else {
    h = f.height * p * p * (3 - 2 * p) * rough;
  }
  if (f.kind === 'crescent') {
    // A bay bitten out of the eastern side makes a sheltered anchorage.
    const bite = Math.hypot(dx - f.radius * 0.55, dz) / (f.radius * 0.5);
    if (bite < 1) h = Math.min(h, -3 + 3.5 * smoothstep(0.75, 1, bite) * Math.max(0, h + 3) * 0.3);
  }
  return h;
}

/** @param {Feature} f @param {number} x @param {number} z @param {number} h */
function featureForest(f, x, z, h) {
  if (f.forest <= 0 || h < 1.2) return 0;
  const patch = smoothstep(0.32, 0.5, noise(x / 30 + f.seed * 3, z / 30 - f.seed));
  const lowland = f.kind === 'volcano' ? 1 - smoothstep(f.height * 0.3, f.height * 0.55, h) : 1;
  return f.forest * patch * lowland * smoothstep(1.2, 3.5, h);
}

/** @returns {Terrain} */
export function buildTerrain() {
  const n = GRID;
  const heights = new Float32Array(n * n).fill(-5);
  const forest = new Float32Array(n * n);
  const step = EXTENT / n;
  const origin = -EXTENT / 2 + step / 2;
  for (const f of FEATURES) {
    // Only visit the cells the feature can reach.
    const reach = f.kind === 'strand' ? f.radius * 4 : f.radius * 1.6;
    const x0 = f.kind === 'mainland' ? 0 : Math.max(0, Math.floor((f.x - reach - origin) / step));
    const x1 =
      f.kind === 'mainland' ? n - 1 : Math.min(n - 1, Math.ceil((f.x + reach - origin) / step));
    const z0 = f.kind === 'mainland' ? 0 : Math.max(0, Math.floor((f.z - reach - origin) / step));
    const z1 =
      f.kind === 'mainland'
        ? Math.min(n - 1, Math.ceil((f.z + 120 - origin) / step))
        : Math.min(n - 1, Math.ceil((f.z + reach - origin) / step));
    for (let iz = z0; iz <= z1; iz++) {
      const z = origin + iz * step;
      for (let ix = x0; ix <= x1; ix++) {
        const x = origin + ix * step;
        const h = featureHeight(f, x, z);
        const i = iz * n + ix;
        if (h > heights[i]) {
          heights[i] = h;
          forest[i] = featureForest(f, x, z, h);
        }
      }
    }
  }

  /** @type {Terrain} */
  const terrain = {
    n,
    extent: EXTENT,
    heights,
    forest,
    ports: [],
    cave: {
      ax: 0,
      az: 0,
      bx: 0,
      bz: 0,
      radius: CAVE_SHAPE.radius,
      hall: CAVE_SHAPE.hall,
      roof: CAVE_SHAPE.roof,
    },
    volcano: { x: 0, z: 0, radius: 0, height: 0, crater: 0 },
  };
  for (const f of FEATURES) {
    if (f.kind === 'volcano') {
      terrain.volcano = {
        x: f.x,
        z: f.z,
        radius: f.radius,
        height: f.height * 0.86,
        crater: f.radius * 0.11,
      };
    }
  }
  for (const spec of PORT_SPECS) {
    const f = FEATURES.find((feature) => feature.id === spec.feature);
    if (!f) continue;
    if (spec.kind === 'cave') {
      terrain.cave.ax = f.x + CAVE_SHAPE.mouth.x;
      terrain.cave.az = f.z + CAVE_SHAPE.mouth.z;
      terrain.cave.bx = f.x + CAVE_SHAPE.chamber.x;
      terrain.cave.bz = f.z + CAVE_SHAPE.chamber.z;
      terrain.ports.push({
        id: spec.id,
        kind: 'cave',
        x: terrain.cave.bx,
        z: terrain.cave.bz,
        base: 0,
      });
    } else if (f.kind === 'mainland') {
      const { x, z } = HOME_LIGHT;
      terrain.ports.push({ id: spec.id, kind: 'light', x, z, base: heightAt(terrain, x, z) });
    } else {
      // Walk out from the middle until the ground runs down to the beach, then step back ashore.
      const sin = Math.sin((spec.bearing * Math.PI) / 180);
      const cos = Math.cos((spec.bearing * Math.PI) / 180);
      let r = f.radius * 0.35;
      while (r < f.radius * 3 && heightAt(terrain, f.x + sin * r, f.z + cos * r) > 1.4) r += 1;
      r -= 2;
      const x = f.x + sin * r;
      const z = f.z + cos * r;
      terrain.ports.push({ id: spec.id, kind: 'light', x, z, base: heightAt(terrain, x, z) });
    }
  }
  return terrain;
}

/**
 * Height of the ground at a point, bilinear between grid samples. Off the grid it is deep water.
 * @param {Terrain} terrain @param {number} x @param {number} z
 */
export function heightAt(terrain, x, z) {
  const { n, extent, heights } = terrain;
  const gx = ((x + extent / 2) / extent) * n - 0.5;
  const gz = ((z + extent / 2) / extent) * n - 0.5;
  if (gx < 0 || gz < 0 || gx > n - 1 || gz > n - 1) return -5;
  const ix = Math.min(n - 2, Math.floor(gx));
  const iz = Math.min(n - 2, Math.floor(gz));
  const fx = gx - ix;
  const fz = gz - iz;
  const i = iz * n + ix;
  const top = heights[i] + (heights[i + 1] - heights[i]) * fx;
  const bottom = heights[i + n] + (heights[i + n + 1] - heights[i + n]) * fx;
  return top + (bottom - top) * fz;
}

/**
 * How far inside the cave's water a point is: positive inside, negative outside (in world units).
 * @param {Cave} cave @param {number} x @param {number} z
 */
export function insideCave(cave, x, z) {
  const ex = cave.bx - cave.ax;
  const ez = cave.bz - cave.az;
  const t = Math.min(
    1,
    Math.max(0, ((x - cave.ax) * ex + (z - cave.az) * ez) / (ex * ex + ez * ez)),
  );
  const tunnel = cave.radius - Math.hypot(x - cave.ax - ex * t, z - cave.az - ez * t);
  const hall = cave.hall - Math.hypot(x - cave.bx, z - cave.bz);
  return Math.max(tunnel, hall);
}

/**
 * Can a boat float here? True over water deep enough and inside the sea cave.
 * @param {Terrain} terrain @param {number} x @param {number} z
 */
export function isWater(terrain, x, z) {
  return heightAt(terrain, x, z) < SHALLOW || insideCave(terrain.cave, x, z) > 1.2;
}

/** @type {Terrain | undefined} */
let charted;

/** The one terrain everybody shares, built on first use (about half a second). */
export function getTerrain() {
  charted ??= buildTerrain();
  return charted;
}
