// What the sea should sound like right now, as numbers. Pure: no Web Audio, no DOM, no stores.
// soundscape.js turns these levels into gains and filter frequencies.

/**
 * @typedef {{
 *   heading?: number, speed?: number, windFrom?: number, windSpeed?: number, relative?: number,
 *   sheet?: number, best?: number, trim?: number, engine?: boolean, land?: number,
 *   gust?: number, sea?: number, cave?: boolean, rocket?: boolean, kraken?: number
 * }} Log
 *   the boat's log as voyage-sea writes it; `land` (0 open sea .. 1 on the beach), `gust` and `sea`
 *   (0..1), `cave` and `rocket` are optional
 * @typedef {{
 *   log?: Log | null, near?: string | null, notice?: string, reading?: boolean, chart?: boolean,
 *   sighting?: { kind: string, at: number } | null
 * }} Passage
 * @typedef {{ found?: readonly string[], hull?: number, sailed?: boolean }} Voyage
 * @typedef {{
 *   sea: number, seaTone: number, wash: number, washTone: number, wind: number, windTone: number,
 *   whistle: number, luff: number, engine: number, enginePitch: number, gulls: number, creak: number,
 *   duck: number, rocket: number, rocketTone: number, breeze: number, speed: number, land: number,
 *   cave: number, gust: number | null, seaState: number | null, energy: number, dark: number,
 *   kraken: number
 * }} Levels
 *   gains are 0..1 (soundscape.js scales them), tones and pitches in Hz. `breeze`, `speed`, `land`,
 *   `gust`, `seaState` feed weather.js (gust and seaState null when the game does not report them);
 *   `energy` and `dark` are the music's mood.
 * @typedef {'found' | 'arrive' | 'aground' | 'wrecked' | 'repaired' | 'edge' | 'anchor'
 *   | 'engineOn' | 'engineOff' | 'fill' | 'tack' | 'gybe' | 'winch' | 'goal' | 'finale' | 'ignite'} Cue
 *   `goal` and `finale` are not from the stores: soundscape.js hears them from the objective list
 */

/** @param {number} x */
const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** Top speed under sail, in units per second (the log contract: about 0..8; the rocket goes far past it). */
export const TOP_SPEED = 8;
/** windSpeed runs from a lull (0.35) to a squall (1.6); 1 is a fresh breeze. */
const WIND_MIN = 0.35;
const WIND_MAX = 1.6;

/** Hull strength as 0 (wrecked) .. 1 (sound), whether the store keeps 0..1 or 0..100. @param {number | undefined} hull */
export function hullShare(hull) {
  if (typeof hull !== 'number' || !Number.isFinite(hull)) return 1;
  return clamp01(hull > 1 ? hull / 100 : hull);
}

/**
 * @param {Passage} passage
 * @param {Voyage} [voyage]
 * @returns {Levels}
 */
export function mix(passage, voyage = {}) {
  const log = passage.log ?? null;
  const speed = clamp01((log?.speed ?? 0) / TOP_SPEED);
  const rocket = log?.rocket ? 1 : 0;
  // Before the first log there is a light breeze.
  const wind =
    log && typeof log.windSpeed === 'number'
      ? clamp01((log.windSpeed - WIND_MIN) / (WIND_MAX - WIND_MIN))
      : 0.35;
  const cave = log?.cave ? 1 : 0;
  const trim = log && typeof log.trim === 'number' ? clamp01(log.trim) : 1;
  const engine = log?.engine ? 1 : 0;
  const worn = 1 - hullShare(voyage.hull);
  const land = passage.near ? 1 : clamp01(log?.land ?? 0);
  // Under engine the sails are struck, so they do not flog.
  const luff = engine || rocket ? 0 : (1 - trim) * (0.35 + 0.65 * wind) * (log ? 1 : 0);
  const num = (/** @type {unknown} */ x) =>
    typeof x === 'number' && Number.isFinite(x) ? x : null;
  const gust = num(log?.gust);
  const seaState = num(log?.sea);

  return {
    // The bed is only the distant sea now; single waves (weather.js, waves.js) carry the rest.
    sea: (0.35 + 0.25 * wind) * (1 - 0.7 * cave),
    seaTone: 380 + 420 * wind,
    wash: speed,
    washTone: 600 + 2000 * speed,
    wind: (0.2 + 0.7 * wind) * (1 - 0.8 * cave),
    windTone: 320 + 700 * wind,
    whistle: wind * wind,
    luff,
    engine,
    enginePitch: 72 + 36 * speed,
    gulls: land,
    creak: clamp01(0.15 + 0.5 * speed + 0.25 * wind + 0.6 * worn),
    duck: passage.reading || passage.chart ? 0.3 : 1,
    rocket,
    rocketTone: 500 + 2500 * clamp01((log?.speed ?? 0) / 75),
    breeze: wind,
    speed,
    land,
    cave,
    gust: gust === null ? null : clamp01(gust),
    seaState: seaState === null ? null : clamp01(seaState),
    energy: rocket ? 1 : clamp01(0.15 + 0.5 * speed + 0.35 * wind),
    dark: Math.max(cave, clamp01((worn - 0.5) / 0.5), clamp01(log?.kraken ?? 0)),
    kraken: clamp01(log?.kraken ?? 0),
  };
}

/**
 * The one-shot cues that one store change calls for.
 * @param {{ passage: Passage, voyage: Voyage }} before
 * @param {{ passage: Passage, voyage: Voyage }} after
 * @returns {Cue[]}
 */
export function cues(before, after) {
  /** @type {Cue[]} */
  const out = [];
  const foundBefore = before.voyage.found?.length ?? 0;
  const foundAfter = after.voyage.found?.length ?? 0;
  if (foundAfter > foundBefore) out.push('found');

  const near = after.passage.near ?? null;
  if (near && near !== (before.passage.near ?? null) && after.voyage.found?.includes(near)) {
    // A port already in the log: a single soft bell. A new one gets 'found' instead.
    if (!out.includes('found')) out.push('arrive');
  }

  const notice = after.passage.notice ?? '';
  if (notice && notice !== (before.passage.notice ?? '')) {
    if (
      notice === 'aground' ||
      notice === 'wrecked' ||
      notice === 'repaired' ||
      notice === 'edge'
    ) {
      out.push(notice);
    }
  }
  if (before.voyage.sailed === false && after.voyage.sailed === true) out.push('anchor');

  out.push(...sailing(before.passage.log ?? null, after.passage.log ?? null));
  return out;
}

/** Sheet moved by at least this much: the winch clicks. */
const WINCH_STEP = 0.03;

/**
 * Cues from the boat's log: engine on and off, a sail filling, tacks, gybes, the winch.
 * @param {Log | null} a before
 * @param {Log | null} b after
 * @returns {Cue[]}
 */
function sailing(a, b) {
  /** @type {Cue[]} */
  const out = [];
  if (!a || !b) return out;
  if (!a.rocket && b.rocket) out.push('ignite');
  if (!a.engine && b.engine) out.push('engineOn');
  if (a.engine && !b.engine) out.push('engineOff');
  if (b.engine) return out; // sails struck: no canvas sounds
  const num = (/** @type {unknown} */ x) => typeof x === 'number' && Number.isFinite(x);
  if (num(a.trim) && num(b.trim) && Number(a.trim) < 0.5 && Number(b.trim) >= 0.75) {
    out.push('fill');
  }
  if (num(a.relative) && num(b.relative) && Number(a.relative) * Number(b.relative) < 0) {
    // The wind crossed the bow (near 0) or the stern (near ±π).
    out.push(
      Math.abs(Number(a.relative)) + Math.abs(Number(b.relative)) < Math.PI ? 'tack' : 'gybe',
    );
  }
  if (num(a.sheet) && num(b.sheet) && Math.abs(Number(b.sheet) - Number(a.sheet)) >= WINCH_STEP) {
    out.push('winch');
  }
  return out;
}
