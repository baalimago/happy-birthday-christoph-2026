// The woods near the boat, tree by tree: firs, and broadleaves on the low ground. A tree stands in
// a cell of a jittered grid wherever the forest is thick enough and the ground neither wet nor
// steep, so the woods are where the ray-marched scene has them. The world is cut into chunks; a
// chunk's trees are worked out once, when the boat first comes near, into one mesh (software GL
// draws instances one by one, so there are none), and kept. Far off only one tree in seven is
// drawn, larger, and beyond that the darker ground of the terrain carries the woods.

import { createMesh } from '../gl.js';
import { COMMON, FINISH } from '../look.js';
import { groundAt } from '../solids.js';

/** @typedef {import('../gl.js').Mesh} Mesh */

/** Side of a cell of the grid the trees stand on, and cells along a side of a chunk. */
const CELL = 5.4;
const CHUNK_CELLS = 8;
const CHUNK = CELL * CHUNK_CELLS;
/** How far from the boat the last trees stand, and how far the small ones do. */
const REACH = 210;
const NEAR_REACH = 90;
/** The share of the trees that are seen from afar. */
const FAR_SHARE = 0.14;
/** No trees lower than this, nor on ground steeper than STEEP (as the ray-marched woods). */
const DRY = 0.8;
const STEEP = 1.3;
/** Broadleaves grow below this height. */
const LOWLAND = 9;
/** The most trees drawn in a frame, chunks built in a frame, and chunks kept. */
const MOST_TREES = 600;
const BUILDS = 8;
const KEPT = 420;

// Every facet has one colour: that of the last corner of each triangle, which carries the
// facet's normal.
const VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec4 aFoot;     // where the tree stands, and how far off it is still drawn
layout(location = 1) in vec3 aOffset;   // from its foot to this corner
layout(location = 2) in vec3 aNormal;
layout(location = 3) in vec3 aColor;
${COMMON}
flat out vec4 vCol;
void main(){
  // A tree shrinks into the ground at the edge of its range, and the few that are seen from
  // afar grow, to stand for the ones that are gone.
  float d = distance(aFoot.xz, uBoat.xy);
  float size = 1.0 - smoothstep(0.7*aFoot.w, aFoot.w, d);
  size *= 1.0 + 0.8*step(200.0, aFoot.w)*smoothstep(50.0, 120.0, d);
  vec3 world = aFoot.xyz + aOffset*size;
  // needles let the light wrap round a tree
  float sun = clamp((dot(aNormal, uSun) + 0.25)/1.25, 0.0, 1.0);
  vCol = vec4(aColor*(uAmb*(0.6 + 0.4*aNormal.y) + uSunCol*sun), hazeAt(world));
  gl_Position = uViewProj*vec4(world, 1.0);
}`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
${FINISH}
flat in vec4 vCol;
out vec4 outColor;
void main(){
  outColor = vec4(finish(vCol.rgb, vCol.a), 1.0);
}`;

/**
 * @typedef {object} Model a tree one unit high, standing on the origin
 * @property {number[]} corners x, y, z, then the normal and the colour of the facet the corner
 *   closes: nine numbers each
 * @property {number[]} index
 */

/**
 * Add a band of facets round the y axis, between a ring of radius r0 at height y0 and one of r1
 * at y1 (either radius may be nought: a cone, or a cap seen from below).
 * @param {Model} model
 * @param {number} sides
 * @param {readonly [number, number]} low
 * @param {readonly [number, number]} high
 * @param {readonly number[]} paint
 * @param {number} [turn] in sides
 */
function band(model, sides, [r0, y0], [r1, y1], paint, turn = 0) {
  const { corners, index } = model;
  /** @param {number} r @param {number} y @param {number} i */
  const at = (r, y, i) => {
    const a = ((i + turn) / sides) * 2 * Math.PI;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };
  /** @param {number[]} p @param {number[]} n @returns {number} the corner's index */
  const corner = (p, n) =>
    corners.push(p[0], p[1], p[2], n[0], n[1], n[2], paint[0], paint[1], paint[2]) / 9 - 1;
  for (let i = 0; i < sides; i++) {
    const a0 = at(r0, y0, i);
    const a1 = at(r0, y0, i + 1);
    const b0 = at(r1, y1, i);
    const b1 = at(r1, y1, i + 1);
    // the facet's normal: out of (a0, b0, b1), or of (a0, b1, a1) where b0 and b1 are one point
    const [p, q] = r1 > 0 ? [b0, b1] : [b1, a1];
    const u = [p[0] - a0[0], p[1] - a0[1], p[2] - a0[2]];
    const v = [q[0] - a0[0], q[1] - a0[1], q[2] - a0[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(n[0], n[1], n[2]);
    for (let k = 0; k < 3; k++) n[k] /= length;
    // each triangle ends on a corner of its own, which carries the normal
    if (r1 > 0) index.push(corner(b0, n), corner(b1, n), corner(a0, n));
    if (r0 > 0) index.push(corner(a1, n), corner(a0, n), corner(b1, n));
  }
}

/** A fir: two tiers of boughs, dark at the foot. @returns {Model} */
function fir() {
  /** @type {Model} */
  const model = { corners: [], index: [] };
  band(model, 4, [0.36, 0.08], [0, 0.68], [0.11, 0.28, 0.19]);
  band(model, 4, [0.26, 0.42], [0, 1], [0.2, 0.39, 0.22], 0.5);
  return model;
}

/** A broadleaf: a round crown on a trunk. @returns {Model} */
function broadleaf() {
  /** @type {Model} */
  const model = { corners: [], index: [] };
  band(model, 3, [0.06, 0], [0, 0.5], [0.33, 0.23, 0.14]);
  band(model, 4, [0, 0.3], [0.38, 0.62], [0.2, 0.35, 0.14]);
  band(model, 4, [0.38, 0.62], [0, 1], [0.36, 0.5, 0.19], 0.0);
  return model;
}

/** @param {number} x @param {number} z @returns {number} 0..1, the same for the same cell always */
function hash(x, z) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** @param {number} a @param {number} b @param {number} x */
function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * @typedef {object} Chunk
 * @property {number} x middle, in the world
 * @property {number} y
 * @property {number} z
 * @property {number} radius of a ball round all its trees
 * @property {Mesh} mesh the trees seen from afar come first
 * @property {number} far how much of the index they take
 * @property {number} farTrees
 * @property {number} trees
 * @property {number} away distance from the boat, this frame
 */

/** @param {import('../renderer.js').Kit} kit @returns {import('../renderer.js').Part} */
export function createTrees({ gl, programs, terrain }) {
  const program = programs.make(VERTEX, FRAGMENT, ['aFoot', 'aOffset', 'aNormal', 'aColor']);
  const models = [fir(), broadleaf()];
  const { n, extent, forest } = terrain;
  const lights = terrain.ports.filter((port) => port.kind === 'light');
  const step = extent / n;

  /** @type {Map<number, Chunk | null>} null where no tree stands */
  const chunks = new Map();
  /** @type {Chunk[]} */
  const seen = [];
  // Room for a chunk with a tree in every cell.
  const cells = CHUNK_CELLS * CHUNK_CELLS;
  const most = cells * Math.max(...models.map((model) => model.corners.length / 9));
  const foot = new Float32Array(most * 4);
  const offset = new Float32Array(most * 3);
  const normal = new Float32Array(most * 3);
  const color = new Float32Array(most * 3);
  const index = new Uint16Array(cells * Math.max(...models.map((model) => model.index.length)));
  /** The trees found in the chunk being built: eight numbers a tree. @type {number[]} */
  const trees = [];

  /**
   * @param {number} cx the chunk's place in the grid of chunks
   * @param {number} cz
   * @returns {Chunk | null}
   */
  function build(cx, cz) {
    trees.length = 0;
    let low = Infinity;
    let high = -Infinity;
    for (let j = 0; j < CHUNK_CELLS; j++) {
      for (let i = 0; i < CHUNK_CELLS; i++) {
        const gx = cx * CHUNK_CELLS + i;
        const gz = cz * CHUNK_CELLS + j;
        const r1 = hash(gx, gz);
        const r2 = hash(gx + 71, gz - 13);
        const x = (gx + 0.5 + (r1 - 0.5) * 0.75) * CELL;
        const z = (gz + 0.5 + (r2 - 0.5) * 0.75) * CELL;
        const h = groundAt(terrain, x, z);
        if (h < DRY) continue;
        const ix = Math.min(n - 1, Math.max(0, Math.floor((x / extent + 0.5) * n)));
        const iz = Math.min(n - 1, Math.max(0, Math.floor((z / extent + 0.5) * n)));
        // No trees on cliffs: the woods thin out where the ground is steep.
        const dx = groundAt(terrain, x + step, z) - groundAt(terrain, x - step, z);
        const dz = groundAt(terrain, x, z + step) - groundAt(terrain, x, z - step);
        const slope = Math.hypot(dx, dz) / (2 * step);
        const wood =
          forest[iz * n + ix] * Math.min(1, Math.max(0, (STEEP - slope) / (STEEP * 0.4)));
        const thin = 0.18 + 0.5 * ((r1 * 7.31) % 1); // thin woods have gaps
        if (wood < 0.1 || wood < thin + 0.07) continue;
        if (lights.some((port) => Math.hypot(port.x - x, port.z - z) < 4)) continue;

        const r3 = hash(gx - 5, gz + 97);
        const leafy = h < LOWLAND && r3 < 0.42 * smooth(LOWLAND, LOWLAND * 0.4, h) ? 1 : 0;
        const size = leafy ? 2.8 + 1.3 * r2 : 3.1 + 1.8 * ((r2 * 5.7) % 1);
        const far = hash(gx + 11, gz - 41) < FAR_SHARE;
        trees.push(
          x,
          h - 0.12 - 0.3 * slope,
          z,
          size,
          leafy,
          hash(gx + 31, gz + 57),
          r3 * 2 * Math.PI,
          far ? REACH : NEAR_REACH * (0.75 + 0.25 * r3),
        );
        low = Math.min(low, h);
        high = Math.max(high, h + size);
      }
    }
    if (!trees.length) return null;

    let corners = 0;
    let filled = 0;
    let farIndex = 0;
    let farTrees = 0;
    // those seen from afar first, so that a far chunk draws the head of its index
    for (const wanted of [true, false]) {
      for (let t = 0; t < trees.length; t += 8) {
        const reach = trees[t + 7];
        if ((reach === REACH) !== wanted) continue;
        if (wanted) farTrees++;
        const size = trees[t + 3];
        const model = models[trees[t + 4]];
        // no two quite the same green, and some are turning
        const own = trees[t + 5];
        const light = 0.8 + 0.38 * own;
        const turned = 0.45 * smooth(0.55, 0.95, own);
        const tint = [light * (1 + 0.4 * turned), light, light * (1 - 0.25 * turned)];
        const c = Math.cos(trees[t + 6]);
        const s = Math.sin(trees[t + 6]);
        for (const k of model.index) index[filled++] = corners + k;
        for (let k = 0; k < model.corners.length; k += 9, corners++) {
          const m = model.corners;
          foot.set([trees[t], trees[t + 1], trees[t + 2], reach], corners * 4);
          offset.set(
            [(m[k] * c + m[k + 2] * s) * size, m[k + 1] * size, (m[k + 2] * c - m[k] * s) * size],
            corners * 3,
          );
          normal.set(
            [m[k + 3] * c + m[k + 5] * s, m[k + 4], m[k + 5] * c - m[k + 3] * s],
            corners * 3,
          );
          color.set([m[k + 6] * tint[0], m[k + 7] * tint[1], m[k + 8] * tint[2]], corners * 3);
        }
      }
      if (wanted) farIndex = filled;
    }
    const mesh = createMesh(
      gl,
      [
        { data: foot.subarray(0, corners * 4), size: 4 },
        { data: offset.subarray(0, corners * 3), size: 3 },
        { data: normal.subarray(0, corners * 3), size: 3 },
        { data: color.subarray(0, corners * 3), size: 3 },
      ],
      index.slice(0, filled),
    );
    return {
      x: (cx + 0.5) * CHUNK,
      y: (low + high) / 2,
      z: (cz + 0.5) * CHUNK,
      radius: Math.hypot(CHUNK * 0.75, (high - low) / 2) + 3,
      mesh,
      far: farIndex,
      farTrees,
      trees: trees.length / 8,
      away: 0,
    };
  }

  /** @param {number} cx @param {number} cz */
  const keyOf = (cx, cz) => (cz + 4096) * 8192 + cx + 4096;

  /** Let go of the chunks the boat has left behind. @param {number} bx @param {number} bz */
  function forget(bx, bz) {
    for (const [key, chunk] of chunks) {
      const cx = (key % 8192) - 4096;
      const cz = Math.floor(key / 8192) - 4096;
      const away = Math.hypot((cx + 0.5) * CHUNK - bx, (cz + 0.5) * CHUNK - bz);
      if (away < REACH + 2 * CHUNK) continue;
      chunk?.mesh.dispose();
      chunks.delete(key);
    }
  }

  return {
    draw(scene) {
      const { x: bx, z: bz } = scene.boat;
      const m = scene.viewProj;
      const aspect = scene.width / scene.height;
      // how far a ball of radius 1 reaches in clip x and y
      const kx = Math.hypot(2.5 / aspect, 1) + (2 * Math.abs(scene.frame.shift[0])) / aspect;
      const ky = Math.hypot(2.5, 1) + 2 * Math.abs(scene.frame.shift[1]);

      seen.length = 0;
      let builds = BUILDS;
      const x0 = Math.floor((bx - REACH) / CHUNK);
      const x1 = Math.floor((bx + REACH) / CHUNK);
      const z0 = Math.floor((bz - REACH) / CHUNK);
      const z1 = Math.floor((bz + REACH) / CHUNK);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          // from the boat to the nearest point of the chunk
          const nx = Math.max(cx * CHUNK - bx, 0, bx - (cx + 1) * CHUNK);
          const nz = Math.max(cz * CHUNK - bz, 0, bz - (cz + 1) * CHUNK);
          const away = Math.hypot(nx, nz);
          if (away > REACH) continue;
          const key = keyOf(cx, cz);
          let chunk = chunks.get(key);
          if (chunk === undefined) {
            // a few a frame, but those at hand at once
            if (builds <= 0 && away > CHUNK) continue;
            builds--;
            chunk = build(cx, cz);
            chunks.set(key, chunk);
          }
          if (!chunk) continue;
          // in the view?
          const w = m[3] * chunk.x + m[7] * chunk.y + m[11] * chunk.z + m[15];
          const r = chunk.radius;
          if (w < -r) continue;
          const px = m[0] * chunk.x + m[4] * chunk.y + m[8] * chunk.z + m[12];
          if (Math.abs(px) > w + r * kx) continue;
          const py = m[1] * chunk.x + m[5] * chunk.y + m[9] * chunk.z + m[13];
          if (Math.abs(py) > w + r * ky) continue;
          chunk.away = away;
          seen.push(chunk);
        }
      }
      if (chunks.size > KEPT) forget(bx, bz);
      if (!seen.length) return;

      // nearest first, so that the cap (and the depth buffer) spares the trees that matter
      seen.sort((a, b) => a.away - b.away);
      scene.bind(program);
      let left = MOST_TREES;
      for (const chunk of seen) {
        const few = chunk.away > NEAR_REACH;
        const count = few ? chunk.farTrees : chunk.trees;
        if (count > left) break;
        left -= count;
        if (!count) continue;
        gl.bindVertexArray(chunk.mesh.vao);
        gl.drawElements(gl.TRIANGLES, few ? chunk.far : chunk.mesh.count, gl.UNSIGNED_SHORT, 0);
      }
    },
    dispose() {
      for (const chunk of chunks.values()) chunk?.mesh.dispose();
      chunks.clear();
    },
  };
}
