// Ambient music, composed as it plays: slow pads that drift between chords in D major, a soft bass,
// and a plucked melody that comes and goes in short phrases, all in a long reverb. Nothing loops:
// each chord, voicing, phrase and rest is drawn as it is needed.
//
// The mood steers it: `energy` (0 hove to .. 1 flying along in a breeze) sets how busy the melody is
// and how bright the pads; `dark` (0..1: in the cave, the hull failing) leans the harmony to the minor
// chords and dims everything.

/** @typedef {AudioContext | OfflineAudioContext} Ctx */
/** @typedef {{ energy: number, dark: number }} Mood */

/** MIDI note to Hz. @param {number} m */
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

/** @param {number} a @param {number} b */
const between = (a, b) => a + (b - a) * Math.random();

/** @template T @param {readonly T[]} list @returns {T} */
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * The chords: bass root, pad voicing, and where each likes to go next. `minor` ones are favoured
 * when the mood is dark.
 * @type {Record<string, { root: number, pad: number[], tones: number[], next: string[], minor?: boolean }>}
 */
const CHORDS = {
  D: { root: 38, pad: [54, 57, 61, 64], tones: [62, 66, 69, 73, 76], next: ['G', 'Bm', 'Em', 'A'] },
  G: { root: 43, pad: [54, 57, 59, 62], tones: [62, 66, 67, 71, 74], next: ['D', 'Em', 'A', 'Bm'] },
  A: { root: 45, pad: [52, 57, 59, 64], tones: [64, 69, 71, 73, 76], next: ['D', 'Bm', 'G'] },
  Bm: {
    root: 35,
    pad: [54, 57, 62, 64],
    tones: [62, 66, 69, 71, 74],
    next: ['G', 'Em', 'A', 'F#m'],
    minor: true,
  },
  Em: {
    root: 40,
    pad: [55, 59, 62, 66],
    tones: [64, 67, 71, 74, 78],
    next: ['A', 'G', 'Bm'],
    minor: true,
  },
  'F#m': {
    root: 42,
    pad: [52, 57, 61, 64],
    tones: [61, 64, 66, 69, 73],
    next: ['Bm', 'G'],
    minor: true,
  },
};

/** The melody walks this scale (D major pentatonic plus the 7th), F#4 up to E6. */
const SCALE = [66, 69, 71, 73, 74, 76, 78, 81, 83, 85, 86, 88];

/**
 * A long, soft stereo room, made from decaying noise.
 * @param {Ctx} ctx @param {number} [seconds]
 */
export function reverb(ctx, seconds = 4.5) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      lp += 0.35 * (Math.random() * 2 - 1 - lp); // darken the tail a little
      data[i] = lp * (1 - k) ** 2.2 * (i < 64 ? i / 64 : 1);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  return conv;
}

/**
 * @param {Ctx} ctx
 * @param {AudioNode} out the music bus
 * @param {AudioNode} room the reverb input
 */
export function createMusic(ctx, out, room) {
  const dry = ctx.createGain();
  dry.gain.value = 0.55;
  dry.connect(out);
  const wet = ctx.createGain();
  wet.gain.value = 0.9;
  wet.connect(room);
  const tone = ctx.createBiquadFilter(); // dims everything when the mood is dark
  tone.type = 'lowpass';
  tone.frequency.value = 6000;
  tone.connect(dry);
  tone.connect(wet);

  let chord = pick(['D', 'G', 'D', 'Bm']);
  let chordAt = -1; // context time the current chord began; -1: not started
  let chordEnd = 0;
  let nextNote = 0;
  let phraseLeft = 0;
  let step = Math.floor(SCALE.length / 2);

  /**
   * Schedule what falls in the next stretch of time. Call it a few times a second.
   * @param {number} now ctx.currentTime
   * @param {Mood} mood
   */
  function tick(now, mood) {
    const energy = Math.min(1, Math.max(0, mood.energy));
    const dark = Math.min(1, Math.max(0, mood.dark));
    tone.frequency.setTargetAtTime(1400 + 4600 * (1 - dark) * (0.6 + 0.4 * energy), now, 2);
    const ahead = now + 1;

    if (chordAt < 0) {
      chordAt = now + 0.5;
      chordEnd = chordAt + between(14, 22);
      playChord(chordAt, chordEnd, energy);
      nextNote = chordAt + between(2, 5);
    }
    while (chordEnd < ahead) {
      chord = nextChord(chord, dark);
      chordAt = chordEnd;
      chordEnd = chordAt + between(14, 24) * (1.15 - 0.3 * energy);
      playChord(chordAt, chordEnd, energy);
    }

    while (nextNote < ahead) {
      const beat = 60 / between(70, 84); // a loose, breathing tempo
      if (phraseLeft <= 0) {
        // Rest, then begin a new phrase. Busier when the boat flies, but never crowded.
        const rest = between(3, 9) * (1.4 - energy);
        nextNote += rest;
        phraseLeft = Math.round(between(3, 5 + 4 * energy));
        if (Math.random() < 0.5) step = nearestStep(pick(CHORDS[chord].tones));
        continue;
      }
      if (Math.random() > 0.12) {
        // A step or two along the scale, leaning to the tones of the chord.
        step = Math.max(0, Math.min(SCALE.length - 1, step + pick([-2, -1, -1, 1, 1, 2, 0])));
        let note = SCALE[step];
        if (Math.random() < 0.45)
          note = closest(
            CHORDS[chord].tones.flatMap((n) => [n, n + 12]),
            note,
          );
        const t = Math.max(nextNote, now + 0.05);
        pluck(t, note, 0.07 + 0.04 * Math.random(), between(-0.6, 0.6));
        if (Math.random() < 0.12) pluck(t + beat / 2, note + 12, 0.025, between(-0.8, 0.8)); // a glint
      }
      phraseLeft--;
      nextNote += beat * pick([1, 1, 1, 2, 2, 1.5, 3]);
    }
  }

  /** @param {string} from @param {number} dark */
  function nextChord(from, dark) {
    const options = CHORDS[from].next;
    const weighted = options.flatMap((c) => {
      const minor = CHORDS[c].minor ? 1 : 0;
      const w = 1 + Math.round(3 * (minor ? dark : 1 - dark));
      return Array(w).fill(c);
    });
    return pick(weighted);
  }

  /** @param {number} t @param {number} end @param {number} energy */
  function playChord(t, end, energy) {
    const c = CHORDS[chord];
    const release = between(5, 8);
    // Pads: each note two detuned voices through a soft filter; slow in, slow out, overlapping the next.
    c.pad.forEach((m, i) => {
      const voiceEnd = end + release;
      const g = ctx.createGain();
      const level = 0.035 * (i === 0 ? 1.2 : 1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + between(3, 6));
      g.gain.setValueAtTime(level, end);
      g.gain.exponentialRampToValueAtTime(0.0001, voiceEnd);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500 + 700 * energy;
      lp.Q.value = 0.3;
      const pan = ctx.createStereoPanner();
      pan.pan.value = (i / (c.pad.length - 1)) * 1.2 - 0.6;
      lp.connect(g).connect(pan).connect(tone);
      [-7, 7].forEach((cents, k) => {
        const osc = ctx.createOscillator();
        osc.type = k ? 'sawtooth' : 'triangle';
        osc.frequency.value = hz(m);
        osc.detune.value = cents;
        osc.connect(lp);
        osc.start(t);
        osc.stop(voiceEnd + 0.1);
      });
    });
    // Bass: a round low root, struck softly at the change and left to fade.
    const b = ctx.createOscillator();
    b.frequency.value = hz(c.root + 12 * (c.root < 40 ? 1 : 0));
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.09, t + 1.5);
    bg.gain.exponentialRampToValueAtTime(0.0001, Math.min(end, t + 12));
    b.connect(bg).connect(tone);
    b.start(t);
    b.stop(Math.min(end, t + 12) + 0.1);
  }

  /**
   * A plucked note, somewhere between a harp and a kalimba.
   * @param {number} t @param {number} m MIDI @param {number} gain @param {number} panTo
   */
  function pluck(t, m, gain, panTo) {
    const f = hz(m);
    const p = ctx.createStereoPanner();
    p.pan.value = panTo;
    p.connect(tone);
    const decay = between(1.8, 3.2);
    [
      [1, 1, decay],
      [2, 0.25, decay * 0.4],
      [3, 0.12, decay * 0.2],
    ].forEach(([mult, amp, d]) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * amp, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(g).connect(p);
      osc.start(t);
      osc.stop(t + d + 0.05);
    });
  }

  return { tick };
}

/** @param {number} note */
function nearestStep(note) {
  let best = 0;
  SCALE.forEach((m, i) => {
    if (Math.abs(m - note) < Math.abs(SCALE[best] - note)) best = i;
  });
  return best;
}

/** @param {number[]} list @param {number} note */
function closest(list, note) {
  return list.reduce((a, b) => (Math.abs(b - note) < Math.abs(a - note) ? b : a));
}
