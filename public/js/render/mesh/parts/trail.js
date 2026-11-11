// Syrus mode: the ribbon of six colours that streams out astern while she flies, in steps.

import { createMesh } from '../gl.js';
import { COMMON } from '../look.js';

/** @typedef {import('../renderer.js').Kit} Kit */
/** @typedef {import('../renderer.js').Part} Part */

/** How far astern the ribbon reaches, and half its breadth. */
const LENGTH = 26;
const HALF = 0.92;

const VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aAt;   // x: -1 port .. 1 starboard, y: 0 at the stern .. 1 at the end
${COMMON}
uniform vec4 uShip;       // where she is (x, z), sine and cosine of her heading
uniform vec4 uRibbon;     // its height, its length, half its breadth, how much of it shows
out vec2 vAt;
void main(){
  float across = aAt.x*uRibbon.z, astern = 1.7 + aAt.y*uRibbon.y;
  vec3 p = vec3(uShip.x + uShip.w*across - uShip.z*astern, uRibbon.x,
                uShip.y - uShip.z*across - uShip.w*astern);
  vAt = vec2(across, aAt.y*uRibbon.y);
  gl_Position = uViewProj*vec4(p, 1.0);
}`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
uniform vec4 uRibbon;
in vec2 vAt;
out vec4 outColor;
void main(){
  float x = vAt.x + 0.16*(step(0.5, fract(vAt.y*0.22 - uTime*2.4)) - 0.5);
  if (abs(x) > 0.75) discard;
  float band = floor((x + 0.75)/1.5*6.0);
  vec3 col = band < 0.5 ? vec3(1.0, 0.16, 0.2) : band < 1.5 ? vec3(1.0, 0.6, 0.1) :
             band < 2.5 ? vec3(1.0, 0.93, 0.15) : band < 3.5 ? vec3(0.2, 0.9, 0.3) :
             band < 4.5 ? vec3(0.15, 0.6, 1.0) : vec3(0.55, 0.3, 1.0);
  float a = 0.92*uRibbon.w*smoothstep(uRibbon.y, uRibbon.y*0.55, vAt.y);
  // its colours are its own in every view
  outColor = vec4(col*a, a);
}`;

/**
 * @param {Kit} kit
 * @returns {Part}
 */
export function createTrail({ gl, programs }) {
  const program = programs.make(VERTEX, FRAGMENT, ['aAt']);
  const strip = new Float32Array([-1, 0, 1, 0, 1, 1, -1, 0, 1, 1, -1, 1]);
  const mesh = createMesh(gl, [{ data: strip, size: 2 }]);
  return {
    draw(scene) {
      const aloft = scene.frame.boat.aloft ?? 0;
      if (aloft < 0.3) return;
      const { x, z, sin, cos } = scene.boat;
      scene.bind(program);
      gl.uniform4f(program.at('uShip'), x, z, sin, cos);
      gl.uniform4f(
        program.at('uRibbon'),
        aloft + 0.7,
        LENGTH,
        HALF,
        Math.min(1, (aloft - 0.3) / 0.6),
      );
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      mesh.draw();
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
    },
    dispose: () => mesh.dispose(),
  };
}
