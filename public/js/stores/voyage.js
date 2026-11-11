import { Store } from '#lib/store.js';

/**
 * @typedef {{ x: number, z: number, heading: number }} Berth
 *
 * @typedef {object} VoyageState
 * @property {readonly string[]} found port ids, in the order found
 * @property {string} view the view in use
 * @property {boolean} sailed the boat has left its mooring
 * @property {number} hull 1 sound .. 0 wrecked
 * @property {Berth | null} berth where the boat was last seen, to pick the voyage up again
 */

const KEY = 'philosophers-voyage:v2';

/** @returns {VoyageState} */
const fresh = () => ({ found: [], view: 'poster', sailed: false, hull: 1, berth: null });

/**
 * What the captain has done so far. Remembered between visits.
 * @extends {Store<VoyageState>}
 */
export class VoyageStore extends Store {
  constructor() {
    super(fresh());
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (saved && Array.isArray(saved.found) && typeof saved.view === 'string') {
        const berth = saved.berth;
        super.commit({
          found: saved.found.map(String),
          view: saved.view,
          sailed: Boolean(saved.sailed),
          hull: Number.isFinite(saved.hull) ? Math.min(1, Math.max(0, saved.hull)) : 1,
          berth:
            berth && [berth.x, berth.z, berth.heading].every(Number.isFinite)
              ? { x: berth.x, z: berth.z, heading: berth.heading }
              : null,
        });
      }
    } catch {
      // No storage, or nonsense in it: start a new voyage.
    }
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

  /** Knock this share off the hull. @param {number} amount */
  damage(amount) {
    if (amount > 0) this.commit({ ...this.state, hull: Math.max(0, this.state.hull - amount) });
  }

  /** Make the hull sound again, or bring it up to this share. @param {number} [hull] */
  repair(hull = 1) {
    if (this.state.hull < hull) this.commit({ ...this.state, hull });
  }

  /** Remember where the boat lies. @param {Berth} berth */
  moor(berth) {
    this.commit({ ...this.state, berth });
  }

  reset() {
    this.commit(fresh());
  }
}

export const voyage = new VoyageStore();
