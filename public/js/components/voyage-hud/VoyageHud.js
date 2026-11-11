import { passage } from '#stores/passage.js';
import { voyage } from '#stores/voyage.js';
import { isDone, unlockedViews } from '#game/objectives.js';

/** How long a notice stays up after its cause has gone, in milliseconds. */
const NOTICE_LINGER = 4000;

/** Within this many radians of the bow the target is "dead ahead"; of the stern, "astern". */
const AHEAD = Math.PI / 12;
const ASTERN = (Math.PI * 5) / 6;

/**
 * @param {number} angle radians, any range
 * @returns {number} the same bearing between -PI and PI
 */
function wrap(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/**
 * @param {import('#stores/passage.js').Target | null} target
 * @returns {string} for example "Unknown port, 140 m, to starboard"
 */
function describe(target) {
  if (!target) return 'Every port found';
  const angle = wrap(target.angle);
  const off = Math.abs(angle);
  let side = angle > 0 ? 'to starboard' : 'to port';
  if (off <= AHEAD) side = 'dead ahead';
  else if (off >= ASTERN) side = 'astern';
  return `Unknown port, ${Math.round(target.distance) * 10} m, ${side}`;
}

/**
 * The HUD: captain's orders, compass, view switcher and notices.
 * Fills and toggles the markup it wraps; reads and writes only the two stores.
 */
export class VoyageHud extends HTMLElement {
  /** @type {AbortController | undefined} */
  #connected;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #lingering;

  /** The needle's last rotation as written, to skip style writes that change nothing. */
  #rotate = '';

  connectedCallback() {
    this.#connected = new AbortController();
    const { signal } = this.#connected;
    this.addEventListener('click', (event) => this.#choose(event), { signal });
    voyage.addEventListener('change', () => this.#renderVoyage(), { signal });
    passage.addEventListener('change', () => this.#renderPassage(), { signal });
    signal.addEventListener('abort', () => this.#stopLingering());
    this.#addDoneMarks();
    this.#renderVoyage();
    this.#renderPassage();
  }

  disconnectedCallback() {
    this.#connected?.abort();
  }

  connectedMoveCallback() {}

  /** One visually hidden "done: " per objective, so a tick is not the only sign. */
  #addDoneMarks() {
    for (const item of this.querySelectorAll('li[data-goal]')) {
      if (item.querySelector(':scope > [data-done-mark]')) continue;
      const mark = document.createElement('span');
      mark.dataset.doneMark = '';
      mark.hidden = true;
      mark.textContent = 'done: ';
      item.prepend(mark);
    }
  }

  /** @returns {Record<string, string>} the view each port unlocks, read from the port cards */
  #portViews() {
    /** @type {Record<string, string>} */
    const views = {};
    const ports = this.closest('voyage-sea')?.querySelectorAll('[data-port][data-view]') ?? [];
    for (const port of ports) {
      if (!(port instanceof HTMLElement)) continue;
      const { card, view } = port.dataset;
      if (card && view) views[card] = view;
    }
    return views;
  }

  /** @param {Event} event */
  #choose(event) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('button[data-view]');
    if (!(button instanceof HTMLButtonElement) || !this.contains(button)) return;
    if (button.dataset.view) voyage.look(button.dataset.view);
  }

  #renderVoyage() {
    const { found, view, sailed } = voyage.state;
    const unlocked = unlockedViews(found, this.#portViews());
    const progress = { found, views: unlocked.length, sailed };

    let current = true;
    for (const item of this.querySelectorAll('li[data-goal]')) {
      if (!(item instanceof HTMLElement)) continue;
      const done = isDone(item.dataset.goal ?? '', progress);
      item.toggleAttribute('data-done', done);
      const mark = item.querySelector(':scope > [data-done-mark]');
      if (mark instanceof HTMLElement) mark.hidden = !done;
      if (!done && current) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      if (!done) current = false;
    }

    for (const button of this.querySelectorAll('button[data-view]')) {
      if (!(button instanceof HTMLButtonElement)) continue;
      button.hidden = !unlocked.includes(button.dataset.view ?? '');
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    }
    const group = this.querySelector('.views');
    if (group instanceof HTMLElement) group.hidden = unlocked.length < 2;
  }

  #renderPassage() {
    const { target, near, notice } = passage.state;

    const needle = this.querySelector('.needle');
    if (needle instanceof HTMLElement) {
      needle.hidden = !target;
      const rotate = `${(target ? wrap(target.angle) : 0).toFixed(2)}rad`;
      if (rotate !== this.#rotate) needle.style.rotate = this.#rotate = rotate;
    }
    const compass = this.querySelector('[data-compass]');
    const bearing = describe(target);
    if (compass && compass.textContent !== bearing) compass.textContent = bearing;

    const status = this.querySelector('[data-notice]');
    if (!status) return;
    let message = '';
    if (notice === 'aground') message = 'Aground. Back off and steer round.';
    else if (notice === 'edge') message = 'Here be dragons. The wind turns you back.';
    else if (near) message = `Arrived at ${this.#portName(near)}`;

    if (message) {
      this.#stopLingering();
      if (status.textContent !== message) status.textContent = message;
    } else if (status.textContent && this.#lingering === undefined) {
      this.#lingering = setTimeout(() => {
        this.#lingering = undefined;
        status.textContent = '';
      }, NOTICE_LINGER);
    }
  }

  /**
   * @param {string} port
   * @returns {string} the heading of that port's card
   */
  #portName(port) {
    const heading = document.getElementById(`port-${port}`)?.querySelector('h2');
    return heading?.textContent?.replace(/\s+/g, ' ').trim() || 'port';
  }

  #stopLingering() {
    clearTimeout(this.#lingering);
    this.#lingering = undefined;
  }
}
