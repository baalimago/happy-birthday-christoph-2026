import { passage } from '#stores/passage.js';
import { voyage } from '#stores/voyage.js';
import { FEATURES } from '#game/chart-data.js';
import { getTerrain } from '#game/terrain.js';
import { drawChart, markChart } from './draw.js';

/** The chart is drawn on a square of this many CSS pixels, times the pixel ratio (2 at most). */
const DRAWN = 1200;
/** No canvas is made larger than this a side, whatever the screen. */
const LARGEST = 2400;
/** A chart narrower than this is too small to read: a small screen starts zoomed in. */
const LEGIBLE = 680;
/** Each press of a zoom button changes the size by this factor. */
const ZOOM = 1.5;

const FONTS = [
  'italic 20px "IM Fell English"',
  '20px "IM Fell English"',
  '20px "IM Fell English SC"',
];

/**
 * The map of the area: a button (and the M key) that unrolls a paper chart in a dialog.
 * The chart shows coasts, hills, woods, shoals and names, and no marks of any kind.
 * Tells the passage store when it is open, and follows the store when that changes elsewhere.
 */
export class VoyageChart extends HTMLElement {
  /** @type {AbortController | undefined} */
  #connected;

  /** Set once the chart has been asked for, so it is drawn only once. */
  #drawing = false;
  /** @type {HTMLCanvasElement | undefined} the chart itself, drawn once and kept */
  #base;

  /** How wide the chart is shown, in CSS pixels; 0 until it has been laid out. */
  #shown = 0;

  /** Where a drag with the mouse began. @type {{ x: number, y: number, left: number, top: number } | null} */
  #grip = null;

  connectedCallback() {
    this.#connected = new AbortController();
    const { signal } = this.#connected;
    const dialog = this.#dialog;
    const sheet = this.#sheet;

    this.addEventListener('click', (event) => this.#press(event), { signal });
    document.addEventListener('keydown', (event) => this.#key(event), { signal });
    dialog?.addEventListener('close', () => passage.unroll(false), { signal });
    passage.addEventListener('change', () => this.#follow(), { signal });
    // A place may be found while the chart is out: she sails on under it.
    voyage.addEventListener('change', () => this.#dialog?.open && this.#mark(), { signal });

    if (sheet) {
      const observer = new ResizeObserver(() => this.#layOut());
      observer.observe(sheet);
      signal.addEventListener('abort', () => observer.disconnect());
      sheet.addEventListener('pointerdown', (event) => this.#grab(event), { signal });
      sheet.addEventListener('pointermove', (event) => this.#drag(event), { signal });
      sheet.addEventListener('pointerup', () => this.#release(), { signal });
      sheet.addEventListener('pointercancel', () => this.#release(), { signal });
    }
    this.#follow();
  }

  disconnectedCallback() {
    this.#connected?.abort();
  }

  connectedMoveCallback() {}

  get #dialog() {
    const dialog = this.querySelector('dialog');
    return dialog instanceof HTMLDialogElement ? dialog : null;
  }

  get #sheet() {
    const sheet = this.querySelector('[data-chart-sheet]');
    return sheet instanceof HTMLElement ? sheet : null;
  }

  get #canvas() {
    const canvas = this.querySelector('canvas');
    return canvas instanceof HTMLCanvasElement ? canvas : null;
  }

  /** At sea, and not ashore reading the logbook. */
  get #live() {
    return this.closest('voyage-sea')?.hasAttribute('live') ?? true;
  }

  /** @param {Event} event */
  #press(event) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('button');
    if (!(button instanceof HTMLButtonElement) || !this.contains(button)) return;
    if (button.hasAttribute('data-chart-toggle')) this.#unroll(!this.#dialog?.open);
    else if (button.dataset.chartZoom === 'in') this.#zoom(ZOOM);
    else if (button.dataset.chartZoom === 'out') this.#zoom(1 / ZOOM);
  }

  /** M unrolls the chart and puts it away, unless the captain is typing. @param {KeyboardEvent} event */
  #key(event) {
    if (event.key !== 'm' && event.key !== 'M') return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.repeat || event.isComposing || event.defaultPrevented) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable || target.closest('input, textarea, select')) return;
    }
    if (!this.#live) return;
    event.preventDefault();
    this.#unroll(!this.#dialog?.open);
  }

  /** Opens or closes the dialog and tells the store. @param {boolean} open */
  #unroll(open) {
    const dialog = this.#dialog;
    if (!dialog || !dialog.isConnected) return;
    if (open && !dialog.open) {
      if (!this.#live) return;
      dialog.showModal();
      this.#draw();
      this.#layOut();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    passage.unroll(dialog.open);
    this.#mirror();
  }

  /** Someone else opened or closed the map in the store. */
  #follow() {
    const dialog = this.#dialog;
    if (dialog && dialog.open !== passage.state.chart) this.#unroll(passage.state.chart);
    this.#mirror();
  }

  /** The button says whether the chart is out. */
  #mirror() {
    const open = String(this.#dialog?.open ?? false);
    const button = this.querySelector('button[data-chart-toggle]');
    if (button && button.getAttribute('aria-expanded') !== open) {
      button.setAttribute('aria-expanded', open);
    }
  }

  /** Draws the chart once, after the dialog has had a frame to appear; after that, only the marks. */
  async #draw() {
    const canvas = this.#canvas;
    if (!canvas) return;
    if (this.#base) return this.#mark();
    if (this.#drawing) return;
    this.#drawing = true;
    const side = Math.min(LARGEST, Math.round(DRAWN * Math.min(2, Math.max(1, devicePixelRatio))));
    canvas.width = canvas.height = side;
    try {
      await Promise.all(FONTS.map((font) => document.fonts.load(font)));
    } catch {
      // The chart is drawn in the fallback serif.
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      const base = document.createElement('canvas');
      base.width = base.height = side;
      drawChart(base, getTerrain(), FEATURES);
      this.#base = base;
      this.#mark();
      this.toggleAttribute('data-drawn', true);
    } catch (error) {
      this.#drawing = false;
      console.error('voyage-chart', error);
    }
  }

  /** Lays the chart on the canvas with the places to find marked as they stand now. */
  #mark() {
    const canvas = this.#canvas;
    const base = this.#base;
    if (!canvas || !base) return;
    markChart(canvas, base, getTerrain(), voyage.state.found);
  }

  /** The size at which the whole chart fits in the sheet. */
  #fit() {
    const sheet = this.#sheet;
    return sheet ? Math.max(1, Math.min(sheet.clientWidth, sheet.clientHeight)) : 1;
  }

  /** Sizes the canvas for the sheet. The first time, a small screen starts over the home coast. */
  #layOut() {
    const sheet = this.#sheet;
    const canvas = this.#canvas;
    if (!sheet || !canvas || !this.#dialog?.open || sheet.clientWidth === 0) return;
    const fit = this.#fit();
    const first = this.#shown === 0;
    const size = first ? Math.max(fit, Math.min(LEGIBLE, DRAWN)) : Math.max(fit, this.#shown);
    this.#resize(size);
    if (first) {
      sheet.scrollLeft = (sheet.scrollWidth - sheet.clientWidth) / 2;
      sheet.scrollTop = sheet.scrollHeight - sheet.clientHeight;
    }
  }

  /** @param {number} size CSS pixels a side */
  #resize(size) {
    const canvas = this.#canvas;
    if (!canvas) return;
    const fit = this.#fit();
    this.#shown = Math.round(Math.min(DRAWN * ZOOM, Math.max(fit, size)));
    const px = `${this.#shown}px`;
    if (canvas.style.inlineSize !== px) canvas.style.inlineSize = canvas.style.blockSize = px;
    for (const button of this.querySelectorAll('button[data-chart-zoom]')) {
      if (!(button instanceof HTMLButtonElement)) continue;
      const spent =
        button.dataset.chartZoom === 'in' ? this.#shown >= DRAWN * ZOOM : this.#shown <= fit;
      button.setAttribute('aria-disabled', String(spent));
    }
  }

  /** Zooms about the middle of what is in view. @param {number} factor */
  #zoom(factor) {
    const sheet = this.#sheet;
    if (!sheet || this.#shown === 0) return;
    const before = this.#shown;
    const cx = (sheet.scrollLeft + sheet.clientWidth / 2) / before;
    const cy = (sheet.scrollTop + sheet.clientHeight / 2) / before;
    this.#resize(before * factor);
    sheet.scrollLeft = cx * this.#shown - sheet.clientWidth / 2;
    sheet.scrollTop = cy * this.#shown - sheet.clientHeight / 2;
  }

  /** A mouse drags the chart about; a finger scrolls it without help. @param {PointerEvent} event */
  #grab(event) {
    const sheet = this.#sheet;
    if (!sheet || event.pointerType !== 'mouse' || event.button !== 0) return;
    this.#grip = {
      x: event.clientX,
      y: event.clientY,
      left: sheet.scrollLeft,
      top: sheet.scrollTop,
    };
    sheet.setPointerCapture(event.pointerId);
    sheet.toggleAttribute('data-dragging', true);
  }

  /** @param {PointerEvent} event */
  #drag(event) {
    const sheet = this.#sheet;
    if (!sheet || !this.#grip) return;
    sheet.scrollLeft = this.#grip.left - (event.clientX - this.#grip.x);
    sheet.scrollTop = this.#grip.top - (event.clientY - this.#grip.y);
  }

  #release() {
    this.#grip = null;
    this.#sheet?.toggleAttribute('data-dragging', false);
  }
}
