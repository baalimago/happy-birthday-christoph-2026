// WebGL 2 plumbing: one program, one full-screen triangle, a handful of uniforms per frame.
// Everything that looks like something is in shaders/.

import { VIEWS } from './views.js';
import { FRAGMENT, MAX_ISLES, PORTS, VERTEX } from './shaders/index.js';

/** @typedef {import('./views.js').View} View */

/**
 * One island: where it is, how high it stands and how wide it spreads.
 * @typedef {{ x: number, z: number, height: number, spread: number }} FrameIsle
 */

/**
 * The boat: world position, heading in radians (0 is +z, positive turns to starboard), speed and
 * roll.
 * @typedef {{ x: number, z: number, heading: number, speed: number, lean: number }} FrameBoat
 */

/**
 * Everything the renderer needs to draw one frame.
 * @typedef {object} Frame
 * @property {number} dt seconds since the last frame
 * @property {number} time seconds since the passage began
 * @property {FrameBoat} boat
 * @property {readonly FrameIsle[]} isles at most 14; the first 6 are the ports
 * @property {readonly boolean[]} found one per port, in the same order
 * @property {View} view
 * @property {number} yaw camera orbit round the boat; Math.PI is dead astern
 * @property {number} pitch camera height, in radians above the horizon
 * @property {readonly [number, number]} shift where the boat sits on screen, in viewport heights
 *   from the centre
 * @property {number} end 0..1, the sunset: the share of ports found
 * @property {readonly [number, number, number]} sun direction to the sun, in world coordinates
 */

/**
 * @typedef {object} Renderer
 * @property {(frame: Frame) => void} draw
 * @property {() => void} dispose
 */

/** Device pixels per CSS pixel are capped here: the shader is paid for per pixel. */
const MAX_PIXEL_RATIO = 1.5;
/** A frame longer than this many seconds is a slow one. */
const SLOW_FRAME = 0.03;
/** A frame this long is a hitch (a hidden tab, a compile), not a slow GPU. */
const HITCH = 0.5;
/** After this many more slow frames than quick ones, the resolution drops. */
const PATIENCE = 12;
const SCALE_STEP = 0.8;
const MIN_SCALE = 0.45;
/** Where unused island slots are parked, far from the chart, with no height. */
const NOWHERE = 1e4;

const UNIFORMS = /** @type {const} */ ([
  'uRes',
  'uShift',
  'uPos',
  'uHead',
  'uSun',
  'uT',
  'uYaw',
  'uPitch',
  'uEnd',
  'uSpeed',
  'uLean',
  'uMode',
  'uIsle',
  'uFound',
]);

/** @typedef {Record<typeof UNIFORMS[number], WebGLUniformLocation | null>} Locations */

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number} type
 * @param {string} source
 * @returns {WebGLShader}
 */
function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('no shader object');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`shader does not compile: ${log}`);
  }
  return shader;
}

/**
 * Compile and link the sea. Throws with the driver's log when it cannot.
 * @param {WebGL2RenderingContext} gl
 * @returns {{ program: WebGLProgram, vao: WebGLVertexArrayObject | null, at: Locations }}
 */
function build(gl) {
  const program = gl.createProgram();
  if (!program) throw new Error('no program object');
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new Error(`program does not link: ${log}`);
  }
  const at = /** @type {Locations} */ (
    Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]))
  );
  // The triangle comes from gl_VertexID, but a vertex array must still be bound.
  return { program, vao: gl.createVertexArray(), at };
}

/**
 * The world sun as the boat sees it: the shader draws everything in the boat's frame.
 * @param {readonly [number, number, number]} sun
 * @param {number} heading
 * @returns {[number, number, number]}
 */
export function sunInBoatFrame(sun, heading) {
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  return [sun[0] * cos - sun[2] * sin, sun[1], sun[0] * sin + sun[2] * cos];
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Renderer | null} null when WebGL 2 or the shaders are unavailable
 */
export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    console.warn('The sea needs WebGL 2, which this browser does not offer.');
    return null;
  }

  /** @type {ReturnType<typeof build> | null} */
  let sea;
  try {
    sea = build(gl);
  } catch (error) {
    console.warn('The sea could not be drawn.', error);
    return null;
  }

  const isles = new Float32Array(MAX_ISLES * 4);
  const found = new Float32Array(PORTS);
  /** Share of the full resolution in use; falls when frames run long, never rises. */
  let scale = 1;
  let slow = 0;

  /** @param {Event} event */
  const onLost = (event) => {
    event.preventDefault(); // or the context is never given back
    sea = null;
  };
  const onRestored = () => {
    try {
      sea = build(gl);
    } catch (error) {
      console.warn('The sea could not be drawn.', error);
    }
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

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
    draw(frame) {
      if (!sea || gl.isContextLost()) return;
      adapt(frame.dt);
      resize();

      const { boat } = frame;
      for (let i = 0; i < MAX_ISLES; i++) {
        const isle = frame.isles[i];
        isles[i * 4] = isle ? isle.x : NOWHERE;
        isles[i * 4 + 1] = isle ? isle.z : NOWHERE;
        isles[i * 4 + 2] = isle ? isle.height : 0;
        isles[i * 4 + 3] = isle ? isle.spread : 1;
      }
      // A port slot with no island has nothing to find: no ring on the water for it.
      for (let i = 0; i < PORTS; i++) found[i] = frame.found[i] || !frame.isles[i] ? 1 : 0;

      const { at } = sea;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(sea.program);
      gl.bindVertexArray(sea.vao);
      gl.uniform2f(at.uRes, canvas.width, canvas.height);
      gl.uniform2f(at.uShift, frame.shift[0], frame.shift[1]);
      gl.uniform2f(at.uPos, boat.x, boat.z);
      gl.uniform2f(at.uHead, Math.sin(boat.heading), Math.cos(boat.heading));
      gl.uniform3fv(at.uSun, sunInBoatFrame(frame.sun, boat.heading));
      gl.uniform1f(at.uT, frame.time);
      gl.uniform1f(at.uYaw, frame.yaw);
      gl.uniform1f(at.uPitch, frame.pitch);
      gl.uniform1f(at.uEnd, frame.end);
      gl.uniform1f(at.uSpeed, boat.speed);
      gl.uniform1f(at.uLean, boat.lean);
      gl.uniform1i(at.uMode, Math.max(0, VIEWS.indexOf(frame.view)));
      gl.uniform4fv(at.uIsle, isles);
      gl.uniform1fv(at.uFound, found);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (sea) {
        gl.deleteVertexArray(sea.vao);
        gl.deleteProgram(sea.program);
        sea = null;
      }
    },
  };
}
