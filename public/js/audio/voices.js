// The instruments, all synthesised with Web Audio: no files, no network.
// Beds (sea, wash, wind, whistle, luff, engine) run all the time and are steered by one level each.
// Events (gull, creak) and cues (bells, thuds, horn, hammer) are one-shots scheduled at a context time.

/** @param {AudioContext | OfflineAudioContext} ctx @param {number} seconds */
export function whiteNoise(ctx, seconds = 3) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Brown noise: the rumble under the sea. @param {AudioContext | OfflineAudioContext} ctx @param {number} seconds */
export function brownNoise(ctx, seconds = 5) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  // Fade the loop seam so it never clicks.
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    data[i] *= k;
    data[data.length - 1 - i] *= k;
  }
  return buf;
}

/**
 * A looping noise source at a random point, so beds sharing a buffer do not sound alike.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioBuffer} buf
 */
function loop(ctx, buf) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.start(0, Math.random() * buf.duration);
  return src;
}

/**
 * A slow sine added onto an AudioParam: swells, gusts, flutter.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioParam} param
 * @param {number} hz @param {number} depth @param {OscillatorType} [type]
 */
function lfo(ctx, param, hz, depth, type = 'sine') {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = hz;
  const amount = ctx.createGain();
  amount.gain.value = depth;
  osc.connect(amount).connect(param);
  osc.start(ctx.currentTime + Math.random() * 2);
  return { osc, amount };
}

/**
 * @typedef {{ level: GainNode, tone?: AudioParam, pitch?: AudioParam[] }} Bed
 *   `level` is driven 0..1 by the mix; `tone` is a filter frequency; `pitch` oscillator frequencies
 */

/**
 * Every bed, wired into `out`. Each bed has its own gain that the mix drives.
 * @param {AudioContext | OfflineAudioContext} ctx
 * @param {AudioNode} out
 * @param {{ white: AudioBuffer, brown: AudioBuffer }} noise
 * @returns {Record<'sea' | 'wash' | 'wind' | 'whistle' | 'luff' | 'engine', Bed>}
 */
export function beds(ctx, out, noise) {
  return {
    sea: sea(ctx, out, noise.brown),
    wash: wash(ctx, out, noise.white),
    wind: wind(ctx, out, noise.white),
    whistle: whistle(ctx, out, noise.white),
    luff: luff(ctx, out, noise.white),
    engine: engine(ctx, out),
  };
}

/** @param {AudioContext | OfflineAudioContext} ctx */
const silentGain = (ctx) => {
  const g = ctx.createGain();
  g.gain.value = 0;
  return g;
};

/**
 * Swell: two layers of low noise, left and right, rising and falling out of step.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out @param {AudioBuffer} brown
 * @returns {Bed}
 */
function sea(ctx, out, brown) {
  const level = silentGain(ctx);
  level.connect(out);
  const tone = ctx.createConstantSource();
  tone.offset.value = 500;
  tone.start();
  [
    [-0.6, 0.083],
    [0.6, 0.117],
  ].forEach(([pan, hz]) => {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.4;
    lp.frequency.value = 0;
    tone.connect(lp.frequency);
    lfo(ctx, lp.frequency, hz * 1.3, 180);
    const swell = ctx.createGain();
    swell.gain.value = 0.55;
    lfo(ctx, swell.gain, hz, 0.4);
    const hp = ctx.createBiquadFilter(); // keep the rumble out of the sub-bass speakers cannot play
    hp.type = 'highpass';
    hp.frequency.value = 90;
    const hp2 = ctx.createBiquadFilter();
    hp2.type = 'highpass';
    hp2.frequency.value = 90;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    loop(ctx, brown).connect(hp).connect(hp2).connect(lp).connect(swell).connect(p).connect(level);
  });
  return { level, tone: tone.offset };
}

/**
 * Wash: water hissing past the hull, louder and brighter with speed, slapping in a slow rhythm.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out @param {AudioBuffer} white
 * @returns {Bed}
 */
function wash(ctx, out, white) {
  const level = silentGain(ctx);
  level.connect(out);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.7;
  bp.frequency.value = 900;
  const slap = ctx.createGain();
  slap.gain.value = 0.6;
  lfo(ctx, slap.gain, 0.55, 0.35);
  loop(ctx, white).connect(bp).connect(slap).connect(level);
  return { level, tone: bp.frequency };
}

/**
 * Wind: a broad band of noise that gusts in level and pitch.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out @param {AudioBuffer} white
 * @returns {Bed}
 */
function wind(ctx, out, white) {
  const level = silentGain(ctx);
  level.connect(out);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.value = 500;
  lfo(ctx, bp.detune, 0.071, 500);
  lfo(ctx, bp.detune, 0.19, 200);
  const gust = ctx.createGain();
  gust.gain.value = 0.6;
  lfo(ctx, gust.gain, 0.071, 0.3);
  lfo(ctx, gust.gain, 0.23, 0.1);
  const p = ctx.createStereoPanner();
  lfo(ctx, p.pan, 0.04, 0.5);
  loop(ctx, white).connect(bp).connect(gust).connect(p).connect(level);
  return { level, tone: bp.frequency };
}

/**
 * Whistle: wind singing in the rigging, only in a stiff breeze.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out @param {AudioBuffer} white
 * @returns {Bed}
 */
function whistle(ctx, out, white) {
  const level = silentGain(ctx);
  level.connect(out);
  const voices = [1180, 1630].map((hz, i) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 22;
    bp.frequency.value = hz;
    lfo(ctx, bp.detune, 0.11 + i * 0.07, 120);
    const g = ctx.createGain();
    g.gain.value = 0.35;
    lfo(ctx, g.gain, 0.09 + i * 0.05, 0.35);
    loop(ctx, white).connect(bp).connect(g).connect(level);
    return bp.frequency;
  });
  return { level, pitch: voices };
}

/**
 * Luff: a badly trimmed sail flogging, a fast flutter of canvas noise.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out @param {AudioBuffer} white
 * @returns {Bed}
 */
function luff(ctx, out, white) {
  const level = silentGain(ctx);
  level.connect(out);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 250;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  const flutter = ctx.createGain();
  flutter.gain.value = 0.5;
  const { osc } = lfo(ctx, flutter.gain, 6.5, 0.5, 'triangle');
  lfo(ctx, osc.frequency, 0.3, 1.8); // the flapping speeds up and slows down
  loop(ctx, white).connect(hp).connect(lp).connect(flutter).connect(level);
  return { level };
}

/**
 * Engine: a small diesel, a low growl chugging at a quarter of its pitch.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out
 * @returns {Bed}
 */
function engine(ctx, out) {
  const level = silentGain(ctx);
  level.connect(out);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  lp.Q.value = 1.5;
  const chug = ctx.createGain();
  chug.gain.value = 0.6;
  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.value = 8;
  const thumpAmount = ctx.createGain();
  thumpAmount.gain.value = 0.4;
  thump.connect(thumpAmount).connect(chug.gain);
  thump.start();
  const pitch = [
    ['sawtooth', 1, 0.5],
    ['square', 2, 0.25],
    ['sawtooth', 3.01, 0.15],
  ].map(([type, mult, gain]) => {
    const osc = ctx.createOscillator();
    osc.type = /** @type {OscillatorType} */ (type);
    osc.frequency.value = 72 * Number(mult);
    const g = ctx.createGain();
    g.gain.value = Number(gain);
    osc.connect(g).connect(lp);
    osc.start();
    return osc.frequency;
  });
  lp.connect(chug).connect(level);
  return { level, pitch: [...pitch, thump.frequency] }; // [fundamental, 2nd, 3rd, chug]
}

// One-shots. Each takes the time to start at and builds its own short-lived nodes.

/**
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out
 * @param {number} t start @param {number} hz @param {number} gain @param {number} decay seconds
 * @param {number} [pan]
 */
function bell(ctx, out, t, hz, gain, decay, pan = 0) {
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  p.connect(out);
  // A ship's bell: a few inharmonic partials, the high ones dying first.
  [
    [1, 1],
    [2.0, 0.5],
    [2.76, 0.35],
    [5.4, 0.18],
    [8.93, 0.08],
  ].forEach(([ratio, amp], i) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = hz * ratio;
    const g = ctx.createGain();
    const d = decay / (1 + i * 0.7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * amp, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.connect(g).connect(p);
    osc.start(t);
    osc.stop(t + d + 0.05);
  });
}

/**
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out @param {AudioBuffer} white
 * @param {number} t @param {number} gain @param {number} hz filter centre @param {number} dur
 */
function burst(ctx, out, white, t, gain, hz, dur) {
  const src = ctx.createBufferSource();
  src.buffer = white;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = hz;
  bp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(t, Math.random() * (white.duration - dur - 0.1), dur + 0.05);
}

/**
 * A hull striking ground: a low thud and a scrape.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out @param {AudioBuffer} white
 * @param {number} t @param {number} [weight] 1 for a bump, more for a wreck
 */
function thud(ctx, out, white, t, weight = 1) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(90, t);
  osc.frequency.exponentialRampToValueAtTime(32, t + 0.4 * weight);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5 * weight);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.55 * weight);
  burst(ctx, out, white, t, 0.5, 380, 0.35 * weight);
  burst(ctx, out, white, t + 0.06, 0.25, 1600, 0.6 * weight);
}

/**
 * A timber creak: a rough, wavering squeak.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out
 * @param {number} t @param {number} gain @param {number} [hz]
 */
export function creak(ctx, out, t, gain, hz = 160 + Math.random() * 140) {
  const dur = 0.25 + Math.random() * 0.45;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(hz, t);
  osc.frequency.linearRampToValueAtTime(hz * (0.75 + Math.random() * 0.5), t + dur);
  // Stick-slip: a fast, irregular wobble in pitch.
  const wobble = ctx.createOscillator();
  wobble.type = 'square';
  wobble.frequency.value = 18 + Math.random() * 20;
  const wobbleAmount = ctx.createGain();
  wobbleAmount.gain.value = hz * 0.08;
  wobble.connect(wobbleAmount).connect(osc.frequency);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = hz * 4;
  bp.Q.value = 3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  const p = ctx.createStereoPanner();
  p.pan.value = Math.random() * 1.2 - 0.6;
  osc.connect(bp).connect(g).connect(p).connect(out);
  osc.start(t);
  wobble.start(t);
  osc.stop(t + dur + 0.05);
  wobble.stop(t + dur + 0.05);
}

/**
 * A gull: two to four falling cries, "kee-ow", from somewhere off to one side.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out
 * @param {number} t @param {number} gain
 */
export function gull(ctx, out, t, gain) {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.random() * 1.6 - 0.8;
  p.connect(out);
  const base = 1300 + Math.random() * 500;
  const cries = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < cries; i++) {
    const s = t + i * (0.28 + Math.random() * 0.12);
    const dur = 0.2 + Math.random() * 0.1;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base * 0.8, s);
    osc.frequency.linearRampToValueAtTime(base * 1.15, s + dur * 0.25);
    osc.frequency.exponentialRampToValueAtTime(base * 0.6, s + dur);
    const trill = ctx.createOscillator();
    trill.frequency.value = 38;
    const trillAmount = ctx.createGain();
    trillAmount.gain.value = base * 0.04;
    trill.connect(trillAmount).connect(osc.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = base * 1.6;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(gain, s + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    osc.connect(bp).connect(g).connect(p);
    osc.start(s);
    trill.start(s);
    osc.stop(s + dur + 0.02);
    trill.stop(s + dur + 0.02);
  }
}

/**
 * The cues, each a one-shot.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out @param {AudioBuffer} white
 * @param {import('./mix.js').Cue} cue @param {number} t
 */
export function play(ctx, out, white, cue, t) {
  switch (cue) {
    case 'found': // two strokes of the ship's bell, then a bright third
      bell(ctx, out, t, 587.33, 0.32, 3.2, -0.2);
      bell(ctx, out, t + 0.42, 587.33, 0.28, 3.2, 0.2);
      bell(ctx, out, t + 1.1, 880, 0.2, 3.6, 0);
      break;
    case 'arrive':
      bell(ctx, out, t, 587.33, 0.18, 2.4);
      break;
    case 'aground':
      thud(ctx, out, white, t, 1);
      creak(ctx, out, t + 0.15, 0.25, 120);
      break;
    case 'wrecked':
      thud(ctx, out, white, t, 1.8);
      burst(ctx, out, white, t + 0.1, 0.4, 2600, 0.5);
      creak(ctx, out, t + 0.3, 0.3, 90);
      creak(ctx, out, t + 0.8, 0.25, 70);
      bell(ctx, out, t + 1.4, 293.66, 0.18, 4);
      break;
    case 'repaired': // three hammer knocks and the bell
      for (let i = 0; i < 3; i++) {
        const s = t + i * 0.22;
        bell(ctx, out, s, 1400 + i * 30, 0.12, 0.12);
        burst(ctx, out, white, s, 0.3, 3000, 0.04);
      }
      bell(ctx, out, t + 0.9, 587.33, 0.22, 2.6);
      break;
    case 'edge': // a far foghorn: here be nothing
      horn(ctx, out, t);
      break;
    case 'anchor': // weighing anchor: the chain rattles up through the hawse
      for (let i = 0; i < 14; i++) {
        const s = t + i * (0.07 + Math.random() * 0.03);
        bell(ctx, out, s, 2200 + Math.random() * 900, 0.05, 0.06, -0.3);
        burst(ctx, out, white, s, 0.12, 3500, 0.03);
      }
      thud(ctx, out, white, t + 1.3, 0.6);
      break;
    case 'engineOn': // starter whirr, a cough or two, then it catches (the bed fades in)
      starter(ctx, out, white, t);
      break;
    case 'engineOff': // falls silent with a last sputter
      for (let i = 0; i < 3; i++) burst(ctx, out, white, t + i * 0.16, 0.18 - i * 0.05, 220, 0.09);
      break;
    case 'fill': // the sail fills: a soft whump of canvas and a creak as the sheet takes the load
      burst(ctx, out, white, t, 0.5, 260, 0.22);
      burst(ctx, out, white, t + 0.02, 0.18, 900, 0.12);
      creak(ctx, out, t + 0.15, 0.08, 140);
      break;
    case 'tack': // through the wind: the sail shivers, then fills on the other side
      flog(ctx, out, white, t, 1.1);
      burst(ctx, out, white, t + 1.15, 0.45, 260, 0.25);
      break;
    case 'gybe': // the boom slams across
      flog(ctx, out, white, t, 0.35);
      thud(ctx, out, white, t + 0.35, 0.7);
      burst(ctx, out, white, t + 0.36, 0.5, 700, 0.18);
      break;
    case 'winch': // a few ratchet clicks
      for (let i = 0; i < 3; i++) {
        const s = t + i * 0.055;
        bell(ctx, out, s, 3100 + Math.random() * 300, 0.06, 0.03, 0.25);
        burst(ctx, out, white, s, 0.1, 4200, 0.015);
      }
      break;
    case 'goal':
      peal(ctx, out, t, false);
      break;
    case 'finale':
      peal(ctx, out, t, true);
      break;
  }
}

// D major, a ringing clock tower. Notes in Hz.
const D5 = 587.33;
const E5 = 659.25;
const FS5 = 739.99;
const A5 = 880;
const B5 = 987.77;
const D6 = 1174.66;

/**
 * A clock tower ringing out: a rising run of bells, then the chord rung together, then the big bell.
 * The finale runs the peal twice and strikes the hour three times.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out
 * @param {number} t @param {boolean} grand
 */
function peal(ctx, out, t, grand) {
  const run = [D5, FS5, A5, D6, A5, D6];
  const step = 0.17;
  const rounds = grand ? 2 : 1;
  let s = t;
  for (let r = 0; r < rounds; r++) {
    run.forEach((hz, i) => bell(ctx, out, s + i * step, hz, 0.14, 2.2, (i % 3) * 0.35 - 0.35));
    s += run.length * step + 0.12;
    if (grand && r === 0) {
      [E5, FS5, A5, B5, D6].forEach((hz, i) => bell(ctx, out, s + i * step, hz, 0.12, 2, 0.3));
      s += 5 * step + 0.12;
    }
  }
  [D5, FS5, A5, D6].forEach((hz) => bell(ctx, out, s, hz, 0.12, 3.5));
  const strikes = grand ? 3 : 1;
  for (let i = 0; i < strikes; i++) bell(ctx, out, s + 0.5 + i * 1.1, D5 / 4, 0.4, 5);
}

/**
 * Canvas flogging hard for a moment, as when the bow passes through the wind.
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out @param {AudioBuffer} white
 * @param {number} t @param {number} dur
 */
function flog(ctx, out, white, t, dur) {
  const n = Math.max(2, Math.round(dur / 0.11));
  for (let i = 0; i < n; i++) {
    const k = 1 - Math.abs(i / n - 0.5) * 1.4; // loudest in the middle
    burst(ctx, out, white, t + i * (dur / n), 0.32 * k, 500 + Math.random() * 900, 0.08);
  }
}

/**
 * @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out @param {AudioBuffer} white
 * @param {number} t
 */
function starter(ctx, out, white, t) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(18, t);
  osc.frequency.linearRampToValueAtTime(34, t + 0.7);
  const wobble = ctx.createOscillator();
  wobble.frequency.value = 9;
  const wobbleAmount = ctx.createGain();
  wobbleAmount.gain.value = 6;
  wobble.connect(wobbleAmount).connect(osc.frequency);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.05);
  g.gain.setValueAtTime(0.22, t + 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
  osc.connect(lp).connect(g).connect(out);
  osc.start(t);
  wobble.start(t);
  osc.stop(t + 0.85);
  wobble.stop(t + 0.85);
  burst(ctx, out, white, t + 0.55, 0.35, 180, 0.12);
  burst(ctx, out, white, t + 0.72, 0.4, 160, 0.14);
}

/** @param {AudioContext | OfflineAudioContext} ctx @param {AudioNode} out @param {number} t */
function horn(ctx, out, t) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.25);
  g.gain.setValueAtTime(0.35, t + 1.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  lp.connect(g).connect(out);
  [98, 98.6, 147].forEach((hz) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = hz;
    osc.connect(lp);
    osc.start(t);
    osc.stop(t + 2.3);
  });
}
