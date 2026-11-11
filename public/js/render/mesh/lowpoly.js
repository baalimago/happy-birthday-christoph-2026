// A small modelling kit for flat-shaded things: triangles with their own corners (so every facet
// has one normal and one colour), lofts through rings of points, and a few ready shapes. Used by
// the creatures and the cave; everything is built once, on the CPU.
//
// A vertex has four attributes, in this order: position (3), facet normal (3), colour (3) and a
// spare vec4 that the part's vertex shader reads as it likes (which limb a vertex belongs to, a
// pivot, a joint): set it with `mark` before adding the triangles it applies to.

import { createMesh } from './gl.js';

/** @typedef {readonly [number, number, number]} Vec */
/** @typedef {Vec | ((centre: Vec, normal: Vec) => Vec)} Paint a colour, or one worked out per facet */

/**
 * @typedef {object} Shape
 * @property {(a?: number, b?: number, c?: number, d?: number) => void} mark the spare attribute of
 *   the triangles that follow
 * @property {(a: Vec, b: Vec, c: Vec, paint: Paint, away?: Vec, inward?: boolean) => void} tri a
 *   facet; its front is where cross(b - a, c - a) points, or, given `away`, the side that looks
 *   away from that point (towards it with `inward`)
 * @property {(points: readonly Vec[], top: Paint, under?: Paint) => void} plate a flat fan of
 *   points seen from both sides: fins, wings, flukes
 * @property {(base: readonly Vec[], tip: Vec, paint: Paint) => void} spike a closed fan from a ring
 *   of base points to a tip (and a cap over the base): a thick fin, a beak
 * @property {(rings: readonly (readonly Vec[])[], paint: Paint, options?: { inward?: boolean,
 *   open?: boolean }) => void} loft skin between successive rings of as many points each; the
 *   rings are closed loops unless `open`; `inward` faces the skin at its own middle (a cave)
 * @property {(centre: Vec, radii: Vec, sides: number, bands: number, paint: Paint) => void} ball
 *   an ellipsoid of `bands` rings between its poles
 * @property {(raw: readonly number[]) => void} vertex one vertex, all thirteen numbers, as given
 * @property {() => number} triangles
 * @property {(gl: WebGL2RenderingContext) => import('./gl.js').Mesh} mesh upload it
 */

/** @param {Vec} a @param {Vec} b @returns {Vec} */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @param {Vec} a @param {Vec} b @returns {Vec} */
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** @param {Vec} a @param {Vec} b */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** @param {readonly Vec[]} points @returns {Vec} */
export function middle(points) {
  const m = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i++) m[i] += p[i] / points.length;
  return [m[0], m[1], m[2]];
}

/**
 * A number in 0..1 that depends only on what is given: speckle and jitter that are the same on
 * every machine.
 * @param {number} a @param {number} [b] @param {number} [c]
 */
export function hash(a, b = 0, c = 0) {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A ring of `sides` points round the z axis at `z`: an ellipse `rx` wide and `ry` high about
 * (0, cy), starting at the top.
 * @param {number} sides @param {number} z @param {number} rx @param {number} ry
 * @param {number} [cy]
 * @returns {Vec[]}
 */
export function ringZ(sides, z, rx, ry, cy = 0) {
  /** @type {Vec[]} */
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = ((i + 0.5) / sides) * Math.PI * 2;
    ring.push([Math.sin(a) * rx, cy + Math.cos(a) * ry, z]);
  }
  return ring;
}

/**
 * A ring of `sides` points round the y axis at height `y`.
 * @param {number} sides @param {number} y @param {number} rx @param {number} rz
 * @param {number} [turn] in sides
 * @returns {Vec[]}
 */
export function ringY(sides, y, rx, rz, turn = 0) {
  /** @type {Vec[]} */
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = ((i + turn) / sides) * Math.PI * 2;
    ring.push([Math.sin(a) * rx, y, Math.cos(a) * rz]);
  }
  return ring;
}

/** @returns {Shape} */
export function createShape() {
  /** @type {number[]} */
  const data = [];
  let spare = [0, 0, 0, 0];

  /** @type {Shape['tri']} */
  function tri(a, b, c, paint, away, inward = false) {
    let n = cross(sub(b, a), sub(c, a));
    const area = Math.hypot(n[0], n[1], n[2]);
    if (area < 1e-9) return;
    const centre = middle([a, b, c]);
    if (away && dot(n, sub(centre, away)) < 0 !== inward) {
      [b, c] = [c, b];
      n = [-n[0], -n[1], -n[2]];
    }
    /** @type {Vec} */
    const normal = [n[0] / area, n[1] / area, n[2] / area];
    const colour = typeof paint === 'function' ? paint(centre, normal) : paint;
    for (const p of [a, b, c]) data.push(...p, ...normal, ...colour, ...spare);
  }

  return {
    mark(a = 0, b = 0, c = 0, d = 0) {
      spare = [a, b, c, d];
    },
    tri,
    plate(points, top, under = top) {
      for (let i = 1; i + 1 < points.length; i++) {
        const n = cross(sub(points[i], points[0]), sub(points[i + 1], points[0]));
        const up = n[1] >= 0;
        tri(points[0], points[i], points[i + 1], up ? top : under);
        tri(points[0], points[i + 1], points[i], up ? under : top);
      }
    },
    spike(base, tip, paint) {
      const inside = middle([...base, tip]);
      for (let i = 0; i < base.length; i++) {
        tri(base[i], base[(i + 1) % base.length], tip, paint, inside);
      }
      for (let i = 1; i + 1 < base.length; i++) tri(base[0], base[i], base[i + 1], paint, inside);
    },
    loft(rings, paint, { inward = false, open = false } = {}) {
      for (let r = 0; r + 1 < rings.length; r++) {
        const lower = rings[r];
        const upper = rings[r + 1];
        const inside = middle([...lower, ...upper]);
        const count = lower.length;
        for (let i = 0; i < (open ? count - 1 : count); i++) {
          const j = (i + 1) % count;
          // split each quad along alternate diagonals, so the facets do not all lean one way
          if ((r + i) % 2 === 0) {
            tri(lower[i], lower[j], upper[j], paint, inside, inward);
            tri(lower[i], upper[j], upper[i], paint, inside, inward);
          } else {
            tri(lower[i], lower[j], upper[i], paint, inside, inward);
            tri(lower[j], upper[j], upper[i], paint, inside, inward);
          }
        }
      }
    },
    ball(centre, radii, sides, bands, paint) {
      /** @type {Vec[][]} */
      const rings = [];
      for (let b = 0; b <= bands; b++) {
        const lat = (b / bands - 0.5) * Math.PI;
        const r = Math.max(0, Math.cos(lat));
        rings.push(
          ringY(sides, Math.sin(lat) * radii[1], r * radii[0], r * radii[2], b * 0.5).map(
            (p) => /** @type {Vec} */ ([p[0] + centre[0], p[1] + centre[1], p[2] + centre[2]]),
          ),
        );
      }
      this.loft(rings, paint);
    },
    vertex(raw) {
      data.push(...raw);
    },
    triangles: () => data.length / 39,
    mesh(gl) {
      const count = data.length / 13;
      const position = new Float32Array(count * 3);
      const normal = new Float32Array(count * 3);
      const colour = new Float32Array(count * 3);
      const extra = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) {
          position[i * 3 + k] = data[i * 13 + k];
          normal[i * 3 + k] = data[i * 13 + 3 + k];
          colour[i * 3 + k] = data[i * 13 + 6 + k];
        }
        for (let k = 0; k < 4; k++) extra[i * 4 + k] = data[i * 13 + 9 + k];
      }
      return createMesh(gl, [
        { data: position, size: 3 },
        { data: normal, size: 3 },
        { data: colour, size: 3 },
        { data: extra, size: 4 },
      ]);
    },
  };
}

/** The attribute names of a shape's mesh, for `programs.make`. */
export const SHAPE_ATTRIBUTES = /** @type {const} */ (['aPos', 'aNor', 'aCol', 'aAux']);
