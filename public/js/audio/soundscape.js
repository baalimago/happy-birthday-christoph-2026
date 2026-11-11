// The sound of the voyage: sea, wind, canvas, engine, gulls, and a few cues. All synthesised.
//
// Contract (docs/ARCHITECTURE.md, "Soundscape"):
// - `startSoundscape(signal)` is the one entry; main.js calls it once. Aborting the signal stops
//   everything and lets the audio hardware go.
// - It listens only to the stores (`passage`, `voyage`), never to other elements.
// - Nothing plays before a user gesture (a pointer or key press anywhere). Browsers require it.
// - Every `[data-sound]` button in the document toggles the sound, and so does the Q key (for quiet; M is the chart). The choice
//   is remembered. Buttons are shown (`hidden` removed) and kept in step with `aria-pressed`
//   (true = sound on).
// - A missing or refused AudioContext only means silence; nothing here throws.

import { passage as passageStore } from '#stores/passage.js';
import { voyage as voyageStore } from '#stores/voyage.js';
import { cues, mix } from './mix.js';
import { beds, brownNoise, creak, gull, play, whiteNoise } from './voices.js';

const KEY = 'philosophers-voyage:sound';

/** How loud each bed is at level 1, before the master. */
const BED_GAIN = { sea: 0.6, wash: 0.25, wind: 0.22, whistle: 0.05, luff: 0.22, engine: 0.28 };
const MASTER = 1;
/** Seconds a level takes to settle (time constant): smooth, never zippered. */
const GLIDE = 0.35;

/**
 * @typedef {EventTarget & { state: object }} StoreLike
 * @typedef {{
 *   readonly muted: boolean,
 *   setMuted(muted: boolean): void,
 *   toggle(): void,
 *   tick(): void,
 *   readonly context: BaseAudioContext | null,
 * }} Soundscape
 */

/**
 * @param {AbortSignal} signal
 * @param {{
 *   passage?: StoreLike, voyage?: StoreLike, root?: Document,
 *   context?: AudioContext | OfflineAudioContext,
 * }} [opts] stores, document and context to use instead of the real ones (tests, previews)
 * @returns {Soundscape}
 */
export function startSoundscape(signal, opts = {}) {
  const passage = opts.passage ?? passageStore;
  const voyage = opts.voyage ?? voyageStore;
  const root = opts.root ?? document;
  const given = opts.context ?? null;
  const offline = typeof OfflineAudioContext === 'function' && given instanceof OfflineAudioContext;

  let muted = readMuted();
  /** @type {Graph | null} */
  let graph = null;
  let heard = false; // a gesture has happened (or a context was handed in)
  let interval = 0;
  let snapshot = take();
  let foundAt = -Infinity;
  let nextGull = 0;
  let nextCreak = 0;

  const on = { signal };

  function take() {
    return {
      passage: /** @type {import('./mix.js').Passage} */ (passage.state),
      voyage: /** @type {import('./mix.js').Voyage} */ (voyage.state),
    };
  }

  /** Build the graph once, on the first gesture with the sound on. */
  function ensure() {
    if (graph || signal.aborted) return graph;
    try {
      const ctx = given ?? makeContext();
      if (!ctx) return null;
      graph = build(ctx);
      const t = ctx.currentTime;
      graph.master.gain.setValueAtTime(0, t);
      graph.master.gain.linearRampToValueAtTime(muted ? 0 : MASTER, t + 2.5); // fade in from silence
      apply(mix(snapshot.passage, snapshot.voyage), true);
      if (!offline) interval = window.setInterval(tick, 250);
    } catch {
      graph = null;
    }
    return graph;
  }

  function resume() {
    const ctx = graph?.ctx;
    if (ctx && !offline && ctx instanceof AudioContext && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  function wake() {
    heard = true;
    if (muted) return;
    ensure();
    resume();
  }

  /** @param {import('./mix.js').Levels} levels @param {boolean} [now] jump instead of glide */
  function apply(levels, now = false) {
    if (!graph) return;
    const { ctx, bus, bed } = graph;
    const t = ctx.currentTime;
    /** @param {AudioParam} param @param {number} value */
    const set = (param, value) =>
      now ? param.setValueAtTime(value, t) : param.setTargetAtTime(value, t, GLIDE);
    for (const name of /** @type {(keyof typeof BED_GAIN)[]} */ (Object.keys(BED_GAIN))) {
      set(bed[name].level.gain, levels[name] * BED_GAIN[name]);
    }
    set(/** @type {AudioParam} */ (bed.sea.tone), levels.seaTone);
    set(/** @type {AudioParam} */ (bed.wash.tone), levels.washTone);
    set(/** @type {AudioParam} */ (bed.wind.tone), levels.windTone);
    const [w1, w2] = bed.whistle.pitch ?? [];
    if (w1 && w2) {
      set(w1, 1180 * (0.85 + 0.3 * levels.whistle));
      set(w2, 1630 * (0.85 + 0.3 * levels.whistle));
    }
    const [e1, e2, e3, chug] = bed.engine.pitch ?? [];
    if (e1 && e2 && e3 && chug) {
      set(e1, levels.enginePitch);
      set(e2, levels.enginePitch * 2);
      set(e3, levels.enginePitch * 3.01);
      set(chug, levels.enginePitch / 6);
    }
    set(bus.gain, levels.duck);
    graph.levels = levels;
  }

  function update() {
    const next = take();
    const fired = cues(snapshot, next);
    snapshot = next;
    if (!graph) return;
    apply(mix(next.passage, next.voyage));
    if (muted) return;
    const t = graph.ctx.currentTime + 0.03;
    for (const cue of fired) {
      if (cue === 'found') foundAt = t;
      if (cue === 'arrive' && t - foundAt < 3) continue; // the new-port bells already rang
      play(graph.ctx, graph.cues, graph.white, cue, t);
    }
  }

  /** Scatter the occasional gull and creak. Called 4 times a second (or by a preview). */
  function tick() {
    if (!graph || muted) return;
    const { ctx, levels } = graph;
    if (!levels) return;
    const t = ctx.currentTime;
    if (levels.gulls <= 0.05) {
      nextGull = 0;
    } else if (nextGull === 0) {
      nextGull = t + 1 + Math.random() * 3; // the first cry comes a moment after land is near
    } else if (t >= nextGull) {
      gull(ctx, graph.bus, t + 0.05, 0.16 * levels.gulls);
      nextGull = t + (3 + Math.random() * 8) / Math.max(0.4, levels.gulls);
    }
    if (t >= nextCreak) {
      if (nextCreak > 0) creak(ctx, graph.bus, t + 0.05, 0.08 * levels.creak);
      nextCreak = t + (2.5 + Math.random() * 7) / Math.max(0.2, levels.creak);
    }
  }

  /** @param {boolean} next */
  function setMuted(next) {
    muted = next;
    writeMuted(muted);
    reflect();
    if (!muted && heard) ensure();
    if (!graph) return;
    const { ctx, master } = graph;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(muted ? 0 : MASTER, t + (muted ? 0.25 : 1.2));
    if (offline || !(ctx instanceof AudioContext)) return;
    if (muted) {
      // Let the CPU rest once the fade is done; resume on unmute.
      window.setTimeout(
        () => muted && ctx.state === 'running' && ctx.suspend().catch(() => {}),
        400,
      );
    } else {
      resume();
    }
  }

  function reflect() {
    for (const button of root.querySelectorAll('[data-sound]')) {
      button.removeAttribute('hidden');
      button.setAttribute('aria-pressed', String(!muted));
    }
  }

  reflect();
  passage.addEventListener('change', update, on);
  voyage.addEventListener('change', update, on);
  root.addEventListener('pointerdown', wake, { capture: true, signal });
  root.addEventListener('keydown', wake, { capture: true, signal });
  root.addEventListener(
    'click',
    (event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (target?.closest?.('[data-sound]')) setMuted(!muted);
    },
    on,
  );
  root.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'q' && event.key !== 'Q') return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const el = /** @type {HTMLElement | null} */ (event.target);
      if (el?.closest?.('input, textarea, select, [contenteditable]')) return;
      setMuted(!muted);
    },
    on,
  );
  root.addEventListener(
    'visibilitychange',
    () => {
      const ctx = graph?.ctx;
      if (!(ctx instanceof AudioContext)) return;
      if (root.hidden) ctx.suspend().catch(() => {});
      else if (!muted) resume();
    },
    on,
  );
  signal.addEventListener(
    'abort',
    () => {
      window.clearInterval(interval);
      const ctx = graph?.ctx;
      graph = null;
      if (ctx instanceof AudioContext && !given) ctx.close().catch(() => {});
    },
    { once: true },
  );

  if (given) {
    heard = true;
    if (!muted) ensure();
  }

  return {
    get muted() {
      return muted;
    },
    setMuted,
    toggle: () => setMuted(!muted),
    tick,
    get context() {
      return graph?.ctx ?? null;
    },
  };
}

/**
 * @typedef {{
 *   ctx: AudioContext | OfflineAudioContext, master: GainNode, bus: GainNode, cues: GainNode,
 *   bed: ReturnType<typeof beds>, white: AudioBuffer, levels: import('./mix.js').Levels | null,
 * }} Graph
 */

/** @param {AudioContext | OfflineAudioContext} ctx @returns {Graph} */
function build(ctx) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(comp);
  const bus = ctx.createGain(); // the beds and scattered events; ducked while a card or the chart is open
  bus.connect(master);
  const cueBus = ctx.createGain();
  cueBus.gain.value = 0.8;
  cueBus.connect(master);
  const white = whiteNoise(ctx, 3);
  const bed = beds(ctx, bus, { white, brown: brownNoise(ctx, 6) });
  return { ctx, master, bus, cues: cueBus, bed, white, levels: null };
}

function makeContext() {
  const Ctx =
    globalThis.AudioContext ??
    /** @type {typeof AudioContext | undefined} */ (
      /** @type {{ webkitAudioContext?: typeof AudioContext }} */ (globalThis).webkitAudioContext
    );
  return Ctx ? new Ctx({ latencyHint: 'playback' }) : null;
}

function readMuted() {
  try {
    return localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
}

/** @param {boolean} muted */
function writeMuted(muted) {
  try {
    localStorage.setItem(KEY, muted ? 'off' : 'on');
  } catch {
    // Not remembered; the toggle still works for this visit.
  }
}
