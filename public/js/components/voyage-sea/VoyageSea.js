import {
  ARRIVE,
  LEAVE,
  PORT_HEIGHT,
  PORT_SPREAD,
  SCENERY,
  SUN,
  bearing,
  newBoat,
  sail,
} from '#game/world.js';
import { takeHelm } from '#input/helm.js';
import { createRenderer } from '#render/renderer.js';
import { VIEWS } from '#render/views.js';
import { passage } from '#stores/passage.js';
import { voyage } from '#stores/voyage.js';

/** @typedef {{ id: string, x: number, z: number, height: number, spread: number }} Port */

const AIM_EVERY = 0.1;
/** Where the camera rests: off the quarter, so the sails show their faces. */
const REST_YAW = 2.75;
const REST_PITCH = 0.24;

/**
 * The game loop. Reads the helm, sails the boat, reports to the stores and hands each frame to
 * the renderer. The ports are its `[data-port]` descendants. Without WebGL 2 it does nothing
 * and the page stays a logbook.
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
  /** @type {import('#input/helm.js').Helm} */
  #helm = { left: false, right: false, up: false, down: false };
  /** @type {Port[]} */
  #ports = [];
  #boat = newBoat();
  #raf = 0;
  #last = 0;
  #time = 0;
  #sinceAim = 0;
  #yaw = REST_YAW;
  #pitch = REST_PITCH;
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

    this.#ports = [...this.querySelectorAll('[data-port]')].map((element) => ({
      id: element.getAttribute('data-card') ?? '',
      x: Number(element.getAttribute('data-x')),
      z: Number(element.getAttribute('data-z')),
      height: PORT_HEIGHT,
      spread: PORT_SPREAD,
    }));

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    this.#renderer = createRenderer(canvas);
    if (!this.#renderer) return;
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
        this.#renderer = createRenderer(canvas);
        this.#run();
      },
      { signal },
    );
    document.addEventListener(
      'visibilitychange',
      () => (document.hidden ? this.#stop() : this.#run()),
      {
        signal,
      },
    );
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
    passage.aim(null);
  }

  #reflectView() {
    const view = VIEWS.find((id) => id === voyage.state.view) ?? VIEWS[0];
    if (this.getAttribute('data-view') !== view) this.setAttribute('data-view', view);
  }

  #onVoyage() {
    this.#reflectView();
    // A new voyage starts back at the mooring.
    if (!voyage.state.sailed && voyage.state.found.length === 0) this.#boat = newBoat();
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
  }

  /** @param {number} now */
  #frame(now) {
    this.#raf = requestAnimationFrame((next) => this.#frame(next));
    const renderer = this.#renderer;
    const canvas = this.#canvas;
    if (!renderer || !canvas) return;
    const dt = this.#last ? Math.min(0.05, (now - this.#last) / 1000) : 0;
    this.#last = now;
    if (!this.#still) this.#time += dt;

    const boat = this.#boat;
    const isles = [...this.#ports, ...SCENERY];
    const event = sail(boat, this.#helm, dt, isles);
    passage.note(event === 'aground' || event === 'edge' ? event : '');
    if (Math.abs(boat.speed) > 0.5) voyage.setSail();

    this.#report(dt);

    // Let the camera drift back to rest once the captain lets go of it.
    if (!this.hasAttribute('looking')) {
      const ease = Math.min(1, dt * 0.8);
      this.#yaw +=
        Math.atan2(Math.sin(REST_YAW - this.#yaw), Math.cos(REST_YAW - this.#yaw)) * ease;
      this.#pitch += (REST_PITCH - this.#pitch) * ease;
    }
    // Keep the boat clear of an open card: beside it on wide screens, above it on narrow ones.
    const wide = canvas.clientWidth >= 900;
    const reading = passage.state.reading;
    const wantX = reading && wide ? 0.22 : 0;
    const wantY = reading && !wide ? 0.16 : -0.1;
    const settle = Math.min(1, dt * 3);
    this.#shiftX += (wantX - this.#shiftX) * settle;
    this.#shiftY += (wantY - this.#shiftY) * settle;
    const found = this.#ports.map((port) => voyage.state.found.includes(port.id));
    const share = this.#ports.length ? found.filter(Boolean).length / this.#ports.length : 0;
    this.#end += (share - this.#end) * Math.min(1, dt * 0.6);

    renderer.draw({
      dt,
      time: this.#time,
      boat,
      isles,
      found,
      view: /** @type {import('#render/renderer.js').Frame['view']} */ (
        this.getAttribute('data-view') ?? VIEWS[0]
      ),
      yaw: this.#yaw,
      pitch: this.#pitch,
      shift: [this.#shiftX, this.#shiftY],
      end: this.#end,
      sun: [SUN[0], SUN[1], SUN[2]],
    });
  }

  /**
   * Tell the stores where the boat is: the port it lies at, and the nearest port still to find.
   * @param {number} dt
   */
  #report(dt) {
    const boat = this.#boat;
    const near = passage.state.near;
    /** @type {string | null} */
    let at = null;
    /** @type {import('#stores/passage.js').Target | null} */
    let target = null;
    for (const port of this.#ports) {
      const { distance, angle } = bearing(boat, port);
      if (distance < (port.id === near ? LEAVE : ARRIVE)) at = port.id;
      if (!voyage.state.found.includes(port.id) && (!target || distance < target.distance)) {
        target = { port: port.id, distance, angle };
      }
    }
    if (at !== near) {
      passage.arriveAt(at);
      if (at) voyage.discover(at);
    }
    this.#sinceAim += dt;
    if (this.#sinceAim >= AIM_EVERY || (target === null) !== (passage.state.target === null)) {
      this.#sinceAim = 0;
      if (target || passage.state.target) passage.aim(target);
    }
  }
}
