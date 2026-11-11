import { Store } from '#lib/store.js';

/**
 * @typedef {'fast' | 'fine'} Look fast is the low-poly sea of triangles, fine the ray-marched one
 *
 * @typedef {object} GraphicsState
 * @property {Look | null} wish what the captain asked for, remembered between visits; null
 *   leaves it to the machine
 * @property {number} asks how many times the captain has asked, so asking again for a look
 *   that was given up is still a change
 * @property {Look | null} using what is on screen now
 * @property {boolean} loading the look asked for is still being made ready
 * @property {boolean} choice this machine can draw either, so the switch is worth showing
 */

const KEY = 'philosophers-voyage:graphics';

/** @returns {Look | null} */
function remembered() {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'fast' || saved === 'fine' ? saved : null;
  } catch {
    return null;
  }
}

/**
 * How the sea is drawn. voyage-hud asks; voyage-sea answers with what it shows.
 * @extends {Store<GraphicsState>}
 */
export class GraphicsStore extends Store {
  constructor() {
    super({ wish: remembered(), asks: 0, using: null, loading: false, choice: false });
  }

  /** The captain wants this look. @param {Look} wish */
  ask(wish) {
    try {
      localStorage.setItem(KEY, wish);
    } catch {
      // Private browsing: the choice lasts the visit.
    }
    const loading = this.state.loading || wish !== this.state.using;
    this.commit({ ...this.state, wish, loading, asks: this.state.asks + 1 });
  }

  /**
   * What the renderer shows, and whether another look is on its way.
   * @param {Look} using
   * @param {boolean} loading
   * @param {boolean} choice
   */
  report(using, loading, choice) {
    const now = this.state;
    if (using === now.using && loading === now.loading && choice === now.choice) return;
    this.commit({ ...now, using, loading, choice });
  }
}

export const graphics = new GraphicsStore();
