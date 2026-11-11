// The sky: one triangle over the screen from just under the horizon up, behind everything. What
// lies under the horizon is the sea's to draw, and is left in the colour the frame was cleared to.

import { createMesh } from '../gl.js';
import { COMMON } from '../look.js';
import { forViews } from '../variants.js';

const VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
${COMMON}
uniform vec3 uRight, uUp, uForward;
uniform vec4 uLens;       // focal x, focal y, shift x, shift y in clip units
uniform float uFloor;     // the clip y just under the horizon
out vec3 vDir;
void main(){
  vec2 corner = vec2(aCorner.x, max(aCorner.y, uFloor));
  vec2 v = (corner - uLens.zw)/uLens.xy;
  vDir = uForward + uRight*v.x + uUp*v.y;
  gl_Position = vec4(corner, 1.0, 1.0);
}`;

/** @param {string} finish */
const fragment = (finish) => /* glsl */ `#version 300 es
precision highp float;
${COMMON}
${finish}
in vec3 vDir;
out vec4 outColor;
void main(){
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  // powers by squaring: exp and pow are dear on a processor
  float low = 1.0 - up;
  low *= low;
  vec3 col = mix(uZenith, uHorizon, low*low);
  float s = max(dot(d, uSun), 0.0);
  float s8 = s*s;
  s8 *= s8;
  s8 *= s8;
  col += uSunCol*(0.35*s8*s8*s8 + clamp(2500.0*s - 2498.25, 0.0, 1.0));
  outColor = vec4(finish(col, 0.0), 1.0);
}`;

/** @param {import('../renderer.js').Kit} kit @returns {import('../renderer.js').Part} */
export function createSky({ gl, programs }) {
  const programFor = forViews(programs, VERTEX, fragment, ['aCorner']);
  const mesh = createMesh(gl, [{ data: new Float32Array([-1, -1, -1, 3, 3, -1]), size: 2 }]);
  return {
    draw(scene) {
      const program = programFor(scene.mode);
      scene.bind(program);
      const aspect = scene.width / scene.height;
      // The horizon is level on the screen: it is where forward + up*v has no height.
      const horizon = scene.up[1] > 1e-3 ? (-scene.forward[1] / scene.up[1]) * 2.5 : -1;
      const floor = horizon + 2 * scene.frame.shift[1] - 8 / scene.height;
      gl.uniform1f(program.at('uFloor'), Math.min(1, Math.max(-1, floor)));
      gl.uniform3fv(program.at('uRight'), scene.right);
      gl.uniform3fv(program.at('uUp'), scene.up);
      gl.uniform3fv(program.at('uForward'), scene.forward);
      const { shift } = scene.frame;
      gl.uniform4f(program.at('uLens'), 2.5 / aspect, 2.5, (2 * shift[0]) / aspect, 2 * shift[1]);
      gl.depthMask(false);
      mesh.draw();
      gl.depthMask(true);
    },
    dispose: () => mesh.dispose(),
  };
}
