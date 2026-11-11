// The sea: one flat sheet at y = 0, a fan of rings round the eye that reaches the horizon, and
// the boat's wake laid over it. The sheet is coloured by the depth of the water under it (one
// fetch from a small map of the heights), with a swash at the shores, ripples that glitter in
// the path of the sun, whitecaps in a blow and dark cat's paws under a gust. Its waves are
// functions of the place in the world, so the water stays put as the boat moves.

import { createMesh } from '../gl.js';
import { caveGloom, createDepthMap, deepWater } from '../heights.js';
import { COMMON, FINISH } from '../look.js';
import { forViews } from '../variants.js';

/** Spokes of the fan, its first ring, the growth from ring to ring and how far it reaches. */
const SPOKES = 48;
const FIRST = 1.5;
const GROWTH = 1.6;
const REACH = 4000;
/** The wind's waves: how many to a unit of water, and how many pass in a second. */
const WAVE_K = 0.14;
const WAVE_W = 0.09;
/** How high the wake lies over the sheet, to win the depth test. */
const WAKE_LIFT = 0.03;
const WAKE_ROWS = 10;
const FOAM = [0.96, 0.94, 0.88];

const VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aOffset;   // from the point under the eye
${COMMON}
uniform vec4 uWeather;                  // gust on the boat, wind 0..1, how much sky the sea mirrors
uniform vec2 uSunFlat;                  // where the sun stands over the horizon, a unit vector
out vec2 vW;
out vec4 vMix;                          // haze and mirrored sky, the sun's path, the waves' shading, the gusts' shading
void main(){
  vec2 w = uEye.xz + aOffset;
  vec3 p = vec3(w.x, 0.0, w.y);
  float dist = distance(p, uEye);
  float graze = 1.0 - uEye.y/dist;
  graze *= graze;
  float mirror = uWeather.z*graze*graze;
  vec2 d = w - uBoat.xy;
  float paws = sin(dot(w, vec2(0.021, 0.013)) + uTime*0.13)*sin(dot(w, vec2(-0.011, 0.027)) - uTime*0.09);
  float toSun = dot(aOffset, uSunFlat)/max(length(aOffset), 0.01);
  vW = w;
  vMix = vec4(1.0 - (1.0 - mirror)*(1.0 - hazeAt(p)),
              0.8*smoothstep(0.80, 0.99, toSun)*smoothstep(1.0, 6.0, dist),
              0.07*exp(-dist/220.0),
              1.0 - 0.3*max(uWeather.x*exp(-dot(d, d)/8000.0), smoothstep(0.3, 0.8, paws)*uWeather.y));
  gl_Position = uViewProj*vec4(p, 1.0);
}`;

// Every pixel of the sea is paid for on the processor: one fetch of a map that holds its
// blends ready made, three folded (triangle) waves, and nothing dearer than a clamp.
/**
 * @param {string} finish
 * @param {boolean} open over deep water far from any shore, where the map has nothing to say
 */
const fragment = (finish, open) => /* glsl */ `#version 300 es
precision highp float;
${COMMON}
${finish}
uniform sampler2D uDepth; // depth as a blend, light, shore: see createDepthMap
uniform vec2 uMap;        // world to that map: scale, offset
uniform vec4 uWave;       // the wind's waves: wave vector and phase under the boat (in turns), whitecap threshold
uniform vec3 uFoam;       // the colour of foam in this light
in vec2 vW;
in vec4 vMix;
out vec4 outColor;
void main(){
  vec3 q = abs(fract(vec3(dot(vW - uBoat.xy, uWave.xy) + uWave.z,
                          dot(vW, vec2(0.30, 0.18)) + uTime*0.07,
                          dot(vW, vec2(-0.14, 0.37)) - uTime*0.055)) - 0.5)*4.0 - 1.0;
  float chop = q.y*q.z;
  // whitecaps where the crests of two waves meet
  float foam = clamp(7.0*(q.x*chop - uWave.w), 0.0, 0.8);
${
  open
    ? `  vec3 col = uDeep;`
    : `  vec3 m = texture(uDepth, vW*uMap.x + uMap.y).rgb;
  // the water: pale over sand, teal over the deep; and the swash on the shore
  vec3 col = mix(uShallow, uDeep, m.r);
  foam = max(foam, clamp(2.8*m.b + 0.36*q.x - 0.36, 0.0, 0.9));`
}
  // shaded by the waves and the gusts, and glittering in the sun's path
  col = col*(vMix.w + vMix.z*(q.x + chop)) + uSunCol*(vMix.y*clamp(4.0*chop - 2.2, 0.0, 1.0));
  col = mix(col, uFoam, foam);
  outColor = vec4(finish(${open ? 'col' : 'col*m.g'}, vMix.x), 1.0);
}`;

const WAKE_VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aAcross;   // -1..1 across the wake, 0..1 down it
${COMMON}
uniform vec4 uWake;                     // length of the arms, of the rocket's tail, strength, light
out vec2 vB;                            // across, and astern of the stern
out vec2 vW;
out float vHaze;
void main(){
  float s = aAcross.y*(max(uWake.x, uWake.y) + 1.0) - 0.7;
  float x = aAcross.x*(0.6 + 0.36*max(s, 0.0));
  float z = -1.0 - s;
  vec2 w = uBoat.xy + x*vec2(uBoat.w, -uBoat.z) + z*uBoat.zw;
  vec3 p = vec3(w.x, ${WAKE_LIFT}, w.y);
  vB = vec2(x, s);
  vW = w;
  vHaze = hazeAt(p);
  gl_Position = uViewProj*vec4(p, 1.0);
}`;

const WAKE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
${FINISH}
uniform vec4 uWake;
in vec2 vB;
in vec2 vW;
in float vHaze;
out vec4 outColor;
void main(){
  float s = max(vB.y, 0.0), x = abs(vB.x);
  float n = 0.5 + 0.5*sin(vW.x*4.1 + uTime*0.35)*sin(vW.y*3.7 - uTime*0.45);
  // the two arms of the V, breaking up as they fall astern
  float gone = 1.0 - smoothstep(0.2*uWake.x, uWake.x, s);
  float wide = 0.05 + 0.022*s;
  float foam = gone*(1.0 - smoothstep(0.3*wide, wide, abs(x - 0.2 - 0.3*s)))*smoothstep(0.1, 0.5, n + 0.45*gone);
  // the churned water between them
  float churn = 1.0 - smoothstep(0.0, 0.5*uWake.x, s);
  foam = max(foam, 0.5*churn*(1.0 - smoothstep(0.03 + 0.06*s, 0.25 + 0.16*s, x))*smoothstep(0.3, 0.7, n + 0.5*churn));
  // the rooster tail of the rocket: a long band of foam
  float left = 1.0 - smoothstep(0.15*uWake.y, uWake.y + 0.01, s);
  foam = max(foam, step(0.5, uWake.y)*left*(1.0 - smoothstep(0.2 + 0.03*s, 0.34 + 0.045*s, x))*(0.55 + 0.45*n));
  foam *= smoothstep(-0.6, 0.1, vB.y)*uWake.z;
  vec3 col = vec3(0.96, 0.94, 0.88)*(uAmb + 0.55*uSunCol)*uWake.w;
  outColor = vec4(finish(col, vHaze), foam);
}`;

/** @param {import('../renderer.js').Kit} kit @returns {import('../renderer.js').Part} */
export function createSea({ gl, programs, terrain }) {
  const sheetFor = forViews(programs, VERTEX, (finish) => fragment(finish, false), ['aOffset']);
  const openFor = forViews(programs, VERTEX, (finish) => fragment(finish, true), ['aOffset']);
  const deep = deepWater(terrain);
  const wakeProgram = programs.make(WAKE_VERTEX, WAKE_FRAGMENT, ['aAcross']);
  const map = createDepthMap(gl, terrain);

  // The fan: a point under the eye, then rings that grow until they reach the horizon.
  const radii = [0];
  for (let r = FIRST; r < REACH; r *= GROWTH) radii.push(r);
  radii.push(REACH);
  const points = new Float32Array((1 + (radii.length - 1) * SPOKES) * 2);
  /** @type {number[]} */
  const index = [];
  for (let ring = 1; ring < radii.length; ring++) {
    const base = 1 + (ring - 1) * SPOKES;
    for (let s = 0; s < SPOKES; s++) {
      // every other ring is turned half a spoke, so the facets do not line up into rays
      const angle = ((s + (ring % 2) * 0.5) / SPOKES) * 2 * Math.PI;
      points[(base + s) * 2] = radii[ring] * Math.sin(angle);
      points[(base + s) * 2 + 1] = radii[ring] * Math.cos(angle);
      const next = base + ((s + 1) % SPOKES);
      if (ring === 1) {
        index.push(0, base + s, next);
      } else {
        const inner = base - SPOKES + s;
        const innerNext = base - SPOKES + ((s + 1) % SPOKES);
        if (ring % 2) index.push(inner, base + s, innerNext, innerNext, base + s, next);
        else index.push(inner, base + s, next, inner, next, innerNext);
      }
    }
  }
  // The fan's triangles are sorted each frame: those over deep water and nothing else go first
  // and are drawn without the map, the rest after them. Its index buffer is rewritten when the
  // sorting changes.
  const all = new Uint16Array(index);
  const sorted = new Uint16Array(all.length);
  const sent = new Uint16Array(all.length);
  const sheet = createMesh(gl, [{ data: points, size: 2 }], sorted);
  const indices = gl.createBuffer();
  gl.bindVertexArray(sheet.vao);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sorted, gl.DYNAMIC_DRAW);
  gl.bindVertexArray(null);

  /**
   * Sort the fan round the eye at (ex, ez).
   * @param {number} ex @param {number} ez
   * @returns {number} how many indices are of triangles over deep water
   */
  function sort(ex, ez) {
    let front = 0;
    let back = all.length;
    for (let t = 0; t < all.length; t += 3) {
      const a = all[t] * 2;
      const b = all[t + 1] * 2;
      const c = all[t + 2] * 2;
      const open = deep(
        ex + Math.min(points[a], points[b], points[c]),
        ez + Math.min(points[a + 1], points[b + 1], points[c + 1]),
        ex + Math.max(points[a], points[b], points[c]),
        ez + Math.max(points[a + 1], points[b + 1], points[c + 1]),
      );
      const o = open ? front : (back -= 3);
      if (open) front += 3;
      sorted[o] = all[t];
      sorted[o + 1] = all[t + 1];
      sorted[o + 2] = all[t + 2];
    }
    let same = true;
    for (let i = 0; i < sorted.length && same; i++) same = sorted[i] === sent[i];
    if (!same) {
      sent.set(sorted);
      gl.bindVertexArray(sheet.vao);
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, sorted);
    }
    return front;
  }

  const strip = new Float32Array(WAKE_ROWS * 12);
  for (let row = 0; row < WAKE_ROWS; row++) {
    const v0 = (row / WAKE_ROWS) ** 2;
    const v1 = ((row + 1) / WAKE_ROWS) ** 2;
    // front faces look up: cross(b - a, c - a) along +y
    strip.set([-1, v1, 1, v0, 1, v1, -1, v1, -1, v0, 1, v0], row * 12);
  }
  const wake = createMesh(gl, [{ data: strip, size: 2 }]);

  // The phase of the wind's waves under the boat, kept from frame to frame so that the waves
  // stay on the water when she moves and do not race when the wind veers.
  let phase = 0;
  let last = { x: NaN, z: NaN };

  return {
    draw(scene) {
      const { frame, boat } = scene;
      const { wind } = frame;
      const from = wind.from;
      // the waves run down the wind
      const kx = -Math.sin(from) * WAVE_K;
      const kz = -Math.cos(from) * WAVE_K;
      const dx = boat.x - last.x;
      const dz = boat.z - last.z;
      if (Math.abs(dx) + Math.abs(dz) < 50) phase += dx * kx + dz * kz;
      phase = (phase - WAVE_W * Math.min(frame.dt, 0.1)) % 1;
      last = { x: boat.x, z: boat.z };
      const blow = Math.min(1, Math.max(0, (wind.speed - 0.35) / 1.25));
      const state = wind.sea ?? blow;
      const gust = wind.gust ?? 0;

      const open = sort(scene.eye[0], scene.eye[2]);
      const under = caveGloom(terrain.cave, scene.eye[0], scene.eye[2]);
      const { look } = scene;
      const foam = FOAM.map((v, i) => v * (look.ambient[i] + 0.55 * look.sunColor[i]));
      const [sx, , sz] = frame.sun;
      const flat = Math.hypot(sx, sz) || 1;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, map.texture);
      for (const program of [openFor(scene.mode), sheetFor(scene.mode)]) {
        const first = program === openFor(scene.mode);
        const count = first ? open : all.length - open;
        if (!count) continue;
        scene.bind(program);
        gl.uniform1i(program.at('uDepth'), 0);
        gl.uniform2f(program.at('uMap'), map.scale, map.offset);
        gl.uniform4f(program.at('uWave'), kx, kz, phase, 1.0 - 0.42 * state);
        gl.uniform4f(program.at('uWeather'), gust, 0.35 + 0.65 * blow, 0.5 * (1 - under), 0);
        gl.uniform3fv(program.at('uFoam'), foam);
        gl.uniform2f(program.at('uSunFlat'), sx / flat, sz / flat);
        gl.bindVertexArray(sheet.vao);
        gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, first ? 0 : open * 2);
      }

      const speed = frame.boat.speed;
      const rocket = (frame.rocket ?? 0) > 0.5;
      if ((speed > 0.8 || rocket) && (frame.boat.aloft ?? 0) < 0.5) {
        const fast = Math.min(speed, 12);
        scene.bind(wakeProgram);
        gl.uniform4f(
          wakeProgram.at('uWake'),
          3 + fast * 2.4,
          rocket ? 4 + speed * 0.9 : 0,
          Math.min(1, fast / 4),
          1 - 0.8 * caveGloom(terrain.cave, boat.x, boat.z),
        );
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        wake.draw();
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    },
    dispose() {
      sheet.dispose();
      gl.deleteBuffer(indices);
      wake.dispose();
      gl.deleteTexture(map.texture);
    },
  };
}
