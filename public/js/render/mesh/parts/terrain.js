// The land: the height grid as flat-shaded facets. The world is a quadtree of square blocks,
// each a dozen facets a side whatever its size: a block near the eye gives way to four of half
// the size, down to one facet for each cell of the grid, unless its facets already lie close
// enough to the ground for the distance. Blocks are built when first wanted and kept while in
// use; those that are all sea are never built, and those out of sight are not drawn. A block
// hangs a skirt from its edges, drawn where its neighbour is of another size, so no sky shows
// between two levels. The sea cave is left open: fragments inside its hollow (../cave-shape.js)
// are discarded.
//
// What costs here is the count of triangles (a software rasteriser sets up about five thousand
// in a millisecond), so vertices are shared: a facet takes its colour and its normal from its
// last corner (the varyings are flat), and each grid point has two vertices, one for each of
// the two facets it is the last corner of.

import { CAVE_SHAPE, bindCave } from '../cave-shape.js';
import { createMesh } from '../gl.js';
import { LAKE_DROP, sampler } from '../heights.js';
import { COMMON } from '../look.js';
import { forViews } from '../variants.js';

/** @typedef {import('../gl.js').Mesh} Mesh */

/** Facets along a side of every block, whatever its size. */
const FACETS = 12;
/** Cells of the grid along the coarsest blocks and along the finest (one facet to a cell). */
const COARSEST = 192;
const FINEST = FACETS;
/** Levels of detail, from the coarsest to the finest: each halves the block. */
const DEPTHS = Math.log2(COARSEST / FINEST) + 1;
/** A block gives way to four finer ones when the eye is within this many of its sides. */
const DETAIL = 1.1;
/** ...and its facets stray from the ground by more than this share of the distance to it. */
const TOLERANCE = 0.025;
/** Ground whose cell lies wholly under this is left to the sea. */
const AWASH = -0.4;
/** Blocks kept built. */
const KEPT = 400;

const VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec4 aPos;      // xyz, and how much bare rock (strata) the facet shows
layout(location = 1) in vec3 aNormal;   // of the facet
layout(location = 2) in vec4 aColor;    // albedo, and the glow of lava
${COMMON}
flat out vec4 vCol;
out vec4 vPos;                          // xyz in the world, and the haze
void main(){
  // the sun and the sky, and a little of the sun's light come round by the air
  vec3 col = lit(aColor.rgb, aNormal) + aColor.rgb*uSunCol*0.14;
  float pulse = 0.85 + 0.15*sin(uTime*1.7 + aPos.x*0.9 + aPos.z*0.7);
  col += vec3(1.0, 0.36, 0.08)*2.2*aColor.a*pulse;
  vCol = vec4(col, 0.3*aPos.w);
  vPos = vec4(aPos.xyz, hazeAt(aPos.xyz));
  gl_Position = uViewProj*vec4(aPos.xyz, 1.0);
}`;

/** @param {boolean} cave @param {string} finish */
const fragment = (cave, finish) => /* glsl */ `#version 300 es
precision highp float;
${COMMON}
${finish}
${cave ? CAVE_SHAPE : ''}
flat in vec4 vCol;
in vec4 vPos;
out vec4 outColor;
void main(){
  ${cave ? 'if (caveD(vPos.xyz) < 0.0) discard;' : ''}
  // strata: beds of darker rock across the bare faces
  outColor = vec4(finish(vCol.rgb*(1.0 - vCol.a*step(0.55, fract(vPos.y*0.31))), vPos.w), 1.0);
}`;

/**
 * @typedef {object} Block
 * @property {Mesh | null} mesh null where there is no land
 * @property {number} x0 bounds in the world
 * @property {number} x1
 * @property {number} z0
 * @property {number} z1
 * @property {number} low
 * @property {number} high
 * @property {boolean} cave whether the cave's hollow reaches this block
 * @property {[number, number, number]} place its depth in the tree, and its column and row there
 * @property {number} seen the frame it was last drawn in
 * @property {number} error how far its facets stray from the ground, in units
 * @property {number} leaf the frame it was last drawn in as it is, not as finer blocks
 * @property {number} out the frame it was last found out of sight or all sea
 * @property {number} grounds indices of its ground, which come first
 * @property {number} indices indices of its ground and its skirts
 */

/** @param {number} a @param {number} b @param {number} x */
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** @param {number} x @param {number} z */
const hash = (x, z) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** @param {import('../renderer.js').Kit} kit @returns {import('../renderer.js').Part} */
export function createTerrain({ gl, programs, terrain }) {
  const { n, extent, forest, volcano, cave } = terrain;
  const cell = extent / (n - 1);
  const half = extent / 2;
  const at = sampler(terrain);
  const lake = volcano.height - LAKE_DROP;

  const attributes = ['aPos', 'aNormal', 'aColor'];
  const plainFor = forViews(programs, VERTEX, (finish) => fragment(false, finish), attributes);
  const holedFor = forViews(programs, VERTEX, (finish) => fragment(true, finish), attributes);

  // Room for the largest block: two vertices to a grid point (each carries the colour and the
  // normal of the one facet it is the last corner of), and a skirt all round.
  const pos = new Float32Array(((FACETS + 1) ** 2 * 2 + FACETS * 16) * 4);
  const nor = new Float32Array((pos.length / 4) * 3);
  const col = new Float32Array(pos.length);
  const index = new Uint16Array(FACETS * FACETS * 6 + FACETS * 24);
  let filled = 0;
  let indexed = 0;
  const tint = [0, 0, 0, 0, 0]; // r, g, b, glow, rock

  /**
   * The colour of a facet: sand by the water, grass, woods, rock where it is steep, the
   * volcano's basalt and its lava.
   * @param {number} x @param {number} z @param {number} h height of its middle
   * @param {number} up the y of its normal
   */
  function paint(x, z, h, up) {
    const ix = Math.min(n - 1, Math.max(0, Math.round((x + half) / cell)));
    const iz = Math.min(n - 1, Math.max(0, Math.round((z + half) / cell)));
    const wood = h > 1 ? smooth(0.2, 0.55, forest[iz * n + ix]) : 0;
    const own = hash(Math.round(x * 4), Math.round(z * 4));
    const patch = 0.5 + 0.5 * Math.sin(x * 0.043 + 2 * Math.sin(z * 0.027));
    const drift = 0.5 + 0.5 * Math.sin(x * 0.11 - z * 0.17);
    // dry grass, greener in the hollows
    let r = 0.33 + 0.25 * patch;
    let g = 0.42 + 0.09 * patch;
    let b = 0.14 + 0.08 * patch;
    const shade = 0.9 + 0.2 * own;
    r *= shade;
    g *= shade;
    b *= shade;
    /** @param {number} tr @param {number} tg @param {number} tb @param {number} k */
    const blend = (tr, tg, tb, k) => {
      r += (tr - r) * k;
      g += (tg - g) * k;
      b += (tb - b) * k;
    };
    const leaf = 0.8 + 0.45 * own;
    blend(0.07 * leaf, 0.21 * leaf, 0.11 * leaf, wood);
    const steep = 1 - smooth(0.6, 0.84, up + 0.08 * (own - 0.5));
    blend(0.7 - 0.16 * drift, 0.47 - 0.14 * drift, 0.3 - 0.09 * drift, steep);
    let rock = steep;
    let glow = 0;
    const vr = Math.hypot(x - volcano.x, z - volcano.z);
    const cone = 1 - smooth(0.3, 0.72, vr / volcano.radius + 0.12 * (drift - 0.5));
    if (cone > 0) {
      blend(0.1 + 0.1 * own, 0.085 + 0.03 * own, 0.09, cone);
      rock *= 1 - 0.5 * cone;
      // the lake of lava, and its light on the crater's rim
      glow =
        0.3 *
        smooth(volcano.crater * 2.4, volcano.crater, vr) *
        smooth(volcano.height - 16, volcano.height - 2, h);
      if (vr < volcano.crater * 1.05 && h < lake + 0.4) {
        glow = 0.75 + 0.5 * own;
        blend(0.3, 0.05, 0.02, 1);
        rock = 0;
      }
    } else {
      blend(0.78, 0.76, 0.72, smooth(30, 40, h)); // pale rock on the highest tops
    }
    const sand = (1 - smooth(0.9, 2.2, h + 0.5 * (patch - 0.5))) * smooth(0.5, 0.8, up);
    const grain = 0.93 + 0.14 * own;
    blend(0.95 * grain, 0.83 * grain, 0.58 * grain, sand);
    rock *= 1 - sand;
    const wet = 0.62 + 0.38 * smooth(0, 0.4, h);
    tint[0] = r * wet;
    tint[1] = g * wet;
    tint[2] = b * wet;
    tint[3] = glow;
    tint[4] = rock;
  }

  /**
   * Give vertex v the colour in `tint` and a normal. A facet is flat: it takes both from its
   * last corner.
   * @param {number} v @param {number} nx @param {number} ny @param {number} nz
   */
  function dress(v, nx, ny, nz) {
    pos[v * 4 + 3] = tint[4];
    nor[v * 3] = nx;
    nor[v * 3 + 1] = ny;
    nor[v * 3 + 2] = nz;
    col[v * 4] = tint[0];
    col[v * 4 + 1] = tint[1];
    col[v * 4 + 2] = tint[2];
    col[v * 4 + 3] = tint[3];
  }

  /**
   * A facet of the ground on vertices a, b, c (cross(b - a, c - a) points up), painted by its
   * height and its slope; c carries its colour.
   * @param {number} a @param {number} b @param {number} c
   */
  function ground(a, b, c) {
    const ax = pos[a * 4];
    const ay = pos[a * 4 + 1];
    const az = pos[a * 4 + 2];
    const ux = pos[b * 4] - ax;
    const uy = pos[b * 4 + 1] - ay;
    const uz = pos[b * 4 + 2] - az;
    const vx = pos[c * 4] - ax;
    const vy = pos[c * 4 + 1] - ay;
    const vz = pos[c * 4 + 2] - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    paint(ax + (ux + vx) / 3, az + (uz + vz) / 3, ay + (uy + vy) / 3, ny);
    dress(c, nx, ny, nz);
    index[indexed++] = a;
    index[indexed++] = b;
    index[indexed++] = c;
  }

  /**
   * The skirt under one edge of a block, between vertices a and b, facing (ox, oz); in the
   * colour of the ground above it.
   * @param {number} a @param {number} b @param {number} ox @param {number} oz
   * @param {number} drop
   */
  function skirt(a, b, ox, oz, drop) {
    const ax = pos[a * 4];
    const ay = pos[a * 4 + 1];
    const az = pos[a * 4 + 2];
    const bx = pos[b * 4];
    const by = pos[b * 4 + 1];
    const bz = pos[b * 4 + 2];
    paint((ax + bx) / 2, (az + bz) / 2, (ay + by) / 2, 0.9);
    const v = filled;
    pos.set([ax, ay, az, 0, bx, by, bz, 0, bx, by - drop, bz, 0, ax, ay - drop, az, 0], v * 4);
    for (let k = 0; k < 4; k++) dress(v + k, 0, 1, 0);
    filled += 4;
    // seen from outside, a to b runs to the right when cross(b - a, down) points out
    const out = (bz - az) * ox - (bx - ax) * oz > 0;
    index.set(
      out ? [v, v + 1, v + 2, v, v + 2, v + 3] : [v + 1, v, v + 3, v + 1, v + 3, v + 2],
      indexed,
    );
    indexed += 6;
  }

  /**
   * Build the block whose south-west sample is (ix0, iz0).
   * @param {number} ix0 @param {number} iz0 @param {number} cells along a side
   * @param {number} step samples between vertices
   * @returns {Block}
   */
  function build(ix0, iz0, cells, step) {
    const side = cells / step;
    const across = side + 1;
    let low = Infinity;
    let high = -Infinity;
    for (let j = 0; j <= side; j++) {
      for (let i = 0; i <= side; i++) {
        const ix = ix0 + i * step;
        const iz = iz0 + j * step;
        let h = at(ix, iz);
        if (step >= 4 && h < 1) {
          // Far off, a skerry between two vertices would be lost: let it lift the nearest.
          const reach = step / 3;
          let near = h;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              near = Math.max(near, at(Math.round(ix + dx * reach), Math.round(iz + dz * reach)));
            }
          }
          h = Math.min(near, Math.max(h, 1));
        }
        low = Math.min(low, h);
        high = Math.max(high, h);
        const v = (j * across + i) * 2;
        pos.set([ix * cell - half, h, iz * cell - half, 0], v * 4);
        pos.set([ix * cell - half, h, iz * cell - half, 0], v * 4 + 4);
      }
    }
    // How far this block's facets stray from the ground they stand for, in units of height; at
    // the waterline it counts threefold, since there it moves the shore.
    let error = 0;
    if (step > 1) {
      const stride = Math.max(1, step / 4);
      for (let dz = 0; dz <= cells; dz += stride) {
        const j = Math.min(side - 1, Math.floor(dz / step));
        const fz = dz / step - j;
        for (let dx = 0; dx <= cells; dx += stride) {
          const i = Math.min(side - 1, Math.floor(dx / step));
          const fx = dx / step - i;
          const v = (j * across + i) * 8;
          const south = pos[v + 1] * (1 - fx) + pos[v + 9] * fx;
          const north = pos[v + across * 8 + 1] * (1 - fx) + pos[v + across * 8 + 9] * fx;
          const truth = at(ix0 + dx, iz0 + dz);
          const off = Math.abs(south * (1 - fz) + north * fz - truth);
          error = Math.max(error, truth > -1.5 && truth < 1.5 ? 3 * off : off);
        }
      }
    }
    filled = across * across * 2;
    indexed = 0;
    const drop = 0.6 + cell * step * 0.7;
    if (high > AWASH) {
      for (let j = 0; j < side; j++) {
        for (let i = 0; i < side; i++) {
          const a = (j * across + i) * 2;
          const b = a + 2;
          const c = a + across * 2;
          const d = c + 2;
          if (Math.max(pos[a * 4 + 1], pos[b * 4 + 1], pos[c * 4 + 1], pos[d * 4 + 1]) < AWASH) {
            continue;
          }
          ground(c, d, a);
          ground(d, b, a + 1);
        }
      }
    }
    const grounds = indexed;
    for (let j = 0; j < side && grounds; j++) {
      for (let i = 0; i < side; i++) {
        if (i > 0 && i < side - 1 && j > 0 && j < side - 1) continue;
        const a = (j * across + i) * 2;
        const b = a + 2;
        const c = a + across * 2;
        const d = c + 2;
        if (Math.max(pos[a * 4 + 1], pos[b * 4 + 1], pos[c * 4 + 1], pos[d * 4 + 1]) < AWASH) {
          continue;
        }
        if (j === 0) skirt(a, b, 0, -1, drop);
        if (j === side - 1) skirt(c, d, 0, 1, drop);
        if (i === 0) skirt(a, c, -1, 0, drop);
        if (i === side - 1) skirt(b, d, 1, 0, drop);
      }
    }
    const x0 = ix0 * cell - half;
    const z0 = iz0 * cell - half;
    const x1 = x0 + cells * cell;
    const z1 = z0 + cells * cell;
    const reach = cave.hall + 2;
    return {
      mesh: indexed
        ? createMesh(
            gl,
            [
              { data: pos.subarray(0, filled * 4), size: 4 },
              { data: nor.subarray(0, filled * 3), size: 3 },
              { data: col.subarray(0, filled * 4), size: 4 },
            ],
            index.slice(0, indexed),
          )
        : null,
      x0,
      x1,
      z0,
      z1,
      low: low - drop,
      high: Math.max(high, top(ix0, iz0, cells)),
      cave:
        x1 > Math.min(cave.ax, cave.bx) - reach &&
        x0 < Math.max(cave.ax, cave.bx) + reach &&
        z1 > Math.min(cave.az, cave.bz) - reach &&
        z0 < Math.max(cave.az, cave.bz) + reach,
      place: [0, 0, 0],
      seen: 0,
      leaf: 0,
      out: 0,
      error,
      grounds,
      indices: indexed,
    };
  }

  // The highest ground in each of the finest blocks, so that a block which is all sea is known
  // without building it, however coarse its own vertices are.
  const blocks = Math.ceil((n - 1) / FINEST);
  const tops = new Float32Array(blocks * blocks).fill(-Infinity);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const h = at(ix, iz);
      // a sample on the line between two blocks belongs to both
      for (
        let bz = Math.max(0, Math.ceil(iz / FINEST) - 1);
        bz <= iz / FINEST && bz < blocks;
        bz++
      ) {
        for (
          let bx = Math.max(0, Math.ceil(ix / FINEST) - 1);
          bx <= ix / FINEST && bx < blocks;
          bx++
        ) {
          if (h > tops[bz * blocks + bx]) tops[bz * blocks + bx] = h;
        }
      }
    }
  }
  /** @param {number} ix0 @param {number} iz0 @param {number} cells */
  function top(ix0, iz0, cells) {
    let high = -Infinity;
    const b0 = ix0 / FINEST;
    const z0 = iz0 / FINEST;
    for (let bz = z0; bz < Math.min(blocks, z0 + cells / FINEST); bz++) {
      for (let bx = b0; bx < Math.min(blocks, b0 + cells / FINEST); bx++) {
        high = Math.max(high, tops[bz * blocks + bx]);
      }
    }
    return high;
  }

  /** The blocks built so far, by level and place. @type {Map<number, Block>} */
  const kept = new Map();
  let frame = 0;

  /**
   * @param {number} depth 0 for the coarsest @param {number} tx @param {number} tz
   */
  function blockAt(depth, tx, tz) {
    const key = (depth * 1024 + tz) * 1024 + tx;
    let found = kept.get(key);
    if (!found) {
      const cells = COARSEST >> depth;
      found = build(tx * cells, tz * cells, cells, (COARSEST / FACETS) >> depth);
      found.place = [depth, tx, tz];
      kept.set(key, found);
    }
    found.seen = frame;
    return found;
  }

  function forget() {
    if (kept.size <= KEPT) return;
    const old = [...kept.entries()]
      .filter(([, b]) => b.seen !== frame)
      .sort((a, b) => a[1].seen - b[1].seen);
    for (const [key, b] of old.slice(0, kept.size - KEPT)) {
      b.mesh?.dispose();
      kept.delete(key);
    }
  }

  // The frustum, as five planes (left, right, bottom, top, near) taken from the matrix.
  const planes = new Float32Array(20);
  /** @param {Float32Array} m */
  function frustum(m) {
    for (let k = 0; k < 4; k++) {
      const w = m[k * 4 + 3];
      planes[k] = w + m[k * 4];
      planes[4 + k] = w - m[k * 4];
      planes[8 + k] = w + m[k * 4 + 1];
      planes[12 + k] = w - m[k * 4 + 1];
      planes[16 + k] = w + m[k * 4 + 2];
    }
  }
  /** @param {Block} t */
  function visible(t) {
    for (let p = 0; p < 20; p += 4) {
      const a = planes[p];
      const b = planes[p + 1];
      const c = planes[p + 2];
      const d =
        a * (a > 0 ? t.x1 : t.x0) + b * (b > 0 ? t.high : t.low) + c * (c > 0 ? t.z1 : t.z0);
      if (d + planes[p + 3] < 0) return false;
    }
    return true;
  }

  /** What to draw this frame: the blocks in the open, and those the cave runs under. */
  /** @type {Block[]} */
  const open = [];
  /** @type {Block[]} */
  const holedOnes = [];

  /**
   * Draw a block, or the four finer ones in its place when the eye is near.
   * @param {number} depth @param {number} tx @param {number} tz
   * @param {number} ex @param {number} ez where the eye is
   */
  function walk(depth, tx, tz, ex, ez) {
    const b = blockAt(depth, tx, tz);
    if (b.high < AWASH || !visible(b)) {
      b.out = frame;
      return;
    }
    const away = Math.hypot(Math.max(b.x0 - ex, 0, ex - b.x1), Math.max(b.z0 - ez, 0, ez - b.z1));
    const size = b.x1 - b.x0;
    if (
      depth < DEPTHS - 1 &&
      away < DETAIL * size &&
      b.error > TOLERANCE * Math.max(away, 0.25 * size)
    ) {
      for (let k = 0; k < 4; k++) walk(depth + 1, tx * 2 + (k & 1), tz * 2 + (k >> 1), ex, ez);
      return;
    }
    b.leaf = frame;
    if (b.mesh) {
      (b.cave ? holedOnes : open).push(b);
    }
  }

  /** Blocks along a side of the world at each depth. */
  const widths = Array.from({ length: DEPTHS }, (_, d) => Math.ceil((n - 1) / (COARSEST >> d)));

  /**
   * Is the block beside this one drawn at the same level (or not at all)? Then the two meet
   * vertex for vertex, and there is no crack for a skirt to hide.
   * @param {number} depth @param {number} tx @param {number} tz
   */
  function flush(depth, tx, tz) {
    if (tx < 0 || tz < 0 || tx >= widths[depth] || tz >= widths[depth]) return true;
    const b = kept.get((depth * 1024 + tz) * 1024 + tx);
    return b !== undefined && (b.leaf === frame || b.out === frame);
  }

  /** @param {Block[]} list */
  function drawAll(list) {
    for (const b of list) {
      if (!b.mesh) continue;
      const [depth, tx, tz] = b.place;
      const snug =
        flush(depth, tx - 1, tz) &&
        flush(depth, tx + 1, tz) &&
        flush(depth, tx, tz - 1) &&
        flush(depth, tx, tz + 1);
      const count = snug ? b.grounds : b.indices;
      gl.bindVertexArray(b.mesh.vao);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    }
  }

  const roots = Math.ceil((n - 1) / COARSEST);

  return {
    draw(scene) {
      frame++;
      open.length = 0;
      holedOnes.length = 0;
      frustum(scene.viewProj);
      for (let tz = 0; tz < roots; tz++) {
        for (let tx = 0; tx < roots; tx++) walk(0, tx, tz, scene.eye[0], scene.eye[2]);
      }
      if (open.length) {
        scene.bind(plainFor(scene.mode));
        drawAll(open);
      }
      if (holedOnes.length) {
        const holed = holedFor(scene.mode);
        scene.bind(holed);
        bindCave(gl, holed, cave);
        drawAll(holedOnes);
      }
      forget();
    },
    dispose() {
      for (const b of kept.values()) b.mesh?.dispose();
      kept.clear();
    },
  };
}
