import { START } from '#game/chart-data.js';
import { createFauna } from '#game/fauna.js';
import { bearingTo, damageFor, newBoat, sail, windAt } from '#game/sailing.js';
import { getTerrain, heightAt, insideCave, isWater } from '#game/terrain.js';
import { takeHelm } from '#input/helm.js';
import { createAutoRenderer } from '#render/auto.js';
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
/** While the kraken hunts, the camera stands off on the bow, wide, to show the boat and it. */
const KRAKEN_DISTANCE = 17;
const KRAKEN_PITCH = 0.3;

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
 * Reflects `loading` (`chart`, then `rig`) until the first frame is drawn, `live` while the sea is drawn, `data-view` for the current view, and `looking`
 * while the camera is being dragged.
 */
export class VoyageSea extends HTMLElement {
  /** @type {AbortController | undefined} */
  #abort;
  /** @type {HTMLCanvasElement[]} */
  #canvases = [];
  /** @type {import('#render/renderer.js').Renderer | null} */
  #renderer = null;
  /** @type {Terrain | undefined} */
  #terrain;
  /** @type {import('#input/helm.js').Helm} */
  #helm = { left: false, right: false, out: false, in: false, engine: false, rocket: false };
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
  #charting = false;
  #hold = 0;
  #yaw = REST_YAW;
  #pitch = REST_PITCH;
  #distance = REST_DISTANCE;
  #shiftX = 0;
  #shiftY = -0.1;
  #end = 0;
  #still = false;
  #fauna = createFauna((Math.random() * 2 ** 31) | 0);
  #menace = 0;

  get live() {
    return this.hasAttribute('live');
  }

  connectedCallback() {
    this.#abort = new AbortController();
    const { signal } = this.#abort;

    // Two canvases, one per renderer (see render/auto.js); only one of them shows.
    const canvas = document.createElement('canvas');
    const fine = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    fine.setAttribute('aria-hidden', 'true');
    // Ask for the context before charting the sea: without WebGL 2 there is no need to.
    // (On a canvas of its own: the first request fixes a context's settings.)
    if (!document.createElement('canvas').getContext('webgl2')) return;
    // Charting the sea and compiling its shaders take a moment: say so first, and let that paint.
    this.setAttribute('loading', 'chart');
    Promise.race([
      new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve))),
      new Promise((resolve) => setTimeout(resolve, 250)),
    ]).then(() => {
      if (!signal.aborted) this.#embark(canvas, fine, signal);
    });
  }

  /**
   * Chart the sea, start the shaders compiling and take the helm.
   * @param {HTMLCanvasElement} canvas the fast renderer's
   * @param {HTMLCanvasElement} fine the fine renderer's
   * @param {AbortSignal} signal
   */
  #embark(canvas, fine, signal) {
    const terrain = getTerrain();
    // `?fine` and `?fast` in the address insist on one renderer; otherwise the machine decides.
    const asked = new URLSearchParams(location.search);
    const mode = asked.has('fine') ? 'fine' : asked.has('fast') ? 'fast' : 'auto';
    this.#renderer = createAutoRenderer(canvas, fine, terrain, mode);
    if (!this.#renderer) {
      this.removeAttribute('loading');
      return;
    }
    this.setAttribute('loading', 'rig');
    this.#terrain = terrain;
    this.#marks = marksOf(terrain);
    this.#boat = newBoat(this.#mooring());
    this.#canvases = [canvas, fine];
    this.prepend(canvas, fine);
    this.tabIndex = -1;
    this.toggleAttribute('live', true);
    this.#reflectView();

    this.#helm = takeHelm(this, signal);
    this.#listenForLooking(canvas, signal);
    this.#listenForLooking(fine, signal);
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
        this.#run(); // the renderer has rebuilt itself
      },
      { signal },
    );
    document.addEventListener(
      'visibilitychange',
      () => (document.hidden ? this.#stop() : this.#run()),
      { signal },
    );
    addEventListener('pagehide', () => this.#moor(), { signal });
    // ?kraken raises it a few seconds into the passage, to see it without waiting an hour.
    if (new URLSearchParams(location.search).has('kraken')) {
      setTimeout(() => {
        const water = (/** @type {number} */ x, /** @type {number} */ z) => isWater(terrain, x, z);
        if (this.#fauna.summonKraken(this.#boat, water)) passage.sight('kraken-rise');
      }, 6000);
    }
    this.#run();
  }

  disconnectedCallback() {
    this.#abort?.abort();
    this.#stop();
    this.#renderer?.dispose();
    this.#renderer = null;
    for (const canvas of this.#canvases) canvas.remove();
    this.toggleAttribute('live', false);
    this.removeAttribute('loading');
    passage.arriveAt(null);
  }

  /** The shaders did not compile: back to the page as it reads without a sea. */
  #ashore() {
    this.#stop();
    this.#renderer?.dispose();
    this.#renderer = null;
    for (const canvas of this.#canvases) canvas.remove();
    this.toggleAttribute('live', false);
    this.removeAttribute('loading');
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
    const terrain = this.#terrain;
    if (!renderer || !terrain) return;
    // Nothing moves until there is a sea to see.
    const ready = renderer.ready();
    if (ready === 'failed') this.#ashore();
    if (ready !== 'ready') {
      this.#last = 0;
      return;
    }
    const dt = this.#last ? Math.min(0.05, (now - this.#last) / 1000) : 0;
    this.#last = now;
    if (!this.#still) this.#time += dt;

    const hoveTo = passage.state.reading || passage.state.chart;
    // The chart shows where she lies: tell the log as the map is unrolled.
    if (passage.state.chart && !this.#charting) this.#moor();
    this.#charting = passage.state.chart;
    const wind = windAt(this.#watch, this.#boat.x, this.#boat.z);
    // Hove to, the clock stops but the instruments still read.
    const step = hoveTo ? 0 : dt;
    this.#watch += step;
    this.#sail(step, wind, terrain, dt);
    this.#live(step, terrain);
    const boat = this.#boat;

    // Let the camera drift back to rest once the captain lets go of it, and close up in the cave.
    const under = insideCave(terrain.cave, boat.x, boat.z) > -3;
    // With the kraken up, the camera swings out ahead and to one side, looking back past the
    // boat at it.
    const monster = this.#fauna.kraken;
    const fear = this.#menace > 0.05 && monster ? 1 : 0;
    let restYaw = REST_YAW;
    if (fear && monster) {
      const ex = monster.x - boat.x;
      const ez = monster.z - boat.z;
      const sin = Math.sin(boat.heading);
      const cos = Math.cos(boat.heading);
      const bearing = Math.atan2(ex * cos - ez * sin, ex * sin + ez * cos);
      restYaw = bearing + Math.PI - 1.05;
    }
    if (!this.hasAttribute('looking')) {
      const ease = Math.min(1, dt * (fear ? 1.2 : 0.8));
      this.#yaw += Math.atan2(Math.sin(restYaw - this.#yaw), Math.cos(restYaw - this.#yaw)) * ease;
      const pitch = under ? CAVE_PITCH : fear ? KRAKEN_PITCH : REST_PITCH;
      this.#pitch += (pitch - this.#pitch) * ease;
    } else if (under) {
      this.#pitch = Math.min(this.#pitch, 0.3);
    }
    const distance = under ? CAVE_DISTANCE : fear ? KRAKEN_DISTANCE : REST_DISTANCE;
    this.#distance += (distance - this.#distance) * Math.min(1, dt * (fear ? 0.7 : 2));

    // Keep the boat clear of an open card: beside it on wide screens, above it on narrow ones.
    const wide = innerWidth >= 900;
    const reading = passage.state.reading;
    const wantX = reading && wide ? 0.22 : 0;
    const wantY = reading && !wide ? 0.16 : -0.1;
    const settle = Math.min(1, dt * 3);
    this.#shiftX += (wantX - this.#shiftX) * settle;
    this.#shiftY += (wantY - this.#shiftY) * settle;
    const found = this.#marks.map((mark) => voyage.state.found.includes(mark.id));
    const share = found.length ? found.filter(Boolean).length / found.length : 0;
    this.#end += (share - this.#end) * Math.min(1, dt * 0.6);

    // Built apart from the call: the frame may carry more than a renderer of the day reads.
    const frame = {
      dt,
      time: this.#time,
      boat,
      found,
      view: /** @type {import('#render/renderer.js').Frame['view']} */ (
        this.getAttribute('data-view') ?? VIEWS[0]
      ),
      camera: { yaw: this.#yaw, pitch: this.#pitch, distance: this.#distance },
      shift: /** @type {[number, number]} */ ([this.#shiftX, this.#shiftY]),
      end: this.#end,
      sun: SUN,
      wind,
      rocket: this.#helm.rocket ? 1 : 0,
      beasts: this.#fauna.beasts,
      kraken: this.#fauna.kraken,
    };
    renderer.draw(frame);
    if (this.hasAttribute('loading')) this.removeAttribute('loading');
  }

  /**
   * One step under way: sail, take the knocks, and tell the stores.
   * @param {number} dt
   * @param {import('#game/sailing.js').Wind} wind
   * @param {Terrain} terrain
   * @param {number} real seconds of real time, which the instruments keep even when hove to
   */
  #sail(dt, wind, terrain, real) {
    const boat = this.#boat;
    // Under the rocket the boat covers boat lengths in a frame: take the step in slices, so that
    // no rock slips between two looks ahead.
    const slices = this.#helm.rocket || boat.speed > 12 ? 8 : 1;
    let outcome = sail(boat, this.#helm, wind, dt / slices, terrain);
    for (let i = 1; i < slices && !outcome.event; i++) {
      outcome = sail(boat, this.#helm, wind, dt / slices, terrain);
    }
    if (Math.abs(boat.speed) > 0.5) voyage.setSail();

    this.#hold = Math.max(0, this.#hold - dt);
    if (outcome.event === 'aground') {
      // A rocket-speed strike is a joke, not a death sentence: it costs what a hard grounding costs.
      voyage.damage(damageFor(Math.min(outcome.impact, 6)));
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
    this.#sinceLog += real;
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
        rocket: this.#helm.rocket,
        gust: wind.gust,
        sea: wind.sea,
        // Shoaling water means land is near: the sea floor runs down to -5 about 40 units out.
        land: Math.min(1, Math.max(0, (heightAt(terrain, boat.x, boat.z) + 5) / 5)),
        cave: insideCave(terrain.cave, boat.x, boat.z) > 0,
        kraken: this.#menace,
      });
    }
  }

  /**
   * The sea's life for one step: creatures come and go, sightings go to the passage store, and a
   * kraken that catches the boat stoves in some of her hull.
   * @param {number} dt @param {Terrain} terrain
   */
  #live(dt, terrain) {
    const water = (/** @type {number} */ x, /** @type {number} */ z) => isWater(terrain, x, z);
    const { sightings, strike } = this.#fauna.step(this.#boat, dt, water);
    for (const kind of sightings) passage.sight(kind);
    this.#menace = this.#fauna.menace(this.#boat);
    if (strike > 0) {
      voyage.damage(strike);
      if (voyage.state.hull <= 0) this.#wreck();
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
