// How the boat sails: the wind, the trim of the sail, the way she carries, and what happens
// when she meets the land. Pure: no DOM, no GPU. Bearings are compass bearings in radians
// (0 north, clockwise), x runs east and z runs north.

import { EDGE } from './chart-data.js';
import { heightAt, isWater, noise } from './terrain.js';

/**
 * @typedef {import('./terrain.js').Terrain} Terrain
 * @typedef {{ x: number, z: number, heading: number }} Berth
 * @typedef {{ left: boolean, right: boolean, out: boolean, in: boolean, engine: boolean, rocket?: boolean, anchor?: boolean, syrus?: boolean }} Helm
 */

/**
 * @typedef {object} Boat
 * @property {number} x
 * @property {number} z
 * @property {number} heading compass bearing of the bow
 * @property {number} speed units a second through the water, negative when going astern
 * @property {number} lean heel in radians, positive when she heels to starboard
 * @property {number} sheet from 0, hauled right in, to 1, right out
 * @property {number} boom angle of the boom off the centreline in radians, positive when the
 *   sail lies to starboard
 * @property {number} [aloft] how high she flies over the still water (Syrus mode); 0 or absent
 *   when she floats
 */

/**
 * @typedef {object} Wind
 * @property {number} from compass bearing the wind blows from
 * @property {number} speed about 0.35 (a lull) to 1.6 (a squall); 1 is a fresh breeze
 * @property {number} [gust] 0..1, how hard it is gusting here and now, on top of the breeze
 * @property {number} [sea] 0..1, the sea state: calm water to a steep running sea
 */

/**
 * @typedef {object} Outcome
 * @property {'' | 'aground' | 'edge'} event
 * @property {number} impact the speed at which she struck, 0 when she did not
 * @property {number} relative where the wind comes from seen from the boat, -PI..PI: 0 on the
 *   bow, positive over the starboard side
 * @property {number} best the sheet setting that drives best on this point of sail
 * @property {number} trim from 0 to 1 (perfect): how close the sheet is to best
 */

/** Best point of sail in a fresh breeze, in units a second. */
export const MAX_SPEED = 7.5;
/** Amin mode: a rocket on the stern, ten times the best the sails can do. */
export const ROCKET_SPEED = MAX_SPEED * 10;
/** Syrus mode: she flies at this speed, this far clear of the water and of whatever lies ahead. */
export const FLY_SPEED = 17;
const FLY_CLEAR = 7;
/** Higher than this she touches nothing. */
const AIRBORNE = 0.4;
/** Seconds for the anchor to take most of the way off her. */
const ANCHOR_BITE = 0.8;
/** Under engine alone. */
export const ENGINE_SPEED = 3.4;

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** The prevailing wind: west-south-west, a broad reach for the first leg north out of harbour. */
const PREVAILING = 247.5 * DEG;
/** Closer to the wind than this the sail only luffs. */
const NO_GO = 40 * DEG;
/** The boom's angle with the sheet right out. */
const BOOM_OUT = 80 * DEG;
/** The fastest the boom swings across in a tack or a gybe, in radians a second. */
const BOOM_SWING = 4;
const SHEET_RATE = 0.6;
/** Radians a second at speed, and the share of it left with no way on. */
const TURN_RATE = 1.0;
const TURN_MIN = 0.25;
/** Seconds to gather way, and (longer) to lose it: she carries her way through a tack. */
const GATHER = 3;
const CARRY = 6.5;
const ASTERN = -2.5;
const MAX_HEEL = 0.22;
/** Half the length and half the beam of the hull, for the collision probes. */
const HALF_LENGTH = 1.5;
const HALF_BEAM = 0.9;
/** The longest step taken at once, so a stalled frame cannot carry her through a rock. */
const MAX_STEP = 0.25;
/** Within this distance of the edge of the chart she is turned for home. */
const EDGE_BAND = 10;
/** Radians a second: more than the rudder can do, so the edge always wins. */
const EDGE_TURN = 1.8;

/** Wrap an angle to -PI..PI. @param {number} angle */
function wrap(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** @param {number} value @param {number} low @param {number} high */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/** @param {number} a @param {number} b @param {number} t */
function smoothstep(a, b, t) {
  const u = clamp((t - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
}

/** The breeze without its gusts: it freshens and falls light over minutes. @param {number} time */
function breeze(time) {
  return (
    0.92 +
    0.26 * Math.sin((TAU * time) / 311 + 1.3) +
    0.17 * Math.sin((TAU * time) / 683 + 4.2) +
    0.1 * Math.sin((TAU * time) / 97 + 0.4) +
    0.05 * Math.sin((TAU * time) / 41.3 + 2)
  );
}

/**
 * The wind at a moment and a place. A prevailing breeze veers and backs by tens of degrees over
 * minutes, freshens into squalls and falls into lulls; over it, gusts and holes drift downwind
 * across the sea in patches a few hundred units wide, so two boats a mile apart would not feel
 * the same wind, and the sea state follows the breeze a minute behind. No state, never jumps.
 * @param {number} time seconds
 * @param {number} [x] where, in world units
 * @param {number} [z]
 * @returns {Wind & { gust: number, sea: number }}
 */
export function windAt(time, x = 0, z = 0) {
  const swing =
    21 * Math.sin((TAU * time) / 437 + 0.6) +
    12 * Math.sin((TAU * time) / 991 + 2.1) +
    6 * Math.sin((TAU * time) / 173 + 5.1) +
    2.5 * Math.sin((TAU * time) / 71 + 4);
  const mean = PREVAILING + swing * DEG;

  // Patches of stronger and lighter air, carried along by the breeze itself.
  const drift = 9 * time;
  // They drift on the prevailing bearing, not the wind of the moment: that keeps the field
  // from sweeping sideways as the wind veers.
  const px = (x + Math.sin(PREVAILING) * drift) / 210;
  const pz = (z + Math.cos(PREVAILING) * drift) / 210;
  const patch = noise(px, pz) * 0.65 + noise(px * 2.7 + 31, pz * 2.7 - 17) * 0.35;
  const gust = smoothstep(0.52, 0.85, patch);
  const hole = smoothstep(0.42, 0.18, patch);
  // Quick puffs inside a gust.
  const puff =
    0.5 + 0.5 * Math.sin((TAU * time) / 9.3 + px * 9) * Math.sin((TAU * time) / 5.9 + pz * 7);

  const speed = breeze(time) + gust * (0.3 + 0.08 * puff) - hole * 0.28;
  // A gust heads or lifts the boat by a few degrees.
  const veer = (noise(px * 1.3 - 50, pz * 1.3 + 80) - 0.5) * 18 * (0.3 + 0.7 * gust);
  const from = (mean + veer * DEG) % TAU;
  return {
    from: from < 0 ? from + TAU : from,
    speed: clamp(speed, 0.35, 1.6),
    gust,
    sea: clamp((breeze(time - 60) - 0.45) / 1.0 + gust * 0.12, 0, 1),
  };
}

/**
 * @param {Berth} berth
 * @returns {Boat}
 */
export function newBoat(berth) {
  return { x: berth.x, z: berth.z, heading: berth.heading, speed: 0, lean: 0, sheet: 0.5, boom: 0 };
}

/**
 * The sheet setting that drives best with the wind this far off the bow: hauled nearly flat
 * when close-hauled, half out on a beam reach, right out on a dead run.
 * @param {number} off 0..PI, the angle between the bow and the wind
 */
function bestSheet(off) {
  const u = clamp((off - 45 * DEG) / (135 * DEG), 0, 1);
  return 0.12 + 0.88 * Math.pow(u, 0.75);
}

/** How well the sail draws with the sheet this far from its best. @param {number} gap */
function trimFor(gap) {
  return 1 - smoothstep(0.05, 0.45, Math.abs(gap));
}

/** Points of the polar: degrees off the wind, share of MAX_SPEED. */
const POLAR = [
  [0, 0],
  [40, 0],
  [45, 0.6],
  [60, 0.8],
  [90, 0.93],
  [120, 1],
  [140, 0.97],
  [160, 0.86],
  [180, 0.75],
];

/**
 * How fast a well trimmed boat sails with the wind this far off the bow, as a share of MAX_SPEED.
 * @param {number} off 0..PI
 */
function polar(off) {
  const degrees = off / DEG;
  for (let i = 1; i < POLAR.length; i++) {
    const [a, low] = POLAR[i - 1];
    const [b, high] = POLAR[i];
    if (degrees <= b) return low + ((high - low) * (degrees - a)) / (b - a);
  }
  return POLAR[POLAR.length - 1][1];
}

/** The beat of the luffing sail, per boat, so the boat itself stays plain data. @type {WeakMap<Boat, number>} */
const flutter = new WeakMap();

/**
 * Advance the boat by dt seconds. Mutates the boat and says what happened.
 * @param {Boat} boat
 * @param {Helm} helm
 * @param {Wind} wind
 * @param {number} dt seconds
 * @param {Terrain} terrain
 * @returns {Outcome}
 */
export function sail(boat, helm, wind, dt, terrain) {
  dt = clamp(dt, 0, MAX_STEP);

  // Rudder: it only bites when water flows past it.
  const turn = (helm.right ? 1 : 0) - (helm.left ? 1 : 0);
  const way = Math.min(1, Math.abs(boat.speed) / 3.5);
  boat.heading = wrap(boat.heading + turn * TURN_RATE * dt * (TURN_MIN + (1 - TURN_MIN) * way));

  // Sheet.
  const ease = (helm.out ? 1 : 0) - (helm.in ? 1 : 0);
  boat.sheet = clamp(boat.sheet + ease * SHEET_RATE * dt, 0, 1);

  // Point of sail and trim.
  const relative = wrap(wind.from - boat.heading);
  const off = Math.abs(relative);
  const best = bestSheet(off);
  const trim = trimFor(boat.sheet - best);
  const drive = polar(off) * trim * wind.speed;

  // Way: she gathers it in a few seconds and loses it more slowly.
  let target = Math.min(MAX_SPEED * drive, MAX_SPEED * 1.12);
  if (helm.engine) target = Math.max(target, ENGINE_SPEED);
  // Syrus mode: she flies. Switched off over land, she flies on until there is water to land on.
  const high = boat.aloft ?? 0;
  const ahead = (/** @type {number} */ d) =>
    heightAt(terrain, boat.x + Math.sin(boat.heading) * d, boat.z + Math.cos(boat.heading) * d);
  const dry = high > 0 && [-4, 0, 4, 9].some((d) => ahead(d) > -0.3);
  const flying = helm.syrus === true || dry;
  if (flying || high > 0) {
    // Over whatever lies under her and a few seconds ahead.
    const ground = Math.max(0, ...[0, 6, 14, 24, 36, 50].map(ahead));
    const want = flying ? FLY_CLEAR + ground * 1.08 + (ground > 0 ? 4 : 0) : 0;
    const rate = want > high ? 0.6 : 1.4;
    let next = high + (want - high) * (1 - Math.exp(-dt / rate));
    if (!flying && next < 0.05) next = 0;
    boat.aloft = next;
  }
  if (flying) target = Math.max(target, FLY_SPEED);
  if (helm.rocket) target = ROCKET_SPEED;
  // The anchor is down: whatever drives her, she is brought up gently and held.
  if (helm.anchor && !dry) target = 0;
  let lag = target > boat.speed ? GATHER : CARRY;
  if (helm.rocket) lag = 1.2;
  if (helm.anchor) lag = ANCHOR_BITE;
  boat.speed += (target - boat.speed) * (1 - Math.exp(-dt / lag));
  if (helm.anchor && Math.abs(boat.speed) < 0.05) boat.speed = 0;
  // Way left over from the rocket bleeds off through the normal lag rather than vanishing.
  const top =
    helm.rocket || flying || boat.speed > MAX_SPEED * 1.2 ? ROCKET_SPEED : MAX_SPEED * 1.12;
  boat.speed = clamp(boat.speed, ASTERN, top);

  // The boom lies to leeward, as far out as the sheet lets it and never past the wind itself.
  // Dead ahead and dead astern it keeps the side it is on, so it does not chatter.
  let side = relative > 0 ? -1 : 1;
  if ((off < 4 * DEG || off > 172 * DEG) && boat.boom !== 0) side = Math.sign(boat.boom);
  let boom = side * Math.min(boat.sheet * BOOM_OUT, off);
  if (off < NO_GO) {
    // In the no-go zone the sail luffs: it falls to the centreline and shivers there.
    const beat = (flutter.get(boat) ?? 0) + dt * (8 + 4 * wind.speed);
    flutter.set(boat, beat % (TAU * 10));
    const slack = smoothstep(NO_GO, NO_GO - 12 * DEG, off);
    boom = boom * (1 - slack) + slack * 5 * DEG * (Math.sin(beat) + 0.4 * Math.sin(beat * 2.7));
  }
  const swing = (boom - boat.boom) * (1 - Math.exp(-dt * 8));
  boat.boom += clamp(swing, -BOOM_SWING * dt, BOOM_SWING * dt);

  // Heel: away from the wind, most when close-hauled or reaching, and a little from turning.
  const press = 1 - 0.8 * smoothstep(100 * DEG, 180 * DEG, off);
  const heel = side * MAX_HEEL * Math.min(1, drive) * press - turn * 0.05 * way;
  boat.lean += (heel - boat.lean) * (1 - Math.exp(-dt * 3));

  // Move, unless the land is in the way.
  /** @type {Outcome} */
  const outcome = { event: '', impact: 0, relative, best, trim };
  const sin = Math.sin(boat.heading);
  const cos = Math.cos(boat.heading);
  const x = boat.x + sin * boat.speed * dt;
  const z = boat.z + cos * boat.speed * dt;
  const end = boat.speed >= 0 ? HALF_LENGTH : -HALF_LENGTH;
  /** Is this point of the hull, (along, across) from the middle, about to touch the land? */
  const strikes = (/** @type {number} */ along, /** @type {number} */ across) => {
    const ox = sin * along + cos * across;
    const oz = cos * along - sin * across;
    // A point already ashore (she swung onto it while turning) must not hold her fast.
    return !isWater(terrain, x + ox, z + oz) && isWater(terrain, boat.x + ox, boat.z + oz);
  };
  if ((boat.aloft ?? 0) > AIRBORNE) {
    boat.x = x;
    boat.z = z;
  } else if (
    !isWater(terrain, x, z) ||
    strikes(end, 0) ||
    strikes(0, HALF_BEAM) ||
    strikes(0, -HALF_BEAM)
  ) {
    outcome.event = 'aground';
    outcome.impact = Math.abs(boat.speed);
    boat.speed *= -0.3;
  } else {
    boat.x = x;
    boat.z = z;
  }

  // The edge of the chart: she is held inside it, and near it she is turned for the middle,
  // the short way round, until she points well clear.
  boat.x = clamp(boat.x, -EDGE, EDGE);
  boat.z = clamp(boat.z, -EDGE, EDGE);
  if (Math.max(Math.abs(boat.x), Math.abs(boat.z)) > EDGE - EDGE_BAND) {
    const home = wrap(Math.atan2(-boat.x, -boat.z) - boat.heading);
    if (Math.abs(home) > 50 * DEG) {
      boat.heading = wrap(boat.heading + Math.sign(home) * EDGE_TURN * dt);
      outcome.event = 'edge';
    }
  }
  return outcome;
}

/**
 * The share of the hull lost by striking at this speed: nothing for a nudge, about a quarter
 * at half speed, well over half at full speed.
 * @param {number} impact units a second
 * @returns {number} 0..1
 */
export function damageFor(impact) {
  const hard = Math.abs(impact) - 0.5;
  if (!(hard > 0)) return 0;
  return Math.min(1, 0.0464 * Math.pow(hard, 1.345));
}

/**
 * Where a point lies from the boat: distance, and angle in radians (0 dead ahead, positive to starboard).
 * @param {{ x: number, z: number, heading: number }} boat
 * @param {{ x: number, z: number }} point
 * @returns {{ distance: number, angle: number }}
 */
export function bearingTo(boat, point) {
  const dx = point.x - boat.x;
  const dz = point.z - boat.z;
  const sin = Math.sin(boat.heading);
  const cos = Math.cos(boat.heading);
  return {
    distance: Math.hypot(dx, dz),
    angle: Math.atan2(dx * cos - dz * sin, dx * sin + dz * cos),
  };
}
