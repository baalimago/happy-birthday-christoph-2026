import { Store } from '#lib/store.js';

/**
 * @typedef {'' | 'aground' | 'edge' | 'wrecked' | 'repaired' | 'luffing'} Notice
 *
 * @typedef {object} Log
 * @property {number} heading radians, 0 north, positive clockwise (east is PI / 2)
 * @property {number} speed world units a second; 1 unit a second reads as 1 knot
 * @property {number} windFrom compass bearing the wind blows from, radians
 * @property {number} windSpeed 0 calm .. 1 fresh breeze .. about 1.3 in a gust
 * @property {number} relative where the wind comes from, seen from the boat: 0 on the bow,
 *   positive over the starboard side, -PI..PI
 * @property {number} sheet how far the sails are let out, 0 hauled in .. 1 right out
 * @property {number} best the sheet setting that would drive the boat best now, 0..1
 * @property {number} trim how well the sails are set, 0 flapping .. 1 perfect
 * @property {boolean} engine the engine is running
 *
 * @typedef {object} PassageState
 * @property {string | null} near the port the boat lies at
 * @property {Notice} notice
 * @property {boolean} reading a card is open
 * @property {boolean} chart the map is open
 * @property {Log} log
 */

/** @returns {Log} */
const calm = () => ({
  heading: 0,
  speed: 0,
  windFrom: 0,
  windSpeed: 0,
  relative: 0,
  sheet: 0.5,
  best: 0.5,
  trim: 0,
  engine: false,
});

/**
 * The passage right now: nothing here is remembered between visits.
 * voyage-sea reports the boat; voyage-log says whether a card is being read;
 * voyage-chart says whether the map is open.
 * @extends {Store<PassageState>}
 */
export class PassageStore extends Store {
  constructor() {
    super({ near: null, notice: '', reading: false, chart: false, log: calm() });
  }

  /** The boat is at this port, or (null) at none. @param {string | null} port */
  arriveAt(port) {
    if (port !== this.state.near) this.commit({ ...this.state, near: port });
  }

  /** @param {Notice} notice */
  note(notice) {
    if (notice !== this.state.notice) this.commit({ ...this.state, notice });
  }

  /** The instruments, about ten times a second. @param {Log} log */
  report(log) {
    this.commit({ ...this.state, log });
  }

  /** A card is open (true) or all are closed (false). @param {boolean} reading */
  read(reading) {
    if (reading !== this.state.reading) this.commit({ ...this.state, reading });
  }

  /** Unroll the map (true) or put it away (false). @param {boolean} chart */
  unroll(chart) {
    if (chart !== this.state.chart) this.commit({ ...this.state, chart });
  }
}

export const passage = new PassageStore();
