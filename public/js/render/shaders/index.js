// Assembles the two shaders: one full-screen triangle, and a fragment shader made of the shared
// scene, every view's sky and shading, and a main() that marches a ray and hands the hit to the
// view chosen by uMode.
//
// To add a view: write shaders/<id>.js exporting { id, glsl } where the GLSL defines
//   vec3 sky_<id>(vec3 rd, vec2 fc, float k)
//   vec3 shade_<id>(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k)
//   vec3 post_<id>(vec3 col, vec3 rd, vec2 fc, float k)
// (rd ray, fc pixel, k pixel scale, p hit point and n normal in the boat's frame, q the point in
// the boat's own tilted coordinates, t distance), add it to SHADERS below, and add its id to
// VIEWS in ../views.js. A view's place in VIEWS is its uMode.

import { VIEWS } from '../views.js';
import { MAX_ISLES, PORTS, SCENE } from './scene.js';
import { poster } from './poster.js';
import { terminal } from './terminal.js';
import { gold } from './gold.js';
import { chart } from './chart.js';

export { MAX_ISLES, PORTS };

/** @typedef {{ id: string, glsl: string }} ViewShader */

/** @type {ViewShader[]} */
const SHADERS = [poster, terminal, gold, chart];

/** The march never takes more steps than this. */
const STEPS = 110;

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

export const VERTEX = /* glsl */ `#version 300 es
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
out vec4 outColor;
${SCENE}
${SHADERS.map((shader) => shader.glsl).join('\n')}
void main(){
  vec2 fc = gl_FragCoord.xy;
  float k = uRes.y/700.0;
  vec2 uv = (fc - 0.5*uRes)/uRes.y - uShift;
  vec3 ta = vec3(0.0, 1.1, 0.0);
  vec3 ro = ta + 8.6*vec3(cos(uPitch)*sin(uYaw), sin(uPitch), cos(uPitch)*cos(uYaw));
  vec3 f = normalize(ta - ro), r = normalize(cross(vec3(0,1,0), f)), u = cross(f, r);
  vec3 rd = normalize(f*1.25 + r*uv.x + u*uv.y);

  float t = 0.0; vec2 m = vec2(0.0); bool hit = false;
  for (int i = 0; i < ${STEPS}; i++) {
    vec3 p = ro + rd*t;
    if (rd.y > 0.0 && p.y > 5.2) break;   // above everything and climbing: sky
    m = map(p);
    if (m.x < 0.0012*t + 0.0008) { hit = true; break; }
    t += m.x;
    if (t > 140.0) break;
  }
  float id = m.y;
  // out of steps over open water: the flat sea, all the way to the horizon
  if (!hit && rd.y < -0.002) { t = max(t, -ro.y/rd.y); id = 1.0; hit = true; }

  vec3 col;
  if (hit) {
    vec3 p = ro + rd*t;
    vec3 n = id < 2.5 ? groundN(W(p), 0.01 + 0.004*t) : id > 9.5 ? lightN(id, p) : boatN(p);
    vec3 q = boatLocal(p);
    ${dispatch((id) => `col = shade_${id}(id, p, n, rd, q, t, fc, k)`)}
  } else {
    ${dispatch((id) => `col = sky_${id}(rd, fc, k)`)}
  }
  ${dispatch((id) => `col = post_${id}(col, rd, fc, k)`)}
  outColor = vec4(col, 1.0);
}`;
