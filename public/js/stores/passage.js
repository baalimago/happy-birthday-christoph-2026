import { Store } from '#lib/store.js';

/**
 * @typedef {{ port: string, distance: number, angle: number }} Target
 *   the nearest port still to be found: its id, how far, and its bearing in radians
 *   (0 dead ahead, positive to starboard)
 * @typedef {'' | 'aground' | 'edge'} Notice
 * @typedef {{ near: string | null, target: Target | null, notice: Notice, reading: boolean }} PassageState
 */

/**
 * The passage right now: nothing here is remembered between visits.
 * voyage-sea reports where the boat is; voyage-log says whether a card is being read.
 @extends {Store<PassageState>}
 */
export class PassageStore extends Store {
  constructor() {
    super(/** @type {PassageState} */ ({ near: null, target: null, notice: '', reading: false }));
  }

  /** @returns {PassageState} */
  get state() {
    return /** @type {PassageState} */ (super.state);
  }

  /** The boat is at this port, or (null) at none. @param {string | null} port */
  arriveAt(port) {
    if (port !== this.state.near) this.commit({ ...this.state, near: port });
  }

  /** @param {Target | null} target */
  aim(target) {
    this.commit({ ...this.state, target });
  }

  /** @param {Notice} notice */
  note(notice) {
    if (notice !== this.state.notice) this.commit({ ...this.state, notice });
  }

  /** A card is open (true) or all are closed (false). @param {boolean} reading */
  read(reading) {
    if (reading !== this.state.reading) this.commit({ ...this.state, reading });
  }
}

export const passage = new PassageStore();
