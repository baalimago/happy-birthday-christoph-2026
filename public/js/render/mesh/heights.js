// The height grid, as the mesh renderer reads it: the ground at a sample or at a point, and the
// small texture the sea looks its depth up in.

import { caveCeiling } from './cave-shape.js';

/** @typedef {import('../renderer.js').RenderTerrain} RenderTerrain */

/** How far the floor of the crater (the lava lake) lies under the volcano's top. */
export const LAKE_DROP = 5;

/**
 * The ground at a sample of the grid, as the land's mesh draws it: the height grid, with the
 * crater filled to the level of its lava lake. Indices are clamped to the grid.
 * @param {RenderTerrain} terrain
 * @returns {(ix: number, iz: number) => number}
 */
export function sampler(terrain) {
  const { n, extent, heights, volcano } = terrain;
  const step = extent / (n - 1);
  const half = extent / 2;
  const lake = volcano.height - LAKE_DROP;
  const reach = volcano.crater * volcano.crater;
  return (ix, iz) => {
    const cx = ix < 0 ? 0 : ix > n - 1 ? n - 1 : ix;
    const cz = iz < 0 ? 0 : iz > n - 1 ? n - 1 : iz;
    const h = heights[cz * n + cx];
    if (h > 1 && h < lake) {
      const dx = cx * step - half - volcano.x;
      const dz = cz * step - half - volcano.z;
      if (dx * dx + dz * dz < reach) return lake;
    }
    return h;
  };
}

/**
 * The height of the ground at a point of the world (bilinear, as the finest mesh draws it up to
 * the choice of each cell's diagonal). For standing things on the land.
 * @param {RenderTerrain} terrain @param {number} x @param {number} z
 */
export function groundHeight(terrain, x, z) {
  const { n, extent } = terrain;
  const at = sampler(terrain);
  const gx = Math.min(n - 1, Math.max(0, ((x + extent / 2) / extent) * (n - 1)));
  const gz = Math.min(n - 1, Math.max(0, ((z + extent / 2) / extent) * (n - 1)));
  const ix = Math.min(n - 2, Math.floor(gx));
  const iz = Math.min(n - 2, Math.floor(gz));
  const fx = gx - ix;
  const fz = gz - iz;
  const south = at(ix, iz) * (1 - fx) + at(ix + 1, iz) * fx;
  const north = at(ix, iz + 1) * (1 - fx) + at(ix + 1, iz + 1) * fx;
  return south * (1 - fz) + north * fz;
}

/** Side of the sea's map. */
const MAP = 768;
/** How dark the water is, well inside the cave. */
const GLOOM = 0.82;

/**
 * The world for the sea, uploaded once, with everything the sea's shader wants ready to use
 * (a pixel of the sea is paid for on the processor, so nothing is left for it to work out):
 *   red    how deep the water is, as a blend: 0 over the shallows, 1 over the deep
 *   green  the light on the water: 1 in the open, falling to 1 - GLOOM well inside the cave
 *   blue   the shore: 0 where the ground is half a unit under water, 0.5 at the waterline,
 *          1 half a unit above (the water of the cave counts as sea)
 * A world point (x, z) is at texture coordinate (x, z)*scale + offset.
 * @param {WebGL2RenderingContext} gl @param {RenderTerrain} terrain
 * @returns {{ texture: WebGLTexture, scale: number, offset: number }}
 */
export function createDepthMap(gl, terrain) {
  const { n, extent, heights, cave } = terrain;
  const step = extent / (n - 1);
  const half = extent / 2;
  const per = n / MAP; // samples per texel, a whole number for the grids the game builds
  const size = Math.max(1, Math.round(per));
  const data = new Uint8Array(MAP * MAP * 3);
  for (let j = 0; j < MAP; j++) {
    for (let i = 0; i < MAP; i++) {
      let sum = 0;
      let count = 0;
      for (let dz = 0; dz < size; dz++) {
        const row = Math.min(n - 1, Math.floor(j * per) + dz) * n;
        for (let dx = 0; dx < size; dx++) {
          sum += heights[row + Math.min(n - 1, Math.floor(i * per) + dx)];
          count++;
        }
      }
      let h = sum / count;
      // the middle of the texel, in the world
      const x = (i * per + (size - 1) / 2) * step - half;
      const z = (j * per + (size - 1) / 2) * step - half;
      const roof = caveCeiling(cave, x, z);
      // Under the rock the water is the cave's: deepest in the middle, awash at the walls.
      if (roof > 0 && h > -1) h = Math.min(h, 0.15 - 0.55 * roof);
      const o = (j * MAP + i) * 3;
      data[o] = Math.round(255 * Math.min(1, Math.max(0, -0.28 * h - 0.1)));
      data[o + 1] = Math.round(255 * (1 - GLOOM * caveGloom(cave, x, z)));
      data[o + 2] = Math.round(255 * Math.min(1, Math.max(0, h + 0.5)));
    }
  }
  const texture = gl.createTexture();
  if (!texture) throw new Error('no texture object');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, MAP, MAP, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // Sample s of the grid lies at (s + 0.5)/n across the texture, and at s*step - half in the world.
  return { texture, scale: 1 / (step * n), offset: (half / step + 0.5) / n };
}

/**
 * How dark it is over the water at (x, z): 0 in the open, 1 well inside the sea cave.
 * @param {RenderTerrain['cave']} cave @param {number} x @param {number} z
 */
export function caveGloom(cave, x, z) {
  if (caveCeiling(cave, x, z) <= 0) return 0;
  const ex = cave.bx - cave.ax;
  const ez = cave.bz - cave.az;
  const into = ((x - cave.ax) * ex + (z - cave.az) * ez) / (Math.hypot(ex, ez) || 1);
  return Math.min(1, Math.max(0, (into - 6) / 22));
}

/** Samples along a side of a cell of the table of deep water. */
const DEEP_CELL = 16;

/**
 * Where the sea is deep and nothing else: the answer says whether the whole of a rectangle of
 * the world lies over water so deep that the depth map holds nothing there (red 1, green 1,
 * blue 0), with a margin of one cell. The sea draws such water without looking at the map.
 * @param {RenderTerrain} terrain
 * @returns {(x0: number, z0: number, x1: number, z1: number) => boolean}
 */
export function deepWater(terrain) {
  const { n, extent, heights } = terrain;
  const side = Math.ceil(n / DEEP_CELL);
  const size = (extent / (n - 1)) * DEEP_CELL;
  const half = extent / 2;
  const shoal = new Uint8Array(side * side);
  for (let iz = 0; iz < n; iz++) {
    const row = Math.floor(iz / DEEP_CELL) * side;
    for (let ix = 0; ix < n; ix++) {
      // red is 1 from 3.93 units down
      if (heights[iz * n + ix] > -4.3) shoal[row + Math.floor(ix / DEEP_CELL)] = 1;
    }
  }
  // the margin: a cell beside a shoal is not deep either
  const wide = new Uint8Array(side * side);
  for (let cz = 0; cz < side; cz++) {
    for (let cx = 0; cx < side; cx++) {
      if (!shoal[cz * side + cx]) continue;
      for (let dz = Math.max(0, cz - 1); dz <= Math.min(side - 1, cz + 1); dz++) {
        for (let dx = Math.max(0, cx - 1); dx <= Math.min(side - 1, cx + 1); dx++) {
          wide[dz * side + dx] = 1;
        }
      }
    }
  }
  /** @param {number} v */
  const cellOf = (v) => Math.min(side - 1, Math.max(0, Math.floor((v + half) / size)));
  return (x0, z0, x1, z1) => {
    const cx0 = cellOf(x0);
    const cx1 = cellOf(x1);
    const cz0 = cellOf(z0);
    const cz1 = cellOf(z1);
    if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > 64) return false; // too much to ask about
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) if (wide[cz * side + cx]) return false;
    }
    return true;
  };
}
