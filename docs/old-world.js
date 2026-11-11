// The sea as numbers: islands, the boat and how it moves. Pure, so it can be tested without a GPU.

/** @typedef {{ x: number, z: number, height: number, spread: number }} Isle */
/** @typedef {{ x: number, z: number, heading: number, speed: number, lean: number }} Boat */
/** @typedef {{ left: boolean, right: boolean, up: boolean, down: boolean }} Helm */

export const PORT_HEIGHT = 2.9;
export const PORT_SPREAD = 6.5;
/** Within this distance of a port the boat has arrived. */
export const ARRIVE = 6.4;
/** Beyond this distance the port's card is put away again. */
export const LEAVE = 9;
export const MAX_SPEED = 8.5;
/** The chart ends this far from its middle; the wind turns the boat back. */
export const EDGE = 100;
export const MIDDLE = { x: 0, z: 58 };
/** The sun, in world coordinates (x, up, z). The boat sets out towards it. */
export const SUN = [-0.3542, 0.2226, 0.9083];

/** Islands with nothing on them, for scenery and for steering round. @type {Isle[]} */
export const SCENERY = [
  { x: -9, z: -14, height: 1.6, spread: 4 },
  { x: 18, z: 26, height: 1.4, spread: 3.5 },
  { x: -36, z: 10, height: 2.2, spread: 5 },
  { x: 3, z: 56, height: 1.3, spread: 3 },
  { x: -40, z: 62, height: 2.4, spread: 6 },
  { x: 46, z: 70, height: 1.8, spread: 4 },
  { x: 11, z: 106, height: 1.5, spread: 3.5 },
  { x: -28, z: 100, height: 2.0, spread: 5 },
];

/** @returns {Boat} */
export function newBoat() {
  return { x: 0, z: 0, heading: 0, speed: 0, lean: 0 };
}

/**
 * Height of the land at a point, without the shader's surface noise. Below zero is water.
 * @param {Isle[]} isles
 * @param {number} x
 * @param {number} z
 */
export function landAt(isles, x, z) {
  let height = -1;
  for (const isle of isles) {
    const dx = x - isle.x;
    const dz = z - isle.z;
    height = Math.max(height, isle.height * Math.exp(-(dx * dx + dz * dz) / isle.spread) - 0.35);
  }
  return height;
}

/**
 * Advance the boat by dt seconds. Returns what happened: 'aground', 'edge' or ''.
 * @param {Boat} boat
 * @param {Helm} helm
 * @param {number} dt
 * @param {Isle[]} isles
 */
export function sail(boat, helm, dt, isles) {
  const turn = (helm.right ? 1 : 0) - (helm.left ? 1 : 0);
  const way = Math.min(1, Math.abs(boat.speed) / 4);
  boat.heading += turn * 1.5 * dt * (0.4 + 0.6 * way);
  if (helm.up) boat.speed += 6.5 * dt;
  if (helm.down) boat.speed -= 5 * dt;
  boat.speed -= boat.speed * 0.5 * dt;
  boat.speed = Math.min(MAX_SPEED, Math.max(-2.5, boat.speed));
  boat.lean += (-turn * 0.16 * way - boat.lean) * Math.min(1, dt * 4);

  let event = '';
  const sin = Math.sin(boat.heading);
  const cos = Math.cos(boat.heading);
  const x = boat.x + sin * boat.speed * dt;
  const z = boat.z + cos * boat.speed * dt;
  const bow = boat.speed >= 0 ? 1.5 : -1.5;
  if (landAt(isles, x + sin * bow, z + cos * bow) > -0.08) {
    boat.speed *= -0.35;
    event = 'aground';
  } else {
    boat.x = x;
    boat.z = z;
  }

  const ox = boat.x - MIDDLE.x;
  const oz = boat.z - MIDDLE.z;
  const out = Math.hypot(ox, oz);
  if (out > EDGE) {
    // Turn towards the middle of the chart, the short way round.
    const home = Math.atan2(-ox, -oz);
    const off = Math.atan2(Math.sin(home - boat.heading), Math.cos(home - boat.heading));
    boat.heading += Math.sign(off) * Math.min(Math.abs(off), 1.8 * dt);
    boat.x -= (ox / out) * (out - EDGE) * 0.5;
    boat.z -= (oz / out) * (out - EDGE) * 0.5;
    event = 'edge';
  }
  return event;
}

/**
 * Where a point lies from the boat: distance, and bearing in radians (0 dead ahead, positive to starboard).
 * @param {Boat} boat
 * @param {{ x: number, z: number }} point
 */
export function bearing(boat, point) {
  const dx = point.x - boat.x;
  const dz = point.z - boat.z;
  const sin = Math.sin(boat.heading);
  const cos = Math.cos(boat.heading);
  return {
    distance: Math.hypot(dx, dz),
    angle: Math.atan2(dx * cos - dz * sin, dx * sin + dz * cos),
  };
}
