// Low-poly solids for the mesh renderer: a builder of flat-shaded, vertex-coloured triangles
// (boxes, lathes, loose triangles), the one program that draws them, and the little matrix
// arithmetic a part needs to place them. A solid is lit per vertex; its fragments only add the haze.

import { createMesh } from './gl.js';
import { COMMON, FINISH } from './look.js';

/** @typedef {readonly number[]} Point x, y, z and, for cloth, how far it bellies */
/** @typedef {readonly number[]} Paint red, green, blue and, optionally, gloss 0..1 */

/**
 * A solid's vertex: position (w: how far the point bellies along x, for cloth), the facet's
 * normal, colour (a: gloss).
 *   uModel   the solid's own frame to the world (a rigid motion, or the normals go wrong)
 *   uCloth   x: which way and how far cloth bellies, -1..1 (1 for anything rigid); y: how far a
 *            flag flutters; z: 1 for cloth, which is lit on both faces and lets the sun through;
 *            w: 1 for a thing that glows with its own colour
 */
export const SOLID_VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec4 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aColor;
${COMMON}
uniform mat4 uModel;
uniform vec4 uCloth;
out vec3 vCol;
out float vHaze;
out float vInk;
void main(){
  vec3 p = aPos.xyz;
  p.x += aPos.w*(uCloth.x + uCloth.y*sin(aPos.w*9.0 - uTime*6.0));
  vec3 world = (uModel*vec4(p, 1.0)).xyz;
  vec3 n = normalize(mat3(uModel)*vec3(aNormal.x, aNormal.yz*uCloth.x));
  vec3 v = normalize(uEye - world);
  float facing = dot(n, v);
  if (uCloth.z > 0.5 && facing < 0.0) { n = -n; facing = -facing; }
  vec3 col = lit(aColor.rgb, n);
  // cloth lets the sun through, and the sky fills it
  col += aColor.rgb*uCloth.z*(uSunCol*(0.6*max(dot(-n, uSun), 0.0)) + uAmb*0.4);
  col += aColor.rgb*uHorizon*(0.2*(1.0 - max(n.y, 0.0)));     // and the sea throws light back up
  float shine = pow(max(dot(n, normalize(v + uSun)), 0.0), 40.0);
  float rim = 1.0 - max(facing, 0.0);
  col += aColor.a*(uSunCol*shine*0.9 + uZenith*(0.22*rim*rim));
  vCol = mix(col, aColor.rgb, uCloth.w);
  vHaze = hazeAt(world);
  vInk = 0.36 + 0.44*smoothstep(0.25, 0.6, facing);
  gl_Position = uViewProj*vec4(world, 1.0);
}`;

export const SOLID_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
${FINISH}
in vec3 vCol;
in float vHaze;
in float vInk;
out vec4 outColor;
void main(){
  // on the chart a solid is drawn in ink: darker where it turns away, which outlines it
  outColor = vec4(finish(uMode == 3 ? vCol*vInk : vCol, vHaze), 1.0);
}`;

export const SOLID_ATTRIBUTES = /** @type {const} */ (['aPos', 'aNormal', 'aColor']);

/** uCloth of a rigid, matt-or-glossy thing, and of one that glows. */
export const RIGID = /** @type {const} */ ([1, 0, 0, 0]);
export const GLOWING = /** @type {const} */ ([1, 0, 0, 1]);

/**
 * @typedef {object} Shape a pile of triangles being built
 * @property {(a: Point, b: Point, c: Point, paint: Paint, paintB?: Paint, paintC?: Paint) => void} tri
 *   one triangle, seen from the side cross(b - a, c - a) points to; with three paints the colour
 *   runs between the corners
 * @property {(a: Point, b: Point, c: Point, d: Point, paint: Paint) => void} quad a, b, c, d
 *   round the facet, wound as a triangle is
 * @property {(low: Point, high: Point, paint: Paint) => void} box
 * @property {(profile: readonly (readonly [number, number])[], sides: number,
 *   paint: Paint | readonly Paint[], options?: { turn?: number, blend?: boolean }) => void} lathe
 *   a profile of [radius, height] pairs spun round the y axis, bottom to top for a solid seen
 *   from outside; `paint` is one colour, or one per stretch of the profile (with `blend`, one
 *   per point of it, and the colour runs between them); `turn` turns the facets round the axis
 * @property {(place: ((p: Point) => Point) | null) => void} place map every point given from
 *   here on (a rotation and a shift: a mirror would turn the facets inside out)
 * @property {() => number} triangles
 * @property {() => { data: Float32Array, size: number }[]} attributes position, normal, colour:
 *   what createMesh takes, in the order of SOLID_ATTRIBUTES
 * @property {(gl: WebGL2RenderingContext) => import('./gl.js').Mesh} mesh
 */

/** @returns {Shape} */
export function createShape() {
  /** @type {number[]} */
  const positions = [];
  /** @type {number[]} */
  const normals = [];
  /** @type {number[]} */
  const colors = [];
  /** @type {((p: Point) => Point) | null} */
  let map = null;

  /** @type {Shape['tri']} */
  function tri(a0, b0, c0, paint, paintB = paint, paintC = paint) {
    const a = map ? map(a0) : a0;
    const b = map ? map(b0) : b0;
    const c = map ? map(c0) : c0;
    // The normal of cloth is that of its bellied shape.
    const ax = a[0] + (a[3] ?? 0);
    const ux = b[0] + (b[3] ?? 0) - ax;
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] + (c[3] ?? 0) - ax;
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-9) return; // no area: the tip of a cone
    for (const [p, q] of /** @type {const} */ ([
      [a, paint],
      [b, paintB],
      [c, paintC],
    ])) {
      positions.push(p[0], p[1], p[2], p[3] ?? 0);
      normals.push(nx / length, ny / length, nz / length);
      colors.push(q[0], q[1], q[2], q[3] ?? 0);
    }
  }

  /** @type {Shape['quad']} */
  function quad(a, b, c, d, paint) {
    tri(a, b, c, paint);
    tri(a, c, d, paint);
  }

  return {
    tri,
    quad,
    box([x0, y0, z0], [x1, y1, z1], paint) {
      quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], paint);
      quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], paint);
      quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], paint);
      quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], paint);
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], paint);
      quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], paint);
    },
    lathe(profile, sides, paint, { turn = 0, blend = false } = {}) {
      const many = Array.isArray(paint[0]);
      /** @param {number} i @returns {Paint} */
      const paintAt = (i) =>
        many ? /** @type {readonly Paint[]} */ (paint)[i] : /** @type {Paint} */ (paint);
      for (let j = 0; j + 1 < profile.length; j++) {
        const [r0, y0] = profile[j];
        const [r1, y1] = profile[j + 1];
        const low = paintAt(j);
        const high = blend ? paintAt(j + 1) : low;
        for (let i = 0; i < sides; i++) {
          const a0 = ((i + turn) / sides) * 2 * Math.PI;
          const a1 = ((i + 1 + turn) / sides) * 2 * Math.PI;
          const c0 = Math.cos(a0);
          const s0 = Math.sin(a0);
          const c1 = Math.cos(a1);
          const s1 = Math.sin(a1);
          const p00 = [r0 * c0, y0, r0 * s0];
          const p01 = [r0 * c1, y0, r0 * s1];
          const p10 = [r1 * c0, y1, r1 * s0];
          const p11 = [r1 * c1, y1, r1 * s1];
          tri(p00, p10, p11, low, high, high);
          tri(p00, p11, p01, low, high, low);
        }
      }
    },
    place(place) {
      map = place;
    },
    triangles: () => positions.length / 12,
    attributes: () => [
      { data: new Float32Array(positions), size: 4 },
      { data: new Float32Array(normals), size: 3 },
      { data: new Float32Array(colors), size: 4 },
    ],
    mesh(gl) {
      return createMesh(gl, this.attributes());
    },
  };
}

/**
 * A colour, scaled.
 * @param {Paint} paint
 * @param {number} k
 * @param {number} [gloss]
 * @returns {number[]}
 */
export function shade(paint, k, gloss = paint[3] ?? 0) {
  return [paint[0] * k, paint[1] * k, paint[2] * k, gloss];
}

// ---- 4x4 matrices, column-major, as WebGL takes them. Each writes into `out` and returns it.

/** @returns {Float32Array} the identity */
export function matrix() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/**
 * out = a * b (b is applied to a point first). `out` may not be a or b.
 * @param {Float32Array} out
 * @param {Float32Array} a
 * @param {Float32Array} b
 */
export function multiply(out, a, b) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/**
 * A frame given by where its axes point and where its origin lies.
 * @param {Float32Array} out
 * @param {readonly number[]} x
 * @param {readonly number[]} y
 * @param {readonly number[]} z
 * @param {readonly number[]} origin
 */
export function frameOf(out, x, y, z, origin) {
  out.set([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0], 0);
  out.set([origin[0], origin[1], origin[2], 1], 12);
  return out;
}

/**
 * A turn of `angle` about the line through `point` along the unit vector `axis`.
 * @param {Float32Array} out
 * @param {readonly number[]} point
 * @param {readonly number[]} axis
 * @param {number} angle
 */
export function turnAbout(out, point, axis, angle) {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  out[0] = t * x * x + c;
  out[1] = t * x * y + s * z;
  out[2] = t * x * z - s * y;
  out[4] = t * x * y - s * z;
  out[5] = t * y * y + c;
  out[6] = t * y * z + s * x;
  out[8] = t * x * z + s * y;
  out[9] = t * y * z - s * x;
  out[10] = t * z * z + c;
  out[3] = out[7] = out[11] = 0;
  for (let r = 0; r < 3; r++) {
    out[12 + r] = point[r] - (out[r] * point[0] + out[4 + r] * point[1] + out[8 + r] * point[2]);
  }
  out[15] = 1;
  return out;
}

/**
 * Height of the ground under a solid: the terrain's grid, bilinear between samples (as the game
 * reads it). Off the grid it is deep water.
 * @param {import('../renderer.js').RenderTerrain} terrain
 * @param {number} x
 * @param {number} z
 */
export function groundAt(terrain, x, z) {
  const { n, extent, heights } = terrain;
  const gx = (x / extent + 0.5) * n - 0.5;
  const gz = (z / extent + 0.5) * n - 0.5;
  if (gx < 0 || gz < 0 || gx > n - 1 || gz > n - 1) return -5;
  const ix = Math.min(n - 2, Math.floor(gx));
  const iz = Math.min(n - 2, Math.floor(gz));
  const fx = gx - ix;
  const fz = gz - iz;
  const i = iz * n + ix;
  const near = heights[i] + (heights[i + 1] - heights[i]) * fx;
  const far = heights[i + n] + (heights[i + n + 1] - heights[i + n]) * fx;
  return near + (far - near) * fz;
}
