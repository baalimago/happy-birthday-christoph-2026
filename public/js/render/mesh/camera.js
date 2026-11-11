// The camera of the mesh renderer: the same orbit round the boat as the ray-marched renderer, as
// a view-projection matrix. The world is x east, y up, z north (heading 0 looks along +z).

/** Height above the waterline that the camera looks at, and the focal length in viewport heights. */
const AIM = 1.1;
const FOCAL = 1.25;
const NEAR = 0.3;
const FAR = 4200;

/**
 * @typedef {object} Camera
 * @property {[number, number, number]} eye world position
 * @property {[number, number, number]} right unit vectors of the view, in the world
 * @property {[number, number, number]} up
 * @property {[number, number, number]} forward
 * @property {Float32Array} viewProj 4x4, column-major, world to clip
 */

/**
 * @param {{ x: number, z: number, heading: number }} boat
 * @param {{ yaw: number, pitch: number, distance: number }} orbit
 * @param {readonly [number, number]} shift where the boat sits on screen, viewport heights
 * @param {number} aspect width over height
 * @param {number} [lift] how far the boat's frame is lifted off the still water
 * @returns {Camera}
 */
export function cameraOf(boat, orbit, shift, aspect, lift = 0) {
  const sin = Math.sin(boat.heading);
  const cos = Math.cos(boat.heading);
  // In the boat's frame: x to starboard, y up, z ahead.
  const cp = Math.cos(orbit.pitch);
  const cam = [
    orbit.distance * cp * Math.sin(orbit.yaw),
    AIM + orbit.distance * Math.sin(orbit.pitch),
    orbit.distance * cp * Math.cos(orbit.yaw),
  ];
  const f = normalize([-cam[0], AIM - cam[1], -cam[2]]);
  const r = normalize([f[2], 0, -f[0]]); // up x forward
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  /** @param {number[]} v @returns {[number, number, number]} */
  const world = (v) => [v[0] * cos + v[2] * sin, v[1], -v[0] * sin + v[2] * cos];
  const right = world(r);
  const up = world(u);
  const forward = world(f);
  const at = world(cam);
  /** @type {[number, number, number]} */
  const eye = [boat.x + at[0], Math.max(0.25, at[1] + lift), boat.z + at[2]];

  // clip.w is the distance along `forward`; x and y carry the focal length and the screen shift.
  const fy = 2 * FOCAL;
  const fx = fy / aspect;
  const sx = (2 * shift[0]) / aspect;
  const sy = 2 * shift[1];
  const a = (FAR + NEAR) / (FAR - NEAR);
  const b = (-2 * FAR * NEAR) / (FAR - NEAR);
  const rows = [
    right.map((v, i) => v * fx + forward[i] * sx),
    up.map((v, i) => v * fy + forward[i] * sy),
    forward.map((v) => v * a),
    forward,
  ];
  const viewProj = new Float32Array(16);
  rows.forEach((row, i) => {
    viewProj[i] = row[0];
    viewProj[4 + i] = row[1];
    viewProj[8 + i] = row[2];
    viewProj[12 + i] = -(row[0] * eye[0] + row[1] * eye[1] + row[2] * eye[2]);
  });
  viewProj[14] += b;
  return { eye, right, up, forward, viewProj };
}

/** @param {number[]} v */
function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
