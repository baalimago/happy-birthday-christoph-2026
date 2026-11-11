// The volcano's plume: puffs of smoke that rise from the crater, swell and drift off downwind, as
// in the ray-marched scene. Each puff is a lumpy low-poly ball, see-through and thinner at its
// rim; the young ones are lit from below by the lava. It is drawn after everything solid.

import { COMMON, FINISH } from '../look.js';
import { createShape } from '../solids.js';

const PUFFS = 10;
/** A ball this far round the middle of the plume holds all of it. */
const BOUND = 240;

const VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec4 aPos;
layout(location = 1) in vec3 aNormal;
${COMMON}
uniform vec4 uPuff;       // middle and radius
uniform vec4 uSmoke;      // age 0 new .. 1, how much there is of it 0..1, cos and sin of its turn
out vec4 vCol;
out float vHaze;
void main(){
  mat2 spin = mat2(uSmoke.z, -uSmoke.w, uSmoke.w, uSmoke.z);
  vec3 p = aPos.xyz, n = aNormal;
  p.xz = spin*p.xz;
  n.xz = spin*n.xz;
  vec3 world = uPuff.xyz + p*uPuff.w;
  vec3 alb = mix(vec3(0.34, 0.31, 0.35), vec3(0.74, 0.70, 0.72), smoothstep(0.1, 0.9, uSmoke.x));
  vec3 col = alb*(uSunCol*0.8*smoothstep(-0.45, 0.85, dot(n, uSun)) + uAmb*(0.75 + 0.45*n.y));
  col += vec3(1.0, 0.5, 0.16)*1.1*(1.0 - smoothstep(0.02, 0.3, uSmoke.x))*clamp(0.75 - n.y, 0.0, 1.0);
  float facing = dot(n, normalize(uEye - world));
  vCol = vec4(col, uSmoke.y*smoothstep(-0.05, 0.55, facing));
  vHaze = hazeAt(world);
  gl_Position = uViewProj*vec4(world, 1.0);
}`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
${FINISH}
in vec4 vCol;
in float vHaze;
out vec4 outColor;
void main(){
  outColor = vec4(finish(vCol.rgb, vHaze), vCol.a);
}`;

/** A lumpy ball of twenty facets, about one unit in radius. */
function puffShape() {
  const shape = createShape();
  const g = (1 + Math.sqrt(5)) / 2;
  /** @type {number[][]} */
  const corners = [];
  for (const a of [-1, 1]) {
    for (const b of [-g, g]) corners.push([0, a, b], [a, b, 0], [b, 0, a]);
  }
  const points = corners.map(([x, y, z], i) => {
    const r = (0.82 + 0.36 * ((i * 0.618) % 1)) / Math.hypot(x, y, z);
    return [x * r, y * r, z * r];
  });
  // every three corners that are neighbours make a facet
  const near = (/** @type {number} */ i, /** @type {number} */ j) =>
    Math.hypot(
      corners[i][0] - corners[j][0],
      corners[i][1] - corners[j][1],
      corners[i][2] - corners[j][2],
    ) < 2.1;
  for (let i = 0; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      for (let k = j + 1; k < 12; k++) {
        if (!near(i, j) || !near(j, k) || !near(i, k)) continue;
        const [a, b, c] = [points[i], points[j], points[k]];
        const out =
          (b[1] - a[1]) * (c[2] - a[2]) * a[0] -
          (b[2] - a[2]) * (c[1] - a[1]) * a[0] +
          ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])) * a[1] +
          ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * a[2];
        if (out > 0) shape.tri(a, b, c, [1, 1, 1]);
        else shape.tri(a, c, b, [1, 1, 1]);
      }
    }
  }
  return shape;
}

/** @param {number} a @param {number} b @param {number} x */
function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** @param {import('../renderer.js').Kit} kit @returns {import('../renderer.js').Part} */
export function createVolcano({ gl, programs, terrain }) {
  const program = programs.make(VERTEX, FRAGMENT, ['aPos', 'aNormal']);
  const mesh = puffShape().mesh(gl);
  const { volcano } = terrain;
  // x, y, z, radius, age, distance from the eye, for each puff; and the order they are drawn in
  const puffs = new Float32Array(PUFFS * 6);
  const order = Array.from({ length: PUFFS }, (_, i) => i);

  return {
    draw(scene) {
      if (volcano.radius <= 0) return;
      const { eye, frame, time } = scene;
      const { wind } = frame;
      const wx = -Math.sin(wind.from);
      const wz = -Math.cos(wind.from);

      // Is any of it in the view?
      const mx = volcano.x + wx * 90 * wind.speed;
      const my = volcano.height + 60;
      const mz = volcano.z + wz * 90 * wind.speed;
      const m = scene.viewProj;
      const w = m[3] * mx + m[7] * my + m[11] * mz + m[15];
      if (w < -BOUND) return;
      const aspect = scene.width / scene.height;
      const px = m[0] * mx + m[4] * my + m[8] * mz + m[12];
      if (Math.abs(px) > w + BOUND * (Math.hypot(2.5 / aspect, 1) + 1)) return;
      const py = m[1] * mx + m[5] * my + m[9] * mz + m[13];
      if (Math.abs(py) > w + BOUND * 3.7) return;

      for (let i = 0; i < PUFFS; i++) {
        const s = ((i + time * 0.05) / PUFFS) % 1;
        const drift = 14 * s + 190 * s * s * wind.speed;
        const x = volcano.x + wx * drift + 7 * s * Math.sin(i * 2.4);
        const y = volcano.height + 100 * s ** 0.85;
        const z = volcano.z + wz * drift + 7 * s * Math.cos(i * 1.7);
        puffs.set(
          [
            x,
            y,
            z,
            1.3 * (8 + 27 * s) * smooth(0, 0.05, s) * smooth(1, 0.8, s),
            s,
            Math.hypot(x - eye[0], y - eye[1], z - eye[2]),
          ],
          i * 6,
        );
      }
      // the farthest first, as anything see-through must be
      order.sort((a, b) => puffs[b * 6 + 5] - puffs[a * 6 + 5]);

      scene.bind(program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const i of order) {
        const [x, y, z, radius, s] = puffs.subarray(i * 6, i * 6 + 5);
        if (radius < 0.5) continue;
        const turn = i * 1.9 + time * 0.03;
        gl.uniform4f(program.at('uPuff'), x, y, z, radius);
        gl.uniform4f(
          program.at('uSmoke'),
          s,
          0.92 * (1 - 0.5 * smooth(0.5, 1, s)),
          Math.cos(turn),
          Math.sin(turn),
        );
        mesh.draw();
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    },
    dispose: () => mesh.dispose(),
  };
}
