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
import { createJingle } from './jingle.js';
import { createMusic, reverb } from './music.js';
import { beds, brownNoise, creak, drip, gull, play, whiteNoise } from './voices.js';
import { slap, spray, surf, wave } from './waves.js';
import { createWeather } from './weather.js';
import { creature, dread } from './wildlife.js';

const KEY = 'philosophers-voyage:sound';
const MUSIC_KEY = 'philosophers-voyage:music';

/** How loud each bed is at level 1, before the master. */
const BED_GAIN = {
  sea: 0.25,
  wash: 0.25,
  wind: 0.24,
  whistle: 0.06,
  luff: 0.08,
  engine: 0.28,
  rocket: 0.3,
  kraken: 0.22,
};
/** How loud the single waves, slaps, spray and surf are. */
const WAVE_GAIN = 1;
/** The music, under everything else. */
const MUSIC_GAIN = 0.5;
const MASTER = 1;
/** Seconds a level takes to settle (time constant): smooth, never zippered. */
const GLIDE = 0.35;

/**
 * @typedef {EventTarget & { state: object }} StoreLike
 * @typedef {{
 *   readonly muted: boolean,
 *   setMuted(muted: boolean): void,
 *   toggle(): void,
 *   readonly music: boolean,
 *   setMusic(on: boolean): void,
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
  let music = readMusic();
  const weather = createWeather();
  let weatherAt = -1;
  let nextDrip = 0;
  /** @type {Graph | null} */
  let graph = null;
  let heard = false; // a gesture has happened (or a context was handed in)
  let interval = 0;
  let snapshot = take();
  let foundAt = -Infinity;
  let anchorAt = -Infinity;
  let pendingFound = 0;
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
      graph.musicBus.gain.value = music ? MUSIC_GAIN : 0;
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
    for (const name of /** @type {(keyof ReturnType<typeof beds>)[]} */ (Object.keys(bed))) {
      set(bed[name].level.gain, levels[name] * BED_GAIN[name]);
    }
    set(/** @type {AudioParam} */ (bed.sea.tone), levels.seaTone);
    set(/** @type {AudioParam} */ (bed.wash.tone), levels.washTone);
    set(/** @type {AudioParam} */ (bed.wind.tone), levels.windTone);
    set(/** @type {AudioParam} */ (bed.rocket.tone), levels.rocketTone);
    set(graph.cave.gain, 0.04 + 0.6 * levels.cave);
    set(graph.dread.level.gain, levels.kraken * BED_GAIN.kraken);
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
    const seen = next.passage.sighting;
    const sighted = seen && seen.at !== snapshot.passage.sighting?.at ? seen.kind : '';
    snapshot = next;
    if (!graph) return;
    apply(mix(next.passage, next.voyage));
    if (muted) return;
    const t = graph.ctx.currentTime + 0.03;
    if (sighted) {
      creature(
        graph.ctx,
        graph.water,
        graph.room,
        { white: graph.white, brown: graph.brown },
        sighted,
        t,
      );
    }
    for (const cue of fired) {
      if (cue === 'arrive' && t - foundAt < 3) continue; // the new-port bells already rang
      // The winch's clicks read as a fault (Lorentz, 2026-11-11): the sheet moves in silence.
      if (cue === 'winch') continue;
      if (cue === 'anchor') anchorAt = t;
      if (cue === 'found') {
        // Wait a beat: if this port completes a goal, the clock tower rings instead of the bells.
        foundAt = t;
        window.clearTimeout(pendingFound);
        pendingFound = window.setTimeout(() => ring('found'), 150);
        continue;
      }
      play(graph.ctx, graph.cues, graph.white, cue, t);
    }
  }

  /** @param {import('./mix.js').Cue} cue @param {number} [delay] seconds from now */
  function ring(cue, delay = 0) {
    if (!graph || muted) return;
    play(graph.ctx, graph.cues, graph.white, cue, graph.ctx.currentTime + 0.03 + delay);
  }

  // Goals: the HUD marks each `[data-goal]` with `data-done` (docs/ARCHITECTURE.md). A goal newly
  // done rings the clock tower; the last one rings the grand peal. Goals already done when the page
  // loads, or done before the first gesture, stay quiet.
  const goals = () => [...root.querySelectorAll('[data-goal]')];
  /** @param {Element} el */
  const isDone = (el) => el.hasAttribute('data-done');
  let doneBefore = new Set(goals().filter(isDone));
  const watcher = new MutationObserver((records) => {
    const fresh = records.some(
      (r) => r.target instanceof Element && isDone(r.target) && !doneBefore.has(r.target),
    );
    const all = goals();
    doneBefore = new Set(all.filter(isDone));
    if (!fresh || !graph) return;
    window.clearTimeout(pendingFound);
    const now = graph.ctx.currentTime;
    const wait = Math.max(0, anchorAt + 1.6 - now); // let the anchor chain finish first
    ring(all.every(isDone) ? 'finale' : 'goal', wait);
  });
  watcher.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-done'] });

  /**
   * The living part, called 4 times a second (or by a preview): gusts and swell move the beds,
   * waves and other water noises are scattered, the music writes its next bars, gulls and creaks.
   */
  function tick() {
    if (!graph || muted) return;
    const { ctx, levels } = graph;
    if (!levels) return;
    const t = ctx.currentTime;
    const dt = weatherAt < 0 ? 0.25 : t - weatherAt;
    weatherAt = t;
    const hove = levels.duck < 1; // a card or the chart: the wind clock stops, but the sea goes on
    const w = weather.step(hove ? dt * 0.3 : dt, {
      wind: levels.breeze,
      gust: levels.gust,
      sea: levels.seaState,
      speed: hove ? 0 : levels.speed,
      land: levels.land,
    });
    const { bed } = graph;
    const glide = 0.6;
    // Each layer of wind takes the gust a little differently, so they never move as one.
    (bed.wind.gust ?? []).forEach((p, i) =>
      p.setTargetAtTime(
        0.35 + 1.1 * w.gust * (i ? 1.15 : 0.85) + 0.1 * Math.random(),
        t,
        glide + i * 0.4,
      ),
    );
    (bed.wind.swing ?? []).forEach((p, i) =>
      p.setTargetAtTime(
        i % 2 ? Math.random() * 1.2 - 0.6 : (w.gust - 0.4) * 900 + (Math.random() - 0.5) * 150,
        t,
        i % 2 ? 3 : glide,
      ),
    );
    (bed.whistle.gust ?? []).forEach((p) =>
      p.setTargetAtTime(Math.max(0, w.gust - 0.35) ** 2 * 2.5 * Math.random(), t, 0.8),
    );
    (bed.sea.gust ?? []).forEach((p) =>
      p.setTargetAtTime(
        (0.25 + 0.5 * w.sea) * (0.6 + 0.6 * w.swell) * (0.7 + 0.6 * Math.random()),
        t,
        2.5,
      ),
    );
    const water = graph.water;
    const buf = { white: graph.white, brown: graph.brown };
    for (const e of w.events) {
      const at = t + 0.05 + e.at;
      if (e.kind === 'wave') wave(ctx, water, buf, at, e.size * (1 - 0.6 * levels.cave), e.pan);
      else if (e.kind === 'slap') slap(ctx, water, buf, at, e.size, e.pan);
      else if (e.kind === 'spray') spray(ctx, water, buf, at, e.size, e.pan);
      else surf(ctx, water, buf, at, e.size, e.pan);
    }
    if (music) graph.music.tick(t, { energy: levels.energy, dark: levels.dark });
    // Syrus mode has a tune of its own, and the music makes way for it.
    graph.jingle.tick(t, levels.syrus > 0);
    graph.musicBus.gain.setTargetAtTime(music && !levels.syrus ? MUSIC_GAIN : 0, t, 0.4);
    if (levels.cave > 0 && t >= nextDrip) {
      if (nextDrip > 0) drip(ctx, graph.bus, t + 0.05, 0.05 + 0.05 * Math.random());
      nextDrip = t + 0.4 + Math.random() * 2.6;
    }
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

  /** @param {boolean} on */
  function setMusic(on) {
    music = on;
    writeMusic(music);
    reflect();
    if (!graph) return;
    const t = graph.ctx.currentTime;
    graph.musicBus.gain.cancelScheduledValues(t);
    graph.musicBus.gain.setTargetAtTime(music ? MUSIC_GAIN : 0, t, music ? 1.5 : 0.4);
  }

  function reflect() {
    for (const button of root.querySelectorAll('[data-sound]')) {
      button.removeAttribute('hidden');
      button.setAttribute('aria-pressed', String(!muted));
    }
    for (const button of root.querySelectorAll('[data-music]')) {
      button.removeAttribute('hidden');
      button.setAttribute('aria-pressed', String(music));
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
      else if (target?.closest?.('[data-music]')) setMusic(!music);
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
      window.clearTimeout(pendingFound);
      watcher.disconnect();
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
    get music() {
      return music;
    },
    setMusic,
    tick,
    get context() {
      return graph?.ctx ?? null;
    },
  };
}

/**
 * @typedef {{
 *   ctx: AudioContext | OfflineAudioContext, master: GainNode, bus: GainNode, cues: GainNode,
 *   water: GainNode, musicBus: GainNode, cave: GainNode, music: ReturnType<typeof createMusic>,
 *   jingle: ReturnType<typeof createJingle>, room: ConvolverNode, dread: ReturnType<typeof dread>,
 *   bed: ReturnType<typeof beds>, white: AudioBuffer, brown: AudioBuffer,
 *   levels: import('./mix.js').Levels | null,
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
  const room = reverb(ctx); // the music's hall, and the sea cave's echo
  const roomOut = ctx.createGain();
  roomOut.gain.value = 0.5;
  room.connect(roomOut).connect(master);
  const bus = ctx.createGain(); // beds and scattered sounds; ducked while a card or the chart is open
  bus.connect(master);
  const cave = ctx.createGain(); // how much of the sea goes into the echo: a lot inside the cave
  cave.gain.value = 0.04;
  bus.connect(cave).connect(room);
  const water = ctx.createGain();
  water.gain.value = WAVE_GAIN;
  water.connect(bus);
  const cueBus = ctx.createGain();
  cueBus.gain.value = 0.8;
  cueBus.connect(master);
  const cueRoom = ctx.createGain();
  cueRoom.gain.value = 0.25; // bells ring on a little
  cueBus.connect(cueRoom).connect(room);
  const musicBus = ctx.createGain(); // never ducked: the music carries on while he reads
  musicBus.connect(master);
  const white = whiteNoise(ctx, 3);
  const brown = brownNoise(ctx, 6);
  const bed = beds(ctx, bus, { white, brown });
  const music = createMusic(ctx, musicBus, room);
  const jingle = createJingle(ctx, master);
  const fear = dread(ctx, master, { white, brown }); // not ducked: the kraken does not wait
  return {
    room,
    dread: fear,
    ctx,
    master,
    bus,
    cues: cueBus,
    water,
    musicBus,
    cave,
    music,
    jingle,
    bed,
    white,
    brown,
    levels: null,
  };
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

function readMusic() {
  try {
    return localStorage.getItem(MUSIC_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** @param {boolean} on */
function writeMusic(on) {
  try {
    localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered.
  }
}
