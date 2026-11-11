// The weather as the ear hears it: gusts that come and go, a sea that builds and falls with the wind,
// waves that arrive one by one in sets and lulls, hull slaps, spray and surf. Pure: no Web Audio,
// no DOM. Randomness comes in through `random`, so tests can seed it.
//
// Nothing here repeats on a cycle: gusts are a mean-reverting random walk with the odd squall, and
// waves are drawn one at a time, their size and spacing depending on the sea and on where in a set
// they fall.

/**
 * @typedef {{
 *   wind: number, gust?: number | null, sea?: number | null, speed: number, land: number,
 * }} WeatherInput
 *   wind 0..1 (from the log's windSpeed), speed 0..1 (share of top speed), land 0..1 (near shore);
 *   gust and sea 0..1 when the game reports them, otherwise made up here
 * @typedef {{ kind: 'wave' | 'slap' | 'spray' | 'surf', at: number, size: number, pan: number }} SeaEvent
 *   at: seconds from the start of the step; size 0..1; pan -1..1
 * @typedef {{ gust: number, sea: number, swell: number, events: SeaEvent[] }} WeatherFrame
 *   gust 0..1 the wind on top of its mean; sea 0..1 sea state; swell 0..1 how heavy the
 *   current stretch of waves is (sets are heavy, lulls light)
 */

/** @param {number} x */
const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** A standard normal draw. @param {() => number} random */
function normal(random) {
  const u = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** @param {() => number} [random] */
export function createWeather(random = Math.random) {
  /** @param {number} a @param {number} b */
  const between = (a, b) => a + (b - a) * random();

  let gust = 0.3;
  let squall = 0; // extra gust from a passing squall, decays
  let squallRise = 0; // seconds the squall still builds
  let sea = -1; // not yet known
  let swell = 0.6;
  let setLeft = 0; // waves left in the current set
  let lullFor = between(20, 50); // seconds until the next set
  let nextWave = between(0.5, 3);
  let nextSlap = between(1, 3);
  let nextSpray = between(4, 10);
  let nextSurf = between(1, 4);

  /**
   * Advance by dt seconds.
   * @param {number} dt
   * @param {WeatherInput} input
   * @returns {WeatherFrame}
   */
  function step(dt, input) {
    dt = Math.max(0, Math.min(dt, 2));
    const wind = clamp01(input.wind);
    /** @type {SeaEvent[]} */
    const events = [];

    // Gusts: Ornstein-Uhlenbeck round a mean that rises with the wind, plus the odd squall.
    const mean = 0.25 + 0.35 * wind;
    gust += 0.35 * (mean - gust) * dt + 0.32 * Math.sqrt(dt) * normal(random);
    if (squall <= 0.02 && random() < dt * (0.004 + 0.012 * wind)) {
      squallRise = between(3, 8);
      squall = 0.02;
    }
    if (squallRise > 0) {
      squallRise -= dt;
      squall = Math.min(0.6, squall + dt * between(0.06, 0.12));
    } else {
      squall *= Math.exp(-dt / 9);
    }
    gust = clamp01(gust);
    const outGust =
      typeof input.gust === 'number'
        ? clamp01(Math.max(input.gust, gust * 0.5))
        : clamp01(gust + squall);

    // The sea builds slowly with the wind (a minute or so) and falls more slowly still.
    const target =
      typeof input.sea === 'number' ? clamp01(input.sea) : clamp01(0.2 + 0.7 * wind + 0.2 * squall);
    if (sea < 0) sea = target;
    const tau = target > sea ? 40 : 70;
    sea += (target - sea) * (1 - Math.exp(-dt / tau));
    if (typeof input.sea === 'number') sea = target; // the game knows best

    // Sets and lulls.
    if (setLeft <= 0) {
      lullFor -= dt;
      swell += (between(0.35, 0.6) - swell) * (1 - Math.exp(-dt / 8));
      if (lullFor <= 0) {
        setLeft = Math.round(between(4, 9));
        lullFor = between(35, 110) * (1.2 - 0.5 * sea);
      }
    } else {
      swell += (between(0.85, 1) - swell) * (1 - Math.exp(-dt / 4));
    }
    swell = clamp01(swell);

    // Waves, one at a time.
    nextWave -= dt;
    while (nextWave <= 0) {
      const inSet = setLeft > 0;
      const size = clamp01(
        (0.25 + 0.75 * sea) * (inSet ? between(0.75, 1) : between(0.3, 0.8)) * between(0.8, 1.1),
      );
      events.push({ kind: 'wave', at: Math.max(0, dt + nextWave), size, pan: between(-0.9, 0.9) });
      if (inSet) setLeft--;
      // Rougher seas come quicker; sets come in close order.
      const gap = (inSet ? between(3.5, 6.5) : between(5, 12)) * (1.25 - 0.45 * sea);
      nextWave += gap;
    }

    // Slaps of water on the hull: only underway, more often in a sea.
    const speed = clamp01(input.speed);
    if (speed > 0.05) {
      nextSlap -= dt * speed * (0.5 + sea);
      while (nextSlap <= 0) {
        events.push({
          kind: 'slap',
          at: between(0, dt),
          size: clamp01(between(0.3, 1) * (0.4 + 0.6 * speed)),
          pan: between(-0.5, 0.5),
        });
        nextSlap += between(0.6, 2.4);
      }
    }

    // Spray off breaking crests in a strong wind.
    if (outGust > 0.55 && sea > 0.5) {
      nextSpray -= dt * (outGust + sea - 1);
      while (nextSpray <= 0) {
        events.push({
          kind: 'spray',
          at: between(0, dt),
          size: clamp01(outGust),
          pan: between(-1, 1),
        });
        nextSpray += between(1.5, 6);
      }
    }

    // Surf on the shore when land is near.
    const land = clamp01(input.land);
    if (land > 0.05) {
      nextSurf -= dt;
      while (nextSurf <= 0) {
        events.push({
          kind: 'surf',
          at: between(0, dt),
          size: clamp01(land * (0.4 + 0.6 * sea) * between(0.6, 1)),
          pan: between(-0.7, 0.7),
        });
        nextSurf += between(5, 11);
      }
    }

    return { gust: outGust, sea: clamp01(sea), swell, events };
  }

  return { step };
}

/**
 * A small seeded random generator (mulberry32), for tests and previews.
 * @param {number} seed
 * @returns {() => number}
 */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
