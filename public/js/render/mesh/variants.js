// Programs in two variants: one for the poster view, one for the other three. `finish` in
// ../look.js chooses the view by a uniform, and a software rasteriser runs every branch of it
// for every pixel (about a millisecond for a screenful at 640 by 400). The poster view needs
// only the haze, so a part that covers much of the screen compiles a second program whose
// `finish` is just that, and picks by the view each frame. The pictures are the same.

import { FINISH } from './look.js';

/** `finish` for the poster view alone: the same result as FINISH when uMode is 0. */
const POSTER_FINISH = /* glsl */ `
vec3 finish(vec3 col, float haze){ return mix(col, uHorizon, haze); }
`;

/**
 * @param {import('./gl.js').Programs} programs
 * @param {string} vertex
 * @param {(finish: string) => string} fragment the fragment shader, given the GLSL of `finish`
 * @param {readonly string[]} attributes
 * @returns {(mode: number) => import('./gl.js').Program} the program for a view (scene.mode)
 */
export function forViews(programs, vertex, fragment, attributes) {
  const poster = programs.make(vertex, fragment(POSTER_FINISH), attributes);
  const others = programs.make(vertex, fragment(FINISH), attributes);
  return (mode) => (mode === 0 ? poster : others);
}
