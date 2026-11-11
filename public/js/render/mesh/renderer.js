// The mesh renderer: the world as triangles. It draws the same frames as the ray-marched renderer
// (../renderer.js) at a small fraction of the cost, so the game runs without a graphics card.
// This file owns the context, the canvas size and the frame's shared state; each thing that can
// be seen is a part in parts/, and they do not know about each other.

import { VIEWS } from '../views.js';
import { cameraOf } from './camera.js';
import { createPrograms } from './gl.js';
import { lookAt } from './look.js';
import { PARTS } from './parts/index.js';

/** @typedef {import('../renderer.js').Frame} Frame */
/** @typedef {import('../renderer.js').Renderer} Renderer */
/** @typedef {import('../renderer.js').RenderTerrain} RenderTerrain */
/** @typedef {import('./gl.js').Program} Program */

/**
 * What a part is given to draw one frame.
 * @typedef {object} Scene
 * @property {Frame} frame
 * @property {number} time seconds, for anything that moves by itself
 * @property {number} width canvas pixels
 * @property {number} height
 * @property {[number, number, number]} eye
 * @property {[number, number, number]} right
 * @property {[number, number, number]} up
 * @property {[number, number, number]} forward
 * @property {Float32Array} viewProj world to clip, column-major
 * @property {import('./look.js').Look} look
 * @property {number} mode index of the view in VIEWS
 * @property {{ x: number, z: number, sin: number, cos: number }} boat the boat's place and the
 *   sine and cosine of her heading
 * @property {(program: Program) => void} bind use the program and fill the uniforms of COMMON
 */

/**
 * A part: one kind of thing in the world. It builds its meshes and starts its programs compiling
 * in `create`, and draws itself each frame. It leaves the GL state as it found it, apart from the
 * bound program, vertex array and textures on units of its own.
 * @typedef {object} Part
 * @property {(scene: Scene) => void} draw
 * @property {() => void} dispose
 */

/**
 * @typedef {object} Kit what a part is created with
 * @property {WebGL2RenderingContext} gl
 * @property {import('./gl.js').Programs} programs
 * @property {RenderTerrain} terrain
 */

/** Device pixels per CSS pixel are capped here. */
const MAX_PIXEL_RATIO = 1.5;
/** A frame longer than this many seconds is a slow one: the aim is sixty a second. */
const SLOW_FRAME = 0.021;
/** A frame this long is a hitch (a tab switch), not a slow machine. */
const HITCH = 0.5;
/** Slow frames, net of fast ones, before the resolution is lowered. */
const PATIENCE = 10;
const SCALE_STEP = 0.8;
const MIN_SCALE = 0.25;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {RenderTerrain} terrain
 * @returns {Renderer | null} null when WebGL 2 is unavailable or the world cannot be uploaded
 */
export function createMeshRenderer(canvas, terrain) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    console.warn('The sea needs WebGL 2, which this browser does not offer.');
    return null;
  }

  /** @type {{ programs: import('./gl.js').Programs, parts: Part[] } | null} */
  let world = null;
  const launch = () => {
    const programs = createPrograms(gl);
    /** @type {Part[]} */
    const parts = [];
    try {
      for (const create of PARTS) parts.push(create({ gl, programs, terrain }));
      gl.flush(); // hand the compiling to the driver now
      world = { programs, parts };
    } catch (error) {
      console.warn('The sea could not be drawn.', error);
      for (const part of parts) part.dispose();
      programs.dispose();
      world = null;
    }
  };
  launch();
  if (!world) return null;

  let scale = 1;
  let slow = 0;

  /** @param {Event} event */
  const onLost = (event) => {
    event.preventDefault(); // or the context is never given back
    world = null;
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', launch);

  /** @param {number} dt */
  function adapt(dt) {
    if (dt > HITCH) return;
    slow = dt > SLOW_FRAME ? slow + 1 : Math.max(0, slow - 1);
    if (slow >= PATIENCE && scale > MIN_SCALE) {
      scale = Math.max(MIN_SCALE, scale * SCALE_STEP);
      slow = 0;
    }
  }

  function resize() {
    const ratio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO) * scale;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  return {
    ready() {
      return world ? world.programs.ready() : 'pending';
    },

    draw(frame) {
      if (!world || gl.isContextLost() || world.programs.ready() !== 'ready') return;
      adapt(frame.dt);
      resize();
      const { width, height } = canvas;
      const { boat } = frame;
      const camera = cameraOf(boat, frame.camera, frame.shift, width / height);
      const look = lookAt(frame.end);
      const mode = Math.max(0, VIEWS.indexOf(frame.view));
      const sin = Math.sin(boat.heading);
      const cos = Math.cos(boat.heading);
      /** @type {Scene} */
      const scene = {
        frame,
        time: frame.time,
        width,
        height,
        ...camera,
        look,
        mode,
        boat: { x: boat.x, z: boat.z, sin, cos },
        bind({ program, at }) {
          gl.useProgram(program);
          gl.uniformMatrix4fv(at('uViewProj'), false, camera.viewProj);
          gl.uniform3fv(at('uEye'), camera.eye);
          gl.uniform3fv(at('uSun'), frame.sun);
          gl.uniform3fv(at('uSunCol'), look.sunColor);
          gl.uniform3fv(at('uAmb'), look.ambient);
          gl.uniform3fv(at('uZenith'), look.zenith);
          gl.uniform3fv(at('uHorizon'), look.horizon);
          gl.uniform3fv(at('uDeep'), look.deep);
          gl.uniform3fv(at('uShallow'), look.shallow);
          gl.uniform1f(at('uHaze'), look.haze);
          gl.uniform1f(at('uTime'), frame.time);
          gl.uniform2f(at('uRes'), width, height);
          gl.uniform1i(at('uMode'), mode);
          gl.uniform4f(at('uBoat'), boat.x, boat.z, sin, cos);
        },
      };

      gl.viewport(0, 0, width, height);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      // A triangle is seen from its front when cross(b - a, c - a) points at the eye: in this
      // world (x east, y up, z north) that is clockwise on screen.
      gl.enable(gl.CULL_FACE);
      gl.frontFace(gl.CW);
      gl.clearColor(look.horizon[0], look.horizon[1], look.horizon[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      for (const part of world.parts) part.draw(scene);
      gl.bindVertexArray(null);
    },

    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', launch);
      if (world) {
        for (const part of world.parts) part.dispose();
        world.programs.dispose();
        world = null;
      }
    },
  };
}
