// The sea cave: the inside of the tunnel and of the chamber, seen from the water in it, and its
// fittings: a brazier either side of the mouth and the lamp hanging at the back of the chamber.
// The land (parts/terrain.js) leaves the hole in the hillside, by the shape in ../cave-shape.js;
// these walls stand on that same surface, pushed a little into the rock here and there. Nothing
// in here is lit by the sun: see ../cave-light.js. The water is the sea's.

import { caveDistance } from '../cave-shape.js';
import { CAVE_LIGHT, bindCaveLight, caveFittings, groundAt } from '../cave-light.js';
import { createMesh } from '../gl.js';
import { COMMON, FINISH } from '../look.js';
import { SHAPE_ATTRIBUTES, createShape, hash, ringY } from '../lowpoly.js';

/** @typedef {import('../lowpoly.js').Vec} Vec */
/** @typedef {import('../renderer.js').RenderTerrain} RenderTerrain */

/** The cave is not drawn from further off than this. */
const SEEN = 650;
/** Facets round the vault, from the water on one side to the water on the other. */
const AROUND = 12;
/** The walls go this far down into the water. */
const SKIRT = 1.6;
/** The cut rock at the foot of the walls reaches this far out from them. */
const LEDGE = 9;
/** Its colour, before the light: nearly black. */
const CUT = /** @type {const} */ ([0.16, 0.14, 0.14]);
/** The rock is pushed back from the true wall by up to this much. */
const ROUGH = 0.7;
const WALL_VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec3 aCol;
${COMMON}
${CAVE_LIGHT}
out vec3 vCol;
out float vBand;
void main(){
  // wet and dark by the water
  vCol = aCol*caveGlow(aPos, aNor)*(0.5 + 0.5*smoothstep(0.1, 1.3, aPos.y));
  // the strata lie level, and drift up and down along the cave
  vBand = aPos.y/1.5 + 0.7*sin(aPos.x*0.21 + 1.3*sin(aPos.z*0.17));
  gl_Position = uViewProj*vec4(aPos, 1.0);
}`;

const WALL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
${FINISH}
in vec3 vCol;
in float vBand;
out vec4 outColor;
void main(){
  vec3 rock = mix(vec3(0.5, 0.33, 0.25), vec3(0.78, 0.58, 0.42), step(0.5, fract(vBand)));
  rock *= 0.8 + 0.2*step(0.45, fract(vBand*0.37));
  // no haze: nothing in here is far off
  outColor = vec4(finish(rock*vCol, 0.0), 1.0);
}`;

// The spare attribute: x is 0 for a post in the open, 3 for iron in the cave, 1 for a flame by
// the mouth and 2 for the lamp's; y, z, w is the middle of the flame it belongs to. A flame's
// position is its shape about that middle, in flame sizes.
const FITTING_VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec3 aCol;
layout(location = 3) in vec4 aAux;
${COMMON}
${CAVE_LIGHT}
flat out vec3 vCol;
out float vHaze;
void main(){
  vec3 p = aPos, c = aAux.yzw;
  float fire = uCaveLamp.w;
  if (aAux.x > 0.5 && aAux.x < 2.5) {
    // a flame: taller and steadier the better it burns, its tip licking about
    float h = max(aPos.y, 0.0), size = (aAux.x < 1.5 ? 0.42 : 0.5)*(0.6 + 0.5*fire);
    vec2 lick = vec2(sin(uTime*9.0 + c.x*3.0 + h*2.0), cos(uTime*7.3 + c.z*3.0 + h*2.6))*0.22*h*h;
    p = c + vec3(aPos.x + lick.x, aPos.y*(1.25 + 0.25*sin(uTime*11.0 + c.x)), aPos.z + lick.y)*size;
    vCol = aCol*(0.75 + 0.45*fire);
  } else {
    vec3 l = c - p;
    vec3 warm = vec3(1.0, 0.66, 0.27)*fire*(1.5/(1.0 + dot(l, l)*0.5));
    vCol = aAux.x > 2.5 ? aCol*(caveGlow(p, aNor) + warm) : lit(aCol, aNor) + aCol*warm;
  }
  vHaze = hazeAt(p);
  gl_Position = uViewProj*vec4(p, 1.0);
}`;

const FITTING_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
${FINISH}
flat in vec3 vCol;
in float vHaze;
out vec4 outColor;
void main(){
  outColor = vec4(finish(vCol, vHaze), 1.0);
}`;

// The cut face of the rock, when the eye is inside it: behind everything, like the sky.
const ROCK_VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
${COMMON}
void main(){
  gl_Position = vec4(aCorner, 1.0, 1.0);
}`;

const ROCK_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
${FINISH}
out vec4 outColor;
void main(){
  outColor = vec4(finish(vec3(0.1, 0.08, 0.09), 0.0), 1.0);
}`;

/**
 * The walls and roof, facing in. The cave is cut across its tunnel into slices; in each, the
 * wall is the wider of the tunnel's arch and the chamber's, so the two run into each other
 * without a seam.
 * @param {RenderTerrain} terrain
 */
function walls(terrain) {
  const { cave } = terrain;
  const { ex, ez, length, mouth } = caveFittings(terrain);
  const vault = Math.min(cave.roof, cave.radius);

  // where the slices are: along the tunnel from before the cliff, then closer round the chamber
  /** @type {number[]} */
  const stations = [];
  const first = Math.max(0, mouth - 20);
  const join = length - cave.hall + 1.5;
  for (let s = first; s < join - 1; s += 2.4) stations.push(s);
  const from = Math.acos(Math.min(1, (length - join) / cave.hall));
  for (let i = 0; i <= 15; i++) {
    stations.push(length - cave.hall * Math.cos(from + ((Math.PI - from) * i) / 15));
  }

  /** How far the wall is from the axis in the slice at `s`, looking `angle` up from the water. */
  const reach = (/** @type {number} */ s, /** @type {number} */ angle) => {
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    /** @param {number} off @param {number} wide @param {number} high */
    const arch = (off, wide, high) => {
      const k = 1 - (off / wide) ** 2;
      if (k <= 0) return 0;
      const q = Math.sqrt(k);
      return 1 / Math.hypot(c / (wide * q), sn / (high * q));
    };
    const past = s < 0 ? -s : s > length ? s - length : 0;
    return Math.max(arch(past, cave.radius, vault), arch(s - length, cave.hall, cave.roof));
  };

  /** @type {Vec[][]} */
  const rings = stations.map((s0, i) => {
    /** @type {Vec[]} */
    const ring = [];
    const last = i === stations.length - 1;
    for (let j = 0; j <= AROUND; j++) {
      const edge = j === 0 || j === AROUND;
      // corners wander a little along and round the cave, and back into the rock
      const s = s0 + (last || i === 0 ? 0 : (hash(i, j, 1) - 0.5) * 1.1);
      const angle = ((j + (edge ? 0 : (hash(i, j, 2) - 0.5) * 0.5)) / AROUND) * Math.PI;
      const true_ = reach(s, angle);
      const rough = ROUGH * (0.2 + 0.8 * hash(i, j, 3)) * Math.min(1, true_ / 3);
      const r = true_ + rough;
      const u = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      /** @type {Vec} */
      const point = [cave.ax + ex * s - ez * u, y, cave.az + ez * s + ex * u];
      if (j === 0) ring.push([point[0], -SKIRT, point[2]]);
      ring.push(point);
      if (j === AROUND) ring.push([point[0], -SKIRT, point[2]]);
    }
    return ring;
  });

  // each facet a little lighter or darker than the next; the strata are the fragment shader's
  /** @type {import('../lowpoly.js').Paint} */
  const strata = (c) => {
    const k = 0.8 + 0.4 * hash(c[0], c[1], c[2]);
    return [k, k, k];
  };
  /** Is this corner in the hill? Only rock that is under the ground (or all but) is drawn. */
  const buried = (/** @type {Vec} */ p) => {
    const ground = groundAt(terrain, p[0], p[2]);
    return ground > 0.3 && ground > p[1] - 0.8;
  };

  /** A point out in the rock from the foot `p` of the wall in slice `i`, just over the water. */
  const ledge = (/** @type {Vec} */ p, /** @type {number} */ i) => {
    const round = stations[i] > length - cave.hall;
    const s = round ? length : stations[i];
    const dx = p[0] - (cave.ax + ex * s);
    const dz = p[2] - (cave.az + ez * s);
    const d = Math.hypot(dx, dz) || 1;
    // the last slice is one point, at the very back of the chamber
    const [ox, oz] = d < 0.01 ? [ex, ez] : [dx / d, dz / d];
    return /** @type {Vec} */ ([p[0] + ox * LEDGE, p[1], p[2] + oz * LEDGE]);
  };

  const shape = createShape();
  /** @type {Vec} */
  const chamber = [cave.bx, 2, cave.bz];
  for (let i = 0; i + 1 < rings.length; i++) {
    const lower = rings[i];
    const upper = rings[i + 1];
    const mid = (stations[i] + stations[i + 1]) / 2;
    /** @type {Vec} */
    const inside =
      mid > length - cave.hall ? chamber : [cave.ax + ex * mid, 1.5, cave.az + ez * mid];
    for (let j = 0; j + 1 < lower.length; j++) {
      const quad = [lower[j], lower[j + 1], upper[j + 1], upper[j]];
      const split = (i + j) % 2 === 0 ? [0, 1, 2, 0, 2, 3] : [0, 1, 3, 1, 2, 3];
      for (let t = 0; t < 6; t += 3) {
        const [a, b, c] = [quad[split[t]], quad[split[t + 1]], quad[split[t + 2]]];
        if (buried(a) || buried(b) || buried(c)) shape.tri(a, b, c, strata, inside, true);
      }
    }
    // Rock cut level with the water, out from the foot of each wall: an eye that has backed
    // into the rock looks over it into the cave, not at the sea that the hill stands in.
    for (const side of [1, lower.length - 2]) {
      /** @type {Vec[]} */
      const foot = [lower[side], upper[side]].map((p) => [p[0], 0.05, p[2]]);
      const quad = [foot[0], foot[1], ledge(foot[1], i + 1), ledge(foot[0], i)];
      if (!quad.every((p) => groundAt(terrain, p[0], p[2]) > 0.5)) continue;
      shape.tri(quad[0], quad[1], quad[2], CUT, [quad[0][0], -100, quad[0][2]]);
      shape.tri(quad[0], quad[2], quad[3], CUT, [quad[0][0], -100, quad[0][2]]);
    }
  }
  return shape;
}

/**
 * The braziers by the mouth and the lamp in the chamber.
 * @param {RenderTerrain} terrain
 */
function fittings(terrain) {
  const { lamp, braziers, ex, ez } = caveFittings(terrain);
  const shape = createShape();
  /** @type {Vec} */
  const stone = [0.46, 0.41, 0.36];
  /** @type {Vec} */
  const iron = [0.17, 0.15, 0.15];
  /** @type {Vec} */
  const coal = [0.5, 0.16, 0.05];
  /** @param {Vec[]} ring @param {Vec} by @returns {Vec[]} */
  const moved = (ring, by) => ring.map((p) => [p[0] + by[0], p[1], p[2] + by[2]]);
  /** A flame about `c`: white-hot at the foot, red at the tip. */
  const flame = (/** @type {number} */ kind, /** @type {Vec} */ c) => {
    shape.mark(kind, c[0], c[1], c[2]);
    const rings = [
      ringY(5, -0.8, 0, 0),
      ringY(5, -0.5, 0.75, 0.75),
      ringY(5, 0.0, 1.0, 1.0, 0.5),
      ringY(5, 0.7, 0.62, 0.62),
      ringY(5, 1.4, 0.25, 0.25, 0.5),
      ringY(5, 2.0, 0, 0),
    ];
    shape.loft(rings, (m) => {
      const h = Math.min(1, Math.max(0, (m[1] + 0.6) / 2.2));
      return [1.25, 1.05 - 0.75 * h, 0.55 - 0.5 * h];
    });
  };

  for (const top of braziers) {
    /** @type {Vec} */
    const fire = [top[0], top[1] + 0.45, top[2]];
    shape.mark(0, fire[0], fire[1], fire[2]);
    const y = top[1];
    shape.loft(
      [
        moved(ringY(6, -2, 0.4, 0.4), top),
        moved(ringY(6, y - 0.85, 0.27, 0.27), top),
        moved(ringY(6, y - 0.7, 0.3, 0.3), top),
      ],
      stone,
    );
    shape.loft(
      [
        moved(ringY(6, y - 0.7, 0.3, 0.3), top),
        moved(ringY(6, y - 0.1, 0.7, 0.7), top),
        moved(ringY(6, y + 0.06, 0.74, 0.74), top),
        moved(ringY(6, y + 0.06, 0.58, 0.58), top),
      ],
      iron,
    );
    shape.loft(
      [moved(ringY(6, y + 0.06, 0.58, 0.58), top), moved(ringY(6, y + 0.12, 0, 0), top)],
      coal,
    );
    flame(1, fire);
  }

  // the lamp: an iron basket hung on three rods from the roof
  shape.mark(3, lamp[0], lamp[1], lamp[2]);
  const y = lamp[1] - 0.45;
  shape.loft(
    [
      moved(ringY(6, y - 0.5, 0, 0), lamp),
      moved(ringY(6, y - 0.4, 0.4, 0.4), lamp),
      moved(ringY(6, y, 0.72, 0.72), lamp),
      moved(ringY(6, y, 0.56, 0.56), lamp),
      moved(ringY(6, y + 0.05, 0, 0), lamp),
    ],
    iron,
  );
  /** @type {Vec} */
  const hook = [lamp[0] + ex * 0.6, lamp[1] + 4, lamp[2] + ez * 0.6];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const [dx, dz] = [Math.sin(a) * 0.68, Math.cos(a) * 0.68];
    /** @type {Vec[]} */
    const foot = [0, 1, 2].map((k) => {
      const b = a + (k / 3) * Math.PI * 2;
      return [lamp[0] + dx + Math.sin(b) * 0.05, y, lamp[2] + dz + Math.cos(b) * 0.05];
    });
    shape.spike(foot, hook, iron);
  }
  flame(2, lamp);
  return shape;
}

/** @param {import('../renderer.js').Kit} kit @returns {import('../renderer.js').Part} */
export function createCave({ gl, programs, terrain }) {
  const wallProgram = programs.make(WALL_VERTEX, WALL_FRAGMENT, SHAPE_ATTRIBUTES);
  const fittingProgram = programs.make(FITTING_VERTEX, FITTING_FRAGMENT, SHAPE_ATTRIBUTES);
  const rockProgram = programs.make(ROCK_VERTEX, ROCK_FRAGMENT, ['aCorner']);
  const wallMesh = walls(terrain).mesh(gl);
  const fittingMesh = fittings(terrain).mesh(gl);
  const screen = createMesh(gl, [{ data: new Float32Array([-1, -1, -1, 3, 3, -1]), size: 2 }]);
  const { cave } = terrain;
  const midX = (cave.ax + cave.bx) / 2;
  const midZ = (cave.az + cave.bz) / 2;
  const reach = Math.hypot(cave.bx - cave.ax, cave.bz - cave.az) / 2 + cave.hall + 8;

  return {
    draw(scene) {
      const { eye, frame } = scene;
      const off = Math.hypot(eye[0] - midX, eye[2] - midZ);
      if (off > SEEN) return;
      // An eye that has backed into the rock sees the cave cut open, not the sky through the hill.
      if (
        off < reach &&
        eye[1] < groundAt(terrain, eye[0], eye[2]) - 0.3 &&
        caveDistance(cave, eye[0], eye[1], eye[2]) > ROUGH
      ) {
        scene.bind(rockProgram);
        gl.depthMask(false);
        screen.draw();
        gl.depthMask(true);
      }
      scene.bind(wallProgram);
      bindCaveLight(gl, wallProgram, terrain, frame);
      wallMesh.draw();
      scene.bind(fittingProgram);
      bindCaveLight(gl, fittingProgram, terrain, frame);
      fittingMesh.draw();
    },
    dispose() {
      wallMesh.dispose();
      fittingMesh.dispose();
      screen.dispose();
    },
  };
}
