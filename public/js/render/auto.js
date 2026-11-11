// Which renderer draws the sea. Where the browser draws on a real graphics card, the ray-marched
// sea (renderer.js) is the one: it is the picture the voyage was made for. Its shaders are long
// to compile, so the loading bar stays up until they are ready. If its frames then run slow, or
// it cannot be built, triangles (mesh/) take over for good; and where WebGL runs in software,
// triangles are used from the start, since ray marching cannot keep up there. Each renderer has a
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
 * @param {HTMLCanvasElement} fast the canvas for the mesh renderer
 * @param {HTMLCanvasElement} fine the canvas for the ray-marched renderer
 * @param {RenderTerrain} terrain
 * @param {'auto' | 'fast' | 'fine'} [mode] auto picks by the machine and falls back to triangles
 *   if the fine sea runs slow; fast and fine insist on one
 * @returns {Renderer | null}
 */
export function createAutoRenderer(fast, fine, terrain, mode = 'auto') {
  if (mode === 'fine') {
    fast.hidden = true;
    return createRenderer(fine, terrain);
  }
  const probe = document.createElement('canvas').getContext('webgl2');
  const card = mode === 'auto' && probe !== null && hasGpu(probe);
  probe?.getExtension('WEBGL_lose_context')?.loseContext();
  /** @type {Renderer | null} */
  let candidate = card ? createRenderer(fine, terrain) : null;
  if (!candidate) {
    fine.hidden = true;
    return createMeshRenderer(fast, terrain);
  }
  fast.hidden = true;

  /** @type {Renderer | null} the triangles, once the fine sea has been given up */
  let mesh = null;
  let frames = 0;
  let slow = 0;
  let last = 0;

  const giveUp = () => {
    if (!candidate) return;
    candidate.dispose();
    candidate = null;
    fine.hidden = true;
    fast.hidden = false;
    mesh = createMeshRenderer(fast, terrain);
  };
  fine.addEventListener('webglcontextlost', giveUp);

  return {
    ready() {
      if (candidate) {
        const state = candidate.ready();
        if (state !== 'failed') return state;
        giveUp();
      }
      return mesh ? mesh.ready() : 'failed';
    },

    draw(frame) {
      if (candidate) {
        const now = performance.now();
        const took = last ? now - last : 0;
        last = now;
        frames++;
        if (frames > GRACE && frame.dt > 0) {
          slow = took > AWFUL ? slow + 10 : took > SLOW ? slow + 1 : Math.max(0, slow - 0.5);
        }
        if (slow < PATIENCE) return candidate.draw(frame);
        giveUp();
      }
      mesh?.draw(frame);
    },

    dispose() {
      fine.removeEventListener('webglcontextlost', giveUp);
      candidate?.dispose();
      mesh?.dispose();
    },
  };
}
