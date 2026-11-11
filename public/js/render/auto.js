// Which renderer draws the sea. Triangles (mesh/) run anywhere and start at once, so they are the
// rule. Asked to try (`?try`), and where the browser draws on a real graphics card, the ray-marched
// sea (renderer.js) is compiled in the background and takes over when it is ready; if its frames then run slow, the
// triangles come back for good. Each renderer has a canvas of its own (a canvas has one context),
// and only the one in use is shown.

import { createMeshRenderer } from './mesh/renderer.js';
import { createRenderer } from './renderer.js';

/** @typedef {import('./renderer.js').Renderer} Renderer */
/** @typedef {import('./renderer.js').RenderTerrain} RenderTerrain */

/** Frames of the fast renderer to draw before the fine one starts compiling. */
const SETTLE = 45;
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
 * @param {'auto' | 'fast' | 'fine' | 'try'} [mode] auto and fast draw triangles; try starts on
 *   triangles and moves to the fine renderer on a graphics card if it keeps up; fine insists on it
 * @returns {Renderer | null}
 */
export function createAutoRenderer(fast, fine, terrain, mode = 'auto') {
  if (mode === 'fine') {
    fast.hidden = true;
    return createRenderer(fine, terrain);
  }
  fine.hidden = true;
  const mesh = createMeshRenderer(fast, terrain);
  const gl = fast.getContext('webgl2');
  // Only on request: compiling the ray-marched sea froze the whole browser for a long while on a
  // machine with a graphics card (its driver compiles on the thread everything else waits for),
  // so it is no longer tried unasked.
  if (!mesh || mode !== 'try' || !gl || !hasGpu(gl)) return mesh;

  /** @type {Renderer | null} */
  let candidate = null;
  /** @type {'fast' | 'fine' | 'settled'} */
  let state = 'fast';
  let frames = 0;
  let slow = 0;
  let last = 0;

  const giveUp = () => {
    candidate?.dispose();
    candidate = null;
    fine.hidden = true;
    fast.hidden = false;
    state = 'settled';
  };
  fine.addEventListener('webglcontextlost', giveUp);

  return {
    ready: () => mesh.ready(),

    draw(frame) {
      if (state === 'fine' && candidate) {
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
      mesh.draw(frame);
      if (state !== 'fast') return;
      frames++;
      if (frames === SETTLE) candidate = createRenderer(fine, terrain);
      const ready = candidate?.ready();
      if (ready === 'failed') giveUp();
      if (ready === 'ready') {
        fast.hidden = true;
        fine.hidden = false;
        state = 'fine';
        frames = 0;
        last = 0;
      }
    },

    dispose() {
      fine.removeEventListener('webglcontextlost', giveUp);
      candidate?.dispose();
      mesh.dispose();
    },
  };
}
