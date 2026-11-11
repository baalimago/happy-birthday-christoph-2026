// The creatures of the sea, synthesised: one call per sighting (passage.state.sighting.kind), and a
// low dread that rises with the kraken (log.kraken).

import { slap, spray, surf } from './waves.js';
import { gull } from './voices.js';

/** @typedef {AudioContext | OfflineAudioContext} Ctx */
/** @typedef {{ white: AudioBuffer, brown: AudioBuffer }} Noise */

/** @param {number} a @param {number} b */
const between = (a, b) => a + (b - a) * Math.random();

/**
 * A gliding tone with an envelope: whale song, dolphin whistles, the kraken's groan.
 * @param {Ctx} ctx @param {AudioNode} out @param {number} t
 * @param {{ from: number, to: number, dur: number, gain: number, type?: OscillatorType,
 *   vibrato?: number, attack?: number, pan?: number, cutoff?: number }} o
 */
function glide(ctx, out, t, o) {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.from, t);
  osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  if (o.vibrato) {
    const v = ctx.createOscillator();
    v.frequency.value = between(4, 7);
    const vg = ctx.createGain();
    vg.gain.value = o.vibrato;
    v.connect(vg).connect(osc.frequency);
    v.start(t);
    v.stop(t + o.dur + 0.05);
  }
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = o.cutoff ?? 20000;
  const g = ctx.createGain();
  const attack = o.attack ?? 0.05;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + attack);
  g.gain.setValueAtTime(o.gain, t + Math.max(attack, o.dur * 0.6));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  const p = ctx.createStereoPanner();
  p.pan.value = o.pan ?? 0;
  osc.connect(lp).connect(g).connect(p).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

/**
 * A breath of noise: a whale's blow, a rumble from below.
 * @param {Ctx} ctx @param {AudioNode} out @param {AudioBuffer} buf @param {number} t
 * @param {{ hz: number, to: number, dur: number, gain: number, q?: number, pan?: number }} o
 */
function breath(ctx, out, buf, t, o) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = o.q ?? 0.8;
  bp.frequency.setValueAtTime(o.hz, t);
  bp.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + o.dur * 0.2);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  const p = ctx.createStereoPanner();
  p.pan.value = o.pan ?? 0;
  src.connect(bp).connect(g).connect(p).connect(out);
  src.start(t, Math.random() * buf.duration);
  src.stop(t + o.dur + 0.05);
}

/**
 * @param {Ctx} ctx
 * @param {AudioNode} out dry, to the sea bus
 * @param {AudioNode} room the reverb, for song and the deep
 * @param {Noise} buf
 * @param {string} kind
 * @param {number} t
 */
export function creature(ctx, out, room, buf, kind, t) {
  const pan = between(-0.8, 0.8);
  switch (kind) {
    case 'dolphin-leap': {
      // Far off: a soft hiss as it leaves the water and a short, dull splash as it lands.
      spray(ctx, out, buf, t, 0.12, pan);
      breath(ctx, out, buf.white, t + between(0.6, 0.9), {
        hz: 1500,
        to: 420,
        dur: between(0.45, 0.7),
        gain: 0.035,
        q: 0.5,
        pan,
      });
      // A few quick whistles and clicks.
      for (let i = 0; i < 3; i++) {
        const s = t + between(0, 1.2);
        const f = between(5000, 9000);
        glide(ctx, room, s, {
          from: f,
          to: f * between(1.2, 1.6),
          dur: between(0.12, 0.3),
          gain: 0.008,
          pan,
        });
      }
      break;
    }
    case 'whale-blow':
      breath(ctx, out, buf.white, t, {
        hz: 500,
        to: 1800,
        dur: between(1.4, 2.2),
        gain: 0.35,
        pan,
      });
      if (Math.random() < 0.6) {
        // And sometimes a song, far off in the deep.
        const base = between(110, 220);
        const s = t + between(1.5, 3);
        glide(ctx, room, s, {
          from: base,
          to: base * between(1.4, 2),
          dur: 2.8,
          gain: 0.08,
          vibrato: 4,
          attack: 0.8,
          pan: -pan,
          cutoff: 1500,
        });
        glide(ctx, room, s + 2.6, {
          from: base * 1.8,
          to: base * 0.9,
          dur: 3.2,
          gain: 0.07,
          vibrato: 3,
          attack: 0.6,
          pan: -pan,
          cutoff: 1500,
        });
      }
      break;
    case 'whale-dive':
      surf(ctx, out, buf, t - 0.6, 0.8, pan); // the flukes come down
      break;
    case 'gull-cry':
      gull(ctx, out, t, 0.18);
      break;
    case 'turtle-dive':
      slap(ctx, out, buf, t, 0.35, pan);
      glide(ctx, out, t + 0.03, { from: 700, to: 1400, dur: 0.08, gain: 0.05, pan }); // plop
      break;
    case 'flyingfish':
      for (let i = 0; i < 5; i++) {
        const s = t + i * between(0.12, 0.3);
        spray(ctx, out, buf, s, 0.3, pan + i * 0.1);
        glide(ctx, out, s, { from: 1100, to: 1900, dur: 0.05, gain: 0.03, pan });
      }
      break;
    case 'kraken-rise':
      breath(ctx, room, buf.brown, t, { hz: 60, to: 140, dur: 4, gain: 1.4, q: 0.6 });
      glide(ctx, room, t + 0.8, {
        from: 48,
        to: 34,
        dur: 4.5,
        gain: 0.25,
        type: 'sawtooth',
        vibrato: 2,
        attack: 1.5,
        cutoff: 400,
      });
      for (let i = 0; i < 12; i++) {
        // Bubbles breaking the surface.
        const s = t + between(0.5, 4);
        glide(ctx, out, s, {
          from: between(300, 700),
          to: between(900, 1600),
          dur: 0.06,
          gain: 0.04,
          pan: between(-1, 1),
        });
      }
      break;
    case 'kraken-strike':
      surf(ctx, out, buf, t - 0.9, 1, pan);
      breath(ctx, out, buf.brown, t, { hz: 80, to: 40, dur: 1.2, gain: 2, q: 0.5 });
      glide(ctx, room, t + 0.1, {
        from: 70,
        to: 30,
        dur: 2.5,
        gain: 0.3,
        type: 'sawtooth',
        cutoff: 500,
      });
      break;
    case 'kraken-gone':
      breath(ctx, room, buf.brown, t, { hz: 140, to: 50, dur: 5, gain: 0.9, q: 0.6 });
      glide(ctx, room, t, { from: 220, to: 330, dur: 2.5, gain: 0.04, attack: 0.5 }); // relief
      break;
  }
}

/**
 * The kraken's dread: a low beating drone and a churn beneath, steered 0..1 by log.kraken.
 * @param {Ctx} ctx @param {AudioNode} out @param {Noise} buf
 * @returns {{ level: GainNode }}
 */
export function dread(ctx, out, buf) {
  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(out);
  [55, 58.3, 82.4].forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = i === 2 ? 'triangle' : 'sawtooth';
    osc.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.value = i === 2 ? 0.15 : 0.3;
    osc.connect(lp).connect(g).connect(level);
    osc.start();
  });
  const src = ctx.createBufferSource();
  src.buffer = buf.brown;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 120;
  const g = ctx.createGain();
  g.gain.value = 1.2;
  src.connect(lp).connect(g).connect(level);
  src.start();
  return { level };
}
