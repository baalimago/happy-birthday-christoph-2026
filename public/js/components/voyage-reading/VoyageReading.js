import { READINGS } from '#game/readings.js';
import { voyage } from '#stores/voyage.js';

/**
 * The ship's library. Every place found leaves one passage aboard, and the captain reads what he
 * has collected on the way to the next: the boat keeps sailing while the book is open. Passages
 * for places not yet found stay out of reach.
 *
 * Markup: `button[data-reading-toggle]`, and a `[data-reading-panel]` holding `[data-reading-title]`,
 * `[data-reading-by]`, `[data-reading-count]`, `[data-reading-text]`, `[data-reading-note]`,
 * `button[data-reading-step="-1|1"]` and `button[data-reading-close]`. The empty shelf is what the
 * markup says before anything is found. `L` opens and closes it; Space and the Page keys turn the
 * page. Any `[data-reading-open="<port>"]` in the document opens that port's passage.
 *
 * Reflects `open`, and `fresh` while a passage has come aboard that has not been opened yet.
 */
export class VoyageReading extends HTMLElement {
  /** @type {AbortController | undefined} */
  #connected;
  #index = 0;
  /** How many passages were aboard when last looked: -1 before the first look. */
  #aboard = -1;
  /** @type {Map<Element, Node[]>} what the title, the by-line, the count and the page said at first */
  #empty = new Map();

  connectedCallback() {
    this.#connected = new AbortController();
    const { signal } = this.#connected;
    if (this.#empty.size === 0) {
      for (const name of ['title', 'by', 'count', 'text', 'note']) {
        const element = this.querySelector(`[data-reading-${name}]`);
        if (element)
          this.#empty.set(
            element,
            [...element.childNodes].map((n) => n.cloneNode(true)),
          );
      }
    }
    this.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('[data-reading-toggle]')) this.#open(!this.hasAttribute('open'));
        else if (target?.closest('[data-reading-close]')) this.#open(false);
        const step = target?.closest('[data-reading-step]');
        if (step) this.#show(this.#index + Number(step.getAttribute('data-reading-step')));
      },
      { signal },
    );
    // A port's card offers its passage: open the book at it.
    document.addEventListener(
      'click',
      (event) => {
        const offer =
          event.target instanceof Element ? event.target.closest('[data-reading-open]') : null;
        if (!offer || this.contains(offer)) return;
        const at = this.#shelf().findIndex(
          (reading) => reading.leg === offer.getAttribute('data-reading-open'),
        );
        if (at < 0) return;
        this.#show(at);
        this.#open(true);
      },
      { signal },
    );
    addEventListener('keydown', (event) => this.#onKey(event), { signal });
    voyage.addEventListener('change', () => this.#follow(), { signal });
    this.#follow();
  }

  disconnectedCallback() {
    this.#connected?.abort();
  }

  /** The passages aboard, in the order their places were found. */
  #shelf() {
    return voyage.state.found.flatMap((port) => READINGS.filter((reading) => reading.leg === port));
  }

  /** @param {KeyboardEvent} event */
  #onKey(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
    if (!this.closest('voyage-sea')?.hasAttribute('live')) return;
    if (event.key.toLowerCase() === 'l') {
      this.#open(!this.hasAttribute('open'));
      return;
    }
    if (!this.hasAttribute('open')) return;
    // Space on a focused button is that button's own business.
    const onButton = event.target instanceof Element && event.target.closest('button, a') !== null;
    const down = event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey && !onButton);
    const up = event.key === 'PageUp' || (event.key === ' ' && event.shiftKey && !onButton);
    const text = this.querySelector('[data-reading-text]');
    if (!text || (!down && !up)) return;
    event.preventDefault();
    text.scrollBy({ top: (down ? 1 : -1) * text.clientHeight * 0.85, behavior: 'smooth' });
  }

  /** @param {boolean} open */
  #open(open) {
    this.toggleAttribute('open', open);
    if (open) this.removeAttribute('fresh');
    this.querySelector('[data-reading-toggle]')?.setAttribute('aria-expanded', String(open));
    const panel = this.querySelector('[data-reading-panel]');
    if (panel instanceof HTMLElement) panel.hidden = !open;
  }

  /** A place was found, or a new voyage began: turn to the newest passage aboard. */
  #follow() {
    const aboard = this.#shelf().length;
    if (aboard === this.#aboard) return;
    const gained = this.#aboard >= 0 && aboard > this.#aboard;
    this.#aboard = aboard;
    this.#show(aboard - 1);
    this.toggleAttribute('fresh', gained && !this.hasAttribute('open'));
  }

  /** Put back what the markup said before anything was found: a new voyage has begun. */
  #restoreEmpty() {
    for (const [element, nodes] of this.#empty) {
      element.replaceChildren(...nodes.map((node) => node.cloneNode(true)));
    }
    const note = this.querySelector('[data-reading-note]');
    if (note instanceof HTMLElement) note.hidden = true;
  }

  /** @param {number} index */
  #show(index) {
    const shelf = this.#shelf();
    for (const step of this.querySelectorAll('button[data-reading-step]')) {
      if (step instanceof HTMLButtonElement) step.disabled = shelf.length < 2;
    }
    if (shelf.length === 0) {
      this.#index = -1;
      this.#restoreEmpty();
      return;
    }
    this.#index = (index + shelf.length) % shelf.length;
    const reading = shelf[this.#index];
    if (!reading) return;
    /** @param {string} name @param {string} text */
    const fill = (name, text) => {
      const element = this.querySelector(`[data-reading-${name}]`);
      if (element) element.textContent = text;
      if (element instanceof HTMLElement && name === 'note') element.hidden = text === '';
    };
    const toFind = READINGS.length - shelf.length;
    fill('title', reading.work);
    fill(
      'by',
      `${reading.author}, ${reading.year}${reading.translator ? `. Translated by ${reading.translator}` : ''}`,
    );
    fill('note', reading.note ?? '');
    fill(
      'count',
      `passage ${this.#index + 1} of ${shelf.length} aboard, ${toFind === 0 ? 'the shelf is full' : `${toFind} still to find`}`,
    );
    const text = this.querySelector('[data-reading-text]');
    if (text) {
      text.replaceChildren(
        ...reading.text.map((paragraph) => {
          const p = document.createElement('p');
          p.textContent = paragraph;
          return p;
        }),
      );
      text.scrollTop = 0;
    }
  }
}
