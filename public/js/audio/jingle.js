// Syrus mode: a bright little tune on square waves, played round and round while she flies.
// If a recording lies at TRACK it is looped instead: drop a file there to change the music
// (see the README). None is shipped, so the tune below is what plays.

/** Where a recording to play in place of the tune may be put. */
export const TRACK = '/assets/audio/syrus.mp3';

/** Eighth notes a second. */
const STEP = 60 / 168 / 2;
/** The tune, as MIDI notes; 0 is a rest. Four bars of eight. */
const LEAD = [
  76, 0, 79, 76, 81, 0, 79, 76, 74, 0, 76, 74, 72, 74, 76, 0, 76, 0, 79, 76, 81, 83, 84, 0, 83, 81,
  79, 76, 74, 76, 72, 0,
];
/** The root under each bar. */
const BASS = [48, 45, 41, 43];

/** @param {number} midi */
const hertz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/**
 * @param {AudioContext | OfflineAudioContext} ctx
 * @param {AudioNode} out
 */
export function createJingle(ctx, out) {
  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(out);
  let on = false;
  let next = 0;
  let step = 0;
  /** The recording, once looked for: a buffer, or null if there is none. @type {AudioBuffer | null | undefined} */
  let track;
  /** @type {AudioBufferSourceNode | null} */
  let playing = null;
  let asked = false;
  const look = () => {
    if (asked) return;
    asked = true;
    fetch(TRACK)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error())))
      .then((bytes) => ctx.decodeAudioData(bytes))
      .then((buffer) => {
        track = buffer;
        if (on) spin();
      })
      .catch(() => {
        track = null;
      });
  };
  const spin = () => {
    if (!track || playing) return;
    playing = ctx.createBufferSource();
    playing.buffer = track;
    playing.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    playing.connect(gain).connect(level);
    playing.start();
  };
  const still = () => {
    playing?.stop(ctx.currentTime + 0.5);
    playing = null;
  };

  /**
   * @param {number} midi @param {number} at @param {number} length seconds
   * @param {OscillatorType} type @param {number} gain
   */
  const note = (midi, at, length, type, gain) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hertz(midi);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.008);
    env.gain.setTargetAtTime(0, at + length * 0.6, length * 0.2);
    osc.connect(env).connect(level);
    osc.start(at);
    osc.stop(at + length + 0.3);
  };

  return {
    /**
     * Called a few times a second: writes the notes of the next half second.
     * @param {number} t the context's time now
     * @param {boolean} flying
     */
    tick(t, flying) {
      if (flying !== on) {
        on = flying;
        level.gain.cancelScheduledValues(t);
        level.gain.setTargetAtTime(on ? 1 : 0, t, on ? 0.03 : 0.15);
        if (on) {
          next = t + 0.06;
          step = 0;
          look();
          spin();
        } else still();
      }
      if (!on || track) return;
      while (next < t + 0.6) {
        const lead = LEAD[step];
        if (lead) note(lead, next, STEP * 0.95, 'square', 0.05);
        const root = BASS[Math.floor(step / 8) % BASS.length];
        note(step % 2 ? root + 12 : root, next, STEP * 0.9, 'triangle', 0.16);
        next += STEP;
        step = (step + 1) % LEAD.length;
      }
    },
  };
}
