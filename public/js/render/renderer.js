// WebGL 2 plumbing: one program, one full-screen triangle, the world as two textures (uploaded
// once) and a handful of uniforms per frame. Everything that looks like something is in shaders/.

import { VIEWS } from './views.js';
import { FRAGMENT, PORTS, VERTEX } from './shaders/index.js';

/** @typedef {import('./views.js').View} View */

/**
 * The world, as the game's terrain module builds it (js/game/terrain.js: the renderer imports
 * nothing from outside its folder, so the shape is spelled out here).
 * @typedef {object} RenderTerrain
 * @property {number} n samples along a side of the grids
 * @property {number} extent side of the world in units; the grids are centred on the origin
 * @property {Float32Array} heights n*n, index iz*n + ix; units above the sea, negative under it
 * @property {Float32Array} forest n*n, 0..1
 * @property {readonly { id: string, kind: 'light' | 'cave', x: number, z: number, base: number }[]} ports
 * @property {{ ax: number, az: number, bx: number, bz: number, radius: number, hall: number, roof: number }} cave
 * @property {{ x: number, z: number, radius: number, height: number, crater: number }} volcano
 */

/**
 * The boat: world position, heading in radians (0 is north, +z; positive turns to starboard),
 * speed, heel, and the angle of the boom off the centreline (positive to starboard).
 * @typedef {{ x: number, z: number, heading: number, speed: number, lean: number, boom: number }} FrameBoat
 */

/**
 * Everything the renderer needs to draw one frame.
 * @typedef {object} Frame
 * @property {number} dt seconds since the last frame
 * @property {number} time seconds since the passage began
 * @property {FrameBoat} boat
 * @property {readonly boolean[]} found one per terrain.ports entry, in the same order
 * @property {View} view
 * @property {{ yaw: number, pitch: number, distance: number }} camera orbit round the boat: yaw
 *   (Math.PI is dead astern), pitch in radians above the horizon, distance from the boat
 * @property {readonly [number, number]} shift where the boat sits on screen, in viewport heights
 *   from the centre
 * @property {number} end 0..1, the sunset: the share of ports found
 * @property {readonly [number, number, number]} sun direction to the sun, in world coordinates
 * @property {{ from: number, speed: number }} wind the compass bearing it blows from, and its
 *   strength (about 0.55..1.25)
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
/** Samples of the height grid along the side of a cell of the coarse grid. */
const BLOCK = 16;
/** Coarse cells along the side of a cell of the coarsest grid (the shader's 4.0*uCell). */
const GROUP = 4;
/** What the shader may add to the grid's height: relief, and the woods where there are any. */
const RELIEF = 1.5;
const WOODS = 4.4;
/** Ground that climbs faster than this (rise over run) carries no trees. */
const STEEP = 1.3;
/** Wave trains: wavenumber along their run, and how fast their phase turns (see sea() in GLSL). */
const WAVES = /** @type {const} */ ([
  [0.85, 1.1],
  [1.9, 1.7],
  [0.3, 0.12],
]);
/** The second wave train runs this far off the wind, in radians. */
const CROSS_SEA = 0.5;

const UNIFORMS = /** @type {const} */ ([
  'uRes',
  'uShift',
  'uPos',
  'uHead',
  'uSun',
  'uT',
  'uYaw',
  'uPitch',
  'uDist',
  'uEnd',
  'uSpeed',
  'uLean',
  'uBoom',
  'uMode',
  'uLand',
  'uTop',
  'uExtent',
  'uMaxLand',
  'uCell',
  'uPort',
  'uFound',
  'uCave',
  'uCaveShape',
  'uCaveLamp',
  'uBrazier',
  'uVolcano',
  'uVolcanoR',
  'uWind',
  'uWindSpeed',
  'uWave',
  'uPennant',
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
 * Height of the ground at a point, bilinear between samples, as the shader's texture reads it.
 * @param {RenderTerrain} terrain @param {number} x @param {number} z
 */
function groundAt(terrain, x, z) {
  const { n, extent, heights } = terrain;
  const gx = Math.min(n - 1, Math.max(0, ((x + extent / 2) / extent) * n - 0.5));
  const gz = Math.min(n - 1, Math.max(0, ((z + extent / 2) / extent) * n - 0.5));
  const ix = Math.min(n - 2, Math.floor(gx));
  const iz = Math.min(n - 2, Math.floor(gz));
  const fx = gx - ix;
  const fz = gz - iz;
  const i = iz * n + ix;
  const near = heights[i] + (heights[i + 1] - heights[i]) * fx;
  const far = heights[i + n] + (heights[i + n + 1] - heights[i + n]) * fx;
  return near + (far - near) * fz;
}

/**
 * The highest the land can stand in each coarse cell, and in each group of coarse cells: the
 * march skips a cell whose top lies under the ray.
 * @param {RenderTerrain} terrain
 * @returns {{ size: number, tops: Float32Array, highest: number }} tops is size*size pairs
 */
function topsOf(terrain) {
  const { n, heights, forest } = terrain;
  const size = Math.ceil(n / BLOCK);
  const tops = new Float32Array(size * size * 2);
  for (let cz = 0; cz < size; cz++) {
    for (let cx = 0; cx < size; cx++) {
      // One sample more on every side: the texture blends neighbours.
      const x0 = Math.max(0, cx * BLOCK - 1);
      const x1 = Math.min(n - 1, cx * BLOCK + BLOCK);
      const z0 = Math.max(0, cz * BLOCK - 1);
      const z1 = Math.min(n - 1, cz * BLOCK + BLOCK);
      let top = -Infinity;
      let wooded = false;
      for (let iz = z0; iz <= z1; iz++) {
        for (let i = iz * n + x0; i <= iz * n + x1; i++) {
          if (heights[i] > top) top = heights[i];
          if (forest[i] > 0.05) wooded = true;
        }
      }
      if (top > 0.9) top += RELIEF + (wooded ? WOODS : 0);
      tops[(cz * size + cx) * 2] = top + 0.1;
    }
  }
  let highest = 0;
  for (let cz = 0; cz < size; cz++) {
    for (let cx = 0; cx < size; cx++) {
      let top = -Infinity;
      const gz = cz - (cz % GROUP);
      const gx = cx - (cx % GROUP);
      for (let z = gz; z < Math.min(size, gz + GROUP); z++) {
        for (let x = gx; x < Math.min(size, gx + GROUP); x++) {
          top = Math.max(top, tops[(z * size + x) * 2]);
        }
      }
      tops[(cz * size + cx) * 2 + 1] = top;
      highest = Math.max(highest, top);
    }
  }
  return { size, tops, highest };
}

/**
 * Where the cave's fittings go: how far along the tunnel the cliff begins, the lamp at the back
 * of the chamber, and a brazier on the shore either side of the mouth.
 * @param {RenderTerrain} terrain
 */
function caveFittings(terrain) {
  const { ax, az, bx, bz, radius, hall } = terrain.cave;
  const length = Math.hypot(bx - ax, bz - az) || 1;
  const ex = (bx - ax) / length;
  const ez = (bz - az) / length;
  let mouth = 0;
  while (mouth < length && groundAt(terrain, ax + ex * mouth, az + ez * mouth) < 3) mouth += 0.5;
  const braziers = [-1, 1].flatMap((side) => {
    const x = ax - ez * side * (radius + 2.6);
    const z = az + ex * side * (radius + 2.6);
    let s = 0;
    while (s < length && groundAt(terrain, x + ex * s, z + ez * s) < 0.7) s += 0.25;
    return [x + ex * s, Math.max(0.7, groundAt(terrain, x + ex * s, z + ez * s)) + 2.6, z + ez * s];
  });
  return {
    mouth,
    lamp: [bx + ex * (hall - 2), 4.2, bz + ez * (hall - 2)],
    braziers: new Float32Array(braziers),
  };
}

/**
 * Upload a two-channel float grid.
 * @param {WebGL2RenderingContext} gl
 * @param {number} unit texture unit
 * @param {number} size samples a side
 * @param {Float32Array} pairs size*size pairs
 * @param {number} filter gl.LINEAR or gl.NEAREST
 * @returns {WebGLTexture}
 */
function upload(gl, unit, size, pairs, filter) {
  const texture = gl.createTexture();
  if (!texture) throw new Error('no texture object');
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  while (gl.getError() !== gl.NO_ERROR && !gl.isContextLost()); // only this upload's errors count
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, size, size, 0, gl.RG, gl.FLOAT, pairs);
  const error = gl.getError();
  if (error !== gl.NO_ERROR && !gl.isContextLost()) {
    gl.deleteTexture(texture);
    throw new Error(`the terrain does not fit a texture (GL error ${error})`);
  }
  return texture;
}

/**
 * Compile the sea and upload the world. Throws when it cannot.
 * @param {WebGL2RenderingContext} gl
 * @param {RenderTerrain} terrain
 * @param {ReturnType<typeof topsOf>} top
 */
function launch(gl, terrain, top) {
  const sea = build(gl);
  const { n, heights, forest } = terrain;
  const step = terrain.extent / n;
  const pairs = new Float32Array(n * n * 2);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      // No trees on cliffs: the woods thin out where the ground is steep.
      const dx = heights[i + (ix < n - 1 ? 1 : 0)] - heights[i - (ix > 0 ? 1 : 0)];
      const dz = heights[i + (iz < n - 1 ? n : 0)] - heights[i - (iz > 0 ? n : 0)];
      const slope = Math.hypot(dx, dz) / (2 * step);
      pairs[i * 2] = heights[i];
      pairs[i * 2 + 1] = forest[i] * Math.min(1, Math.max(0, (STEEP - slope) / (STEEP * 0.4)));
    }
  }
  const land = upload(gl, 0, n, pairs, gl.LINEAR);
  const tops = upload(gl, 1, top.size, top.tops, gl.NEAREST);
  return { ...sea, land, tops };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {RenderTerrain} terrain the world; its height grid is uploaded once
 * @returns {Renderer | null} null when WebGL 2, the shaders or the terrain texture are unavailable
 */
export function createRenderer(canvas, terrain) {
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

  const top = topsOf(terrain);
  const fittings = caveFittings(terrain);
  const ports = new Float32Array(PORTS * 4);
  for (let i = 0; i < PORTS; i++) {
    const port = terrain.ports[i];
    ports.set(
      port ? [port.x, port.z, port.base, port.kind === 'cave' ? 1 : 0] : [0, 0, 0, -1],
      i * 4,
    );
  }

  /** @type {ReturnType<typeof launch> | null} */
  let sea;
  try {
    sea = launch(gl, terrain, top);
  } catch (error) {
    console.warn('The sea could not be drawn.', error);
    return null;
  }

  const found = new Float32Array(PORTS);
  /** Phases of the wave trains under the boat, so the swell stays put on the water as she moves. */
  const wave = new Float32Array(WAVES.length);
  /** @type {{ x: number, z: number } | null} */
  let last = null;
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
      sea = launch(gl, terrain, top);
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

  /**
   * Turn the wave trains' phases on by one frame: time passes, and the boat moves over them.
   * @param {Frame} frame
   * @param {readonly [number, number][]} runs the way each train runs, world x and z
   */
  function swell(frame, runs) {
    const { boat } = frame;
    let dx = last ? boat.x - last.x : 0;
    let dz = last ? boat.z - last.z : 0;
    if (Math.hypot(dx, dz) > 40) dx = dz = 0; // she was moved, not sailed
    last = { x: boat.x, z: boat.z };
    const dt = Math.min(Math.max(frame.dt, 0), HITCH);
    for (let i = 0; i < WAVES.length; i++) {
      const [number, rate] = WAVES[i];
      const phase = wave[i] + number * (dx * runs[i][0] + dz * runs[i][1]) - rate * dt;
      wave[i] = phase - Math.floor(phase / (2 * Math.PI)) * 2 * Math.PI;
    }
  }

  return {
    draw(frame) {
      if (!sea || gl.isContextLost()) return;
      adapt(frame.dt);
      resize();

      const { boat, camera, wind } = frame;
      const sin = Math.sin(boat.heading);
      const cos = Math.cos(boat.heading);
      // The wind blows towards (wx, wz); the second wave train runs a little off it.
      const wx = -Math.sin(wind.from);
      const wz = -Math.cos(wind.from);
      const cx = wx * Math.cos(CROSS_SEA) - wz * Math.sin(CROSS_SEA);
      const cz = wx * Math.sin(CROSS_SEA) + wz * Math.cos(CROSS_SEA);
      swell(frame, [
        [wx, wz],
        [cx, cz],
        [-wz, wx],
      ]);
      // The pennant streams with the wind she feels: the true wind less her own way.
      const ax = wx * wind.speed * 8 - sin * boat.speed;
      const az = wz * wind.speed * 8 - cos * boat.speed;
      const felt = Math.hypot(ax, az);
      const px = felt > 1e-3 ? (ax * cos - az * sin) / felt : 0;
      const pz = felt > 1e-3 ? (ax * sin + az * cos) / felt : -1;
      for (let i = 0; i < PORTS; i++) found[i] = frame.found[i] ? 1 : 0;

      const { at } = sea;
      const { cave, volcano } = terrain;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(sea.program);
      gl.bindVertexArray(sea.vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sea.land);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sea.tops);
      gl.uniform1i(at.uLand, 0);
      gl.uniform1i(at.uTop, 1);
      gl.uniform1f(at.uExtent, terrain.extent);
      gl.uniform1f(at.uMaxLand, top.highest);
      gl.uniform1f(at.uCell, (terrain.extent / terrain.n) * BLOCK);
      gl.uniform4fv(at.uPort, ports);
      gl.uniform1fv(at.uFound, found);
      gl.uniform4f(at.uCave, cave.ax, cave.az, cave.bx, cave.bz);
      gl.uniform4f(at.uCaveShape, cave.radius, cave.hall, cave.roof, fittings.mouth);
      gl.uniform3fv(at.uCaveLamp, fittings.lamp);
      gl.uniform3fv(at.uBrazier, fittings.braziers);
      gl.uniform4f(at.uVolcano, volcano.x, volcano.z, volcano.height, volcano.crater);
      gl.uniform1f(at.uVolcanoR, volcano.radius);
      gl.uniform2f(at.uRes, canvas.width, canvas.height);
      gl.uniform2f(at.uShift, frame.shift[0], frame.shift[1]);
      gl.uniform2f(at.uPos, boat.x, boat.z);
      gl.uniform2f(at.uHead, sin, cos);
      gl.uniform3fv(at.uSun, frame.sun);
      gl.uniform1f(at.uT, frame.time);
      gl.uniform1f(at.uYaw, camera.yaw);
      gl.uniform1f(at.uPitch, camera.pitch);
      gl.uniform1f(at.uDist, camera.distance);
      gl.uniform1f(at.uEnd, frame.end);
      gl.uniform1f(at.uSpeed, boat.speed);
      gl.uniform1f(at.uLean, boat.lean);
      gl.uniform1f(at.uBoom, boat.boom);
      gl.uniform1i(at.uMode, Math.max(0, VIEWS.indexOf(frame.view)));
      gl.uniform4f(at.uWind, wx, wz, cx, cz);
      gl.uniform1f(at.uWindSpeed, wind.speed);
      gl.uniform3fv(at.uWave, wave);
      gl.uniform2f(at.uPennant, px, pz);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (sea) {
        gl.deleteVertexArray(sea.vao);
        gl.deleteProgram(sea.program);
        gl.deleteTexture(sea.land);
        gl.deleteTexture(sea.tops);
        sea = null;
      }
    },
  };
}
