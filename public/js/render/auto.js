// Which renderer draws the sea. Where the browser draws on a real graphics card, the ray-marched
// sea (renderer.js) is the one: it is the picture the voyage was made for. Its shaders are long
// to compile, so the loading bar stays up until they are ready. If its frames then run slow, or
// it cannot be built, triangles (mesh/) take over; and where WebGL runs in software, triangles
// are used from the start, since ray marching cannot keep up there. The captain may also ask
// for one or the other while under way (prefer): the one on screen keeps drawing until the
// other is ready. Each renderer has a
// canvas of its own (a canvas has one context), and only the one in use is shown.

import { createMeshRenderer } from './mesh/renderer.js';
import { createRenderer } from './renderer.js';

/** @typedef {import('./renderer.js').Renderer} Renderer */
/** @typedef {import('./renderer.js').RenderTerrain} RenderTerrain */

/** A frame longer than this many milliseconds counts against the fine renderer. */
const SLOW = 30;
/** A frame this long counts ten times. */
const AWFUL = 250;
/** Slow frames, net of half as many fast ones, before the fine renderer is given up. */
const PATIENCE = 45;
/** Frames after the switch that are not judged: the first ones carry the driver's warm-up. */
const GRACE = 6;

/**
 * Whether WebGL draws on a graphics card rather than in software.
 * @param {WebGL2RenderingContext} gl
 */
export function hasGpu(gl) {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  return !/swiftshader|llvmpipe|softpipe|software|basic render|warp/i.test(name);
}

/**
 * @typedef {'fast' | 'fine'} Look
 * @typedef {Renderer & {
 *   look(): Look,
 *   wants(): Look,
 *   prefer(look: Look): void,
 *   choice: boolean,
 * }} AutoRenderer look is what is on screen; wants is what will be once it is ready; prefer asks
 *   for the other; choice says whether this machine can sensibly draw either
 */

/**
 * @param {HTMLCanvasElement} fast the canvas for the mesh renderer
 * @param {HTMLCanvasElement} fine the canvas for the ray-marched renderer
 * @param {RenderTerrain} terrain
 * @param {'auto' | 'fast' | 'fine'} [mode] auto picks by the machine and falls back to triangles
 *   if the fine sea runs slow; fast and fine start with one, and fine is then never given up
 * @param {Look | null} [liking] the look to start with where the machine could draw either
 * @returns {AutoRenderer | null}
 */
export function createAutoRenderer(fast, fine, terrain, mode = 'auto', liking = null) {
  const probe = document.createElement('canvas').getContext('webgl2');
  const card = probe !== null && hasGpu(probe);
  probe?.getExtension('WEBGL_lose_context')?.loseContext();
  const insist = mode === 'fine';
  /** @type {Record<Look, Renderer | null>} both are kept once made, so switching back is quick */
  const made = { fast: null, fine: null };
  /** @param {Look} look */
  const make = (look) => {
    made[look] ??=
      look === 'fine' ? createRenderer(fine, terrain) : createMeshRenderer(fast, terrain);
    return made[look];
  };
  /** @param {Look} look */
  const drop = (look) => {
    made[look]?.dispose();
    made[look] = null;
  };

  let frames = 0;
  let slow = 0;
  let last = 0;
  /** @param {Look} look */
  const show = (look) => {
    fast.hidden = look !== 'fast';
    fine.hidden = look !== 'fine';
    shown = look;
    frames = slow = last = 0;
  };

  /** @type {Look} */
  let want = 'fast';
  if (mode === 'fine') want = 'fine';
  else if (mode === 'auto' && card) want = liking ?? 'fine';
  if (!make(want)) {
    if (want === 'fast' || !make('fast')) return null;
    want = 'fast';
  }
  /** @type {Look} */
  let shown = want;
  show(want);

  /** The fine sea cannot be built or cannot keep up: triangles take over. */
  const giveUp = () => {
    drop('fine');
    want = 'fast';
    if (shown === 'fine' && make('fast')) show('fast');
  };
  fine.addEventListener('webglcontextlost', giveUp);

  /** Bring on the look asked for once it is ready; forget it if it cannot be made. */
  const settle = () => {
    if (want !== shown) {
      const state = make(want)?.ready() ?? 'failed';
      if (state === 'ready') show(want);
      else if (state === 'failed') {
        drop(want);
        want = shown;
      }
    }
    if (shown === 'fine' && made.fine?.ready() === 'failed') giveUp();
  };

  return {
    choice: card || mode !== 'auto',
    look: () => shown,
    wants: () => want,
    prefer(look) {
      want = look;
    },

    ready() {
      settle();
      return made[shown]?.ready() ?? 'failed';
    },

    draw(frame) {
      settle();
      if (shown === 'fine' && !insist) {
        const now = performance.now();
        const took = last ? now - last : 0;
        last = now;
        frames++;
        if (frames > GRACE && frame.dt > 0) {
          slow = took > AWFUL ? slow + 10 : took > SLOW ? slow + 1 : Math.max(0, slow - 0.5);
        }
        if (slow >= PATIENCE) giveUp();
      }
      made[shown]?.draw(frame);
    },

    dispose() {
      fine.removeEventListener('webglcontextlost', giveUp);
      drop('fine');
      drop('fast');
    },
  };
}
