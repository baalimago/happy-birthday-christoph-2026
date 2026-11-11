// The life of the sea, as numbers: dolphins that leap and ride the bow, whales that blow and
// sound, gulls that wheel over the mast near land, turtles, skipping flying fish, and (very
// rarely) a kraken that rises astern and gives chase. Pure: no DOM, no GPU. The loop calls
// step() once a frame and hands `beasts` and `kraken` to the renderer as plain numbers.
//
// Coordinates as everywhere in game/: x east, z north, y up from the sea; heading 0 is north,
// positive clockwise. A beast under the water (y below about -0.6) is simply not seen.

/** Slots the shader has room for. */
export const SLOTS = 14;

/** @typedef {'dolphin' | 'whale' | 'gull' | 'turtle' | 'flyingfish' | 'splash' | 'spout'} Kind */

/**
 * What the sound and the HUD may hear about.
 * @typedef {'dolphin-leap' | 'whale-blow' | 'whale-dive' | 'gull-cry' | 'turtle-dive' |
 *   'flyingfish' | 'kraken-rise' | 'kraken-strike' | 'kraken-gone'} Sighting
 */

/**
 * One creature as the renderer sees it.
 * @typedef {object} Beast
 * @property {Kind} kind
 * @property {number} x
 * @property {number} y height of its centre above the sea
 * @property {number} z
 * @property {number} heading
 * @property {number} pitch nose up is positive
 * @property {number} size scale of the model (1 is the usual animal)
 * @property {number} anim free-running phase of the fins and flukes; for a gull the angle of
 *   its wings; for a splash or a spout its age, 0..1
 */

/**
 * The kraken as the renderer sees it.
 * @typedef {object} KrakenView
 * @property {number} x
 * @property {number} z
 * @property {number} heading the way it faces (towards the boat)
 * @property {number} rise 0 under the sea .. 1 fully up
 * @property {number} reach 0 .. 1, its arms lunging at the boat
 */

/**
 * @typedef {{ x: number, z: number, heading: number, speed: number }} BoatLike
 * @typedef {(x: number, z: number) => boolean} WaterTest true where a creature may swim
 */

/**
 * @typedef {object} StepResult
 * @property {Sighting[]} sightings what happened this step
 * @property {number} strike share of the hull the kraken knocked off this step (0 mostly)
 */

/** Beasts further than this from the boat are let go, and fresh ones found nearer. */
const RANGE = 170;
/** A kraken never rises in the first this many seconds under way. */
const KRAKEN_GRACE = 240;
/** Mean seconds of open-water sailing between krakens. */
const KRAKEN_EVERY = 1500;
/** The kraken swims this fast: a well-trimmed boat outruns it, one under engine does not. */
export const KRAKEN_SPEED = 5.6;
/** It gives up past this distance, or after this many seconds of chase. */
const KRAKEN_LOSE = 75;
const KRAKEN_TIRE = 55;
/** It strikes when this close. */
const KRAKEN_GRAB = 7;
/** Share of the hull one strike takes. */
export const KRAKEN_BITE = 0.22;

const TAU = Math.PI * 2;

/** @param {number} a @returns {number} the same angle, -PI..PI */
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A small seeded generator (mulberry32), so a test can replay a sea.
 * @param {number} seed
 * @returns {() => number} 0..1
 */
export function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Internal state of one creature: what the renderer sees, plus its plans.
 * @typedef {Beast & { vx: number, vz: number, speed: number, timer: number, mode: string,
 *   group: number, leap: number, beat: number, span: number, high: number, ox: number, oz: number,
 *   life: number, dead: boolean }} Life
 */

/**
 * @param {Kind} kind
 * @param {number} x @param {number} z @param {number} heading
 * @returns {Life}
 */
function born(kind, x, z, heading) {
  return {
    kind,
    x,
    y: -2,
    z,
    heading,
    pitch: 0,
    size: 1,
    anim: 0,
    vx: 0,
    vz: 0,
    speed: 0,
    timer: 0,
    mode: '',
    group: 0,
    leap: 0,
    beat: 0,
    span: 1,
    high: 1,
    ox: 0,
    oz: 0,
    life: 0,
    dead: false,
  };
}

/**
 * The sea's creatures round one boat.
 * @param {number} [seed]
 */
export function createFauna(seed = 1) {
  const rand = random(seed);
  /** @type {Life[]} */
  let lives = [];
  /** @type {(KrakenView & { mode: 'rising' | 'chasing' | 'striking' | 'sinking', timer: number,
   *   struck: boolean }) | null} */
  let kraken = null;
  let underWay = 0;
  let pods = 0;
  let nearLand = false;
  let landCheck = 0;
  /** @type {{ x: number, z: number } | null} */
  let last = null;

  /** @param {number} a @param {number} b */
  const between = (a, b) => a + (b - a) * rand();
  /** @param {readonly Life[]} list @param {Kind} kind */
  const count = (list, kind) => list.filter((l) => l.kind === kind && !l.dead).length;

  /**
   * A spot of open water round the boat: ahead of her mostly, where the camera looks.
   * @param {BoatLike} boat @param {WaterTest} water @param {number} near @param {number} far
   * @param {number} [spread] radians either side of the bow
   */
  function spot(boat, water, near, far, spread = 1.4) {
    for (let i = 0; i < 8; i++) {
      const a = boat.heading + between(-spread, spread);
      const r = between(near, far);
      const x = boat.x + Math.sin(a) * r;
      const z = boat.z + Math.cos(a) * r;
      if (water(x, z) && water(x + 6, z) && water(x - 6, z) && water(x, z + 6) && water(x, z - 6)) {
        return { x, z };
      }
    }
    return null;
  }

  /** @param {Life} l @param {number} life */
  function splash(l, life = 0.9) {
    const s = born('splash', l.x, l.z, 0);
    s.y = 0;
    s.life = life;
    s.size = l.kind === 'whale' ? 3 : l.kind === 'flyingfish' ? 0.35 : 1;
    lives.push(s);
  }

  /**
   * Bring new creatures into the sea round the boat, as the population falls short.
   * @param {BoatLike} boat @param {WaterTest} water @param {Sighting[]} out
   */
  function populate(boat, water, out) {
    if (lives.length >= SLOTS - 2) return;
    // A pod of dolphins now and then.
    if (count(lives, 'dolphin') === 0 && rand() < 0.004) {
      const at = spot(boat, water, 35, 80, 1.2);
      if (at) {
        const n = 3 + Math.floor(rand() * 3);
        const heading = boat.heading + between(-0.6, 0.6);
        pods++;
        for (let i = 0; i < n && lives.length < SLOTS - 3; i++) {
          const d = born('dolphin', at.x + between(-4, 4), at.z + between(-4, 4), heading);
          d.group = pods;
          d.speed = between(4, 5.5);
          d.mode = 'swim';
          d.timer = between(0.2, 3);
          d.ox = between(-2.5, 2.5);
          d.oz = between(-2, 3);
          d.size = between(0.9, 1.1);
          lives.push(d);
        }
      }
    }
    // A whale, further out, now and then.
    if (count(lives, 'whale') === 0 && rand() < 0.0015) {
      const at = spot(boat, water, 70, 140, 1.0);
      if (at) {
        const w = born('whale', at.x, at.z, boat.heading + between(-2, 2));
        w.speed = between(1.0, 1.6);
        w.mode = 'surface';
        w.timer = 0;
        w.size = between(0.9, 1.15);
        w.y = -3;
        lives.push(w);
      }
    }
    // Gulls wheel over the boat near land; far out there is now and then a straggler.
    const gulls = count(lives, 'gull');
    if (gulls < (nearLand ? 4 : 1) && rand() < (nearLand ? 0.02 : 0.002)) {
      const a = between(0, TAU);
      const g = born('gull', boat.x + Math.sin(a) * 40, boat.z + Math.cos(a) * 40, a + Math.PI);
      g.y = between(6, 11);
      g.span = between(7, 14); // radius of its circle
      g.high = g.y;
      g.speed = between(5, 7);
      g.oz = rand() < 0.5 ? 1 : -1; // which way it circles
      g.beat = between(0, TAU);
      g.mode = 'come';
      lives.push(g);
    }
    // Turtles basking at the surface.
    if (count(lives, 'turtle') < 2 && rand() < 0.002) {
      const at = spot(boat, water, 30, 70, 0.9);
      if (at) {
        const t = born('turtle', at.x, at.z, between(0, TAU));
        t.y = -0.05;
        t.speed = 0.5;
        t.mode = 'bask';
        t.size = between(0.85, 1.2);
        lives.push(t);
      }
    }
    // A school of flying fish bursts out ahead of the bow.
    if (count(lives, 'flyingfish') === 0 && boat.speed > 2 && rand() < 0.003) {
      const at = spot(boat, water, 14, 30, 0.5);
      if (at) {
        const n = 3 + Math.floor(rand() * 4);
        const heading = boat.heading + (rand() < 0.5 ? 1 : -1) * between(0.5, 1.2);
        for (let i = 0; i < n && lives.length < SLOTS - 1; i++) {
          const f = born('flyingfish', at.x + between(-3, 3), at.z + between(-3, 3), heading);
          f.speed = between(11, 15);
          f.mode = 'wait';
          f.timer = between(0, 0.8);
          f.life = between(1.8, 3.2); // seconds aloft
          lives.push(f);
        }
        out.push('flyingfish');
      }
    }
  }

  /**
   * @param {Life} d @param {BoatLike} boat @param {WaterTest} water @param {number} dt
   * @param {Sighting[]} out
   */
  function dolphin(d, boat, water, dt, out) {
    // Bow-riding: a pod near a boat under way runs alongside her bow, a little ahead.
    const dx = boat.x - d.x;
    const dz = boat.z - d.z;
    const far = Math.hypot(dx, dz);
    let want = d.heading;
    if (boat.speed > 1.5 && boat.speed < 12 && far < 90) {
      const sx = Math.cos(boat.heading);
      const sz = -Math.sin(boat.heading);
      const fx = Math.sin(boat.heading);
      const fz = Math.cos(boat.heading);
      const side = d.ox < 0 ? -1 : 1;
      const tx = boat.x + fx * (5 + d.oz) + sx * (side * 2.2 + d.ox);
      const tz = boat.z + fz * (5 + d.oz) + sz * (side * 2.2 + d.ox);
      want = Math.atan2(tx - d.x, tz - d.z);
      const gap = Math.hypot(tx - d.x, tz - d.z);
      d.speed = Math.min(boat.speed + 4, Math.max(boat.speed * 0.8, boat.speed + (gap - 2) * 0.6));
    } else {
      d.speed += (4.5 - d.speed) * Math.min(1, dt);
    }
    d.heading += Math.max(-1.6 * dt, Math.min(1.6 * dt, wrap(want - d.heading)));
    const nx = d.x + Math.sin(d.heading) * d.speed * dt;
    const nz = d.z + Math.cos(d.heading) * d.speed * dt;
    if (water(nx, nz)) {
      d.x = nx;
      d.z = nz;
    } else d.heading += Math.PI * dt;
    d.anim += dt * (4 + d.speed * 0.6);

    d.timer -= dt;
    if (d.mode === 'swim') {
      d.y += (-1.4 - d.y) * Math.min(1, dt * 3);
      d.pitch *= 1 - Math.min(1, dt * 4);
      if (d.timer <= 0) {
        d.mode = 'leap';
        d.leap = 0;
        d.span = between(0.9, 1.4); // seconds in the air
        d.high = between(0.9, 2.2);
        if (rand() < 0.12) d.high += 1.2; // a show-off
        splash(d, 0.6);
        out.push('dolphin-leap');
      }
    } else {
      d.leap += dt / d.span;
      const s = Math.min(1, d.leap);
      // A parabola from under the sea to under the sea, crossing it at s = 0.15 and 0.85.
      const base = -0.9;
      d.y = base + (d.high - base) * 4 * s * (1 - s) * 1.0;
      const rise = (d.high - base) * 4 * (1 - 2 * s);
      d.pitch = Math.atan2(rise / d.span, Math.max(d.speed, 1));
      if (d.leap >= 1) {
        d.mode = 'swim';
        d.timer = boat.speed > 1.5 && far < 30 ? between(0.6, 2.5) : between(1.5, 6);
        splash(d, 0.7);
      }
    }
  }

  /**
   * @param {Life} w @param {WaterTest} water @param {number} dt @param {Sighting[]} out
   */
  function whale(w, water, dt, out) {
    w.timer += dt;
    w.anim += dt * 1.2;
    const ahead = w.speed * dt;
    const nx = w.x + Math.sin(w.heading) * ahead;
    const nz = w.z + Math.cos(w.heading) * ahead;
    // Whales need room: turn away from shoal water well before it.
    if (water(w.x + Math.sin(w.heading) * 25, w.z + Math.cos(w.heading) * 25)) {
      w.x = nx;
      w.z = nz;
    } else w.heading += 0.4 * dt;

    if (w.mode === 'surface') {
      // Coming up: the back breaks the water, and it blows.
      w.y += (-0.95 - w.y) * Math.min(1, dt * 0.8);
      w.pitch += (0.02 - w.pitch) * Math.min(1, dt);
      if (w.timer > 1.5 && w.leap === 0) {
        w.leap = 1;
        const s = born(
          'spout',
          w.x + Math.sin(w.heading) * 3.5 * w.size,
          w.z + Math.cos(w.heading) * 3.5 * w.size,
          0,
        );
        s.y = 0;
        s.life = 2.6;
        s.size = w.size;
        lives.push(s);
        out.push('whale-blow');
      }
      if (w.timer > between(9, 12)) {
        w.mode = rand() < 0.12 ? 'breach' : 'dive';
        w.timer = 0;
        if (w.mode === 'dive') out.push('whale-dive');
      }
    } else if (w.mode === 'dive') {
      // Nose down, the flukes come up out of the sea and slide under.
      const s = Math.min(1, w.timer / 6);
      w.pitch = -0.75 * Math.sin(Math.min(1, s * 1.4) * Math.PI * 0.5);
      w.y = -0.95 - 7 * s * s;
      if (w.timer > 7) {
        w.mode = 'deep';
        w.timer = 0;
        w.span = between(18, 35);
      }
    } else if (w.mode === 'breach') {
      // Rare: it bursts nearly clear of the sea and falls back with a crash.
      const s = Math.min(1, w.timer / 3.2);
      w.pitch = 1.1 * (1 - s) - 0.2;
      w.y = -6 + 11 * 4 * s * (1 - s);
      if (w.timer > 3.2) {
        splash(w, 1.4);
        out.push('whale-dive');
        w.mode = 'deep';
        w.timer = 0;
        w.span = between(15, 25);
        w.y = -8;
        w.pitch = 0;
      }
    } else if (w.mode === 'deep') {
      w.y = -8;
      w.pitch = 0;
      w.speed = 2.2;
      if (w.timer > w.span) {
        w.mode = 'surface';
        w.timer = 0;
        w.leap = 0;
        w.speed = between(1.0, 1.6);
        w.y = -3.5;
      }
    }
  }

  /**
   * @param {Life} g @param {BoatLike} boat @param {number} dt @param {Sighting[]} out
   */
  function gull(g, boat, dt, out) {
    // It wheels round a point just above and ahead of the masthead.
    const cx = boat.x + Math.sin(boat.heading) * 4;
    const cz = boat.z + Math.cos(boat.heading) * 4;
    const dx = g.x - cx;
    const dz = g.z - cz;
    const r = Math.hypot(dx, dz) || 1;
    const around = Math.atan2(dx, dz) + (g.oz * Math.PI) / 2; // tangent
    const inward = Math.atan2(-dx, -dz);
    const pull = Math.max(-1, Math.min(1, (r - g.span) / g.span));
    const want =
      around + wrap(inward - around) * Math.max(0, pull) - g.oz * 0.3 * Math.min(0, pull);
    g.heading += Math.max(-1.5 * dt, Math.min(1.5 * dt, wrap(want - g.heading)));
    // It keeps up with the boat (up to a point: a rocket leaves it behind).
    const speed = Math.max(g.speed, Math.min(boat.speed * 1.15, 16));
    g.x += Math.sin(g.heading) * speed * dt;
    g.z += Math.cos(g.heading) * speed * dt;
    g.timer -= dt;
    if (g.timer <= 0) {
      g.timer = between(2, 5);
      g.mode = g.mode === 'flap' ? 'glide' : 'flap';
      g.high = between(5.5, 12);
      if (rand() < 0.35) out.push('gull-cry');
    }
    g.y += (g.high - g.y) * Math.min(1, dt * 0.4);
    g.pitch = (g.high - g.y) * 0.05;
    // Flapping beats the wings; gliding holds them out, a little raised.
    g.beat += dt * 9;
    const wings = g.mode === 'flap' ? 0.55 * Math.sin(g.beat) : 0.14;
    g.anim += (wings - g.anim) * Math.min(1, dt * 12);
  }

  /**
   * @param {Life} t @param {BoatLike} boat @param {WaterTest} water @param {number} dt
   * @param {Sighting[]} out
   */
  function turtle(t, boat, water, dt, out) {
    t.anim += dt * 1.6;
    const close = Math.hypot(boat.x - t.x, boat.z - t.z);
    if (t.mode === 'bask' && close < 9) {
      t.mode = 'dive';
      out.push('turtle-dive');
    }
    if (t.mode === 'dive') {
      t.y -= dt * 0.5;
      t.pitch = -0.4;
      t.speed = 1.2;
      if (t.y < -3) t.dead = true;
    } else {
      t.y = -0.07 + 0.03 * Math.sin(t.anim * 0.7);
      t.heading += 0.08 * Math.sin(t.anim * 0.21) * dt;
    }
    const nx = t.x + Math.sin(t.heading) * t.speed * dt;
    const nz = t.z + Math.cos(t.heading) * t.speed * dt;
    if (water(nx, nz)) {
      t.x = nx;
      t.z = nz;
    } else t.heading += dt;
  }

  /**
   * @param {Life} f @param {number} dt
   */
  function flyingfish(f, dt) {
    f.timer -= dt;
    f.anim += dt * 30;
    if (f.mode === 'wait') {
      f.y = -1;
      if (f.timer <= 0) {
        f.mode = 'glide';
        f.timer = f.life;
        splash(f, 0.4);
      }
      return;
    }
    // Out of the water, a long low glide that sinks and skips once off a wave crest.
    const s = 1 - Math.max(0, f.timer) / f.life;
    f.y = 0.25 + 0.7 * Math.sin(Math.min(1, s * 1.2) * Math.PI) * (1 - s * 0.5);
    f.speed *= 1 - dt * 0.12;
    f.heading += Math.sin(f.anim * 0.05) * 0.2 * dt;
    f.x += Math.sin(f.heading) * f.speed * dt;
    f.z += Math.cos(f.heading) * f.speed * dt;
    f.pitch = 0.05;
    if (f.timer <= 0) {
      splash(f, 0.4);
      f.dead = true;
    }
  }

  /**
   * @param {BoatLike} boat @param {WaterTest} water @param {number} dt
   * @param {Sighting[]} out
   * @returns {number} hull knocked off
   */
  function hunt(boat, water, dt, out) {
    if (!kraken) return 0;
    const k = kraken;
    k.timer += dt;
    const dx = boat.x - k.x;
    const dz = boat.z - k.z;
    const far = Math.hypot(dx, dz);
    const toward = Math.atan2(dx, dz);
    k.heading += Math.max(-1.2 * dt, Math.min(1.2 * dt, wrap(toward - k.heading)));
    let hit = 0;
    if (k.mode === 'rising') {
      k.rise = Math.min(1, k.rise + dt / 3.5);
      if (k.rise >= 1) {
        k.mode = 'chasing';
        k.timer = 0;
      }
    } else if (k.mode === 'chasing') {
      const speed = Math.min(KRAKEN_SPEED, far * 0.8);
      const nx = k.x + Math.sin(k.heading) * speed * dt;
      const nz = k.z + Math.cos(k.heading) * speed * dt;
      if (water(nx, nz)) {
        k.x = nx;
        k.z = nz;
      }
      if (far < KRAKEN_GRAB) {
        k.mode = 'striking';
        k.timer = 0;
        out.push('kraken-strike');
      } else if (far > KRAKEN_LOSE || k.timer > KRAKEN_TIRE || !water(nx, nz)) {
        k.mode = 'sinking';
        k.timer = 0;
        out.push('kraken-gone');
      }
    } else if (k.mode === 'striking') {
      k.reach = Math.min(1, k.timer / 0.7);
      if (k.timer > 0.7 && !k.struck) {
        k.struck = true;
        hit = KRAKEN_BITE;
      }
      if (k.timer > 2.2) {
        k.mode = 'sinking';
        k.timer = 0;
        out.push('kraken-gone');
      }
    } else {
      k.reach = Math.max(0, k.reach - dt);
      k.rise = Math.max(0, k.rise - dt / 3);
      if (k.rise <= 0) kraken = null;
    }
    return hit;
  }

  /**
   * Raise the kraken astern of the boat, on her quarter. False when there is no room.
   * @param {BoatLike} boat @param {WaterTest} water
   */
  function summonKraken(boat, water) {
    if (kraken) return false;
    for (const side of [0.35, -0.35, 0, 0.7, -0.7]) {
      const a = boat.heading + Math.PI + side;
      const x = boat.x + Math.sin(a) * 26;
      const z = boat.z + Math.cos(a) * 26;
      if (water(x, z) && water(x + 8, z) && water(x - 8, z) && water(x, z + 8) && water(x, z - 8)) {
        kraken = {
          x,
          z,
          heading: Math.atan2(boat.x - x, boat.z - z),
          rise: 0,
          reach: 0,
          mode: 'rising',
          timer: 0,
          struck: false,
        };
        return true;
      }
    }
    return false;
  }

  /**
   * Open water all round: no land within a long way. Sampled on a ring.
   * @param {BoatLike} boat @param {WaterTest} water @param {number} radius
   */
  function open(boat, water, radius) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      if (!water(boat.x + Math.sin(a) * radius, boat.z + Math.cos(a) * radius)) return false;
    }
    return true;
  }

  return {
    /** What the renderer draws: at most SLOTS beasts, nearest first. */
    get beasts() {
      return /** @type {readonly Beast[]} */ (lives);
    },
    /** @returns {KrakenView | null} */
    get kraken() {
      return kraken;
    },
    /**
     * 0..1: how near and how risen the kraken is, for sound and camera.
     * @param {BoatLike} boat
     */
    menace(boat) {
      if (!kraken) return 0;
      const far = Math.hypot(boat.x - kraken.x, boat.z - kraken.z);
      return kraken.rise * Math.max(0, Math.min(1, 1.3 - far / KRAKEN_LOSE));
    },
    summonKraken,

    /**
     * One step of the sea's life.
     * @param {BoatLike} boat
     * @param {number} dt seconds (0 while hove to: nothing moves)
     * @param {WaterTest} water
     * @returns {StepResult}
     */
    step(boat, dt, water) {
      /** @type {Sighting[]} */
      const sightings = [];
      if (dt <= 0) return { sightings, strike: 0 };
      dt = Math.min(dt, 0.1);
      // Moved, not sailed (a wreck towed home, a new voyage): the old sea is gone.
      if (last && Math.hypot(boat.x - last.x, boat.z - last.z) > 60) {
        lives = [];
        kraken = null;
      }
      last = { x: boat.x, z: boat.z };

      landCheck -= dt;
      if (landCheck <= 0) {
        landCheck = 2;
        nearLand = !open(boat, water, 140);
        if (boat.speed > 1.5) underWay += 2;
      }

      for (const l of lives) {
        if (l.kind === 'dolphin') dolphin(l, boat, water, dt, sightings);
        else if (l.kind === 'whale') whale(l, water, dt, sightings);
        else if (l.kind === 'gull') gull(l, boat, dt, sightings);
        else if (l.kind === 'turtle') turtle(l, boat, water, dt, sightings);
        else if (l.kind === 'flyingfish') flyingfish(l, dt);
        else {
          l.anim += dt / l.life;
          if (l.anim >= 1) l.dead = true;
        }
        if (Math.hypot(l.x - boat.x, l.z - boat.z) > RANGE) l.dead = true;
      }
      lives = lives.filter((l) => !l.dead);
      populate(boat, water, sightings);
      // Too many (a burst of splashes): keep the nearest.
      if (lives.length > SLOTS) {
        const d = (/** @type {Life} */ l) => Math.hypot(l.x - boat.x, l.z - boat.z);
        lives = lives.sort((a, b) => d(a) - d(b)).slice(0, SLOTS);
      }

      if (
        !kraken &&
        underWay > KRAKEN_GRACE &&
        boat.speed > 1.5 &&
        landCheck === 2 && // once per land check, on open water only
        !nearLand &&
        rand() < 2 / KRAKEN_EVERY
      ) {
        if (summonKraken(boat, water)) sightings.push('kraken-rise');
      }
      const strike = hunt(boat, water, dt, sightings);
      return { sightings, strike };
    },
  };
}

/** @typedef {ReturnType<typeof createFauna>} Fauna */
