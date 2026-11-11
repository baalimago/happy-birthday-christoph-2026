import { graphics } from '#stores/graphics.js';
import { passage } from '#stores/passage.js';
import { voyage } from '#stores/voyage.js';
import { isDone, unlockedViews } from '#game/objectives.js';

/** How long a notice stays up after its cause has gone, in milliseconds. */
const NOTICE_LINGER = 4000;

/** The spoken read-out of the instruments changes no more often than this, in milliseconds. */
const READOUT_EVERY = 1000;

/** The boat cannot sail closer to the wind than this, in radians (about 40 degrees). */
const NO_GO = (40 * Math.PI) / 180;

/** Below this share the hull is in danger. */
const HULL_LOW = 0.3;

/** The boom swings between these angles off the centreline as the sheet runs out, in degrees. */
const BOOM_IN = 6;
const BOOM_OUT = 84;

const POINTS = [
  ['N', 'north'],
  ['NNE', 'north-north-east'],
  ['NE', 'north-east'],
  ['ENE', 'east-north-east'],
  ['E', 'east'],
  ['ESE', 'east-south-east'],
  ['SE', 'south-east'],
  ['SSE', 'south-south-east'],
  ['S', 'south'],
  ['SSW', 'south-south-west'],
  ['SW', 'south-west'],
  ['WSW', 'west-south-west'],
  ['W', 'west'],
  ['WNW', 'west-north-west'],
  ['NW', 'north-west'],
  ['NNW', 'north-north-west'],
];

/** What each notice says. Luffing is left to the trim read-out. */
const NOTICES = {
  '': '',
  luffing: '',
  aground: 'Aground! The hull takes damage. Back off and steer round.',
  edge: 'Here be dragons. The wind turns you back.',
  sinking: 'Holed! She is going down.',
  wrecked: 'Sunk. Towed back to the last place found, and the hull is mended.',
  repaired: 'Hull repaired in port.',
};

/**
 * @param {number} radians a compass bearing, any range
 * @returns {number} whole degrees, 0 to 359
 */
function degrees(radians) {
  const whole = Math.round((radians * 180) / Math.PI) % 360;
  return whole < 0 ? whole + 360 : whole;
}

/**
 * @param {number} radians a compass bearing, any range
 * @returns {string[]} the nearest of the sixteen points, short and spelled out
 */
function point(radians) {
  return POINTS[Math.round(degrees(radians) / 22.5) % 16];
}

/** @param {number} speed 0.35 a lull .. 1 fresh breeze .. 1.6 a squall */
function strength(speed) {
  if (speed < 0.7) return 'light';
  if (speed < 1) return 'moderate';
  return speed < 1.3 ? 'fresh' : 'strong';
}

/** @param {number} trim 0 flapping .. 1 perfect */
function trimWord(trim) {
  if (trim < 0.25) return 'luffing';
  if (trim < 0.55) return 'poor';
  return trim <= 0.8 ? 'fair' : 'good';
}

/**
 * The equivalent of an angle that lies nearest to the last one shown, so a dial that turns
 * through north takes the short way round.
 * @param {number} last degrees, any range
 * @param {number} next degrees, any range
 */
function nearest(last, next) {
  return last + ((((next - last) % 360) + 540) % 360) - 180;
}

/**
 * The HUD: captain's orders, the instruments (compass, wind and sail, speed, trim, hull),
 * the view switcher and notices.
 * Fills and toggles the markup it wraps; reads and writes only the two stores.
 */
export class VoyageHud extends HTMLElement {
  /** @type {AbortController | undefined} */
  #connected;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #lingering;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #reading;

  /** When the spoken read-out last changed, in milliseconds. */
  #readAt = -Infinity;

  /** The read-out waiting for its turn. */
  #readout = '';

  /** What was last written to each target, to skip writes that change nothing. */
  #written = new Map();

  /** Dial angles as last shown, in degrees and unwrapped. */
  #card = 0;
  #arrow = 0;

  /** The side the boom lies on: 1 to port (wind over the starboard side), -1 to starboard. */
  #lee = 1;

  /** The turn of the ship's mark on the compass, degrees. */
  #ship = 0;

  connectedCallback() {
    this.#connected = new AbortController();
    const { signal } = this.#connected;
    this.addEventListener('click', (event) => this.#choose(event), { signal });
    this.addEventListener(
      'click',
      (event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest('button[data-camera]')) {
          graphics.frame(graphics.state.camera === 'free' ? 'follow' : 'free');
          return;
        }
        if (!event.target.closest('button[data-graphics]')) return;
        const { using, loading, wish } = graphics.state;
        const now = loading ? wish : using;
        graphics.ask(now === 'fine' ? 'fast' : 'fine');
      },
      { signal },
    );
    document.addEventListener('keydown', (event) => this.#cycle(event), { signal });
    voyage.addEventListener('change', () => this.#renderVoyage(), { signal });
    passage.addEventListener('change', () => this.#renderPassage(), { signal });
    graphics.addEventListener('change', () => this.#renderGraphics(), { signal });
    signal.addEventListener('abort', () => {
      this.#stopLingering();
      clearTimeout(this.#reading);
      this.#reading = undefined;
    });
    this.#addDoneMarks();
    this.#renderVoyage();
    this.#renderPassage();
    this.#renderGraphics();
  }

  /** The graphics switch: shown where the machine can draw either look, and says which is on. */
  #renderGraphics() {
    const button = this.querySelector('button[data-graphics]');
    if (!(button instanceof HTMLElement)) return;
    const { using, loading, choice, wish } = graphics.state;
    button.hidden = !choice || using === null;
    const fine = using === 'fine';
    let label = fine ? 'Graphics: fine' : 'Graphics: low-poly';
    if (loading) label = wish === 'fine' ? 'Loading fine graphics…' : 'Loading low-poly…';
    if (button.textContent !== label) button.textContent = label;
    button.toggleAttribute('data-loading', loading);
    const camera = this.querySelector('button[data-camera]');
    const framing = graphics.state.camera === 'free' ? 'Camera: free' : 'Camera: follow';
    if (camera && camera.textContent !== framing) camera.textContent = framing;
  }

  /** V steps through the views unlocked so far; C changes how the camera behaves. @param {KeyboardEvent} event */
  #cycle(event) {
    const key = event.key.toLowerCase();
    if (key !== 'v' && key !== 'c') return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable || target.closest('input, textarea, select')) return;
    }
    if (key === 'c') {
      graphics.frame(graphics.state.camera === 'free' ? 'follow' : 'free');
      return;
    }
    const open = [...this.querySelectorAll('button[data-view]:not([hidden])')];
    if (open.length < 2) return;
    const at = open.findIndex((button) => button.getAttribute('aria-pressed') === 'true');
    const next = open[(at + 1) % open.length];
    if (next instanceof HTMLElement) next.click();
  }

  disconnectedCallback() {
    this.#connected?.abort();
  }

  connectedMoveCallback() {}

  /** One visually hidden "done: " per objective, so a tick is not the only sign. */
  #addDoneMarks() {
    for (const item of this.querySelectorAll('li[data-goal]')) {
      if (item.querySelector(':scope > [data-done-mark]')) continue;
      const mark = document.createElement('span');
      mark.dataset.doneMark = '';
      mark.hidden = true;
      mark.textContent = 'done: ';
      item.prepend(mark);
    }
  }

  /** @type {string[] | undefined} the views unlocked at the last render */
  #unlocked;

  /** @returns {Record<string, string>} the view each port unlocks, read from the port cards */
  #portViews() {
    /** @type {Record<string, string>} */
    const views = {};
    const ports = this.closest('voyage-sea')?.querySelectorAll('[data-port][data-view]') ?? [];
    for (const port of ports) {
      if (!(port instanceof HTMLElement)) continue;
      const { card, view } = port.dataset;
      if (card && view) views[card] = view;
    }
    return views;
  }

  /** @param {Event} event */
  #choose(event) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('button[data-view]');
    if (!(button instanceof HTMLButtonElement) || !this.contains(button)) return;
    for (const other of this.querySelectorAll('button[data-fresh]')) {
      other.removeAttribute('data-fresh');
    }
    if (button.dataset.view) voyage.look(button.dataset.view);
  }

  /**
   * Sets the text of the first match, only when it differs from what was last written.
   * @param {string} selector
   * @param {string} text
   */
  #say(selector, text) {
    if (this.#written.get(selector) === text) return;
    const target = this.querySelector(selector);
    if (!target) return;
    this.#written.set(selector, text);
    if (target.textContent !== text) target.textContent = text;
  }

  /**
   * Sets one style property of the first match, only when it differs from what was last written.
   * @param {string} selector
   * @param {'rotate' | 'inlineSize'} property
   * @param {string} value
   */
  #set(selector, property, value) {
    const key = `${selector} ${property}`;
    if (this.#written.get(key) === value) return;
    const target = this.querySelector(selector);
    if (!(target instanceof HTMLElement || target instanceof SVGElement)) return;
    this.#written.set(key, value);
    target.style[property] = value;
  }

  /**
   * Sets or removes a flag attribute on the first match.
   * @param {string} selector
   * @param {string} name
   * @param {boolean} on
   */
  #flag(selector, name, on) {
    const key = `${selector} @${name}`;
    if (this.#written.get(key) === on) return;
    const target = this.querySelector(selector);
    if (!target) return;
    this.#written.set(key, on);
    target.toggleAttribute(name, on);
  }

  #renderVoyage() {
    const { found, view, sailed } = voyage.state;
    const unlocked = unlockedViews(found, this.#portViews());
    const progress = { found, views: unlocked.length, sailed };

    let current = true;
    for (const item of this.querySelectorAll('li[data-goal]')) {
      if (!(item instanceof HTMLElement)) continue;
      const done = isDone(item.dataset.goal ?? '', progress);
      item.toggleAttribute('data-done', done);
      const mark = item.querySelector(':scope > [data-done-mark]');
      if (mark instanceof HTMLElement) mark.hidden = !done;
      if (!done && current) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      if (!done) current = false;
    }

    for (const button of this.querySelectorAll('button[data-view]')) {
      if (!(button instanceof HTMLButtonElement)) continue;
      button.hidden = !unlocked.includes(button.dataset.view ?? '');
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    }
    const group = this.querySelector('.views');
    if (group instanceof HTMLElement) group.hidden = unlocked.length < 2;
    // A view just unlocked is shown off at once: the sea turns to it, and its button is marked
    // until the captain picks a view.
    const fresh = this.#unlocked ? unlocked.filter((id) => !this.#unlocked?.includes(id)) : [];
    this.#unlocked = unlocked;
    if (fresh.length === 1 && unlocked.length > 1) {
      for (const button of this.querySelectorAll('button[data-view]')) {
        button.toggleAttribute('data-fresh', button.getAttribute('data-view') === fresh[0]);
      }
      voyage.look(fresh[0]);
    }

    this.#renderInstruments();
  }

  #renderPassage() {
    this.#renderInstruments();
    this.#renderNotice();
  }

  /** The dials and figures. Runs about ten times a second, so it writes only what changed. */
  #renderInstruments() {
    const { heading, speed, windFrom, windSpeed, relative, sheet, best, trim, engine } =
      passage.state.log;
    const anchored = passage.state.log.anchor === true;
    const hull = Math.round(Math.min(1, Math.max(0, voyage.state.hull ?? 1)) * 100);
    const low = hull < HULL_LOW * 100;

    // Compass: the card turns under a fixed lubber line, which is the way the camera looks, so
    // that the top of the dial is the top of the screen. A small hull on the rim shows the way
    // she heads.
    const view = passage.state.log.view ?? heading;
    const bearing = degrees(view);
    const [short] = point(view);
    const [, long] = point(heading);
    this.#card = nearest(this.#card, (-view * 180) / Math.PI);
    this.#ship = nearest(this.#ship, ((heading - view) * 180) / Math.PI);
    this.#set('[data-ship]', 'rotate', `${this.#ship.toFixed(1)}deg`);
    this.#set('[data-card]', 'rotate', `${this.#card.toFixed(1)}deg`);
    this.#say('[data-heading]', String(bearing).padStart(3, '0'));
    this.#say('[data-point]', short);

    // Wind and sail: the boat is fixed bow-up, the wind comes in over the rim.
    const [windShort, windLong] = point(windFrom);
    const blows = strength(windSpeed);
    this.#arrow = nearest(this.#arrow, (relative * 180) / Math.PI);
    this.#set('[data-wind-arrow]', 'rotate', `${this.#arrow.toFixed(1)}deg`);
    this.#say('[data-wind]', windShort);
    this.#say('[data-wind-strength]', blows);

    // The boom lies to leeward. Dead ahead and dead astern it keeps the side it had.
    const off = Math.abs(relative);
    if (off > 0.1 && off < Math.PI - 0.1) this.#lee = relative > 0 ? 1 : -1;
    const swing = (/** @type {number} */ out) =>
      `${(this.#lee * (BOOM_IN + Math.min(1, Math.max(0, out)) * (BOOM_OUT - BOOM_IN))).toFixed(1)}deg`;
    this.#set('[data-boom]', 'rotate', swing(sheet));
    this.#set('[data-best]', 'rotate', swing(best));

    // Trim, and the no-go zone.
    const word = trimWord(trim);
    const irons = off < NO_GO && !engine;
    this.#say('[data-trim]', word);
    this.#set(
      '[data-trim-bar]',
      'inlineSize',
      `${Math.round(Math.min(1, Math.max(0, trim)) * 100)}%`,
    );
    this.#flag('.instruments', 'data-trimmed', trim > 0.8);
    this.#flag('.instruments', 'data-irons', irons);
    // What to do about it, in plain words. Under engine the sails do not matter.
    let advice = '';
    if (anchored || passage.state.log.syrus) advice = '';
    else if (irons) advice = 'In irons: bear away or start the engine';
    else if (!engine && trim <= 0.8) {
      advice =
        sheet < best
          ? 'Sails too tight: let them out (up arrow)'
          : 'Sails too loose: haul them in (down arrow)';
    }
    // Until the first light is found, the coach talks the captain through the first leg.
    const coach = this.querySelector('[data-coach]');
    if (coach instanceof HTMLElement) {
      const first = this.querySelector('li[data-goal^="port:"]')?.getAttribute('data-goal') ?? '';
      const done = voyage.state.found.includes(first.slice(5));
      let lesson = '';
      if (passage.state.log.syrus) {
        lesson =
          'Syrus mode: she flies over everything. Steer with ← and →. T lands her on the water.';
      } else if (!done && anchored) {
        lesson = 'At anchor: she is held where she lies. Press X to weigh anchor and sail on.';
      } else if (!done && engine) {
        lesson = 'Engine on. Steer (← →) for the lighthouse ahead.';
      } else if (!done && irons) {
        lesson =
          'Bow into the wind: she will not sail. Turn away (← or →), or press E for the engine.';
      } else if (!done && trim <= 0.8) {
        lesson =
          sheet < best
            ? 'First lesson: the lighthouse is ahead and the wind is behind you. Hold ↑ to let the sails out until the boom meets the marker on the wind dial.'
            : 'Too far out now. Hold ↓ to haul the sails in until the boom meets the marker on the wind dial.';
      } else if (!done) {
        lesson = 'Sails drawing well. Steer (← →) for the lighthouse ahead: sail right up to it.';
      }
      if (lesson && coach.textContent !== lesson) coach.textContent = lesson;
      if (coach.hidden === (lesson !== '')) coach.hidden = lesson === '';
    }
    const warning = this.querySelector('[data-irons-note]');
    if (warning instanceof HTMLElement) {
      if (advice && warning.textContent !== advice) warning.textContent = advice;
      if (warning.hidden === (advice !== '')) warning.hidden = advice === '';
    }

    // Speed, and what drives the boat.
    const knots = Math.max(0, speed).toFixed(1);
    let power = 'under sail';
    if (passage.state.log.syrus) power = 'Syrus mode (T lands her)';
    else if (anchored) power = 'at anchor (X weighs it)';
    else if (passage.state.log.rocket) power = 'Amin mode (R stops it)';
    else if (engine) power = 'under engine';
    else if (speed < 0.05) power = 'stopped';
    this.#say('[data-speed]', knots);
    this.#say('[data-power]', power);

    // Hull: a bar, a figure, and below 30 percent a word and a mark as well as a colour.
    this.#say('[data-hull]', String(hull));
    this.#set('[data-hull-bar]', 'inlineSize', `${hull}%`);
    this.#flag('.hull', 'data-low', low);
    const alarm = this.querySelector('[data-hull-low]');
    if (alarm instanceof HTMLElement && alarm.hidden === low) alarm.hidden = !low;

    let side = 'ahead';
    if (off > Math.PI - 0.1) side = 'astern';
    else if (off >= 0.1) side = `${degrees(off)} degrees to ${relative > 0 ? 'starboard' : 'port'}`;
    this.#read(
      [
        `Heading ${bearing} degrees, ${long}.`,
        `Wind from the ${windLong}, ${blows}, ${side}.`,
        `${knots} knots, ${power}.`,
        irons ? `${advice}.` : `Trim ${word}.${advice ? ` ${advice}.` : ''}`,
        `Hull ${hull} percent${low ? ', low' : ''}.`,
      ].join(' '),
    );
  }

  /**
   * The instruments as one sentence for assistive technology, changed at most once a second.
   * @param {string} text
   */
  #read(text) {
    this.#readout = text;
    if (this.#reading !== undefined) return;
    const wait = this.#readAt + READOUT_EVERY - performance.now();
    if (wait <= 0) {
      this.#readAt = performance.now();
      this.#say('[data-readout]', text);
    } else {
      this.#reading = setTimeout(() => {
        this.#reading = undefined;
        this.#read(this.#readout);
      }, wait);
    }
  }

  #renderNotice() {
    const { near, notice } = passage.state;
    const status = this.querySelector('[data-notice]');
    if (!status) return;
    let message = NOTICES[notice] ?? '';
    if (!message && near) message = `Arrived at ${this.#portName(near)}`;

    if (message) {
      this.#stopLingering();
      if (status.textContent !== message) status.textContent = message;
    } else if (status.textContent && this.#lingering === undefined) {
      this.#lingering = setTimeout(() => {
        this.#lingering = undefined;
        status.textContent = '';
      }, NOTICE_LINGER);
    }
  }

  /**
   * @param {string} port
   * @returns {string} the heading of that port's card
   */
  #portName(port) {
    const heading = document.getElementById(`port-${port}`)?.querySelector('h2');
    return heading?.textContent?.replace(/\s+/g, ' ').trim() || 'port';
  }

  #stopLingering() {
    clearTimeout(this.#lingering);
    this.#lingering = undefined;
  }
}
