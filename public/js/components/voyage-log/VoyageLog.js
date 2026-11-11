import { passage } from '#stores/passage.js';
import { voyage } from '#stores/voyage.js';

/**
 * The cards: intro, port rewards, finale. At sea (inside `voyage-sea[live]`) one card at a time
 * is open, marked `data-open`; ashore it does nothing and every card stays on the page.
 *
 * It never takes keyboard focus, so the arrow keys keep steering while a card is read.
 */
export class VoyageLog extends HTMLElement {
  /** @type {AbortController | undefined} */
  #connected;

  /** True while the sea is drawn. */
  #atSea = false;

  /** @type {string | null} the port the boat was at when the passage last changed */
  #near = null;

  /** The finale has had its turn. It gets another after a new voyage. */
  #finaleSeen = false;

  connectedCallback() {
    this.#connected = new AbortController();
    const { signal } = this.#connected;
    const sea = this.closest('voyage-sea');
    if (!sea) return;

    // The sea may upgrade after the log, or lose its WebGL context for good: follow `live`.
    const watch = new MutationObserver(() => this.#followSea());
    watch.observe(sea, { attributes: true, attributeFilter: ['live'] });
    signal.addEventListener('abort', () => watch.disconnect());

    this.addEventListener('click', (event) => this.#onClick(event), { signal });
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && this.#atSea) this.#close();
      },
      { signal },
    );
    passage.addEventListener('change', () => this.#onPassage(), { signal });
    voyage.addEventListener('change', () => this.#onVoyage(), { signal });
    this.#followSea();
  }

  disconnectedCallback() {
    this.#connected?.abort();
    this.#comeAshore();
  }

  #followSea() {
    const live = this.closest('voyage-sea')?.hasAttribute('live') ?? false;
    if (live === this.#atSea) return;
    if (!live) {
      this.#comeAshore();
      return;
    }
    this.#atSea = true;
    this.#near = passage.state.near;
    if (!voyage.state.sailed) this.#open('intro');
    else if (this.#near) this.#open(this.#near);
    else this.#offerFinale();
  }

  /** Back to a logbook: every card on the page, none of them open. */
  #comeAshore() {
    if (!this.#atSea) return;
    this.#atSea = false;
    this.#openCard()?.removeAttribute('data-open');
    this.#announce('');
    passage.read(false);
  }

  /** @param {Event} event */
  #onClick(event) {
    if (!this.#atSea || !(event.target instanceof Element)) return;
    if (event.target.closest('[data-reset]')) {
      voyage.reset();
      this.#close();
    } else if (event.target.closest('[data-close]')) {
      this.#close();
    }
  }

  #onPassage() {
    const { near } = passage.state;
    if (!this.#atSea || near === this.#near) return;
    this.#near = near;
    if (near) this.#open(near);
    else if (this.#openCard()?.hasAttribute('data-port')) this.#close();
  }

  #onVoyage() {
    if (!this.#atSea) return;
    if (!this.#allFound()) this.#finaleSeen = false;
    // The boat moved under the intro: the captain has worked it out.
    if (voyage.state.sailed && this.#openCard()?.dataset.card === 'intro') this.#close();
    // The sea reports a landfall to both stores in one go; wait for both before deciding.
    queueMicrotask(() => this.#offerFinale());
  }

  /** @returns {HTMLElement | null} */
  #openCard() {
    return this.querySelector('[data-card][data-open]');
  }

  #allFound() {
    const ports = [...this.querySelectorAll('[data-port]')];
    const { found } = voyage.state;
    return (
      ports.length > 0 &&
      ports.every((port) => found.includes(port.getAttribute('data-card') ?? ''))
    );
  }

  /** Open the finale once every port is found and no other card is being read. */
  #offerFinale() {
    if (!this.#atSea || this.#finaleSeen || this.#openCard() || !this.#allFound()) return;
    this.#finaleSeen = true;
    this.#open('finale');
  }

  /** @param {string} id the `data-card` of the card to open in place of any other */
  #open(id) {
    /** @type {HTMLElement | null} */
    const card = this.querySelector(`[data-card="${CSS.escape(id)}"]`);
    const previous = this.#openCard();
    if (!card || card === previous) return;
    if (previous) {
      this.#releaseFocus(previous);
      previous.removeAttribute('data-open');
      // A landfall that cut the finale short owes it another turn.
      if (previous.dataset.card === 'finale') this.#finaleSeen = false;
    }
    card.setAttribute('data-open', '');
    card.scrollTop = 0;
    this.#announce(this.#summary(card));
    passage.read(true);
    if (previous?.dataset.card === 'intro') voyage.setSail();
  }

  #close() {
    const card = this.#openCard();
    if (!card) return;
    this.#releaseFocus(card);
    card.removeAttribute('data-open');
    this.#announce('');
    passage.read(false);
    if (card.dataset.card === 'intro') voyage.setSail();
    this.#offerFinale();
  }

  /**
   * A card is about to hide. If focus is inside it, hand it to the sea, never to a hidden node.
   * @param {HTMLElement} card
   */
  #releaseFocus(card) {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !card.contains(active)) return;
    const sea = this.closest('voyage-sea');
    if (sea instanceof HTMLElement) {
      if (!sea.hasAttribute('tabindex')) sea.tabIndex = -1;
      sea.focus({ preventScroll: true });
    }
    if (card.contains(document.activeElement)) active.blur();
  }

  /**
   * What a screen reader hears when the card opens: its heading and its first line.
   * @param {HTMLElement} card
   */
  #summary(card) {
    const parts = [card.querySelector('h1, h2'), card.querySelector('blockquote p, .lede')];
    const text = parts
      .map((part) => part?.textContent?.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return `${text.join('. ')} Press Escape to put the card away.`;
  }

  /** @param {string} message */
  #announce(message) {
    const status = this.querySelector('[data-status]');
    if (status && status.textContent !== message) status.textContent = message;
  }
}
