// How the world is lit and graded in each view, and the GLSL every part shares. The four views
// are one scene with four grades: a part lights its surface with `lit`, then hands the colour to
// `finish`, which adds the haze and the view's look (phosphor, gilt, ink on paper).

/** @typedef {import('../views.js').View} View */
/** @typedef {[number, number, number]} Rgb */

/**
 * @typedef {object} Look colours in linear-ish 0..1, already blended towards the sunset
 * @property {Rgb} zenith top of the sky
 * @property {Rgb} horizon the sky at the horizon, which is also the colour of the haze
 * @property {Rgb} sunColor light from the sun
 * @property {Rgb} ambient light from the sky
 * @property {Rgb} deep the open sea
 * @property {Rgb} shallow water over sand
 * @property {number} haze density of the haze per unit of distance
 */

/** @type {Look} */
const DAY = {
  zenith: [0.27, 0.5, 0.72],
  horizon: [0.86, 0.84, 0.76],
  sunColor: [1.0, 0.93, 0.78],
  ambient: [0.42, 0.5, 0.58],
  deep: [0.03, 0.27, 0.33],
  shallow: [0.2, 0.62, 0.6],
  haze: 0.0016,
};

/** @type {Look} */
const DUSK = {
  zenith: [0.2, 0.2, 0.42],
  horizon: [0.98, 0.56, 0.38],
  sunColor: [1.0, 0.62, 0.36],
  ambient: [0.42, 0.36, 0.48],
  deep: [0.05, 0.16, 0.27],
  shallow: [0.3, 0.42, 0.5],
  haze: 0.0019,
};

const KEYS = /** @type {const} */ (['zenith', 'horizon', 'sunColor', 'ambient', 'deep', 'shallow']);

/**
 * The look of this frame: day, turning to dusk as the voyage ends.
 * @param {number} end 0..1
 * @returns {Look}
 */
export function lookAt(end) {
  const k = Math.min(1, Math.max(0, end));
  const look = { ...DAY, haze: DAY.haze + (DUSK.haze - DAY.haze) * k };
  for (const key of KEYS) {
    look[key] = /** @type {Rgb} */ (DAY[key].map((v, i) => v + (DUSK[key][i] - v) * k));
  }
  return look;
}

/**
 * Uniforms and helpers for both stages. The renderer fills every one of these for each program
 * (`scene.bind(program)`); a part declares nothing of its own for them.
 *   lit(albedo, n)        the surface under sun and sky
 *   hazeAt(worldPos)      0..1, how much of the horizon colour lies between the eye and the point
 */
export const COMMON = /* glsl */ `
precision highp int;
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform vec3 uSun;        // direction to the sun
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uHaze;
uniform float uTime;
uniform vec2 uRes;
uniform int uMode;        // 0 poster, 1 terminal, 2 gold, 3 chart
uniform vec4 uBoat;       // the boat: x, z, sin(heading), cos(heading)
vec3 lit(vec3 albedo, vec3 n){
  float d = max(dot(n, uSun), 0.0);
  return albedo*(uAmb*(0.65 + 0.35*n.y) + uSunCol*d);
}
float hazeAt(vec3 p){
  return 1.0 - exp(-uHaze*distance(p, uEye));
}
`;

/**
 * Fragment stage only: `finish(colour, haze)` is the last thing every fragment shader calls.
 * `haze` is hazeAt of the fragment (computed per vertex is fine); pass 0.0 for the sky itself.
 */
export const FINISH = /* glsl */ `
vec3 finish(vec3 col, float haze){
  col = mix(col, uHorizon, haze);
  if (uMode == 0) return col;
  float l = dot(col, vec3(0.3, 0.55, 0.15));
  vec2 fc = gl_FragCoord.xy;
  if (uMode == 1) {
    float line = 0.8 + 0.2*step(1.0, mod(fc.y, 2.0));
    return vec3(0.06, 1.0, 0.36)*(0.04 + l*l*1.15)*line;
  }
  if (uMode == 2) {
    vec3 gilt = mix(vec3(0.13, 0.07, 0.03), vec3(0.83, 0.6, 0.2), smoothstep(0.05, 0.75, l));
    return mix(gilt, vec3(1.0, 0.93, 0.7), smoothstep(0.8, 1.05, l));
  }
  float pitch = max(3.0, floor(uRes.y/160.0));
  float hatch = step(0.5, fract((fc.x + fc.y)/pitch));
  float cross_ = step(0.5, fract((fc.x - fc.y)/pitch));
  float ink = l < 0.2 ? max(hatch, cross_) : l < 0.42 ? hatch : 0.0;
  ink = max(ink, 1.0 - smoothstep(0.02, 0.1, l));
  return mix(vec3(0.91, 0.86, 0.73), vec3(0.17, 0.14, 0.1), ink*0.85);
}
`;
