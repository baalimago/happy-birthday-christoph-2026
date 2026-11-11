// The sea's creatures: dolphins, whales, gulls, turtles, flying fish, the splashes and spouts
// they leave, and the kraken. Each kind is one small flat-shaded mesh in its own frame (nose
// along +z, y up, about life size), drawn once per creature with its place, heading, pitch and
// size; the tail beats and the wings flap in the vertex shader. They dive through the sea: the
// sea is drawn after them and hides what is under it. A frame without creatures costs nothing.

import { COMMON, FINISH } from '../look.js';
import { SHAPE_ATTRIBUTES, createShape, hash, ringY, ringZ } from '../lowpoly.js';

/** @typedef {import('../lowpoly.js').Vec} Vec */
/** @typedef {import('../lowpoly.js').Shape} Shape */

/** Kinds in the order of the meshes; a creature of another kind is not drawn. */
const KINDS = ['dolphin', 'whale', 'gull', 'turtle', 'flyingfish', 'splash', 'spout'];
/** How far off a creature of each kind can still be made out, for a creature of size 1. */
const SEEN = [260, 700, 220, 150, 110, 260, 420];
/** The kraken is seen from this far. */
const KRAKEN_SEEN = 900;
const ARMS = 8;
const JOINTS = 10;

// The spare attribute: x is the limb (0 the body), the rest is the limb's own (see the models).
const BEAST_VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec3 aCol;
layout(location = 3) in vec4 aAux;
${COMMON}
uniform vec4 uPose;       // x, y, z, size
uniform vec4 uTurn;       // cos and sin of the heading, cos and sin of the pitch
uniform vec2 uKind;       // kind, anim
flat out vec3 vCol;
out float vHaze;
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c*v.x - s*v.y, s*v.x + c*v.y); }
vec3 out_(vec3 l){
  vec3 m = vec3(l.x, l.y*uTurn.z + l.z*uTurn.w, l.z*uTurn.z - l.y*uTurn.w);
  return vec3(m.x*uTurn.x + m.z*uTurn.y, m.y, -m.x*uTurn.y + m.z*uTurn.x);
}
void main(){
  vec3 p = aPos, n = aNor;
  float a = uKind.y, limb = aAux.x;
  int kind = int(uKind.x + 0.5);
  if (kind == 0) {
    // the tail stock beats up and down
    float aft = max(0.0, 0.1 - p.z);
    p.y -= 0.16*sin(a)*aft*aft;
  } else if (kind == 1) {
    float aft = max(0.0, -p.z);
    p.y -= 0.012*sin(a)*aft*aft;
  } else if (kind == 2) {
    if (limb > 0.5) {
      // wings hinge at the shoulder, and again half way out, the other way
      float side = sign(p.x);
      vec2 w = vec2(abs(p.x) - 0.05, p.y - 0.02), m = vec2(n.x*side, n.y);
      if (limb > 1.5) { w = vec2(0.52, 0.0) + rot(w - vec2(0.52, 0.0), -0.7*a); m = rot(m, -0.7*a); }
      w = rot(w, a); m = rot(m, a);
      p.xy = vec2(side*(w.x + 0.05), w.y + 0.02);
      n.xy = vec2(side*m.x, m.y);
    }
  } else if (kind == 3) {
    if (limb > 0.5) {
      // the fore flippers row
      float side = sign(p.x), th = -0.6 + 0.45*sin(a);
      vec2 f = vec2(abs(p.x) - 0.42, p.z - 0.28);
      f = vec2(cos(th)*f.x + sin(th)*f.y, -sin(th)*f.x + cos(th)*f.y);
      p.x = side*(f.x + 0.42); p.z = f.y + 0.28;
      p.y += 0.05*sin(a)*f.x;
    }
  } else if (kind == 4) {
    p.x += 0.03*sin(a)*smoothstep(-0.05, -0.25, p.z);
    if (limb > 0.5) p.y += 0.25*abs(p.x)*sin(a*0.37);
  } else if (kind == 5) {
    // a column and a crown of drops, up and down again as it ages; a ring of foam spreads
    float up = 3.2*a*(1.0 - a);
    if (limb < 0.5) p = vec3(p.x*(0.14 + 0.2*a), up*0.45 + p.y*(0.05 + 0.75*up), p.z*(0.14 + 0.2*a));
    else if (limb < 1.5) {
      vec3 dir = vec3(aAux.y, 0.0, aAux.w);
      p = dir*(0.3 + 0.9*a)*(0.7 + 0.6*aAux.z) + vec3(0.0, up*(0.25 + 0.7*aAux.z), 0.0)
        + p*(0.11*(1.0 - a) + 0.03)*(1.4 - 0.6*aAux.z);
    } else {
      float r = 0.3 + 1.3*a + (aAux.y - 0.5)*0.55*(1.0 - a);
      p = vec3(p.x*r, 0.06/uPose.w, p.z*r);
    }
  } else {
    // the blow: a plume that shoots up, spreads and thins away, and drops falling from it
    float grow = min(1.0, a*4.0), fade = 1.0 - smoothstep(0.55, 1.0, a);
    if (limb < 0.5) {
      float w = (0.25 + 0.7*a)*fade + 0.01;
      p = vec3(p.x*w, 1.6*grow + 0.2*a + (p.y - 0.5)*3.2*grow*fade, p.z*w);
    } else {
      vec3 dir = vec3(aAux.y, 0.0, aAux.w);
      float fall = max(0.0, a - 0.2*aAux.z);
      p = dir*(0.15 + 1.5*fall)*(0.5 + aAux.z)
        + vec3(0.0, 3.0*grow*(0.6 + 0.4*aAux.z) - 4.5*fall*fall, 0.0) + p*0.1*fade*grow;
    }
  }
  vec3 world = uPose.xyz + out_(p)*uPose.w;
  vec3 nw = normalize(out_(n));
  float sun = dot(nw, uSun);
  if (kind >= 5) {
    // spray and mist: lit through, bright on the side to the sun
    vCol = aCol*(uAmb*1.25 + uSunCol*(0.3 + 0.35*max(sun, 0.0)));
  } else {
    // skin: the sun wraps round it a little, the sky above and the sea below light the rest
    vCol = aCol*(uAmb*(0.8 + 0.3*nw.y) + uSunCol*clamp((sun + 0.3)/1.3, 0.0, 1.0))
         + uSunCol*0.3*pow(max(dot(reflect(normalize(world - uEye), nw), uSun), 0.0), 16.0);
    // wet and dark at the waterline
    if (kind != 2) vCol *= 0.75 + 0.25*smoothstep(-0.1, 0.5, world.y);
  }
  vHaze = hazeAt(world);
  gl_Position = uViewProj*vec4(world, 1.0);
}`;

// Arms: aAux is the joint, the corner's place round the arm (cos, sin) and the arm's radius
// there; aPos.xy is the facet's place round the arm, for its normal. Body: aAux.x is -1.
const KRAKEN_VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec3 aCol;
layout(location = 3) in vec4 aAux;
${COMMON}
uniform vec4 uPose;       // x, z, cos and sin of the heading
uniform vec4 uMantle;     // the mantle's centre in the kraken's frame, and how hard it breathes
uniform vec3 uJoint[${ARMS * JOINTS}];
uniform vec3 uArmSide[${ARMS}];
flat out vec3 vCol;
out float vHaze;
void main(){
  vec3 p, n;
  if (aAux.x < -0.5) {
    p = aPos*vec3(1.0 + uMantle.w, 1.0 - 0.6*uMantle.w, 1.0 + uMantle.w) + uMantle.xyz;
    n = aNor;
  } else {
    int j = int(aAux.x + 0.5), arm = j/${JOINTS}, k = j - arm*${JOINTS};
    vec3 t = normalize(uJoint[arm*${JOINTS} + min(k + 1, ${JOINTS - 1})] - uJoint[arm*${JOINTS} + max(k - 1, 0)]);
    vec3 over = normalize(cross(t, uArmSide[arm]));
    vec3 side = cross(over, t);
    p = uJoint[j] + aAux.w*(aAux.y*side + aAux.z*over);
    n = aPos.x*side + aPos.y*over;
  }
  vec3 world = vec3(p.x*uPose.z + p.z*uPose.w + uPose.x, p.y, -p.x*uPose.w + p.z*uPose.z + uPose.y);
  vec3 nw = vec3(n.x*uPose.z + n.z*uPose.w, n.y, -n.x*uPose.w + n.z*uPose.z);
  // eyes glow; the rest is wet skin, dark where it leaves the sea
  vCol = aAux.x < -1.5 ? aCol*(0.75 + 0.5*max(dot(nw, uSun), 0.0))
       : lit(aCol, nw)*(0.6 + 0.4*smoothstep(0.0, 1.6, world.y))
         + uSunCol*0.25*pow(max(dot(reflect(normalize(world - uEye), nw), uSun), 0.0), 12.0);
  vHaze = hazeAt(world);
  gl_Position = uViewProj*vec4(world, 1.0);
}`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
${FINISH}
flat in vec3 vCol;
in float vHaze;
out vec4 outColor;
void main(){
  // on the green screen they would be lost in the dark sea: they glow a little there
  outColor = vec4(finish(uMode == 1 ? vCol*1.3 + 0.22 : vCol, vHaze), 1.0);
}`;

/** @param {Vec} p @returns {Vec} */
const flip = (p) => [-p[0], p[1], p[2]];

/** Grey above, a pale cape along the flank, white beneath; dorsal fin, flippers and flukes. */
function dolphin() {
  const shape = createShape();
  /** @type {Vec} */
  const back = [0.25, 0.31, 0.39];
  /** @type {Vec} */
  const flank = [0.4, 0.48, 0.56];
  /** @type {Vec} */
  const belly = [0.9, 0.9, 0.87];
  const rings = [
    ringZ(6, 1.38, 0, 0, -0.08),
    ringZ(6, 1.14, 0.07, 0.06, -0.07),
    ringZ(6, 0.96, 0.17, 0.19, -0.01),
    ringZ(6, 0.6, 0.27, 0.28),
    ringZ(6, 0.1, 0.3, 0.31),
    ringZ(6, -0.4, 0.24, 0.26),
    ringZ(6, -0.8, 0.13, 0.17),
    ringZ(6, -1.1, 0.05, 0.09),
    ringZ(6, -1.22, 0, 0),
  ];
  shape.loft(rings, (c, n) => (n[1] < -0.3 ? belly : n[1] > 0.5 ? back : flank));
  shape.spike(
    [
      [0.045, 0.27, 0.25],
      [-0.045, 0.27, 0.25],
      [-0.03, 0.25, -0.3],
      [0.03, 0.25, -0.3],
    ],
    [0, 0.62, -0.42],
    back,
  );
  for (const side of [1, -1]) {
    /** @type {Vec[]} */
    const flipper = [
      [0.2, -0.16, 0.58],
      [0.5, -0.33, 0.24],
      [0.2, -0.18, 0.36],
    ];
    /** @type {Vec[]} */
    const fluke = [
      [0, 0, -1.04],
      [0.44, 0, -1.42],
      [0.2, 0, -1.3],
      [0, 0, -1.25],
    ];
    const mirror = side > 0 ? (/** @type {Vec} */ p) => p : flip;
    shape.plate(flipper.map(mirror), flank);
    shape.plate(fluke.map(mirror), back, flank);
  }
  return shape;
}

/** A humpback: dark, a pale throat and long pale flippers, a small fin far aft, broad flukes. */
function whale() {
  const shape = createShape();
  /** @type {Vec} */
  const dark = [0.14, 0.16, 0.21];
  /** @type {Vec} */
  const slate = [0.2, 0.23, 0.29];
  /** @type {Vec} */
  const pale = [0.8, 0.82, 0.82];
  const rings = [
    ringZ(8, 6.6, 0, 0, -0.2),
    ringZ(8, 6.1, 0.7, 0.55, -0.15),
    ringZ(8, 4.6, 1.2, 1.0, -0.05),
    ringZ(8, 2.5, 1.5, 1.3),
    ringZ(8, 0.2, 1.55, 1.35),
    ringZ(8, -2.0, 1.25, 1.12),
    ringZ(8, -4.0, 0.72, 0.72),
    ringZ(8, -5.5, 0.36, 0.38),
    ringZ(8, -6.3, 0.16, 0.16),
    ringZ(8, -6.5, 0, 0),
  ];
  shape.loft(rings, (c, n) =>
    n[1] < -0.3 && c[2] > -3 ? pale : hash(c[0], c[1], c[2]) > 0.7 ? slate : dark,
  );
  shape.spike(
    [
      [0.14, 1.0, -2.6],
      [-0.14, 1.0, -2.6],
      [-0.1, 0.9, -3.8],
      [0.1, 0.9, -3.8],
    ],
    [0, 1.5, -3.7],
    dark,
  );
  for (const side of [1, -1]) {
    const mirror = side > 0 ? (/** @type {Vec} */ p) => p : flip;
    /** @type {Vec[]} */
    const flipper = [
      [1.0, -0.6, 3.0],
      [2.4, -0.95, 1.9],
      [3.5, -1.2, 0.3],
      [3.2, -1.15, 0.2],
      [1.0, -0.65, 2.2],
    ];
    /** @type {Vec[]} */
    const fluke = [
      [0, 0, -5.8],
      [1.3, 0, -6.3],
      [2.4, 0, -7.5],
      [1.0, 0, -7.0],
      [0, 0, -6.75],
    ];
    shape.plate(flipper.map(mirror), pale);
    shape.plate(fluke.map(mirror), dark, pale);
  }
  return shape;
}

/** White, grey on the wings, black wing tips, a yellow bill. Limb 1 is the inner wing, 2 the outer. */
function gull() {
  const shape = createShape();
  /** @type {Vec} */
  const white = [0.97, 0.97, 0.95];
  /** @type {Vec} */
  const grey = [0.64, 0.68, 0.72];
  /** @type {Vec} */
  const black = [0.09, 0.09, 0.1];
  /** @type {Vec} */
  const bill = [0.98, 0.78, 0.15];
  const rings = [
    ringZ(5, 0.3, 0.045, 0.05, 0.05),
    ringZ(5, 0.2, 0.07, 0.07, 0.04),
    ringZ(5, 0.04, 0.085, 0.085),
    ringZ(5, -0.16, 0.06, 0.05),
    ringZ(5, -0.28, 0.07, 0.014),
    ringZ(5, -0.38, 0.035, 0.006),
  ];
  shape.loft(rings, white);
  shape.spike(rings[0], [0, 0.03, 0.4], bill);
  shape.spike(rings[5], [0, 0, -0.39], white);
  for (const side of [1, -1]) {
    const mirror = side > 0 ? (/** @type {Vec} */ p) => p : flip;
    /** @type {Vec[]} */
    const inner = [
      [0.05, 0.02, 0.12],
      [0.52, 0.02, 0.1],
      [0.52, 0.02, -0.07],
      [0.05, 0.02, -0.09],
    ];
    /** @type {Vec[]} */
    const outer = [
      [0.52, 0.02, 0.1],
      [0.76, 0.02, 0.03],
      [0.74, 0.02, -0.1],
      [0.52, 0.02, -0.07],
    ];
    /** @type {Vec[]} */
    const tip = [
      [0.76, 0.02, 0.03],
      [1.02, 0.02, -0.16],
      [0.74, 0.02, -0.1],
    ];
    shape.mark(1);
    shape.plate(inner.map(mirror), grey, white);
    shape.mark(2);
    shape.plate(outer.map(mirror), grey, white);
    shape.plate(tip.map(mirror), black);
  }
  return shape;
}

/** A domed shell of brown scutes over olive skin. Limb 1 is a fore flipper. */
function turtle() {
  const shape = createShape();
  /** @type {Vec} */
  const skin = [0.52, 0.5, 0.36];
  /** @type {Vec} */
  const scute = [0.48, 0.37, 0.17];
  /** @type {Vec} */
  const seam = [0.3, 0.23, 0.1];
  /** @type {Vec} */
  const plastron = [0.74, 0.68, 0.46];
  const shell = [
    ringY(8, -0.12, 0, 0),
    ringY(8, -0.1, 0.3, 0.38, 0.5),
    ringY(8, -0.02, 0.42, 0.52, 0.5),
    ringY(8, 0.09, 0.3, 0.38, 0.5),
    ringY(8, 0.15, 0.13, 0.17, 0.5),
    ringY(8, 0.16, 0, 0),
  ];
  let facet = 0;
  shape.loft(shell, (c, n) => (n[1] < 0 ? plastron : facet++ % 3 === 1 ? seam : scute));
  shape.spike(
    [
      [0.07, 0.03, 0.5],
      [0, 0.07, 0.5],
      [-0.07, 0.03, 0.5],
      [-0.06, -0.05, 0.5],
      [0.06, -0.05, 0.5],
    ],
    [0, 0, 0.8],
    skin,
  );
  for (const side of [1, -1]) {
    const mirror = side > 0 ? (/** @type {Vec} */ p) => p : flip;
    /** @type {Vec[]} */
    const fore = [
      [0.38, -0.04, 0.36],
      [0.72, -0.04, 0.34],
      [0.9, -0.04, 0.24],
      [0.62, -0.04, 0.2],
      [0.38, -0.04, 0.2],
    ];
    /** @type {Vec[]} */
    const hind = [
      [0.2, -0.04, -0.38],
      [0.36, -0.04, -0.5],
      [0.26, -0.04, -0.62],
      [0.14, -0.04, -0.48],
    ];
    shape.mark(1);
    shape.plate(fore.map(mirror), skin);
    shape.mark(0);
    shape.plate(hind.map(mirror), skin);
  }
  return shape;
}

/** A blue back, a silver belly, long glassy wings. Limb 1 is a wing. */
function flyingfish() {
  const shape = createShape();
  /** @type {Vec} */
  const blue = [0.12, 0.28, 0.6];
  /** @type {Vec} */
  const silver = [0.86, 0.89, 0.92];
  /** @type {Vec} */
  const wing = [0.58, 0.7, 0.84];
  const rings = [
    ringZ(4, 0.19, 0, 0),
    ringZ(4, 0.1, 0.04, 0.042),
    ringZ(4, -0.04, 0.045, 0.045),
    ringZ(4, -0.19, 0.012, 0.02),
  ];
  shape.loft(rings, (c, n) => (n[1] > 0 ? blue : silver));
  shape.plate(
    [
      [0, 0, -0.17],
      [0, 0.09, -0.28],
      [0, 0, -0.22],
      [0, -0.11, -0.3],
    ],
    blue,
  );
  shape.mark(1);
  for (const side of [1, -1]) {
    const mirror = side > 0 ? (/** @type {Vec} */ p) => p : flip;
    /** @type {Vec[]} */
    const points = [
      [0.03, 0.015, 0.13],
      [0.33, 0.015, -0.07],
      [0.2, 0.015, -0.06],
      [0.03, 0.015, 0.03],
    ];
    shape.plate(points.map(mirror), wing);
  }
  return shape;
}

/** A drop: an octahedron about the origin, one unit across its points. */
function drop(/** @type {Shape} */ shape, /** @type {Vec} */ colour) {
  shape.ball([0, 0, 0], [1, 1.3, 1], 4, 2, colour);
}

/** Limb 0 the column, 1 a drop of the crown (its way out in y, w; z tells them apart), 2 the foam. */
function splash() {
  const shape = createShape();
  /** @type {Vec} */
  const white = [0.96, 0.97, 1.0];
  /** @type {Vec} */
  const foam = [0.86, 0.93, 0.95];
  shape.ball([0, 0, 0], [1, 1, 1], 6, 3, white);
  for (let i = 0; i < 9; i++) {
    const a = ((i + 0.3 * hash(i, 7)) / 9) * Math.PI * 2;
    shape.mark(1, Math.sin(a), hash(i, 3), Math.cos(a));
    drop(shape, white);
  }
  const sides = 12;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const b = ((i + 1) / sides) * Math.PI * 2;
    /** @type {Vec} */
    const p = [Math.sin(a), 0, Math.cos(a)];
    /** @type {Vec} */
    const q = [Math.sin(b), 0, Math.cos(b)];
    /** @type {Vec} */
    const up = [0, 1, 0];
    // the spare attribute tells the inner edge of the ring from the outer
    for (const [corner, edge] of /** @type {[Vec, number][]} */ ([
      [p, 0],
      [p, 1],
      [q, 1],
      [p, 0],
      [q, 1],
      [q, 0],
    ])) {
      shape.vertex([...corner, ...up, ...foam, 2, edge, 0, 0]);
    }
  }
  return shape;
}

/** Limb 0 the plume (y from 0 at its foot to 1), 1 a drop falling from it. */
function spout() {
  const shape = createShape();
  /** @type {Vec} */
  const white = [0.95, 0.97, 1.0];
  /** @type {Vec} */
  const mist = [0.82, 0.89, 0.94];
  const plume = [
    ringY(6, 0, 0, 0),
    ringY(6, 0.04, 0.22, 0.22),
    ringY(6, 0.45, 0.5, 0.5, 0.5),
    ringY(6, 0.78, 1, 1),
    ringY(6, 0.95, 0.7, 0.7, 0.5),
    ringY(6, 1.04, 0, 0),
  ];
  let facet = 0;
  shape.loft(plume, () => (facet++ % 2 ? white : mist));
  for (let i = 0; i < 7; i++) {
    const a = ((i + 0.5 * hash(i, 11)) / 7) * Math.PI * 2;
    shape.mark(1, Math.sin(a), hash(i, 5), Math.cos(a));
    drop(shape, white);
  }
  return shape;
}

const TILT = 0.5;
/** The mantle's own upright frame into the kraken's: it leans back, away from its prey. */
function lean(/** @type {Vec} */ h) {
  const c = Math.cos(TILT);
  const s = Math.sin(TILT);
  return /** @type {Vec} */ ([h[0], c * h[1] + s * h[2], -s * h[1] + c * h[2]]);
}

/**
 * The kraken: a tall finned mantle leaning back over a broad head with two amber eyes, about
 * the mantle's centre; and eight arms, skinned to joints the part moves each frame.
 */
function kraken() {
  const shape = createShape();
  /** @type {Vec} */
  const red = [0.66, 0.2, 0.14];
  /** @type {Vec} */
  const wine = [0.4, 0.09, 0.1];
  /** @type {Vec} */
  const blotch = [0.72, 0.36, 0.24];
  /** @type {Vec} */
  const pale = [0.9, 0.68, 0.6];
  /** @type {Vec} */
  const sucker = [0.66, 0.36, 0.32];
  /** @type {import('../lowpoly.js').Paint} */
  const skin = (c) => {
    const h = hash(Math.round(c[0] * 3), Math.round(c[1] * 3), Math.round(c[2] * 3));
    return h > 0.88 ? blotch : h > 0.42 ? red : wine;
  };

  shape.mark(-1);
  const profile = [
    [-2.7, 1.5, 1.7],
    [-1.4, 2.15, 2.35],
    [0.4, 2.3, 2.5],
    [2.2, 2.0, 2.15],
    [3.6, 1.35, 1.4],
    [4.5, 0.65, 0.65],
    [5.2, 0, 0],
  ];
  shape.loft(
    profile.map(([y, rx, rz], i) => ringY(8, y, rx, rz, i * 0.5).map(lean)),
    skin,
  );
  // the fins of a squid, either side of the tip
  for (const side of [1, -1]) {
    /** @type {Vec[]} */
    const fin = [
      [1.9 * side, 1.5, -0.3],
      [3.9 * side, 2.3, -1.0],
      [2.4 * side, 4.1, -0.7],
      [0.2 * side, 5.3, -0.2],
    ];
    shape.plate(fin.map(lean), red, wine);
  }
  shape.ball([0, -1.6, 1.4], [2.9, 1.9, 2.4], 8, 4, skin);
  // brows, and the eyes under them: amber, with a slit
  for (const side of [1, -1]) {
    /** @type {Vec} */
    const eye = [1.7 * side, -0.45, 2.85];
    const outward = [0.512 * side, 0, 0.859];
    const across = [0.859 * side, 0, -0.512];
    shape.mark(-1);
    shape.plate(
      [
        [eye[0] - across[0] * 1.0, eye[1] + 0.95, eye[2] - across[2] * 1.0 - 0.2],
        [eye[0] + across[0] * 0.9, eye[1] + 0.4, eye[2] + across[2] * 0.9 + 0.1],
        [eye[0] + outward[0] * 1.1, eye[1] + 0.85, eye[2] + outward[2] * 1.1],
      ],
      wine,
    );
    shape.mark(-2);
    shape.ball(eye, [0.62, 0.62, 0.62], 6, 3, [1.0, 0.7, 0.16]);
    const front = eye.map((v, i) => v + outward[i] * 0.66);
    shape.plate(
      [
        [front[0], front[1] + 0.5, front[2]],
        [front[0] + across[0] * 0.13, front[1], front[2] + across[2] * 0.13],
        [front[0], front[1] - 0.5, front[2]],
        [front[0] - across[0] * 0.13, front[1], front[2] - across[2] * 0.13],
      ],
      [0.03, 0.02, 0.02],
    );
  }

  // the arms: rings of five corners at each joint; pale underneath, with suckers
  const sides = 5;
  for (let arm = 0; arm < ARMS; arm++) {
    for (let j = 0; j + 1 < JOINTS; j++) {
      for (let i = 0; i < sides; i++) {
        /** @param {number} joint @param {number} corner */
        const at = (joint, corner) => {
          const s = joint / (JOINTS - 1);
          // the corner under the arm is where sin is -1
          const a = ((corner + 0.25) / sides) * Math.PI * 2;
          return [arm * JOINTS + joint, Math.cos(a), Math.sin(a), 0.95 * (1 - s) + 0.09];
        };
        const mid = ((i + 0.75) / sides) * Math.PI * 2;
        const under = Math.sin(mid) < -0.55;
        const h = hash(arm, j, i);
        const colour = under ? (j % 2 ? sucker : pale) : h > 0.9 ? blotch : h > 0.45 ? red : wine;
        const facet = [Math.cos(mid), Math.sin(mid), 0, 0, 0, 0, ...colour];
        const corners = [at(j, i), at(j, i + 1), at(j + 1, i + 1), at(j + 1, i)];
        for (const k of [0, 1, 2, 0, 2, 3]) shape.vertex([...facet, ...corners[k]]);
      }
    }
  }
  return shape;
}

const smooth = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Where the kraken's arms are now. Each leaves the sea round the mantle, rears up, arches over
 * and curls its tip down and in; the ones in front straighten at the boat to strike.
 * @param {Float32Array} joints ARMS*JOINTS points in the kraken's frame
 * @param {Float32Array} flanks ARMS vectors: level, across each arm
 * @param {number} time @param {number} rise @param {number} reach
 */
function poseArms(joints, flanks, time, rise, reach) {
  for (let i = 0; i < ARMS; i++) {
    const angle = ((i + 0.5) / ARMS) * Math.PI * 2 + 0.15 * Math.sin(i * 5.1);
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    const front = smooth(0.1, 0.9, dz) * reach;
    let ax = dx + (dx * 0.3 - dx) * front;
    let az = dz + (1 - dz) * front;
    const norm = Math.hypot(ax, az) || 1;
    ax /= norm;
    az /= norm;
    const length = (10 + 2 * Math.sin(i * 3.7)) * rise * (1 + 0.7 * front);
    const out = 2.4 + 0.6 * Math.cos(i * 2.9);
    let x = dx * out;
    let y = -2.2;
    let z = dz * out - 0.4;
    joints.set([x, y, z], i * JOINTS * 3);
    flanks.set([az, 0, -ax], i * 3);
    const sway = time * 1.4 + i * 1.7;
    const step = length / (JOINTS - 1);
    for (let j = 1; j < JOINTS; j++) {
      const s = j / (JOINTS - 1);
      let e = 1.5 - (3.4 + 0.6 * Math.sin(i * 1.9)) * s * s + 0.35 * Math.sin(sway + s * 3);
      e += (0.35 - 0.5 * s - e) * front;
      const wave = 0.45 * Math.sin(sway * 0.8 + s * 4) * s;
      x += step * (ax * Math.cos(e) + az * wave);
      y += step * Math.sin(e);
      z += step * (az * Math.cos(e) - ax * wave);
      joints.set([x, y, z], (i * JOINTS + j) * 3);
    }
  }
}

/** @param {import('../renderer.js').Kit} kit @returns {import('../renderer.js').Part} */
export function createCreatures({ gl, programs }) {
  const beastProgram = programs.make(BEAST_VERTEX, FRAGMENT, SHAPE_ATTRIBUTES);
  const krakenProgram = programs.make(KRAKEN_VERTEX, FRAGMENT, SHAPE_ATTRIBUTES);
  const meshes = [dolphin, whale, gull, turtle, flyingfish, splash, spout].map((build) =>
    build().mesh(gl),
  );
  const monster = kraken().mesh(gl);
  const joints = new Float32Array(ARMS * JOINTS * 3);
  const flanks = new Float32Array(ARMS * 3);

  return {
    draw(scene) {
      const { frame, eye } = scene;
      const beasts = frame.beasts ?? [];
      let bound = false;
      for (const beast of beasts) {
        const kind = KINDS.indexOf(beast.kind);
        if (kind < 0) continue;
        const far = SEEN[kind] * Math.max(1, beast.size);
        const dx = beast.x - eye[0];
        const dz = beast.z - eye[2];
        if (dx * dx + dz * dz > far * far) continue;
        if (!bound) {
          scene.bind(beastProgram);
          bound = true;
        }
        gl.uniform4f(beastProgram.at('uPose'), beast.x, beast.y, beast.z, beast.size);
        gl.uniform4f(
          beastProgram.at('uTurn'),
          Math.cos(beast.heading),
          Math.sin(beast.heading),
          Math.cos(beast.pitch),
          Math.sin(beast.pitch),
        );
        gl.uniform2f(beastProgram.at('uKind'), kind, beast.anim);
        meshes[kind].draw();
      }

      const k = frame.kraken;
      if (!k || k.rise < 0.01) return;
      if ((k.x - eye[0]) ** 2 + (k.z - eye[2]) ** 2 > KRAKEN_SEEN * KRAKEN_SEEN) return;
      poseArms(joints, flanks, scene.time, k.rise, k.reach);
      scene.bind(krakenProgram);
      gl.uniform4f(krakenProgram.at('uPose'), k.x, k.z, Math.cos(k.heading), Math.sin(k.heading));
      gl.uniform4f(
        krakenProgram.at('uMantle'),
        0,
        -4.6 + 6.6 * k.rise,
        -1.4,
        0.03 * Math.sin(scene.time * 1.7),
      );
      gl.uniform3fv(krakenProgram.at('uJoint[0]'), joints);
      gl.uniform3fv(krakenProgram.at('uArmSide[0]'), flanks);
      monster.draw();
    },
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      monster.dispose();
    },
  };
}
