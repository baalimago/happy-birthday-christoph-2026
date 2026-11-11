// WebGL 2 plumbing: one program, one full-screen triangle, the world as two textures (uploaded
// once) and a handful of uniforms per frame. Everything that looks like something is in shaders/.

import { VIEWS } from './views.js';
import { FRAGMENT, PORTS, VERTEX } from './shaders/index.js';
import { BEASTS, KINDS } from './shaders/creatures.js';
import { RUNS } from './shaders/scene.js';

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
 * @typedef {{ x: number, z: number, heading: number, speed: number, lean: number, boom: number, aloft?: number }} FrameBoat
 *   aloft is how high she flies over the still water (Syrus mode)
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
 * @property {{ from: number, speed: number, gust?: number, sea?: number }} wind the compass
 *   bearing it blows from and its strength (about 0.35 in a lull to 1.6 in a squall); gust, 0..1,
 *   a gust passing over the boat; sea, 0..1, the sea state from calm to a steep running sea
 *   (left out, it follows the wind's strength)
 * @property {number} [rocket] 1 while the rocket strapped to the stern burns; 0 or absent, there
 *   is no rocket
 * @property {readonly FrameBeast[]} [beasts] the sea's creatures near the boat
 * @property {FrameKraken | null} [kraken]
 */

/**
 * A creature: kind (see KINDS in shaders/creatures.js), centre, heading (as the boat's), pitch
 * (nose up positive), size, and anim (the phase of its fins, a gull's wing angle, or the age of a
 * splash or a spout, 0..1).
 * @typedef {{ kind: string, x: number, y: number, z: number, heading: number, pitch: number,
 *   size: number, anim: number }} FrameBeast
 * @typedef {{ x: number, z: number, heading: number, rise: number, reach: number }} FrameKraken
 */

/**
 * @typedef {object} Renderer
 * @property {() => 'pending' | 'ready' | 'failed'} ready how the shaders are coming along: they
 *   compile off the main thread where the browser can, and nothing is drawn until they are ready
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
/** The second wave train runs this far off the wind, in radians (TRAINS[1]). */
const CROSS_SEA = 0.5;
/**
 * Wave trains: wavenumber along the run, how fast the phase turns, and the way the train runs,
 * either `off` radians off the wind or a fixed compass heading `to` (the swell does not care
 * about the wind). The first three are uWave in GLSL (see sea()), the rest uPhase and uRun: the
 * swell, two more wind waves, and the four trains of ripples (see rippleSlope()).
 * @type {readonly { number: number, rate: number, off?: number, to?: number }[]}
 */
const TRAINS = [
  { number: 0.85, rate: 0.7, off: 0 },
  { number: 1.9, rate: 1.0, off: CROSS_SEA },
  { number: 0.3, rate: 0.12, off: Math.PI / 2 },
  { number: 0.21, rate: 0.42, to: 2.5 },
  { number: 1.31, rate: 0.8, off: -0.38 },
  { number: 3.4, rate: 1.1, off: 1.15 },
  { number: 2.7, rate: 0.9, off: 0.12 },
  { number: 4.6, rate: 1.1, off: -0.5 },
  { number: 7.9, rate: 1.3, off: 0.61 },
  { number: 13.1, rate: 1.5, off: -0.3 },
];
/** The weather drifts downwind this fast, in units a second, at a wind strength of one. */
const DRIFT = 1.2; // slow: at 6 the foam streaks raced over the water and looked like a fault
/** The wind's frame wraps round here, to keep its numbers small enough for the GPU. */
const LEE_WRAP = 8192;

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
  'uRocket',
  'uAloft',
  'uBeast',
  'uKraken',
  'uSea',
  'uGust',
  'uPhase',
  'uRun',
  'uLee',
]);

/** @typedef {Record<typeof UNIFORMS[number], WebGLUniformLocation | null>} Locations */

/**
 * @typedef {object} Sea the program and what it needs
 * @property {WebGLProgram} program
 * @property {WebGLShader[]} shaders kept until the link is known, for their logs
 * @property {WebGLVertexArrayObject | null} vao
 * @property {Locations | null} at the uniforms, once the program has linked
 * @property {boolean} failed
 */

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
  return shader;
}

/**
 * Start compiling and linking the sea. Nothing here asks how it went: asking would wait for the
 * driver, and the shaders are long. `settle` asks, once the driver says it has finished.
 * @param {WebGL2RenderingContext} gl
 * @returns {Sea}
 */
function build(gl) {
  const program = gl.createProgram();
  if (!program) throw new Error('no program object');
  const shaders = [
    compile(gl, gl.VERTEX_SHADER, VERTEX),
    compile(gl, gl.FRAGMENT_SHADER, FRAGMENT),
  ];
  for (const shader of shaders) gl.attachShader(program, shader);
  gl.linkProgram(program);
  gl.flush(); // hand the work to the driver now
  // The triangle comes from gl_VertexID, but a vertex array must still be bound.
  return { program, shaders, vao: gl.createVertexArray(), at: null, failed: false };
}

/**
 * See whether the sea has linked, without waiting where the browser can tell us
 * (KHR_parallel_shader_compile). Elsewhere the first call waits for the driver.
 * @param {WebGL2RenderingContext} gl
 * @param {Sea} sea
 * @returns {'pending' | 'ready' | 'failed'}
 */
function settle(gl, sea) {
  if (sea.failed) return 'failed';
  if (sea.at) return 'ready';
  if (gl.isContextLost()) return 'pending';
  const parallel = gl.getExtension('KHR_parallel_shader_compile');
  if (parallel && !gl.getProgramParameter(sea.program, parallel.COMPLETION_STATUS_KHR)) {
    return 'pending';
  }
  const linked = gl.getProgramParameter(sea.program, gl.LINK_STATUS);
  if (!linked && gl.isContextLost()) return 'pending';
  if (!linked) {
    const logs = [
      ...sea.shaders.map((shader) => gl.getShaderInfoLog(shader)),
      gl.getProgramInfoLog(sea.program),
    ];
    console.warn('The sea could not be drawn.', logs.filter(Boolean).join('\n'));
    sea.failed = true;
  } else {
    const { program } = sea;
    sea.at = /** @type {Locations} */ (
      Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]))
    );
  }
  for (const shader of sea.shaders) gl.deleteShader(shader);
  sea.shaders = [];
  return sea.failed ? 'failed' : 'ready';
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
 * Start compiling the sea and upload the world. Throws when it cannot.
 * @param {WebGL2RenderingContext} gl
 * @param {RenderTerrain} terrain
 * @param {ReturnType<typeof topsOf>} top
 */
function launch(gl, terrain, top) {
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
  // The shaders last: an upload asks the driver for errors, which waits for all it was given
  // before, and the compile is long.
  const sea = build(gl);
  return { ...sea, land, tops };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {RenderTerrain} terrain the world; its height grid is uploaded once
 * @returns {Renderer | null} null when WebGL 2 or the terrain texture are unavailable; shaders
 *   that do not compile show later, as `ready()` turning 'failed'
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
  const beasts = new Float32Array(BEASTS * 8);
  const kraken = new Float32Array(8);
  /** Phases of the wave trains under the boat, so the swell stays put on the water as she moves. */
  const wave = new Float32Array(RUNS + 3);
  /** The way each train runs, world x and z. */
  const runs = new Float32Array((RUNS + 3) * 2);
  /** Where the boat is in the wind's drifting frame: down the wind, across it. */
  const lee = [0, 0];
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
   * @param {number} wx the way the wind blows, world x
   * @param {number} wz and z
   */
  function swell(frame, wx, wz) {
    const { boat } = frame;
    let dx = last ? boat.x - last.x : 0;
    let dz = last ? boat.z - last.z : 0;
    if (Math.hypot(dx, dz) > 60) dx = dz = 0; // she was moved, not sailed
    last = { x: boat.x, z: boat.z };
    const dt = Math.min(Math.max(frame.dt, 0), HITCH);
    for (let i = 0; i < RUNS + 3; i++) {
      const { number, rate, off, to } = TRAINS[i];
      const cos = Math.cos(off ?? 0);
      const sin = Math.sin(off ?? 0);
      const rx = to === undefined ? wx * cos - wz * sin : Math.sin(to);
      const rz = to === undefined ? wx * sin + wz * cos : Math.cos(to);
      runs[i * 2] = rx;
      runs[i * 2 + 1] = rz;
      const phase = wave[i] + number * (dx * rx + dz * rz) - rate * dt;
      wave[i] = phase - Math.floor(phase / (2 * Math.PI)) * 2 * Math.PI;
    }
    // The wind's frame: she moves through it, and it drifts downwind.
    const along = lee[0] + dx * wx + dz * wz - DRIFT * frame.wind.speed * dt;
    const across = lee[1] - dx * wz + dz * wx;
    lee[0] = along - Math.floor(along / LEE_WRAP) * LEE_WRAP;
    lee[1] = across - Math.floor(across / LEE_WRAP) * LEE_WRAP;
  }

  return {
    ready() {
      return sea ? settle(gl, sea) : 'pending';
    },

    draw(frame) {
      if (!sea || gl.isContextLost() || settle(gl, sea) !== 'ready') return;
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
      swell(frame, wx, wz);
      // The pennant streams with the wind she feels: the true wind less her own way.
      const ax = wx * wind.speed * 8 - sin * boat.speed;
      const az = wz * wind.speed * 8 - cos * boat.speed;
      const felt = Math.hypot(ax, az);
      const px = felt > 1e-3 ? (ax * cos - az * sin) / felt : 0;
      const pz = felt > 1e-3 ? (ax * sin + az * cos) / felt : -1;
      for (let i = 0; i < PORTS; i++) found[i] = frame.found[i] ? 1 : 0;
      const herd = frame.beasts ?? [];
      for (let i = 0; i < BEASTS; i++) {
        const beast = herd[i];
        const kind = beast ? KINDS.indexOf(/** @type {any} */ (beast.kind)) : -1;
        if (beast && kind >= 0) {
          beasts.set([beast.x, beast.y, beast.z, beast.heading], i * 8);
          beasts.set([kind, beast.size, beast.pitch, beast.anim], i * 8 + 4);
        } else beasts.set([0, -100, 0, 0, -1, 1, 0, 0], i * 8);
      }
      const monster = frame.kraken;
      kraken.set(
        monster
          ? [monster.x, monster.z, monster.heading, monster.rise, monster.reach, 0, 0, 0]
          : [0, 0, 0, 0, 0, 0, 0, 0],
      );

      const { at } = sea;
      if (!at) return;
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
      const aloft = boat.aloft ?? 0;
      gl.uniform1f(at.uAloft, aloft);
      // In the air she leaves no wake.
      gl.uniform1f(at.uSpeed, aloft > 0.5 ? 0 : boat.speed);
      gl.uniform1f(at.uLean, boat.lean);
      gl.uniform1f(at.uBoom, boat.boom);
      gl.uniform1i(at.uMode, Math.max(0, VIEWS.indexOf(frame.view)));
      gl.uniform4f(at.uWind, wx, wz, cx, cz);
      gl.uniform1f(at.uWindSpeed, wind.speed);
      gl.uniform3fv(at.uWave, wave.subarray(0, 3));
      gl.uniform1fv(at.uPhase, wave.subarray(3));
      gl.uniform2fv(at.uRun, runs.subarray(6));
      gl.uniform2f(at.uLee, lee[0], lee[1]);
      gl.uniform1f(at.uGust, Math.min(1, Math.max(0, wind.gust ?? 0)));
      gl.uniform1f(
        at.uSea,
        Math.min(1, Math.max(0, wind.sea ?? ((wind.speed - 0.35) / 1.25) * 0.8)),
      );
      gl.uniform2f(at.uPennant, px, pz);
      gl.uniform1f(at.uRocket, frame.rocket ? 1 : 0);
      gl.uniform4fv(at.uBeast, beasts);
      gl.uniform4fv(at.uKraken, kraken);
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
