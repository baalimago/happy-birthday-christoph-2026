// The shape of the sea cave, shared by the land (which leaves the hole) and the cave's own walls
// (which line it): a tunnel from the mouth to a round chamber, under a hill that the height grid
// shows as solid. This is the same solid as `caveD` in ../shaders/scene.js, and at the waterline
// the same footprint as `insideCave` in the game's terrain module.
//
// The hollow is the union of two half-ellipsoids standing on the water, carried straight down
// below it:
//   the tunnel  a capsule along a -> b: `radius` wide, min(roof, radius) high over the water
//   the hall    round, `hall` wide, `roof` high, centred on b
// A point is inside the hollow where the distance is negative. The land discards its fragments
// there (see parts/terrain.js), so the cave's walls can be built on the surface where it is zero.

/** @typedef {import('../renderer.js').RenderTerrain['cave']} Cave */
/** @typedef {import('./gl.js').Program} Program */

/**
 * GLSL: `float caveD(vec3 p)`, negative inside the cave (about the distance to its wall, a lower
 * bound). Needs the uniforms filled by `bindCave`. For either stage.
 */
export const CAVE_SHAPE = /* glsl */ `
uniform vec4 uCave;        // tunnel from the mouth a (xy) to the chamber b (zw), world x, z
uniform vec4 uCaveShape;   // tunnel radius, chamber radius, roof, height of the tunnel's vault
float caveD(vec3 p){
  vec2 a = uCave.xy, e = uCave.zw - a, v = p.xz - a;
  float s = clamp(dot(v, e)/dot(e, e), 0.0, 1.0), y = max(p.y, 0.0);
  float tunnel = (length(vec2(length(v - e*s)/uCaveShape.x, y/uCaveShape.w)) - 1.0)*uCaveShape.w;
  float hall = (length(vec2(length(p.xz - uCave.zw)/uCaveShape.y, y/uCaveShape.z)) - 1.0)
             * min(uCaveShape.y, uCaveShape.z);
  return min(tunnel, hall);
}
`;

/**
 * Fill the uniforms of CAVE_SHAPE. The program must be in use.
 * @param {WebGL2RenderingContext} gl @param {Program} program @param {Cave} cave
 */
export function bindCave(gl, program, cave) {
  gl.uniform4f(program.at('uCave'), cave.ax, cave.az, cave.bx, cave.bz);
  gl.uniform4f(
    program.at('uCaveShape'),
    cave.radius,
    cave.hall,
    cave.roof,
    Math.min(cave.roof, cave.radius),
  );
}

/**
 * The same as the GLSL `caveD`, for building meshes: negative inside the cave.
 * @param {Cave} cave @param {number} x @param {number} y @param {number} z
 */
export function caveDistance(cave, x, y, z) {
  const ex = cave.bx - cave.ax;
  const ez = cave.bz - cave.az;
  const vx = x - cave.ax;
  const vz = z - cave.az;
  const s = Math.min(1, Math.max(0, (vx * ex + vz * ez) / (ex * ex + ez * ez)));
  const up = Math.max(y, 0);
  const vault = Math.min(cave.roof, cave.radius);
  const tunnel =
    (Math.hypot(Math.hypot(vx - ex * s, vz - ez * s) / cave.radius, up / vault) - 1) * vault;
  const hall =
    (Math.hypot(Math.hypot(x - cave.bx, z - cave.bz) / cave.hall, up / cave.roof) - 1) *
    Math.min(cave.hall, cave.roof);
  return Math.min(tunnel, hall);
}

/**
 * How high the cave's ceiling is over a point of the water (x, z): 0 at the wall and outside.
 * The ceiling is the surface caveDistance = 0.
 * @param {Cave} cave @param {number} x @param {number} z
 */
export function caveCeiling(cave, x, z) {
  const ex = cave.bx - cave.ax;
  const ez = cave.bz - cave.az;
  const vx = x - cave.ax;
  const vz = z - cave.az;
  const s = Math.min(1, Math.max(0, (vx * ex + vz * ez) / (ex * ex + ez * ez)));
  const t = Math.hypot(vx - ex * s, vz - ez * s) / cave.radius;
  const h = Math.hypot(x - cave.bx, z - cave.bz) / cave.hall;
  const tunnel = t < 1 ? Math.min(cave.roof, cave.radius) * Math.sqrt(1 - t * t) : 0;
  const hall = h < 1 ? cave.roof * Math.sqrt(1 - h * h) : 0;
  return Math.max(tunnel, hall);
}
