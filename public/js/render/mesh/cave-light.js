// The light inside the sea cave, for whatever is in there: its walls (parts/cave.js), and the
// water and the boat if their parts ask. The sun does not reach in. What does is the day, falling
// in at the mouth and dying away down the tunnel, and the fire of the lamp at the back of the
// chamber, which burns low and gutters until the port is found.
//
// To use it in a part: put CAVE_LIGHT after COMMON in a shader (either stage), call
// `bindCaveLight(gl, program, terrain, scene.frame)` after `scene.bind(program)`, and then
//   float under = caveShade(worldPos);         // 0 under the open sky .. 1 under the cave's roof
//   col = mix(col, albedo*caveGlow(worldPos, normal), under);
// caveShade costs a dot product away from the cave; per vertex is enough for both.

/** @typedef {import('../renderer.js').RenderTerrain} RenderTerrain */
/** @typedef {import('../renderer.js').Frame} Frame */
/** @typedef {import('./gl.js').Program} Program */

export const CAVE_LIGHT = /* glsl */ `
uniform vec4 uCaveAxis;   // the tunnel's seaward end (x, z) and its unit direction into the hill (x, z)
uniform vec4 uCaveSpan;   // tunnel length, tunnel radius, chamber radius, where the cliff starts along it
uniform vec4 uCaveLamp;   // the lamp in the chamber: x, y, z, and how bright it burns now
// 0 in the open, 1 over the water inside the cave (the tunnel past its mouth, and the chamber)
float caveShade(vec3 p){
  vec2 v = p.xz - uCaveAxis.xy;
  float s = dot(v, uCaveAxis.zw);
  if (abs(s - 0.5*(uCaveSpan.x + uCaveSpan.z)) > uCaveSpan.x) return 0.0;
  float across = v.x*uCaveAxis.w - v.y*uCaveAxis.z;
  float tunnel = uCaveSpan.y - length(vec2(s - clamp(s, 0.0, uCaveSpan.x), across));
  float hall = uCaveSpan.z - length(vec2(s - uCaveSpan.x, across));
  return smoothstep(-1.0, 0.5, max(tunnel, hall))*smoothstep(-7.0, 9.0, s - uCaveSpan.w);
}
// the light that falls on a surface in the cave, to multiply its colour by: the day from the
// mouth (and a little of it thrown up green from the water), and the fire
vec3 caveGlow(vec3 p, vec3 n){
  vec2 e = uCaveAxis.zw;
  float day = exp(-max(dot(p.xz - uCaveAxis.xy, e) - uCaveSpan.w, 0.0)/16.0);
  vec3 c = mix(uHorizon, uZenith, 0.3)*day*(0.38 + 0.8*clamp(-dot(n.xz, e), 0.0, 1.0));
  c += vec3(0.05, 0.13, 0.12)*day*clamp(0.3 - n.y, 0.0, 1.0);
  vec3 l = uCaveLamp.xyz - p;
  float glow = (0.35 + 0.65*clamp(dot(n, normalize(l)), 0.0, 1.0))/(1.0 + dot(l, l)/130.0);
  return c + vec3(1.0, 0.7, 0.36)*(2.0*uCaveLamp.w*glow) + vec3(0.075, 0.066, 0.06);
}
`;

/**
 * The height of the ground (negative under the sea) at a point, from the height grid.
 * @param {RenderTerrain} terrain @param {number} x @param {number} z
 */
export function groundAt(terrain, x, z) {
  const { n, extent, heights } = terrain;
  const gx = Math.min(n - 1, Math.max(0, ((x + extent / 2) / extent) * n - 0.5));
  const gz = Math.min(n - 1, Math.max(0, ((z + extent / 2) / extent) * n - 0.5));
  const ix = Math.min(n - 2, Math.floor(gx));
  const iz = Math.min(n - 2, Math.floor(gz));
  const fx = gx - ix;
  const fz = gz - iz;
  const i = iz * n + ix;
  const near = heights[i] + (heights[i + 1] - heights[i]) * fx;
  const far = heights[i + n] + (heights[i + n + 1] - heights[i + n]) * fx;
  return near + (far - near) * fz;
}

/**
 * @typedef {object} CaveFittings
 * @property {number} ex unit direction of the tunnel into the hill
 * @property {number} ez
 * @property {number} length from the tunnel's seaward end to the middle of the chamber
 * @property {number} mouth how far along the tunnel the cliff starts
 * @property {[number, number, number]} lamp the flame at the back of the chamber
 * @property {[number, number, number][]} braziers the top of the post either side of the mouth
 * @property {number} port index of the cave's port in terrain.ports, or -1
 */

/** @type {WeakMap<RenderTerrain, CaveFittings>} */
const fitted = new WeakMap();

/**
 * Where the cave's mouth and its lights are: the lamp hangs at the back of the chamber, and a
 * brazier stands on the shore either side of the mouth (as in the ray-marched scene).
 * @param {RenderTerrain} terrain
 * @returns {CaveFittings}
 */
export function caveFittings(terrain) {
  const known = fitted.get(terrain);
  if (known) return known;
  const { ax, az, bx, bz, radius, hall, roof } = terrain.cave;
  const length = Math.hypot(bx - ax, bz - az) || 1;
  const ex = (bx - ax) / length;
  const ez = (bz - az) / length;
  let mouth = 0;
  while (mouth < length && groundAt(terrain, ax + ex * mouth, az + ez * mouth) < 3) mouth += 0.5;
  const braziers = [-1, 1].map((side) => {
    const x = ax - ez * side * (radius + 2.6);
    const z = az + ex * side * (radius + 2.6);
    let s = 0;
    while (s < length && groundAt(terrain, x + ex * s, z + ez * s) < 0.7) s += 0.25;
    const top = Math.max(0.7, groundAt(terrain, x + ex * s, z + ez * s)) + 2.6;
    return /** @type {[number, number, number]} */ ([x + ex * s, top, z + ez * s]);
  });
  // clear of the back wall and of the roof, which comes down to meet it
  const back = hall - 3.4;
  const fittings = {
    ex,
    ez,
    length,
    mouth,
    lamp: /** @type {[number, number, number]} */ ([
      bx + ex * back,
      Math.min(4.2, roof * Math.sqrt(Math.max(0, 1 - (back / hall) ** 2)) - 1.9),
      bz + ez * back,
    ]),
    braziers,
    port: terrain.ports.findIndex((port) => port.kind === 'cave'),
  };
  fitted.set(terrain, fittings);
  return fittings;
}

/**
 * How bright the fires burn this frame, 0..1: low and guttering until the cave's port is found,
 * full and nearly steady after.
 * @param {RenderTerrain} terrain @param {Frame} frame
 */
export function caveFire(terrain, frame) {
  const { port } = caveFittings(terrain);
  const t = frame.time;
  const flutter = 0.5 + 0.25 * Math.sin(t * 9.1) + 0.25 * Math.sin(t * 14.3 + 1.7);
  if (port >= 0 && frame.found[port]) return 0.9 + 0.1 * flutter;
  const gutter = Math.sin(t * 2.3) + Math.sin(t * 3.7 + 2) > 1.2 ? 0.55 : 1;
  return (0.34 + 0.16 * flutter) * gutter;
}

/**
 * Fill the uniforms of CAVE_LIGHT. The program must be in use.
 * @param {WebGL2RenderingContext} gl @param {Program} program @param {RenderTerrain} terrain
 * @param {Frame} frame
 */
export function bindCaveLight(gl, program, terrain, frame) {
  const { ex, ez, length, mouth, lamp } = caveFittings(terrain);
  const { ax, az, radius, hall } = terrain.cave;
  gl.uniform4f(program.at('uCaveAxis'), ax, az, ex, ez);
  gl.uniform4f(program.at('uCaveSpan'), length, radius, hall, mouth);
  gl.uniform4f(program.at('uCaveLamp'), lamp[0], lamp[1], lamp[2], caveFire(terrain, frame));
}
