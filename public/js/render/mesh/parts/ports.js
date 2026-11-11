// The ports that stand in the open: a striped lighthouse at each (the cave's fittings belong to
// the cave), and the lamps. A lamp that is lit shows as a bright dot however far off it is, so a
// port that has been found can be steered for from across the sea.

import { createMesh } from '../gl.js';
import { COMMON, FINISH } from '../look.js';
import {
  GLOWING,
  RIGID,
  SOLID_ATTRIBUTES,
  SOLID_FRAGMENT,
  SOLID_VERTEX,
  createShape,
  frameOf,
  groundAt,
  matrix,
  shade,
} from '../solids.js';

/** @typedef {import('../renderer.js').Kit} Kit */
/** @typedef {import('../renderer.js').Part} Part */
/** @typedef {import('../renderer.js').Scene} Scene */

/** The gallery's height above the foot of the tower; the lamp room sits on it. */
const LIGHT_TOP = 8.6;
/** The middle of the lamp above the foot. */
const LAMP = LIGHT_TOP + 0.7;
/** A tower nearer than this is drawn in full; one farther than FAR_TOWER, not at all. */
const NEAR_TOWER = 170;
const FAR_TOWER = 1100;
/** Height of a stripe. */
const STRIPE = 1.72;

const CREAM = [0.92, 0.88, 0.79, 0.15];
const CORAL = [0.9, 0.4, 0.29, 0.15];
const NAVY = [0.09, 0.22, 0.34, 0.3];
const RUST = [0.66, 0.2, 0.1, 0.2];
const DOOR = [0.2, 0.13, 0.09, 0];
const GLASS = [0.2, 0.3, 0.38, 1];
/** The lamp of a port not yet found, and of one that has been. */
const PALE = [1.0, 0.92, 0.66];
const GOLD = [1.0, 0.84, 0.42];

/** @param {number} y @returns {number} the tower's radius at a height above its foot */
const girth = (y) => 0.82 + 0.055 * Math.min(12, Math.max(0, LIGHT_TOP - y));

/**
 * A lighthouse standing at the origin, its door towards +z.
 * @param {boolean} found a port that has been found flies the navy
 * @param {boolean} plain for a tower seen from afar: fewer facets, no door, no windows
 */
function towerShape(found, plain) {
  const shape = createShape();
  const band = found ? shade(NAVY, 1.15) : CORAL;
  const sides = plain ? 6 : 10;
  // the foot goes into the ground, for a tower on a slope
  /** @type {[number, number][]} */
  const profile = [[girth(-2.5), -2.5]];
  const paints = [];
  for (let k = 0; k * STRIPE < LIGHT_TOP - 0.01; k++) {
    profile.push([girth(k * STRIPE), k * STRIPE]);
    paints.push(k === 0 ? shade(CREAM, 0.7) : k % 2 ? CREAM : band);
  }
  profile.push([girth(LIGHT_TOP - 0.3), LIGHT_TOP - 0.3]);
  paints.push(CREAM);
  // weathered at the foot
  paints[1] = shade(CREAM, 0.88);
  shape.lathe(profile, sides, paints);
  // the gallery, and a rail round it
  shape.lathe(
    [
      [girth(LIGHT_TOP - 0.3), LIGHT_TOP - 0.32],
      [1.35, LIGHT_TOP - 0.32],
      [1.35, LIGHT_TOP + 0.02],
      [0.6, LIGHT_TOP + 0.02],
    ],
    sides,
    NAVY,
  );
  const roof = found ? NAVY : RUST;
  shape.lathe(
    [
      [0.5, LIGHT_TOP + 1.25],
      [0.98, LIGHT_TOP + 1.25],
      [0.5, LIGHT_TOP + 1.85],
      [0, LIGHT_TOP + 2.15],
    ],
    plain ? 6 : 8,
    [shade(roof, 0.7), roof, roof],
  );
  if (plain) return shape;
  // the foot of the lamp room, a ball on the roof
  shape.lathe(
    [
      [0.74, LIGHT_TOP + 0.02],
      [0.74, LIGHT_TOP + 0.2],
      [0.6, LIGHT_TOP + 0.2],
    ],
    8,
    CREAM,
  );
  shape.lathe(
    [
      [0, LIGHT_TOP + 2.1],
      [0.13, LIGHT_TOP + 2.25],
      [0, LIGHT_TOP + 2.45],
    ],
    4,
    roof,
  );
  // a door at the foot, and two windows up the stair
  const out = girth(0) * Math.cos(Math.PI / sides) + 0.02;
  shape.box([-0.32, -1, out - 0.3], [0.32, 1.25, out], DOOR);
  for (const [turn, y] of [
    [-0.4 * Math.PI, 3.7],
    [0.4 * Math.PI, 6.3],
  ]) {
    const [c, s] = [Math.cos(turn), Math.sin(turn)];
    const face = girth(y) * Math.cos(Math.PI / sides);
    shape.place((p) => [p[0] * c + p[2] * s, p[1], p[2] * c - p[0] * s]);
    shape.box([-0.16, y, face - 0.3], [0.16, y + 0.6, face + 0.02], DOOR);
  }
  shape.place(null);
  return shape;
}

/** The lamp room's panes, dark (`paint` glass) or alight. @param {readonly number[]} paint */
function lanternShape(paint) {
  const shape = createShape();
  shape.lathe(
    [
      [0.66, LIGHT_TOP + 0.02],
      [0.66, LIGHT_TOP + 1.25],
    ],
    6,
    paint,
  );
  return shape;
}

/**
 * Whether a port's lamp is lit: steadily once the port is found, and until then it blinks.
 * @param {number} index of the port
 * @param {boolean} found
 * @param {number} time
 */
function lampLit(index, found, time) {
  const phase = time * 0.9 + index * 0.37;
  return found || phase - Math.floor(phase) < 0.6;
}

/** @param {Kit} kit @returns {Part} */
export function createPorts({ gl, programs, terrain }) {
  const program = programs.make(SOLID_VERTEX, SOLID_FRAGMENT, SOLID_ATTRIBUTES);
  // plain and unfound, plain and found, then the same in full
  const towers = [false, true].flatMap((plain) =>
    [false, true].map((found) => towerShape(found, !plain).mesh(gl)),
  );
  const dark = lanternShape(GLASS).mesh(gl);
  const lanterns = [lanternShape(PALE).mesh(gl), lanternShape(GOLD).mesh(gl)];

  // Each tower turns its door downhill, to the sea.
  const lights = terrain.ports.flatMap((port, index) => {
    if (port.kind !== 'light') return [];
    const dx = groundAt(terrain, port.x - 4, port.z) - groundAt(terrain, port.x + 4, port.z);
    const dz = groundAt(terrain, port.x, port.z - 4) - groundAt(terrain, port.x, port.z + 4);
    const steep = Math.hypot(dx, dz);
    const [sin, cos] = steep > 1e-4 ? [dx / steep, dz / steep] : [0, 1];
    const model = frameOf(
      matrix(),
      [cos, 0, -sin],
      [0, 1, 0],
      [sin, 0, cos],
      [port.x, port.base, port.z],
    );
    return [{ index, x: port.x, y: port.base, z: port.z, model }];
  });

  return {
    draw(scene) {
      const { eye, forward, frame } = scene;
      scene.bind(program);
      const uModel = program.at('uModel');
      const uCloth = program.at('uCloth');
      for (const light of lights) {
        // not what lies behind the eye
        const ahead =
          (light.x - eye[0]) * forward[0] +
          (light.y - eye[1]) * forward[1] +
          (light.z - eye[2]) * forward[2];
        if (ahead < -15) continue;
        const away = Math.hypot(light.x - eye[0], light.z - eye[2]);
        if (away > FAR_TOWER) continue; // only its lamp is seen from there
        const found = Boolean(frame.found[light.index]);
        gl.uniformMatrix4fv(uModel, false, light.model);
        gl.uniform4fv(uCloth, RIGID);
        towers[(away < NEAR_TOWER ? 2 : 0) + (found ? 1 : 0)].draw();
        if (lampLit(light.index, found, scene.time)) {
          gl.uniform4fv(uCloth, GLOWING);
          lanterns[found ? 1 : 0].draw();
        } else dark.draw();
      }
    },
    dispose() {
      for (const mesh of [...towers, dark, ...lanterns]) mesh.dispose();
    },
  };
}

const BEACON_VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
${COMMON}
uniform vec4 uLamp;       // the lamp's middle, and the radius of its glow in the world
uniform vec4 uGlow;       // its colour, and the least radius of the glow on screen, in pixels
out vec2 vAt;
out vec3 vCol;
out float vHaze;
void main(){
  // the glow hangs in front of the lamp room, towards the eye
  vec3 c = uLamp.xyz + normalize(uEye - uLamp.xyz)*1.2;
  vec4 clip = uViewProj*vec4(c, 1.0);
  float r = max(uLamp.w*2.5, 2.0*uGlow.w/uRes.y*clip.w);
  clip.xy += aCorner*r*vec2(uRes.y/uRes.x, 1.0);
  vAt = aCorner;
  vCol = uGlow.rgb;
  vHaze = 0.3*hazeAt(c);
  gl_Position = clip;
}`;

// The middle of the glow is the lamp itself and hides what is behind it; round it is a halo of
// light, added to the picture.
const BEACON_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
${FINISH}
in vec2 vAt;
in vec3 vCol;
in float vHaze;
out vec4 outColor;
void main(){
  float d = length(vAt);
  float core = 1.0 - smoothstep(0.16, 0.24, d);
  float halo = max(1.0 - d, 0.0);
  halo = uMode == 0 ? 0.55*halo*halo : 0.0;
  vec3 col = uMode == 3 ? vec3(0.0) : vCol;       // on the chart a lamp is a dot of ink
  outColor = vec4(finish(col, vHaze)*(core + halo), core);
}`;

/**
 * The glow of the lamps that are lit. It is see-through, so it is drawn after the sea.
 * @param {Kit} kit
 * @returns {Part}
 */
export function createBeacons({ gl, programs, terrain }) {
  const program = programs.make(BEACON_VERTEX, BEACON_FRAGMENT, ['aCorner']);
  const corners = new Float32Array([-1, -1, -1, 1, 1, 1, -1, -1, 1, 1, 1, -1]);
  const mesh = createMesh(gl, [{ data: corners, size: 2 }]);
  return {
    draw(scene) {
      const { eye, forward, frame } = scene;
      let bound = false;
      terrain.ports.forEach((port, index) => {
        if (port.kind !== 'light') return;
        const found = Boolean(frame.found[index]);
        if (!lampLit(index, found, scene.time)) return;
        const y = port.base + LAMP;
        const ahead =
          (port.x - eye[0]) * forward[0] +
          (y - eye[1]) * forward[1] +
          (port.z - eye[2]) * forward[2];
        if (ahead < 0) return;
        if (!bound) {
          bound = true;
          scene.bind(program);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(false);
        }
        const glow = found ? GOLD : PALE;
        gl.uniform4f(program.at('uLamp'), port.x, y, port.z, found ? 3.6 : 2.8);
        gl.uniform4f(program.at('uGlow'), glow[0], glow[1], glow[2], found ? 8 : 6);
        mesh.draw();
      });
      if (bound) {
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    },
    dispose: () => mesh.dispose(),
  };
}
