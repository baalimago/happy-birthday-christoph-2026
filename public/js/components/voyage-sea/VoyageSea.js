import { START } from '#game/chart-data.js';
import { bearingTo, damageFor, newBoat, sail, windAt } from '#game/sailing.js';
import { getTerrain, insideCave, isWater } from '#game/terrain.js';
import { takeHelm } from '#input/helm.js';
import { createRenderer } from '#render/renderer.js';
import { VIEWS } from '#render/views.js';
import { passage } from '#stores/passage.js';
import { voyage } from '#stores/voyage.js';

/**
 * @typedef {import('#game/terrain.js').Terrain} Terrain
 * @typedef {import('#stores/voyage.js').Berth} Berth
 * @typedef {{ id: string, x: number, z: number, arrive: number, leave: number, berth: Berth }} Mark
 *   a port as the loop sees it: within `arrive` of it the boat has found it, past `leave` it has
 *   left again; `berth` is clear water beside it, where a wreck is towed to
 */

/** Where the camera rests: off the quarter, so the sails show their faces. */
const REST_YAW = 2.75;
const REST_PITCH = 0.24;
const REST_DISTANCE = 8.6;
/** Under the rock the camera closes up and drops, to stay inside the cave. */
const CAVE_PITCH = 0.12;
const CAVE_DISTANCE = 4;
/** Low in the west-north-west. */
const SUN = /** @type {[number, number, number]} */ ([-0.86, 0.2, 0.47]);
/** Seconds between reports of the instruments, and between notes of where the boat lies. */
const LOG_EVERY = 0.1;
const MOOR_EVERY = 4;
/** Seconds a wreck or a repair stays on the notice line before lesser news may replace it. */
const HOLD = 5;
/** A lighthouse counts as found from this far off. */
const ARRIVE = 30;

/** @param {number} angle @returns {number} the same bearing, 0..2PI */
const compass = (angle) => ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

/**
 * Clear water near a point: the closest spot with nothing but water for a few boat lengths round.
 * @param {Terrain} terrain @param {number} x @param {number} z
 * @returns {Berth | null}
 */
function berthNear(terrain, x, z) {
  for (let r = 8; r < 120; r += 4) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const bx = x + Math.sin(a) * r;
      const bz = z + Math.cos(a) * r;
      let clear = true;
      for (let j = 0; j < 8 && clear; j++) {
        const b = (j / 8) * Math.PI * 2;
        clear =
          isWater(terrain, bx + Math.sin(b) * 9, bz + Math.cos(b) * 9) &&
          isWater(terrain, bx + Math.sin(b) * 4, bz + Math.cos(b) * 4);
      }
      // Lie with the bow to seaward.
      if (clear && isWater(terrain, bx, bz)) return { x: bx, z: bz, heading: a };
    }
  }
  return null;
}

/** @param {Terrain} terrain @returns {Mark[]} */
function marksOf(terrain) {
  const { cave } = terrain;
  return terrain.ports.map((port) => {
    if (port.kind === 'cave') {
      // Found on reaching the chamber; a wreck is towed back there, bow to the daylight.
      const out = Math.atan2(cave.ax - cave.bx, cave.az - cave.bz);
      return {
        id: port.id,
        x: port.x,
        z: port.z,
        arrive: cave.hall - 2,
        leave: cave.hall + 4,
        berth: { x: port.x, z: port.z, heading: out },
      };
    }
    const berth = berthNear(terrain, port.x, port.z) ?? { ...START };
    const reach = Math.hypot(berth.x - port.x, berth.z - port.z) + 8;
    const arrive = Math.max(ARRIVE, reach);
    return { id: port.id, x: port.x, z: port.z, arrive, leave: arrive + 8, berth };
  });
}

/**
 * The game loop. Reads the helm, sails the boat on the wind, reports to the stores and hands each
 * frame to the renderer. Without WebGL 2 it does nothing and the page stays a logbook.
 *
 * The boat heaves to (the clock stops) while a card or the chart is open.
 *
 * Reflects `live` while the sea is drawn, `data-view` for the current view, and `looking`
 * while the camera is being dragged.
 */
export class VoyageSea extends HTMLElement {
  /** @type {AbortController | undefined} */
  #abort;
  /** @type {HTMLCanvasElement | undefined} */
  #canvas;
  /** @type {import('#render/renderer.js').Renderer | null} */
  #renderer = null;
  /** @type {Terrain | undefined} */
  #terrain;
  /** @type {import('#input/helm.js').Helm} */
  #helm = { left: false, right: false, out: false, in: false, engine: false };
  /** @type {Mark[]} */
  #marks = [];
  #boat = newBoat(START);
  #raf = 0;
  #last = 0;
  /** The clock the pictures run on; it stops for visitors who asked for less motion. */
  #time = 0;
  /** The clock the wind runs on; it stops while the boat is hove to. */
  #watch = 0;
  #sinceLog = 0;
  #sinceMoor = 0;
  #hold = 0;
  #yaw = REST_YAW;
  #pitch = REST_PITCH;
  #distance = REST_DISTANCE;
  #shiftX = 0;
  #shiftY = -0.1;
  #end = 0;
  #still = false;

  get live() {
    return this.hasAttribute('live');
  }

  connectedCallback() {
    this.#abort = new AbortController();
    const { signal } = this.#abort;

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    // Ask for the context before charting the sea: without WebGL 2 there is no need to.
    if (!canvas.getContext('webgl2')) return;
    const terrain = getTerrain();
    this.#renderer = createRenderer(canvas, terrain);
    if (!this.#renderer) return;
    this.#terrain = terrain;
    this.#marks = marksOf(terrain);
    this.#boat = newBoat(this.#mooring());
    this.#canvas = canvas;
    this.prepend(canvas);
    this.tabIndex = -1;
    this.toggleAttribute('live', true);
    this.#reflectView();

    this.#helm = takeHelm(this, signal);
    this.#listenForLooking(canvas, signal);
    voyage.addEventListener('change', () => this.#onVoyage(), { signal });

    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.#still = motion.matches;
    motion.addEventListener('change', () => (this.#still = motion.matches), { signal });

    canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        this.#stop();
      },
      { signal },
    );
    canvas.addEventListener(
      'webglcontextrestored',
      () => {
        this.#renderer = createRenderer(canvas, terrain);
        this.#run();
      },
      { signal },
    );
    document.addEventListener(
      'visibilitychange',
      () => (document.hidden ? this.#stop() : this.#run()),
      { signal },
    );
    addEventListener('pagehide', () => this.#moor(), { signal });
    this.#run();
  }

  disconnectedCallback() {
    this.#abort?.abort();
    this.#stop();
    this.#renderer?.dispose();
    this.#renderer = null;
    this.#canvas?.remove();
    this.toggleAttribute('live', false);
    passage.arriveAt(null);
  }

  /** Where to pick the voyage up: where the boat was last seen, if that is still water. */
  #mooring() {
    const berth = voyage.state.berth;
    const terrain = this.#terrain;
    return berth && terrain && isWater(terrain, berth.x, berth.z) ? berth : START;
  }

  #moor() {
    const { x, z, heading } = this.#boat;
    if (this.live && voyage.state.sailed) voyage.moor({ x, z, heading });
  }

  #reflectView() {
    const view = VIEWS.find((id) => id === voyage.state.view) ?? VIEWS[0];
    if (this.getAttribute('data-view') !== view) this.setAttribute('data-view', view);
  }

  #onVoyage() {
    this.#reflectView();
    // A new voyage starts back in the harbour.
    const { sailed, found, berth } = voyage.state;
    if (!sailed && found.length === 0 && !berth) this.#boat = newBoat(START);
  }

  /**
   * Drag the sea to look around.
   * @param {HTMLCanvasElement} canvas
   * @param {AbortSignal} signal
   */
  #listenForLooking(canvas, signal) {
    /** @type {{ id: number, x: number, y: number } | null} */
    let drag = null;
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return;
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
        this.toggleAttribute('looking', true);
      },
      { signal },
    );
    canvas.addEventListener(
      'pointermove',
      (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        this.#yaw += (event.clientX - drag.x) * 0.006;
        this.#pitch = Math.min(1.2, Math.max(0.08, this.#pitch + (event.clientY - drag.y) * 0.004));
        drag.x = event.clientX;
        drag.y = event.clientY;
      },
      { signal },
    );
    const release = (/** @type {PointerEvent} */ event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      this.toggleAttribute('looking', false);
    };
    canvas.addEventListener('pointerup', release, { signal });
    canvas.addEventListener('pointercancel', release, { signal });
  }

  #run() {
    if (this.#raf || !this.live || !this.#renderer || document.hidden) return;
    this.#last = 0;
    this.#raf = requestAnimationFrame((now) => this.#frame(now));
  }

  #stop() {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#moor();
  }

  /** @param {number} now */
  #frame(now) {
    this.#raf = requestAnimationFrame((next) => this.#frame(next));
    const renderer = this.#renderer;
    const canvas = this.#canvas;
    const terrain = this.#terrain;
    if (!renderer || !canvas || !terrain) return;
    const dt = this.#last ? Math.min(0.05, (now - this.#last) / 1000) : 0;
    this.#last = now;
    if (!this.#still) this.#time += dt;

    const hoveTo = passage.state.reading || passage.state.chart;
    const wind = windAt(this.#watch);
    if (!hoveTo) {
      this.#watch += dt;
      this.#sail(dt, wind, terrain);
    }
    const boat = this.#boat;

    // Let the camera drift back to rest once the captain lets go of it, and close up in the cave.
    const under = insideCave(terrain.cave, boat.x, boat.z) > -3;
    if (!this.hasAttribute('looking')) {
      const ease = Math.min(1, dt * 0.8);
      this.#yaw +=
        Math.atan2(Math.sin(REST_YAW - this.#yaw), Math.cos(REST_YAW - this.#yaw)) * ease;
      this.#pitch += ((under ? CAVE_PITCH : REST_PITCH) - this.#pitch) * ease;
    } else if (under) {
      this.#pitch = Math.min(this.#pitch, 0.3);
    }
    this.#distance +=
      ((under ? CAVE_DISTANCE : REST_DISTANCE) - this.#distance) * Math.min(1, dt * 2);

    // Keep the boat clear of an open card: beside it on wide screens, above it on narrow ones.
    const wide = canvas.clientWidth >= 900;
    const reading = passage.state.reading;
    const wantX = reading && wide ? 0.22 : 0;
    const wantY = reading && !wide ? 0.16 : -0.1;
    const settle = Math.min(1, dt * 3);
    this.#shiftX += (wantX - this.#shiftX) * settle;
    this.#shiftY += (wantY - this.#shiftY) * settle;
    const found = this.#marks.map((mark) => voyage.state.found.includes(mark.id));
    const share = found.length ? found.filter(Boolean).length / found.length : 0;
    this.#end += (share - this.#end) * Math.min(1, dt * 0.6);

    renderer.draw({
      dt,
      time: this.#time,
      boat,
      found,
      view: /** @type {import('#render/renderer.js').Frame['view']} */ (
        this.getAttribute('data-view') ?? VIEWS[0]
      ),
      camera: { yaw: this.#yaw, pitch: this.#pitch, distance: this.#distance },
      shift: [this.#shiftX, this.#shiftY],
      end: this.#end,
      sun: SUN,
      wind,
    });
  }

  /**
   * One step under way: sail, take the knocks, and tell the stores.
   * @param {number} dt
   * @param {import('#game/sailing.js').Wind} wind
   * @param {Terrain} terrain
   */
  #sail(dt, wind, terrain) {
    const boat = this.#boat;
    const outcome = sail(boat, this.#helm, wind, dt, terrain);
    if (Math.abs(boat.speed) > 0.5) voyage.setSail();

    this.#hold = Math.max(0, this.#hold - dt);
    if (outcome.event === 'aground') {
      voyage.damage(damageFor(outcome.impact));
      if (voyage.state.hull <= 0) {
        this.#wreck();
        return;
      }
    }
    if (this.#hold === 0) passage.note(outcome.event);

    this.#arrive();

    this.#sinceMoor += dt;
    if (this.#sinceMoor >= MOOR_EVERY) {
      this.#sinceMoor = 0;
      this.#moor();
    }
    this.#sinceLog += dt;
    if (this.#sinceLog >= LOG_EVERY) {
      this.#sinceLog = 0;
      passage.report({
        heading: compass(boat.heading),
        speed: boat.speed,
        windFrom: compass(wind.from),
        windSpeed: wind.speed,
        relative: outcome.relative,
        sheet: boat.sheet,
        best: outcome.best,
        trim: outcome.trim,
        engine: this.#helm.engine,
      });
    }
  }

  /** Holed and sinking: towed back to the last port found (or the harbour) and patched up. */
  #wreck() {
    const last = voyage.state.found.at(-1);
    const berth = this.#marks.find((mark) => mark.id === last)?.berth ?? START;
    this.#boat = newBoat(berth);
    passage.arriveAt(null);
    passage.note('wrecked');
    this.#hold = HOLD;
    voyage.repair();
    voyage.moor(berth);
  }

  /** Tell the stores which port the boat lies at. Making port mends the hull. */
  #arrive() {
    const boat = this.#boat;
    const near = passage.state.near;
    /** @type {string | null} */
    let at = null;
    for (const mark of this.#marks) {
      const { distance } = bearingTo(boat, mark);
      if (distance < (mark.id === near ? mark.leave : mark.arrive)) at = mark.id;
    }
    if (at === near) return;
    if (at && voyage.state.hull < 1 && this.#hold === 0) {
      voyage.repair();
      passage.note('repaired');
      this.#hold = HOLD;
    }
    passage.arriveAt(at);
    if (at) voyage.discover(at);
  }
}
