// Assembles the two shaders: one full-screen triangle, and a fragment shader made of the shared
// scene, every view's sky and shading, and a main() that finds what a ray hits and hands the hit
// to the view chosen by uMode.
//
// To add a view: write shaders/<id>.js exporting { id, glsl } where the GLSL defines
//   vec3 sky_<id>(vec3 rd, vec2 fc, float k)
//   vec3 shade_<id>(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k)
//   vec3 post_<id>(vec3 col, vec3 rd, vec2 fc, float k)
// (rd ray, fc pixel, k pixel scale, p hit point and n normal in world coordinates, t distance;
// q is the point in the boat's own tilted coordinates for the boat, and for the plume q.x is the
// age of the puff, 0..1), add it to SHADERS below, and add its id to VIEWS in ../views.js.
// A view's place in VIEWS is its uMode.
//
// What a hit is (id): 1 sea, 2 land, 3 hull, 4 mainsail, 5 mast, 6 jib, 7 pennant, 8 the wall of
// the sea cave, 9 the volcano's plume, 10 + i the lighthouse (or the cave lights) of port i.
// scene.js has the marks they carry: seaMarks, landMarks, lightMarks, caveLight, haze; gHit is
// the id of what the pixel shows (0 for sky), gT how far off it is and gRo the camera, for
// post_<id>. scene.js also has light and weather a view may use: rippleSlope, sunOverLand,
// sunOverSea, sunPastBoat, wakeFoam, plumeSoft, gustAt, seaFoam, leeAt, and rocketMark, which tells
// the rocket on the stern (ids 3 and 7, like the hull and the pennant) from the boat.
//
// A view that exports smoke: true draws the volcano's plume itself, as smoke over the finished
// picture: it defines
//   vec3 smoke_<id>(vec3 col, vec3 ro, vec3 rd, float t)
// (col what the pixel shows, ro the camera, t how far off that is) and never gets a hit with id 9.

import { VIEWS } from '../views.js';
import { PORTS, SCENE } from './scene.js';
import { poster } from './poster.js';
import { terminal } from './terminal.js';
import { gold } from './gold.js';
import { chart } from './chart.js';

export { PORTS };

/** @typedef {{ id: string, glsl: string, smoke?: boolean }} ViewShader */

/** @type {ViewShader[]} */
const SHADERS = [poster, terminal, gold, chart];

/** The march over the land never takes more steps than this (cells skipped and steps taken). */
const STEPS = 300;

/**
 * An if/else chain on uMode calling one function per view; the first view is the fallback.
 * @param {(id: string) => string} call
 */
function dispatch(call) {
  const ids = VIEWS.filter((id) => SHADERS.some((shader) => shader.id === id));
  return ids
    .map((id, at) => (at ? `if (uMode == ${VIEWS.indexOf(id)}) ` : '') + `${call(id)};`)
    .reverse()
    .join('\n    else ');
}

/** True in the shader for the views that draw the plume themselves. */
const SMOKE =
  SHADERS.filter((shader) => shader.smoke)
    .map((shader) => `uMode == ${VIEWS.indexOf(shader.id)}`)
    .join(' || ') || 'false';
const SMOKES = SHADERS.filter((shader) => shader.smoke)
  .map(
    (shader) =>
      `if (uMode == ${VIEWS.indexOf(shader.id)}) col = smoke_${shader.id}(col, ro, rd, t);`,
  )
  .join('\n  ');

export const VERTEX = /* glsl */ `#version 300 es
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
out vec4 outColor;
const int STEPS = ${STEPS};
${SCENE}
${SHADERS.map((shader) => shader.glsl).join('\n')}
void main(){
  vec2 fc = gl_FragCoord.xy;
  float k = uRes.y/700.0;
  vec2 uv = (fc - 0.5*uRes)/uRes.y - uShift;
  // the camera orbits the boat, in the boat's frame
  vec3 ta = vec3(0.0, 1.1, 0.0);
  vec3 cam = ta + uDist*vec3(cos(uPitch)*sin(uYaw), sin(uPitch), cos(uPitch)*cos(uYaw));
  vec3 f = normalize(ta - cam), r = normalize(cross(vec3(0,1,0), f)), u = cross(f, r);
  vec3 rdb = normalize(f*1.25 + r*uv.x + u*uv.y);
  vec3 rd = toWorld(rdb);
  vec3 ro = vec3(W(cam), cam.y).xzy;

  rideWaves();
  float t = FAR, id = 0.0, part = 0.0, age = 0.0;
  vec3 n = vec3(0.0, 1.0, 0.0), pn;

  float tb = marchBoat(cam, rdb, t, part);
  if (tb > 0.0) { t = tb; id = part; }
  props(ro, rd, t, id);
  bool smoke = ${SMOKE};
  if (!smoke) {
    float tp = plume(ro, rd, t, pn, age);
    if (tp > 0.0) { t = tp; id = 9.0; }
  }

  // the land, as far as the ray stays above the troughs of the sea
  float kind;
  float tl = marchLand(ro, rd, rd.y < -1e-4 ? min(t, (ro.y + 0.7)/-rd.y) : t, kind);
  if (tl > 0.0) {
    // ground under the water is the sea's to draw
    vec3 p = ro + rd*tl;
    if (kind > 5.0 || p.y > sea(p.xz)) { t = tl; id = kind; }
  }
  // the sea, flat all the way to the horizon and with its swell close by
  if (rd.y < -1e-4) {
    float ts = ro.y/-rd.y;
    if (ts < 150.0) {
      for (int i = 0; i < 3; i++) {
        vec3 p = ro + rd*ts;
        ts += clamp((p.y - sea(p.xz))/max(-rd.y, 0.2), -1.5, 1.5);
      }
    }
    if (ts < t || id < 0.5) { t = ts; id = 1.0; }
  }
  // lit lamps show however far off they are
  vec3 at = vec3(0.0);
  float lit = id;
  lamps(ro, rd, t, lit, at);
  bool dot_ = lit != id;
  id = lit;

  gHit = id;
  gT = id > 0.5 ? t : FAR;
  gRo = ro;
  vec3 col;
  if (id > 0.5) {
    vec3 p = dot_ ? at : ro + rd*t;
    vec3 q = vec3(age, 0.0, 0.0);
    if (dot_) n = -rd;
    else if (id < 1.5) n = seaN(p.xz, 0.01 + 0.004*t);
    else if (id < 2.5) {
      float lod = lodAt(t);
      n = landN(p.xz, max(mix(0.12, 0.8, lod), 0.0016*t), lod);
    }
    else if (id < 7.5) { vec3 pb = cam + rdb*t; n = toWorld(boatN(pb)); q = boatLocal(pb); }
    else if (id < 8.5) n = t < 0.05 ? -rd : caveN(p);
    else if (id < 9.5) n = pn;
    else n = propN(id, p);
    ${dispatch((id) => `col = shade_${id}(id, p, n, rd, q, t, fc, k)`)}
  } else {
    ${dispatch((id) => `col = sky_${id}(rd, fc, k)`)}
  }
  ${SMOKES}
  ${dispatch((id) => `col = post_${id}(col, rd, fc, k)`)}
  outColor = vec4(col, 1.0);
}`;
