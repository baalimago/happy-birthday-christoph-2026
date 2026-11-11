// Single waves and the water's smaller noises, synthesised. Each call builds a few short-lived nodes
// that play once at a context time and are collected afterwards. weather.js decides when and how big;
// every call also rolls its own dice for shape, so no two waves sound alike.

/** @typedef {AudioContext | OfflineAudioContext} Ctx */

/**
 * A noise source playing once from a random point of a looped buffer.
 * @param {Ctx} ctx @param {AudioBuffer} buf @param {number} t @param {number} dur
 */
function noise(ctx, buf, t, dur) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.start(t, Math.random() * buf.duration);
  src.stop(t + dur + 0.1);
  return src;
}

/** @param {Ctx} ctx @param {BiquadFilterType} type @param {number} hz @param {number} [q] */
function filter(ctx, type, hz, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return f;
}

/** @param {Ctx} ctx @param {number} pan */
function panner(ctx, pan) {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  return p;
}

/**
 * The loudness of one wave over its life: a half-cosine up to the crest at `r` (0..1 of the way
 * through), then a longer, softer fall.
 * @param {number} peak @param {number} r
 */
function swellCurve(peak, r) {
  const n = 64;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const v =
      x < r
        ? (1 - Math.cos((Math.PI * x) / r)) / 2
        : ((1 + Math.cos((Math.PI * (x - r)) / (1 - r))) / 2) ** 1.6;
    curve[i] = peak * v;
  }
  return curve;
}

/** @param {number} a @param {number} b */
const between = (a, b) => a + (b - a) * Math.random();

/**
 * One wave rolling past: a low body that swells and sweeps brighter, then (if it breaks) a crest of
 * foam that hisses away, drifting across the stereo field as it goes.
 * @param {Ctx} ctx @param {AudioNode} out @param {{ white: AudioBuffer, brown: AudioBuffer }} buf
 * @param {number} t @param {number} size 0..1 @param {number} pan -1..1
 */
export function wave(ctx, out, buf, t, size, pan) {
  const rise = between(1.1, 2.6) * (0.8 + 0.4 * size);
  const fall = between(1.8, 3.8) * (0.7 + 0.6 * size);
  const end = t + rise + fall;

  const p = panner(ctx, pan);
  p.pan.linearRampToValueAtTime(pan * between(0.1, 0.5), end); // it passes under the boat
  p.connect(out);

  // The body: low water heaving.
  const body = noise(ctx, buf.brown, t, rise + fall);
  const hp = filter(ctx, 'highpass', 80);
  const lp = filter(ctx, 'lowpass', 180, 0.5);
  const top = 300 + 900 * size * between(0.7, 1.2);
  lp.frequency.setValueAtTime(180, t);
  lp.frequency.exponentialRampToValueAtTime(top, t + rise);
  lp.frequency.exponentialRampToValueAtTime(160, end);
  const g = ctx.createGain();
  const peak = 0.15 + 0.75 * size;
  // A smooth hump, not a spike: eased up to the crest, eased down after it.
  g.gain.setValueAtTime(0, t);
  g.gain.setValueCurveAtTime(swellCurve(peak, rise / (rise + fall)), t, rise + fall);
  body
    .connect(hp)
    .connect(filter(ctx, 'highpass', 80))
    .connect(lp)
    .connect(g)
    .connect(p);

  // The crest: only waves of some size break, and not every one of them.
  if (size > 0.3 && Math.random() < 0.35 + 0.6 * size) {
    const crest = t + rise * between(0.85, 1);
    const hiss = between(1.2, 3) * (0.6 + 0.6 * size);
    const foam = noise(ctx, buf.white, crest, hiss);
    const bp = filter(ctx, 'bandpass', between(1400, 3200), between(0.4, 0.9));
    bp.frequency.exponentialRampToValueAtTime(between(500, 900), crest + hiss);
    const fg = ctx.createGain();
    const fpeak = (0.1 + 0.35 * size) * between(0.6, 1);
    fg.gain.setValueAtTime(0.0001, crest - 0.25);
    fg.gain.exponentialRampToValueAtTime(fpeak, crest + between(0.05, 0.3));
    fg.gain.exponentialRampToValueAtTime(0.0001, crest + hiss);
    foam.connect(bp).connect(fg).connect(p);
  }
}

/**
 * Water slapping the hull: a hollow knock and a little splash.
 * @param {Ctx} ctx @param {AudioNode} out @param {{ white: AudioBuffer, brown: AudioBuffer }} buf
 * @param {number} t @param {number} size @param {number} pan
 */
export function slap(ctx, out, buf, t, size, pan) {
  const p = panner(ctx, pan);
  p.connect(out);
  const dur = between(0.08, 0.2);
  const knock = noise(ctx, buf.brown, t, dur);
  const bp = filter(ctx, 'bandpass', between(220, 520), between(1.5, 3.5));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.7 * size, t + 0.025);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  knock.connect(bp).connect(g).connect(p);

  const s = t + between(0.02, 0.08);
  const sdur = between(0.25, 0.6);
  const splash = noise(ctx, buf.white, s, sdur);
  const hp = filter(ctx, 'bandpass', between(1800, 3800), 0.8);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.0001, s);
  sg.gain.exponentialRampToValueAtTime(0.3 * size, s + 0.03);
  sg.gain.exponentialRampToValueAtTime(0.0001, s + sdur);
  splash.connect(hp).connect(sg).connect(p);
}

/**
 * Spray torn off a crest by the wind.
 * @param {Ctx} ctx @param {AudioNode} out @param {{ white: AudioBuffer, brown: AudioBuffer }} buf
 * @param {number} t @param {number} size @param {number} pan
 */
export function spray(ctx, out, buf, t, size, pan) {
  const p = panner(ctx, pan);
  p.pan.linearRampToValueAtTime(pan + between(-0.4, 0.4), t + 1);
  p.connect(out);
  const dur = between(0.5, 1.4);
  const src = noise(ctx, buf.white, t, dur);
  const hp = filter(ctx, 'highpass', between(2500, 5000));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.15 * size, t + between(0.04, 0.15));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp).connect(g).connect(p);
}

/**
 * Surf on a shore: a boom as the wave dumps, a crash of white water, and the backwash drawing off.
 * @param {Ctx} ctx @param {AudioNode} out @param {{ white: AudioBuffer, brown: AudioBuffer }} buf
 * @param {number} t @param {number} size @param {number} pan
 */
export function surf(ctx, out, buf, t, size, pan) {
  const p = panner(ctx, pan);
  p.connect(out);
  const build = between(0.8, 1.6);
  const crash = t + build;
  const wash = between(3, 6);

  const boom = noise(ctx, buf.brown, t, build + 1.5);
  const lp = filter(ctx, 'lowpass', 120, 0.8);
  lp.frequency.exponentialRampToValueAtTime(380, crash);
  lp.frequency.exponentialRampToValueAtTime(110, crash + 1.5);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.exponentialRampToValueAtTime(0.7 * size, crash);
  bg.gain.exponentialRampToValueAtTime(0.0001, crash + 1.5);
  boom
    .connect(filter(ctx, 'highpass', 60))
    .connect(lp)
    .connect(bg)
    .connect(p);

  const white = noise(ctx, buf.white, crash - 0.05, wash);
  const bp = filter(ctx, 'bandpass', between(900, 1500), 0.5);
  bp.frequency.exponentialRampToValueAtTime(between(2500, 4000), crash + wash * 0.6); // backwash fizzes
  const wg = ctx.createGain();
  wg.gain.setValueAtTime(0.0001, crash - 0.05);
  wg.gain.exponentialRampToValueAtTime(0.28 * size, crash + 0.1);
  wg.gain.exponentialRampToValueAtTime(0.06 * size, crash + wash * 0.5);
  wg.gain.exponentialRampToValueAtTime(0.0001, crash + wash);
  white.connect(bp).connect(wg).connect(p);
}
