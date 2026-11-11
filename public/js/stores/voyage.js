import { Store } from '#lib/store.js';

/** @typedef {{ found: readonly string[], view: string, sailed: boolean }} VoyageState */

const KEY = 'philosophers-voyage:v1';

/** What the captain has done so far: ports found, the view in use, whether the boat has moved. @extends {Store<VoyageState>}
 */
export class VoyageStore extends Store {
  constructor() {
    super(/** @type {VoyageState} */ ({ found: [], view: 'poster', sailed: false }));
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (saved && Array.isArray(saved.found) && typeof saved.view === 'string') {
        this.commit({
          found: saved.found.map(String),
          view: saved.view,
          sailed: Boolean(saved.sailed),
        });
      }
    } catch {
      // No storage, or nonsense in it: start a new voyage.
    }
  }

  /** @returns {VoyageState} */
  get state() {
    return /** @type {VoyageState} */ (super.state);
  }

  /** @param {VoyageState} next */
  commit(next) {
    super.commit(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // The voyage still works, it just is not remembered.
    }
  }

  /**
   * @param {string} port
   * @returns {boolean} true when the port is new
   */
  discover(port) {
    if (this.state.found.includes(port)) return false;
    this.commit({ ...this.state, found: [...this.state.found, port] });
    return true;
  }

  /** @param {string} view */
  look(view) {
    if (view !== this.state.view) this.commit({ ...this.state, view });
  }

  setSail() {
    if (!this.state.sailed) this.commit({ ...this.state, sailed: true });
  }

  reset() {
    this.commit({ found: [], view: 'poster', sailed: false });
  }
}

export const voyage = new VoyageStore();
