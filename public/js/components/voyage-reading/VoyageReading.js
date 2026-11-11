import { READINGS } from '#game/readings.js';
import { voyage } from '#stores/voyage.js';

/**
 * Something to read on passage: one text for each leg of the voyage, in a panel the captain can
 * open while he sails. The boat keeps sailing while it is open. It offers the reading that suits
 * the first port not yet found, and lets him leaf through the others.
 *
 * Markup: `button[data-reading-toggle]`, and a `[data-reading-panel]` holding `[data-reading-title]`,
 * `[data-reading-by]`, `[data-reading-text]`, `[data-reading-note]`, `button[data-reading-step="-1|1"]`
 * and `button[data-reading-close]`. `R` opens and closes it.
 */
export class VoyageReading extends HTMLElement {
  /** @type {AbortController | undefined} */
  #connected;
  #index = 0;
  #found = -1;

  connectedCallback() {
    this.#connected = new AbortController();
    const { signal } = this.#connected;
    this.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('[data-reading-toggle]')) this.#open(!this.hasAttribute('open'));
        else if (target?.closest('[data-reading-close]')) this.#open(false);
        const step = target?.closest('[data-reading-step]');
        if (step) {
          this.#show(this.#index + Number(step.getAttribute('data-reading-step')));
        }
      },
      { signal },
    );
    addEventListener(
      'keydown',
      (event) => {
        if (event.key.toLowerCase() !== 'r' || event.ctrlKey || event.metaKey || event.altKey)
          return;
        if (event.target instanceof Element && event.target.closest('input, textarea, select'))
          return;
        if (!this.closest('voyage-sea')?.hasAttribute('live')) return;
        this.#open(!this.hasAttribute('open'));
      },
      { signal },
    );
    voyage.addEventListener('change', () => this.#follow(), { signal });
    this.#follow();
  }

  disconnectedCallback() {
    this.#connected?.abort();
  }

  /** @param {boolean} open */
  #open(open) {
    this.toggleAttribute('open', open);
    if (open) this.removeAttribute('fresh');
    this.querySelector('[data-reading-toggle]')?.setAttribute('aria-expanded', String(open));
    const panel = this.querySelector('[data-reading-panel]');
    if (panel instanceof HTMLElement) panel.hidden = !open;
  }

  /** Turn to the reading for the next port to find, when a port has been found since last time. */
  #follow() {
    const { found } = voyage.state;
    if (found.length === this.#found) return;
    this.#found = found.length;
    const next = READINGS.findIndex((reading) => reading.leg && !found.includes(reading.leg));
    const spare = READINGS.findIndex((reading) => !reading.leg);
    this.#show(next >= 0 ? next : Math.max(0, spare));
    // A new text is waiting: say so on the button, without opening anything.
    this.toggleAttribute('fresh', !this.hasAttribute('open'));
  }

  /** @param {number} index */
  #show(index) {
    this.#index = (index + READINGS.length) % READINGS.length;
    const reading = READINGS[this.#index];
    if (!reading) return;
    /** @param {string} name @param {string} text */
    const fill = (name, text) => {
      const element = this.querySelector(`[data-reading-${name}]`);
      if (element) element.textContent = text;
      if (element instanceof HTMLElement && name === 'note') element.hidden = text === '';
    };
    fill('title', reading.work);
    fill(
      'by',
      `${reading.author}, ${reading.year}${reading.translator ? `. Translated by ${reading.translator}` : ''}`,
    );
    fill('note', reading.note ?? '');
    fill('count', `${this.#index + 1} of ${READINGS.length}`);
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
    if (this.hasAttribute('open')) this.removeAttribute('fresh');
  }
}
