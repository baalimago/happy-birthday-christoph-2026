// The boat: a small sailing yacht, the size and cut of the ray-marched one (shaders/scene.js).
// She is built in her own frame (x to starboard, y up, z ahead, the waterline at y = 0) as a few
// rigid pieces: the hull with its deck and mast, the mainsail on its boom, the jib on the
// forestay, the pennant, and the rocket with its flame.

import {
  GLOWING,
  RIGID,
  SOLID_ATTRIBUTES,
  SOLID_FRAGMENT,
  SOLID_VERTEX,
  createShape,
  frameOf,
  matrix,
  multiply,
  shade,
  turnAbout,
} from '../solids.js';

/** @typedef {import('../solids.js').Paint} Paint */

// Paint: rgb and gloss.
const WHITE = [0.95, 0.94, 0.9, 0.9];
const RED = [0.72, 0.15, 0.11, 0.35];
const NAVY = [0.09, 0.2, 0.31, 0.6];
const CREAM = [0.88, 0.84, 0.75, 0.1];
const TEAK = [0.72, 0.52, 0.31, 0];
const DARK_TEAK = [0.46, 0.33, 0.22, 0];
const SPAR = [0.2, 0.24, 0.3, 0.3];
const GLASS = [0.1, 0.17, 0.24, 1];
const CANVAS = [0.9, 0.86, 0.77, 0];
const CORAL = [0.9, 0.4, 0.29, 0];
const YELLOW = [0.98, 0.8, 0.38, 0];
const METAL = [0.22, 0.22, 0.25, 0.4];
const ROCKET_RED = [0.86, 0.16, 0.12, 0.7];
const ROCKET_WHITE = [0.95, 0.94, 0.9, 0.7];

/** Where the mast stands, and its top. */
const MAST_Z = 0.15;
const MAST_TOP = 2.75;
/** The forestay, from the stem to the mast: the jib is hinged on it. */
const TACK = [0, 0.42, 1.32];
const HEAD = [0, 2.1, 0.2];
/** The middle of the rocket's body, over the stern. */
const ROCKET = [0, 0.46, -1.55];
/** How far the sails belly, at most. */
const BELLY = 0.17;

// The hull is lofted through these stations, stern to stem.
const STATIONS = [
  -1.36, -1.2, -1.05, -0.8, -0.55, -0.3, -0.05, 0.2, 0.45, 0.7, 0.95, 1.15, 1.3, 1.4,
];
const COCKPIT = { from: 2, to: 5, half: 0.24, depth: 0.13 }; // station indices
const CABIN = { from: -0.3, to: 0.78, height: 0.15 };

/** @param {number} z half the beam at the deck */
function halfBeam(z) {
  if (z < -0.1) return 0.5 - 0.15 * ((-0.1 - z) / 1.26) ** 2;
  return 0.5 * Math.max(0, 1 - ((z + 0.1) / 1.5) ** 2) ** 0.7;
}
/** @param {number} z height of the deck's edge: she rises to the bow, and a little aft */
function sheer(z) {
  return z > -0.2 ? 0.27 + 0.08 * ((z + 0.2) / 1.6) ** 2 : 0.27 + 0.025 * ((z + 0.2) / 1.16) ** 2;
}
/** @param {number} z depth of the keel line */
function keel(z) {
  return -0.03 - 0.3 * Math.sqrt(Math.max(0, 1 - ((z + 0.1) / 1.55) ** 2));
}

/** The hull, the deck and all that is fast to them. */
function hullShape() {
  const shape = createShape();
  const sections = STATIONS.map((z) => {
    const b = halfBeam(z);
    const s = sheer(z);
    const k = keel(z);
    // Heights of the chines: keel, bilge, waterline, boot top, topsides, sheer strake, deck edge.
    const ys = [k, 0.55 * k, 0, 0.05, 0.05 + 0.5 * (s - 0.05), s - 0.04, s];
    return { z, b, s, points: ys.map((y) => [b * Math.sqrt((y - k) / (s - k)), y, z]) };
  });
  const bands = [RED, RED, NAVY, WHITE, WHITE, NAVY];
  /** @param {readonly number[]} p the same point on the port side */
  const port = (p) => [-p[0], p[1], p[2]];

  for (let i = 0; i + 1 < sections.length; i++) {
    const aft = sections[i];
    const fore = sections[i + 1];
    for (let j = 0; j < bands.length; j++) {
      const [a, b, c, d] = [aft.points[j], aft.points[j + 1], fore.points[j + 1], fore.points[j]];
      shape.quad(a, b, c, d, bands[j]);
      shape.quad(port(a), port(d), port(c), port(b), bands[j]);
    }
  }
  // the transom
  const stern = sections[0];
  for (let j = 0; j < bands.length; j++) {
    const [low, high] = [stern.points[j], stern.points[j + 1]];
    shape.quad(port(low), port(high), high, low, bands[j]);
  }

  // The deck, in strips from rail to rail: a pale covering board, teak, and the cockpit's well.
  for (let i = 0; i + 1 < sections.length; i++) {
    const aft = sections[i];
    const fore = sections[i + 1];
    const well = i >= COCKPIT.from && i < COCKPIT.to;
    /** @param {number} fa @param {number} fb @param {number} drop @param {Paint} paint */
    const strip = (fa, fb, drop, paint) => {
      const at = (/** @type {typeof aft} */ s, /** @type {number} */ f) =>
        Math.abs(f) > 1 ? Math.sign(f) * COCKPIT.half : f * s.b;
      shape.quad(
        [at(aft, fa), aft.s - drop, aft.z],
        [at(fore, fa), fore.s - drop, fore.z],
        [at(fore, fb), fore.s - drop, fore.z],
        [at(aft, fb), aft.s - drop, aft.z],
        paint,
      );
    };
    // 2 and -2 stand for the edges of the well
    strip(-1, -0.86, 0, CREAM);
    strip(0.86, 1, 0, CREAM);
    if (well) {
      strip(-0.86, -2, 0, TEAK);
      strip(2, 0.86, 0, TEAK);
      strip(-2, 2, COCKPIT.depth, DARK_TEAK);
      const h = COCKPIT.half;
      for (const side of [-1, 1]) {
        const wall = [
          [side * h, aft.s - COCKPIT.depth, aft.z],
          [side * h, aft.s, aft.z],
          [side * h, fore.s, fore.z],
          [side * h, fore.s - COCKPIT.depth, fore.z],
        ];
        if (side > 0) wall.reverse();
        shape.quad(wall[0], wall[1], wall[2], wall[3], CREAM);
      }
    } else {
      strip(-0.86, 0, 0, TEAK);
      strip(0, 0.86, 0, shade(TEAK, 0.93));
    }
  }
  {
    const h = COCKPIT.half;
    const back = sections[COCKPIT.from];
    shape.quad(
      [h, back.s - COCKPIT.depth, back.z],
      [h, back.s, back.z],
      [-h, back.s, back.z],
      [-h, back.s - COCKPIT.depth, back.z],
      CREAM,
    );
  }

  // The cabin: a low trunk with a band of windows, narrowing forward.
  {
    const { from, to, height } = CABIN;
    const y0 = sheer(from) - COCKPIT.depth;
    const y1 = sheer(from);
    const top = y1 + height;
    const wide = [0.27, 0.17]; // half widths, aft and forward
    const inset = 0.035;
    // rings round the trunk at the deck, under the windows, over them, and the roof's edge
    const levels = [
      { y: y0, inset: 0, slope: 0 },
      { y: y1 + 0.035, inset: 0.008, slope: 0.03 },
      { y: top - 0.03, inset: 0.026, slope: 0.1 },
      { y: top, inset, slope: 0.15 },
    ];
    const rings = levels.map((level) => [
      [-(wide[0] - level.inset), level.y, from],
      [-(wide[1] - level.inset), level.y, to - level.slope],
      [wide[1] - level.inset, level.y, to - level.slope],
      [wide[0] - level.inset, level.y, from],
    ]);
    const paints = [WHITE, GLASS, WHITE];
    for (let j = 0; j < 3; j++) {
      const [low, high] = [rings[j], rings[j + 1]];
      shape.quad(low[0], low[1], high[1], high[0], paints[j]); // port side
      shape.quad(low[1], low[2], high[2], high[1], j === 1 ? GLASS : WHITE); // the front
      shape.quad(low[2], low[3], high[3], high[2], paints[j]); // starboard side
      shape.quad(low[3], low[0], high[0], high[3], j === 0 ? DARK_TEAK : CREAM); // the hatch
    }
    const roof = rings[3];
    shape.quad(roof[0], roof[1], roof[2], roof[3], CREAM);
  }

  // mast, tiller and rudder head
  shape.place((p) => [p[0], p[1], p[2] + MAST_Z]);
  shape.lathe(
    [
      [0.04, 0.2],
      [0.028, MAST_TOP],
      [0, MAST_TOP + 0.03],
    ],
    6,
    SPAR,
  );
  shape.place(null);
  shape.quad(
    [-0.02, 0.33, -1.3],
    [-0.02, 0.41, -0.82],
    [0.02, 0.41, -0.82],
    [0.02, 0.33, -1.3],
    DARK_TEAK,
  );
  shape.quad(
    [0.02, 0.3, -1.3],
    [0.02, 0.33, -1.3],
    [0.02, 0.41, -0.82],
    [0.02, 0.38, -0.82],
    DARK_TEAK,
  );
  shape.quad(
    [-0.02, 0.3, -1.3],
    [-0.02, 0.38, -0.82],
    [-0.02, 0.41, -0.82],
    [-0.02, 0.33, -1.3],
    DARK_TEAK,
  );
  // the rudder, hung on the transom
  shape.box([-0.02, -0.34, -1.47], [0.02, 0.02, -1.36], RED);
  shape.box([-0.02, 0.02, -1.4], [0.02, 0.31, -1.36], DARK_TEAK);
  return shape;
}

/** The mainsail and its boom, in the boat's frame with the boom amidships. */
function mainShape() {
  const shape = createShape();
  const luff = MAST_Z - 0.05;
  const clew = MAST_Z - 1.34;
  const foot = 0.5;
  const head = 2.45;
  const levels = [0.5, 0.78, 1.05, 1.35, 1.7, 2.05, 2.45];
  const chords = 4;
  /** @param {number} y @param {number} c 0 at the luff .. 1 at the leech */
  const at = (y, c) => {
    const h = (y - foot) / (head - foot);
    const leech = luff + (clew - luff) * (1 - h) - 0.07 * Math.sin(Math.PI * h); // a little roach
    const belly =
      BELLY *
      Math.sin(Math.PI * Math.min(1, h * 1.12) ** 0.75) *
      (0.8 * Math.sin(Math.PI * c) + 0.55 * c);
    return [0, y, luff + (leech - luff) * c, belly];
  };
  for (let r = 0; r + 1 < levels.length; r++) {
    const paint = r === 2 ? CORAL : r % 2 ? shade(CANVAS, 0.96) : CANVAS;
    for (let m = 0; m < chords; m++) {
      const [c0, c1] = [m / chords, (m + 1) / chords];
      shape.quad(
        at(levels[r], c0),
        at(levels[r + 1], c0),
        at(levels[r + 1], c1),
        at(levels[r], c1),
        paint,
      );
    }
  }
  // the boom: a square spar set on edge (no facet of the cloth's mesh may face straight up)
  shape.place((p) => [p[0], p[2] + 0.46, MAST_Z + 0.02 - p[1]]);
  shape.lathe(
    [
      [0.03, 0],
      [0.026, 1.4],
    ],
    4,
    SPAR,
  );
  shape.place(null);
  return shape;
}

/** The jib, in the boat's frame, flat along the centreline. */
function jibShape() {
  const shape = createShape();
  const clew = [0, 0.42, 0.24];
  const rows = 5;
  const cols = 3;
  /** @param {number} u up the luff @param {number} v from the luff to the leech */
  const at = (u, v) => {
    const p = [0, 0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const onLuff = TACK[k] + (HEAD[k] - TACK[k]) * u;
      const onLeech = clew[k] + (HEAD[k] - clew[k]) * u;
      p[k] = onLuff + (onLeech - onLuff) * v;
    }
    p[3] =
      0.8 *
      BELLY *
      Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.06)) *
      (0.8 * Math.sin(Math.PI * v) + 0.45 * v);
    return p;
  };
  for (let r = 0; r < rows; r++) {
    const paint = r % 2 ? shade(CORAL, 0.95) : CORAL;
    for (let m = 0; m < cols; m++) {
      shape.quad(
        at(r / rows, m / cols),
        at((r + 1) / rows, m / cols),
        at((r + 1) / rows, (m + 1) / cols),
        at(r / rows, (m + 1) / cols),
        paint,
      );
    }
  }
  return shape;
}

/** The pennant: a long triangle that streams along +z from the masthead. */
function pennantShape() {
  const shape = createShape();
  const length = 0.6;
  const steps = 5;
  /** @param {number} i @param {number} side @returns {number[]} */
  const at = (i, side) => {
    const along = (i / steps) * length;
    return [0, 2.62 + side * 0.1 * (1 - i / steps), MAST_Z + along, along];
  };
  for (let i = 0; i < steps; i++) {
    shape.quad(
      at(i, -1),
      at(i, 1),
      at(i + 1, 1),
      at(i + 1, -1),
      i % 2 ? shade(YELLOW, 0.9) : YELLOW,
    );
  }
  return shape;
}

/** The rocket strapped over the stern: it lies along the keel, nose forward. */
function rocketShape() {
  const shape = createShape();
  // the lathe's axis lies along the boat's
  shape.place((p) => [p[0] + ROCKET[0], ROCKET[1] - p[2], ROCKET[2] + p[1]]);
  shape.lathe(
    [
      [0, -0.5],
      [0.115, -0.53],
      [0.075, -0.42],
      [0.13, -0.42],
      [0.13, -0.12],
      [0.13, 0.02],
      [0.13, 0.42],
      [0.095, 0.62],
      [0, 0.8],
    ],
    8,
    [
      [0.05, 0.04, 0.04, 0],
      METAL,
      METAL,
      ROCKET_WHITE,
      ROCKET_RED,
      ROCKET_WHITE,
      ROCKET_RED,
      ROCKET_RED,
    ],
  );
  // the straps that hold her down
  for (const z of [-0.17, 0.33]) {
    shape.lathe(
      [
        [0.13, z - 0.025],
        [0.142, z - 0.025],
        [0.142, z + 0.025],
        [0.13, z + 0.025],
      ],
      8,
      METAL,
    );
  }
  // four fins at the tail, swept back
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    /** @param {number} r @param {number} y */
    const at = (r, y) => [r * c, y, r * s];
    const fin = [at(0.12, -0.1), at(0.31, -0.36), at(0.31, -0.46), at(0.12, -0.42)];
    shape.quad(fin[0], fin[1], fin[2], fin[3], ROCKET_RED);
    shape.quad(fin[3], fin[2], fin[1], fin[0], ROCKET_RED);
  }
  shape.place(null);
  // the bracket on the transom
  shape.box([-0.05, 0.16, -1.76], [0.05, 0.35, -1.36], METAL);
  return shape;
}

/** The flame: a tongue from the nozzle along -z, one unit long, hot at the root. */
function flameShape() {
  const shape = createShape();
  shape.place((p) => [p[0], p[2], -p[1]]);
  const hot = [1.0, 0.93, 0.6];
  const mid = [1.0, 0.62, 0.16];
  const cool = [0.95, 0.22, 0.05];
  shape.lathe(
    [
      [0.07, 0],
      [0.18, 0.16],
      [0.15, 0.42],
      [0.07, 0.75],
      [0, 1],
    ],
    7,
    [hot, [1.0, 0.82, 0.34], mid, cool, cool],
    { blend: true },
  );
  shape.place(null);
  return shape;
}

/** @param {import('../renderer.js').Kit} kit @returns {import('../renderer.js').Part} */
export function createBoat({ gl, programs }) {
  const program = programs.make(SOLID_VERTEX, SOLID_FRAGMENT, SOLID_ATTRIBUTES);
  const hull = hullShape().mesh(gl);
  const main = mainShape().mesh(gl);
  const jib = jibShape().mesh(gl);
  const pennant = pennantShape().mesh(gl);
  const rocket = rocketShape().mesh(gl);
  const flame = flameShape().mesh(gl);

  const forestay = HEAD.map((v, i) => v - TACK[i]);
  const stayLength = Math.hypot(forestay[0], forestay[1], forestay[2]);
  const stay = forestay.map((v) => v / stayLength);

  // scratch matrices, so that a frame allocates nothing
  const afloat = matrix();
  const heel = matrix();
  const pitch = matrix();
  const upright = matrix();
  const body = matrix();
  const local = matrix();
  const model = matrix();

  return {
    draw(scene) {
      const { frame, time } = scene;
      const { boat, wind } = frame;
      const { sin, cos } = scene.boat;
      const burning = frame.rocket ? 1 : 0;

      // She rides the sea: a heave, a pitch and a roll that grow with the sea state and ease as
      // she gathers way, from sines of the time and of where she is.
      const sea = Math.min(1, Math.max(0, wind.sea ?? ((wind.speed - 0.35) / 1.25) * 0.8));
      const calm = Math.min(1, Math.max(0.12, 2 - boat.speed / 9));
      const swell = time * 1.25 + boat.x * 0.31 + boat.z * 0.23;
      const chop = time * 2.05 - boat.x * 0.17 + boat.z * 0.41;
      const heave = (0.015 + 0.09 * sea) * calm * (Math.sin(swell) + 0.4 * Math.sin(chop));
      const nod =
        (0.012 + 0.05 * sea) * calm * (Math.sin(swell + 1.3) + 0.35 * Math.sin(chop + 0.6)) +
        0.07 * burning; // the rocket lifts her bow
      const roll = boat.lean - (0.02 + 0.05 * sea) * Math.sin(time * 1.3);

      frameOf(
        afloat,
        [cos, 0, -sin],
        [0, 1, 0],
        [sin, 0, cos],
        [boat.x, 0.03 + 0.05 * burning + heave, boat.z],
      );
      turnAbout(heel, [0, 0, 0], [0, 0, 1], -roll);
      turnAbout(pitch, [0, 0, 0], [1, 0, 0], -nod);
      multiply(upright, afloat, heel);
      multiply(body, upright, pitch);

      scene.bind(program);
      const uModel = program.at('uModel');
      const uCloth = program.at('uCloth');
      gl.uniformMatrix4fv(uModel, false, body);
      gl.uniform4fv(uCloth, RIGID);
      hull.draw();
      if (burning) {
        rocket.draw();
        // the flame flickers: its length, its girth and a sway
        const length = 1.05 + 0.2 * Math.sin(time * 31) + 0.12 * Math.sin(time * 47 + 1.7);
        const girth = 1 + 0.16 * Math.sin(time * 40);
        frameOf(
          local,
          [girth, 0, 0],
          [0, girth, 0],
          [0.07 * Math.sin(time * 23), 0.07 * Math.cos(time * 19), length],
          [ROCKET[0], ROCKET[1], ROCKET[2] - 0.5],
        );
        gl.uniformMatrix4fv(uModel, false, multiply(model, body, local));
        gl.uniform4fv(uCloth, GLOWING);
        flame.draw();
      }

      // Cloth is seen from both sides.
      gl.disable(gl.CULL_FACE);
      const lee = Math.min(1, Math.max(-1, boat.boom * 5));
      turnAbout(local, [0, 0, MAST_Z], [0, 1, 0], -boat.boom);
      gl.uniformMatrix4fv(uModel, false, multiply(model, body, local));
      gl.uniform4f(uCloth, lee, 0, 1, 0);
      main.draw();

      // the jib swings a share of the boom's angle about the forestay
      const swing = Math.min(1.2, Math.max(-1.2, boat.boom)) * 0.7;
      turnAbout(local, TACK, stay, -swing);
      gl.uniformMatrix4fv(uModel, false, multiply(model, body, local));
      gl.uniform4f(uCloth, lee, 0, 1, 0);
      jib.draw();

      // The pennant streams with the wind she feels: the true wind less her own way.
      const ax = -Math.sin(wind.from) * wind.speed * 8 - sin * boat.speed;
      const az = -Math.cos(wind.from) * wind.speed * 8 - cos * boat.speed;
      const stream =
        Math.hypot(ax, az) > 1e-3 ? Math.atan2(ax * cos - az * sin, ax * sin + az * cos) : Math.PI;
      turnAbout(local, [0, 0, MAST_Z], [0, 1, 0], stream);
      gl.uniformMatrix4fv(uModel, false, multiply(model, body, local));
      gl.uniform4f(uCloth, 0, 0.16, 1, 0);
      pennant.draw();
      gl.enable(gl.CULL_FACE);
    },
    dispose() {
      for (const mesh of [hull, main, jib, pennant, rocket, flame]) mesh.dispose();
    },
  };
}
